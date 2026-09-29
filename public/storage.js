// Імʼя бази лишається старим: у ній уже лежать запамʼятовані теки кампаній.
const DB_NAME = "crown-board";
const STORE_NAME = "handles";
// Колись тека була одна, під цим ключем; такий запис стає першою кампанією
// списку.
const LEGACY_HANDLE_KEY = "campaign";
const RECENT_PREFIX = "recent:";

import { campaignKey, campaignName, parseBoardConfig } from "./board-config.js";
import { parseFrontmatter as builtInFrontmatter } from "./frontmatter.js";
import { entityRecord, finalizeEntities, indexedTypes } from "./entities.js";
import { emptyLayout, parseLayout, validateLayout } from "./layout.js";
import {
  appendNoteBlock,
  newNoteDocument,
  nextNoteAnchor,
  noteFileSlug,
  parseNoteBlocks,
  removeNoteBlock,
  splitNoteReference,
  updateNoteBlock,
} from "./notes.js";

function emptyLayoutSource() {
  return `${JSON.stringify(emptyLayout(), null, 2)}\n`;
}

// canvas.json змінився поза канвою (AI, git pull, інша вкладка). Це не збій
// запису, а питання до ДМа — чиї зміни лишити, — тож канва розпізнає його
// окремо від решти помилок.
export class LayoutConflictError extends Error {
  constructor(message = "canvas.json змінився поза канвою") {
    super(message);
    this.name = "LayoutConflictError";
  }
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

async function readTextIfExists(root, path) {
  try { return await readText(root, path); }
  catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
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

function settled(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, work) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const done = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    const result = await work(transaction.objectStore(STORE_NAME));
    await done;
    return result;
  } finally {
    database.close();
  }
}

// Запамʼятовані теки кампаній: handle теки можна зберегти в IndexedDB, на
// відміну від шляху. Запис — { id, handle, name, folder, openedAt }.
export function indexedDbCampaigns() {
  return {
    async list() {
      const [keys, values] = await withStore("readonly", (store) => Promise.all([settled(store.getAllKeys()), settled(store.getAll())]));
      const entries = [];
      let legacy = null;
      keys.forEach((key, index) => {
        if (key === LEGACY_HANDLE_KEY) legacy = values[index];
        else if (String(key).startsWith(RECENT_PREFIX)) entries.push(values[index]);
      });
      if (legacy) {
        const entry = { id: crypto.randomUUID(), handle: legacy, name: legacy.name, folder: legacy.name, openedAt: 0 };
        await withStore("readwrite", (store) => {
          store.put(entry, RECENT_PREFIX + entry.id);
          store.delete(LEGACY_HANDLE_KEY);
        });
        entries.push(entry);
      }
      return entries;
    },
    async put(entry) {
      await withStore("readwrite", (store) => { store.put(entry, RECENT_PREFIX + entry.id); });
    },
    async remove(id) {
      await withStore("readwrite", (store) => { store.delete(RECENT_PREFIX + id); });
    },
  };
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

async function collectMedia(directory, prefix = "", result = new Map()) {
  try {
    for await (const [name, handle] of directory.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") await collectMedia(handle, path, result);
      else result.set(name.toLocaleLowerCase("uk"), path);
    }
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
  }
  return result;
}

async function collectMarkdown(directory, skipDirs, prefix = "", result = []) {
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory") {
      if (!skipDirs.has(name)) await collectMarkdown(handle, skipDirs, prefix ? `${prefix}/${name}` : name, result);
    } else if (name.toLowerCase().endsWith(".md")) {
      const path = prefix ? `${prefix}/${name}` : name;
      result.push({ path, source: await (await handle.getFile()).text() });
    }
  }
  return result;
}

async function importFrontmatter(root, path) {
  const source = await readText(root, path);
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const module = await import(url);
    if (typeof module.parseFrontmatter !== "function") throw new Error(`${path} не експортує parseFrontmatter`);
    return module.parseFrontmatter;
  } finally {
    URL.revokeObjectURL(url);
  }
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

