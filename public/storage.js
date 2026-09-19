const DB_NAME = "crown-board";
const STORE_NAME = "handles";
const HANDLE_KEY = "campaign";

function emptyLayout() {
  return { formatVersion: 1, children: [] };
}

export async function revisionOf(source) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const bytes = [...new Uint8Array(digest)];
  return `"${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}"`;
}

export function pathParts(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")) throw new Error(`Небезпечний шлях: ${path}`);
  const parts = path.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error(`Небезпечний шлях: ${path}`);
  return parts;
}

async function directoryAt(root, parts, create = false) {
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return directory;
}

async function fileAt(root, path, create = false) {
  const parts = pathParts(path);
  const name = parts.pop();
  const directory = await directoryAt(root, parts, create);
  return directory.getFileHandle(name, { create });
}

async function readText(root, path) {
  const handle = await fileAt(root, path);
  return (await handle.getFile()).text();
}

async function writeFile(root, path, contents) {
  const handle = await fileAt(root, path, true);
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
  } finally {
    await writable.close();
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storedHandle() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function rememberHandle(handle) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function collectNames(directory, names = new Set()) {
  try {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "directory") await collectNames(handle, names);
      else names.add(name.toLocaleLowerCase("uk"));
    }
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
  }
  return names;
}

export function webPName(originalName) {
  const stem = originalName.replace(/\.[^.]+$/, "").normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim() || "image";
  return `${stem}.webp`;
}

async function uniqueName(mediaDirectory, originalName) {
  const names = await collectNames(mediaDirectory);
  const preferred = webPName(originalName);
  const stem = preferred.slice(0, -5);
  let candidate = preferred;
  let suffix = 2;
  while (names.has(candidate.toLocaleLowerCase("uk"))) candidate = `${stem}-${suffix++}.webp`;
  return candidate;
}

function createDirectoryStorage() {
  let root = null;
  let config = null;
  const objectUrls = new Map();

  async function permission(handle, request = false) {
    const options = { mode: "readwrite" };
    if ((await handle.queryPermission(options)) === "granted") return true;
    return request && (await handle.requestPermission(options)) === "granted";
  }

  async function useHandle(handle, requestPermission) {
    if (!handle || !(await permission(handle, requestPermission))) return false;
    if (root && !(await root.isSameEntry(handle))) {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    }
    root = handle;
    return true;
  }

  return {
    kind: "directory",
    async restore() {
      try { return await useHandle(await storedHandle(), false); } catch { return false; }
    },
    async connect() {
      if (!("showDirectoryPicker" in window)) throw new Error("Потрібен desktop Chrome або Edge із File System Access API");
      const handle = await window.showDirectoryPicker({ id: "crown-campaign", mode: "readwrite", startIn: "documents" });
      if (!(await useHandle(handle, true))) throw new Error("Потрібен дозвіл на читання й запис папки кампанії");
      await rememberHandle(handle);
    },
    async loadBoard() {
      if (!root) throw new Error("Спочатку відкрий папку кампанії");
      config = JSON.parse(await readText(root, "board.config.json"));
      if (config.boardConfigVersion !== 1) throw new Error(`Непідтримувана boardConfigVersion: ${config.boardConfigVersion}`);
      let source;
      try { source = await readText(root, config.layout); }
      catch (error) {
        if (error.name !== "NotFoundError") throw error;
        source = `${JSON.stringify(emptyLayout(), null, 2)}\n`;
      }
      return { campaign: root.name, config, layout: JSON.parse(source), revision: await revisionOf(source) };
    },
    async saveLayout(layout, expectedRevision) {
      let currentSource;
      try { currentSource = await readText(root, config.layout); }
      catch (error) {
        if (error.name !== "NotFoundError") throw error;
        currentSource = `${JSON.stringify(emptyLayout(), null, 2)}\n`;
      }
      if ((await revisionOf(currentSource)) !== expectedRevision) throw new Error("canvas.json змінився поза канвою. Перезавантаж сторінку, щоб не втратити зміни.");
      const source = `${JSON.stringify(layout, null, 2)}\n`;
      await writeFile(root, config.layout, source);
      return { revision: await revisionOf(source) };
    },
    async saveMedia(blob, kind, originalName) {
      const mediaParts = pathParts(config.media.dir);
      const mediaDirectory = await directoryAt(root, mediaParts, true);
      const name = await uniqueName(mediaDirectory, originalName);
      const subdirectory = kind === "map" ? "maps" : "locations";
      const path = `${config.media.dir}/${subdirectory}/${name}`;
      await writeFile(root, path, blob);
      return { name, path };
    },
    async saveThumbnail(blob, mediaPath) {
      await writeFile(root, `.cache/board/${mediaPath.split("/").at(-1)}`, blob);
    },
    async mediaUrl(mediaPath, thumbnail = false) {
      const key = `${thumbnail ? "thumb:" : "full:"}${mediaPath}`;
      if (objectUrls.has(key)) return objectUrls.get(key);
      let handle;
      try {
        handle = await fileAt(root, thumbnail ? `.cache/board/${mediaPath.split("/").at(-1)}` : mediaPath);
      } catch (error) {
        if (!thumbnail || error.name !== "NotFoundError") throw error;
        return this.mediaUrl(mediaPath, false);
      }
      const url = URL.createObjectURL(await handle.getFile());
      objectUrls.set(key, url);
      return url;
    },
  };
}

function createServerStorage() {
  return {
    kind: "server",
    async restore() { return true; },
    async connect() {},
    async loadBoard() {
      const response = await fetch("/api/board");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не вдалося завантажити дошку");
      return result;
    },
    async saveLayout(layout, revision) {
      const response = await fetch("/api/layout", {
        method: "PUT", headers: { "content-type": "application/json", "if-match": revision }, body: JSON.stringify(layout),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не вдалося зберегти");
      return result;
    },
    async saveMedia(blob, kind, originalName) {
      const response = await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "image/webp", "x-media-kind": kind, "x-file-name": encodeURIComponent(originalName) },
        body: blob,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Не вдалося зберегти ${originalName}`);
      return result;
    },
    async saveThumbnail(blob, mediaPath) {
      const response = await fetch("/api/thumbnail", {
        method: "POST", headers: { "content-type": "image/webp", "x-media-path": encodeURIComponent(mediaPath) }, body: blob,
      });
      if (!response.ok) throw new Error("Не вдалося зберегти мініатюру");
    },
    async mediaUrl(mediaPath, thumbnail = false) {
      return `/api/media?path=${encodeURIComponent(mediaPath)}${thumbnail ? "&thumbnail=1" : ""}`;
    },
  };
}

export async function createStorage() {
  try {
    const response = await fetch("./api/health", { cache: "no-store" });
    if (response.ok && (await response.json()).ok) return createServerStorage();
  } catch {}
  return createDirectoryStorage();
}
