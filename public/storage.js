const DB_NAME = "crown-board";
const STORE_NAME = "handles";
const HANDLE_KEY = "campaign";

import { entityRecord, finalizeEntities } from "./entities.js";
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

function createDirectoryStorage() {
  let root = null;
  let rememberedRoot = null;
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
      try {
        rememberedRoot = await storedHandle();
        return await useHandle(rememberedRoot, false);
      } catch {
        return false;
      }
    },
    async connect(chooseNew = false) {
      if (!("showDirectoryPicker" in window)) throw new Error("Потрібен desktop Chrome або Edge із File System Access API");

      // A directory handle can be persisted in IndexedDB, unlike a filesystem
      // path in localStorage. Browsers may still reset its permission between
      // sessions, so first re-authorize the remembered handle from this click.
      if (!chooseNew && rememberedRoot) {
        try {
          if (await useHandle(rememberedRoot, true)) return;
        } catch {
          // The directory may have been moved or removed; fall back to picker.
        }
      }

      const handle = await window.showDirectoryPicker({ id: "crown-campaign", mode: "readwrite", startIn: "documents" });
      if (!(await useHandle(handle, true))) throw new Error("Потрібен дозвіл на читання й запис папки кампанії");
      rememberedRoot = handle;
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
    async loadEntities() {
      if (!root || !config) throw new Error("Спочатку відкрий папку кампанії");
      const parseFrontmatter = await importFrontmatter(root, config.frontmatter);
      const entityMediaDir = config.media.entityDir ?? config.media.dir;
      const mediaRoot = await directoryAt(root, pathParts(entityMediaDir));
      const mediaByName = await collectMedia(mediaRoot, entityMediaDir);
      const documents = await collectMarkdown(root, new Set(config.entities.skipDirs));
      const types = new Set(config.entities.types);
      return finalizeEntities(documents.flatMap(({ path, source }) => {
        const { meta, body } = parseFrontmatter(source, path);
        return types.has(meta.type) ? [entityRecord(path, meta, body, config.entities, mediaByName)] : [];
      }));
    },
    async loadNotes() {
      if (!root || !config) throw new Error("Спочатку відкрий папку кампанії");
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
      const cacheDir = config.media.cacheDir ?? ".cache/board";
      await writeFile(root, `${cacheDir}/${mediaPath.split("/").at(-1)}`, blob);
    },
    async mediaUrl(mediaPath, thumbnail = false) {
      const key = `${thumbnail ? "thumb:" : "full:"}${mediaPath}`;
      if (objectUrls.has(key)) return objectUrls.get(key);
      let handle;
      try {
        const cacheDir = config.media.cacheDir ?? ".cache/board";
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
    async restore() { return true; },
    async connect() {},
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