// `root` — уже відкрита тека: так сховище можна зібрати поверх будь-якого
// FileSystemDirectoryHandle (у тестах — поверх теки в памʼяті), без пікера.
// `campaigns` — де памʼятати теки; типово IndexedDB браузера.
export function createDirectoryStorage({ root: initialRoot = null, campaigns = indexedDbCampaigns() } = {}) {
  let root = initialRoot;
  let currentId = null;
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

  async function entries() {
    return (await campaigns.list()).sort((first, second) => second.openedAt - first.openedAt);
  }

  return {
    kind: "directory",
    // Нещодавні кампанії, найсвіжіша перша, — для екрана вибору.
    async recent() {
      try {
        return (await entries()).map(({ id, name, folder, openedAt }) => ({ id, name, folder, openedAt }));
      } catch {
        return [];
      }
    },
    // Без кліку можна відкрити лише теку, дозвіл на яку браузер ще памʼятає, —
    // і лише останню: мовчки перескочити на іншу кампанію не можна.
    async restore() {
      try {
        const [latest] = await entries();
        if (!latest || !(await useHandle(latest.handle, false))) return false;
        currentId = latest.id;
        return true;
      } catch {
        return false;
      }
    },
    // `{ id }` — запамʼятована кампанія (дозвіл питається з цього кліку),
    // без нього — системний вибір теки.
    async connect({ id = null } = {}) {
      if (id) {
        const entry = (await entries()).find((candidate) => candidate.id === id);
        if (!entry) throw new Error("Цієї кампанії вже немає в списку");
        let granted;
        try { granted = await useHandle(entry.handle, true); }
        catch { throw new Error(`Теку «${entry.folder}» не знайдено — можливо, її перенесли. Обери її заново.`); }
        if (!granted) throw new Error("Потрібен дозвіл на читання й запис теки кампанії");
        currentId = id;
        return;
      }
      if (!("showDirectoryPicker" in window)) throw new Error("Потрібен desktop Chrome або Edge із File System Access API");
      const handle = await window.showDirectoryPicker({ id: "crown-campaign", mode: "readwrite", startIn: "documents" });
      if (!(await useHandle(handle, true))) throw new Error("Потрібен дозвіл на читання й запис теки кампанії");
      let known = null;
      for (const entry of await entries().catch(() => [])) {
        if (await entry.handle.isSameEntry(handle).catch(() => false)) { known = entry; break; }
      }
      currentId = known?.id ?? crypto.randomUUID();
      await campaigns.put({ ...known, id: currentId, handle, name: known?.name ?? handle.name, folder: handle.name, openedAt: Date.now() }).catch(() => {});
    },
    async forget(id) {
      await campaigns.remove(id);
      if (id === currentId) currentId = null;
    },
    async loadBoard() {
      if (!root) throw new Error("Спочатку відкрий теку кампанії");
      const configSource = await readTextIfExists(root, "board.config.json");
      if (configSource === null) throw new Error(`У теці «${root.name}» немає board.config.json — це не тека кампанії`);
      config = parseBoardConfig(configSource);
      let source;
      try { source = await readText(root, config.layout); }
      catch (error) {
        if (error.name !== "NotFoundError") throw error;
        source = emptyLayoutSource();
      }
      // Зламаний чи новіший за редактор canvas.json зупиняє відкриття з
      // поясненням — інакше канва впала б деінде або перезаписала його по-своєму.
      const layout = parseLayout(source, config.layout);
      const name = campaignName(config, root.name);
      if (currentId) {
        const entry = (await entries().catch(() => [])).find((candidate) => candidate.id === currentId);
        if (entry) await campaigns.put({ ...entry, name, folder: root.name, openedAt: Date.now() }).catch(() => {});
      }
      return { campaign: name, campaignKey: campaignKey(config, root.name), config, layout, revision: await revisionOf(source) };
    },
    async loadEntities() {
      if (!root || !config) throw new Error("Спочатку відкрий теку кампанії");
      const parseFrontmatter = config.frontmatter ? await importFrontmatter(root, config.frontmatter) : builtInFrontmatter;
      // Нова кампанія може ще не мати теки з портретами.
      let mediaByName = new Map();
      try {
        mediaByName = await collectMedia(await directoryAt(root, pathParts(config.media.entityDir)), config.media.entityDir);
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      const documents = await collectMarkdown(root, new Set(config.entities.skipDirs));
      const types = indexedTypes(config.entities);
      return finalizeEntities(documents.flatMap(({ path, source }) => {
        const { meta, body } = parseFrontmatter(source, path);
        return types.has(meta.type) ? [entityRecord(path, meta, body, config.entities, mediaByName)] : [];
      }));
    },
    async loadNotes() {
      if (!root || !config) throw new Error("Спочатку відкрий теку кампанії");
      let directory;
      try { directory = await directoryAt(root, pathParts(config.notes.dir)); }
      catch (error) {
        if (error.name === "NotFoundError") return [];
        throw error;
      }
      const notes = [];
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind !== "file" || !name.toLowerCase().endsWith(".md")) continue;
        const fileSlug = name.slice(0, -3);
        notes.push(...parseNoteBlocks(await (await handle.getFile()).text(), fileSlug));
      }
      return notes;
    },
    async createNote(mapSlug, mapName, text) {
      const fileSlug = noteFileSlug(mapSlug, config.notes);
      const path = `${config.notes.dir}/${fileSlug}.md`;
      const source = await readTextIfExists(root, path) ?? newNoteDocument(config.notes.type, `${mapName} (нотатки дошки)`);
      const anchor = nextNoteAnchor(source);
      const next = appendNoteBlock(source, anchor, text);
      await writeFile(root, path, next);
      return { reference: `${fileSlug}#${anchor}`, text: text.trim() };
    },
    async updateNote(reference, text) {
      const { fileSlug, anchor } = splitNoteReference(reference);
      const path = `${config.notes.dir}/${fileSlug}.md`;
      const source = await readText(root, path);
      await writeFile(root, path, updateNoteBlock(source, anchor, text));
      return { reference, text: text.trim() };
    },
    async moveNote(reference, mapSlug, mapName) {
      const from = splitNoteReference(reference);
      const targetSlug = noteFileSlug(mapSlug, config.notes);
      if (from.fileSlug === targetSlug) return { reference, text: parseNoteBlocks(await readText(root, `${config.notes.dir}/${from.fileSlug}.md`), from.fileSlug).find((note) => note.reference === reference)?.text ?? "" };
      const sourcePath = `${config.notes.dir}/${from.fileSlug}.md`;
      const source = await readText(root, sourcePath);
      const note = parseNoteBlocks(source, from.fileSlug).find((candidate) => candidate.reference === reference);
      if (!note) throw new Error(`Не знайдено нотатку ${reference}`);
      const targetPath = `${config.notes.dir}/${targetSlug}.md`;
      const target = await readTextIfExists(root, targetPath) ?? newNoteDocument(config.notes.type, `${mapName} (нотатки дошки)`);
      const anchor = nextNoteAnchor(target);
      const nextReference = `${targetSlug}#${anchor}`;
      await writeFile(root, targetPath, appendNoteBlock(target, anchor, note.text));
      await writeFile(root, sourcePath, removeNoteBlock(source, from.anchor));
      return { reference: nextReference, text: note.text };
    },
    async deleteNote(reference) {
      const { fileSlug, anchor } = splitNoteReference(reference);
      const path = `${config.notes.dir}/${fileSlug}.md`;
      const source = await readText(root, path);
      const note = parseNoteBlocks(source, fileSlug).find((candidate) => candidate.reference === reference);
      if (!note) throw new Error(`Не знайдено нотатку ${reference}`);
      await writeFile(root, path, removeNoteBlock(source, anchor));
      return { reference, text: note.text };
    },
    async restoreNote(reference, text) {
      const { fileSlug, anchor } = splitNoteReference(reference);
      const path = `${config.notes.dir}/${fileSlug}.md`;
      const source = await readText(root, path);
      if (parseNoteBlocks(source, fileSlug).some((note) => note.reference === reference)) throw new Error(`Нотатка ${reference} вже існує`);
      await writeFile(root, path, appendNoteBlock(source, anchor, text));
      return { reference, text: text.trim() };
    },
    // Ревізія того, що зараз на диску, без розбору: «перезаписати своїм» має
    // спрацювати й тоді, коли чужа правка лишила файл зламаним.
    async currentRevision() {
      return revisionOf(await readTextIfExists(root, config.layout) ?? emptyLayoutSource());
    },
    async saveLayout(layout, expectedRevision) {
      // Биту розкладку на диск не пускаємо: тека — єдина копія дошки.
      validateLayout(layout);
      const currentSource = await readTextIfExists(root, config.layout) ?? emptyLayoutSource();
      if ((await revisionOf(currentSource)) !== expectedRevision) throw new LayoutConflictError();
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
      const cacheDir = config.media.cacheDir;
      await writeFile(root, `${cacheDir}/${mediaPath.split("/").at(-1)}`, blob);
    },
    // На відміну від mediaUrl, без відкату на оригінал: нема мініатюри — null,
    // і її зробить сама канва.
    async cachedThumbnail(mediaPath) {
      const cacheDir = config.media.cacheDir;
      try {
        return await (await fileAt(root, `${cacheDir}/${mediaPath.split("/").at(-1)}`)).getFile();
      } catch (error) {
        if (error.name === "NotFoundError") return null;
        throw error;
      }
    },
    async mediaUrl(mediaPath, thumbnail = false) {
      const key = `${thumbnail ? "thumb:" : "full:"}${mediaPath}`;
      if (objectUrls.has(key)) return objectUrls.get(key);
      let handle;
      try {
        const cacheDir = config.media.cacheDir;
        handle = await fileAt(root, thumbnail ? `${cacheDir}/${mediaPath.split("/").at(-1)}` : mediaPath);
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
    // Сервер запущено на одну кампанію (`--base`), тож вибирати нема з чого.
    async recent() { return []; },
    async restore() { return true; },
    async connect() {},
    async forget() {},
    async loadBoard() {
      const response = await fetch("/api/board");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не вдалося завантажити дошку");
      return result;
    },
    async loadEntities() {
      const response = await fetch("/api/entities");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не вдалося завантажити картки");
      return result.entities;
    },
    async loadNotes() {
      const response = await fetch("/api/notes");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не вдалося завантажити нотатки");
      return result.notes;
    },
    async createNote(mapSlug, mapName, text) {
      return noteRequest("/api/notes", "POST", { mapSlug, mapName, text });
    },
    async updateNote(reference, text) {
      return noteRequest("/api/notes", "PUT", { reference, text });
    },
    async moveNote(reference, mapSlug, mapName) {
      return noteRequest("/api/notes/move", "POST", { reference, mapSlug, mapName });
    },
    async deleteNote(reference) {
      return noteRequest("/api/notes", "DELETE", { reference });
    },
    async restoreNote(reference, text) {
      return noteRequest("/api/notes/restore", "POST", { reference, text });
    },
    async saveLayout(layout, revision) {
      const response = await fetch("/api/layout", {
        method: "PUT", headers: { "content-type": "application/json", "if-match": revision }, body: JSON.stringify(layout),
      });
      const result = await response.json();
      if (response.status === 409) throw new LayoutConflictError(result.error);
      if (!response.ok) throw new Error(result.error || "Не вдалося зберегти");
      return result;
    },
    async currentRevision() {
      const response = await fetch("/api/board", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не вдалося прочитати canvas.json");
      return result.revision;
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
    async cachedThumbnail(mediaPath) {
      const response = await fetch(`/api/media?path=${encodeURIComponent(mediaPath)}&thumbnail=only`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Не вдалося прочитати мініатюру");
      return response.blob();
    },
    async mediaUrl(mediaPath, thumbnail = false) {
      return `/api/media?path=${encodeURIComponent(mediaPath)}${thumbnail ? "&thumbnail=1" : ""}`;
    },
  };
}

async function noteRequest(path, method, body) {
  const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не вдалося зберегти нотатку");
  return result;
}

export async function createStorage() {
  try {
    const response = await fetch("./api/health", { cache: "no-store" });
    if (response.ok && (await response.json()).ok) return createServerStorage();
  } catch {}
  return createDirectoryStorage();
}
