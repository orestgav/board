import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { entityRecord, finalizeEntities } from "../public/entities.js";
import {
  appendNoteBlock,
  newNoteDocument,
  nextNoteAnchor,
  noteFileSlug,
  parseNoteBlocks,
  removeNoteBlock,
  splitNoteReference,
  updateNoteBlock,
} from "../public/notes.js";
import { canonicalYouTubeUrl } from "../public/music.js";

export const LAYOUT_VERSION = 1;
const STATIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function errorResponse(response, status, message) {
  json(response, status, { error: message });
}

function safePath(root, configuredPath) {
  if (typeof configuredPath !== "string" || configuredPath.length === 0 || isAbsolute(configuredPath)) {
    throw new Error("Шлях layout у board.config.json має бути відносним");
  }
  const target = resolve(root, configuredPath);
  const relation = relative(root, target);
  if (relation.startsWith(`..${sep}`) || relation === "..") throw new Error("Шлях layout виходить за межі кампанії");
  return target;
}

function revisionOf(source) {
  return `"${createHash("sha256").update(source).digest("base64url")}"`;
}

export function emptyLayout() {
  return { formatVersion: LAYOUT_VERSION, children: [] };
}

export function validateLayout(layout) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) throw new Error("Розкладка має бути об'єктом");
  if (layout.formatVersion !== LAYOUT_VERSION) {
    const relation = Number(layout.formatVersion) > LAYOUT_VERSION ? "новіша за редактор" : "має непідтримувану версію";
    throw new Error(`Розкладка ${relation}: ${layout.formatVersion ?? "відсутня"}`);
  }
  if (!Array.isArray(layout.children)) throw new Error("children має бути масивом");

  const ids = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error("Кожен вузол має бути об'єктом");
    if (typeof node.id !== "string" || !node.id) throw new Error("Кожен вузол мусить мати id");
    if (ids.has(node.id)) throw new Error(`Повторний id вузла: ${node.id}`);
    ids.add(node.id);
    if (!["frame", "scene", "image", "entity", "note", "music"].includes(node.type)) throw new Error(`Непідтримуваний тип вузла: ${node.type}`);
    for (const field of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(node[field])) throw new Error(`${node.id}.${field} має бути числом`);
    }
    if (node.width <= 0 || node.height <= 0) throw new Error(`${node.id}: вузол має мати додатний розмір`);
    if (["frame", "scene"].includes(node.type) && typeof node.title !== "string") throw new Error(`${node.id}.title має бути рядком`);
    if (node.type === "image") {
      const imagePath = typeof node.image === "string" ? node.image.replaceAll("\\", "/") : "";
      if (!imagePath.toLowerCase().endsWith(".webp") || imagePath.startsWith("/") || imagePath.split("/").includes("..")) {
        throw new Error(`${node.id}.image має бути безпечним відносним шляхом до WebP`);
      }
    }
    if (node.type === "entity" && (typeof node.entity !== "string" || !node.entity)) {
      throw new Error(`${node.id}.entity має бути непорожнім slug`);
    }
    // Поточні HP статблока: у кожної копії істоти свої, тож живуть у вузлі.
    // Мінус — нормальне значення: так видно, наскільки істоту перебили.
    if (node.hp !== undefined && !Number.isFinite(node.hp)) {
      throw new Error(`${node.id}.hp має бути числом`);
    }
    // Кілька однакових істот на одній картці: у кожної свої HP й назва. Поки
    // істота одна, вузол лишається на node.hp і масиву не має.
    if (node.creatures !== undefined) {
      if (!Array.isArray(node.creatures) || !node.creatures.length) {
        throw new Error(`${node.id}.creatures має бути непорожнім масивом`);
      }
      for (const creature of node.creatures) {
        if (!creature || typeof creature !== "object" || Array.isArray(creature)) {
          throw new Error(`${node.id}.creatures: кожна істота має бути об'єктом`);
        }
        if (creature.hp !== undefined && !Number.isFinite(creature.hp)) {
          throw new Error(`${node.id}.creatures: hp істоти має бути числом`);
        }
        if (creature.name !== undefined && typeof creature.name !== "string") {
          throw new Error(`${node.id}.creatures: назва істоти має бути рядком`);
        }
      }
    }
    // Схований опис картки NPC; показаний — за замовчуванням, без поля.
    if (node.hideSummary !== undefined && typeof node.hideSummary !== "boolean") {
      throw new Error(`${node.id}.hideSummary має бути булевим`);
    }
    // Розмитий, як під спойлером, текст нотатки; видимий — без поля.
    if (node.hideText !== undefined && typeof node.hideText !== "boolean") {
      throw new Error(`${node.id}.hideText має бути булевим`);
    }
    if (node.type === "music") {
      if (!canonicalYouTubeUrl(node.url)) throw new Error(`${node.id}.url має бути лінком на ролік YouTube`);
      if (node.title !== undefined && typeof node.title !== "string") throw new Error(`${node.id}.title має бути рядком`);
    }
    if (node.type === "note") splitNoteReference(node.note);
    if (!Array.isArray(node.children)) throw new Error(`${node.id}.children має бути масивом`);
    node.children.forEach(visit);
  };
  layout.children.forEach(visit);
  return layout;
}

async function readConfig(base) {
  const configPath = join(base, "board.config.json");
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Не знайдено ${configPath}`);
    throw new Error(`Не вдалося прочитати board.config.json: ${error.message}`);
  }
  if (config.boardConfigVersion !== 1) throw new Error(`Непідтримувана boardConfigVersion: ${config.boardConfigVersion}`);
  return { config, layoutPath: safePath(base, config.layout) };
}

async function readLayout(layoutPath) {
  try {
    const source = await readFile(layoutPath, "utf8");
    return { layout: validateLayout(JSON.parse(source)), revision: revisionOf(source) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const layout = emptyLayout();
    const source = `${JSON.stringify(layout, null, 2)}\n`;
    return { layout, revision: revisionOf(source) };
  }
}

async function atomicWrite(path, source) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporary, source, { flag: "wx" });
  await rename(temporary, path);
}

async function readBuffer(request, limit = 2_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error("Запит завеликий");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(request, limit = 2_000_000) {
  return (await readBuffer(request, limit)).toString("utf8");
}

function isWebP(buffer) {
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

async function collectFileNames(root, result = new Set()) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await collectFileNames(path, result);
    else result.add(entry.name.toLocaleLowerCase("uk"));
  }
  return result;
}

async function collectMediaPaths(root, campaignRoot, result = new Map()) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await collectMediaPaths(path, campaignRoot, result);
    else result.set(entry.name.toLocaleLowerCase("uk"), relative(campaignRoot, path).split(sep).join("/"));
  }
  return result;
}

async function collectMarkdown(root, skipDirs, campaignRoot = root, result = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) await collectMarkdown(path, skipDirs, campaignRoot, result);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      result.push({ path: relative(campaignRoot, path).split(sep).join("/"), source: await readFile(path, "utf8") });
    }
  }
  return result;
}

async function readEntities(campaignRoot, config) {
  const parserPath = safePath(campaignRoot, config.frontmatter);
  const parser = await import(`${pathToFileURL(parserPath).href}?board=${Date.now()}`);
  if (typeof parser.parseFrontmatter !== "function") throw new Error(`${config.frontmatter} не експортує parseFrontmatter`);
  const mediaRoot = safePath(campaignRoot, config.media.entityDir ?? config.media.dir);
  const mediaByName = await collectMediaPaths(mediaRoot, campaignRoot);
  const documents = await collectMarkdown(campaignRoot, new Set(config.entities.skipDirs));
  const types = new Set(config.entities.types);
  const entities = documents.flatMap(({ path, source }) => {
    const { meta, body } = parser.parseFrontmatter(source, path);
    return types.has(meta.type) ? [entityRecord(path, meta, body, config.entities, mediaByName)] : [];
  });
  return finalizeEntities(entities);
}

function validMapSlug(value) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error("Некоректний slug карти");
  return value;
}

function safeMapName(value, fallback) {
  return typeof value === "string" && value.trim() ? value.replace(/[\r\n]+/g, " ").trim() : fallback;
}

async function optionalText(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function notePath(campaignRoot, config, fileSlug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fileSlug)) throw new Error("Некоректний slug файлу нотаток");
  return join(safePath(campaignRoot, config.notes.dir), `${fileSlug}.md`);
}

async function readNotes(campaignRoot, config) {
  const directory = safePath(campaignRoot, config.notes.dir);
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const notes = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const fileSlug = entry.name.slice(0, -3);
    notes.push(...parseNoteBlocks(await readFile(join(directory, entry.name), "utf8"), fileSlug));
  }
  return notes;
}

async function createNote(campaignRoot, config, mapSlug, mapName, text) {
  const slug = validMapSlug(mapSlug);
  if (typeof text !== "string") throw new Error("Текст нотатки має бути рядком");
  const fileSlug = noteFileSlug(slug, config.notes);
  const path = notePath(campaignRoot, config, fileSlug);
  const source = await optionalText(path) ?? newNoteDocument(config.notes.type, `${safeMapName(mapName, slug)} (нотатки дошки)`);
  const anchor = nextNoteAnchor(source);
  await atomicWrite(path, appendNoteBlock(source, anchor, text));
  return { reference: `${fileSlug}#${anchor}`, text: text.trim() };
}

async function updateNote(campaignRoot, config, reference, text) {
  if (typeof text !== "string") throw new Error("Текст нотатки має бути рядком");
  const { fileSlug, anchor } = splitNoteReference(reference);
  const path = notePath(campaignRoot, config, fileSlug);
  const source = await readFile(path, "utf8");
  await atomicWrite(path, updateNoteBlock(source, anchor, text));
  return { reference, text: text.trim() };
}

async function moveNote(campaignRoot, config, reference, mapSlug, mapName) {
  const from = splitNoteReference(reference);
  const slug = validMapSlug(mapSlug);
  const targetSlug = noteFileSlug(slug, config.notes);
  const sourcePath = notePath(campaignRoot, config, from.fileSlug);
  const source = await readFile(sourcePath, "utf8");
  const note = parseNoteBlocks(source, from.fileSlug).find((candidate) => candidate.reference === reference);
  if (!note) throw new Error(`Не знайдено нотатку ${reference}`);
  if (from.fileSlug === targetSlug) return { reference, text: note.text };
  const targetPath = notePath(campaignRoot, config, targetSlug);
  const target = await optionalText(targetPath) ?? newNoteDocument(config.notes.type, `${safeMapName(mapName, slug)} (нотатки дошки)`);
  const anchor = nextNoteAnchor(target);
  const nextReference = `${targetSlug}#${anchor}`;
  await atomicWrite(targetPath, appendNoteBlock(target, anchor, note.text));
  await atomicWrite(sourcePath, removeNoteBlock(source, from.anchor));
  return { reference: nextReference, text: note.text };
}

async function deleteNote(campaignRoot, config, reference) {
  const { fileSlug, anchor } = splitNoteReference(reference);
  const path = notePath(campaignRoot, config, fileSlug);
  const source = await readFile(path, "utf8");
  const note = parseNoteBlocks(source, fileSlug).find((candidate) => candidate.reference === reference);
  if (!note) throw new Error(`Не знайдено нотатку ${reference}`);
  await atomicWrite(path, removeNoteBlock(source, anchor));
  return { reference, text: note.text };
}

async function restoreNote(campaignRoot, config, reference, text) {
  if (typeof text !== "string") throw new Error("Текст нотатки має бути рядком");
  const { fileSlug, anchor } = splitNoteReference(reference);
  const path = notePath(campaignRoot, config, fileSlug);
  const source = await readFile(path, "utf8");
  if (parseNoteBlocks(source, fileSlug).some((note) => note.reference === reference)) throw new Error(`Нотатка ${reference} вже існує`);
  await atomicWrite(path, appendNoteBlock(source, anchor, text));
  return { reference, text: text.trim() };
}

function safeMediaName(originalName) {
  const rawStem = basename(originalName || "image", extname(originalName || ""));
  const stem = rawStem.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim() || "image";
  return `${stem}.webp`;
}

async function uniqueMediaName(mediaRoot, originalName) {
  const names = await collectFileNames(mediaRoot);
  const preferred = safeMediaName(originalName);
  const stem = preferred.slice(0, -5);
  let candidate = preferred;
  let suffix = 2;
  while (names.has(candidate.toLocaleLowerCase("uk"))) candidate = `${stem}-${suffix++}.webp`;
  return candidate;
}

function pathInside(root, target) {
  const relation = relative(root, target);
  return relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function mediaRoots(campaignRoot, config) {
  return [...new Set([config.media?.dir, config.media?.entityDir].filter(Boolean))]
    .map((path) => safePath(campaignRoot, path));
}

function cacheRoot(campaignRoot, config) {
  return safePath(campaignRoot, config.media?.cacheDir ?? ".cache/board");
}

async function serveMedia(config, campaignRoot, url, response) {
  const requested = url.searchParams.get("path");
  if (!requested) return errorResponse(response, 400, "Потрібен шлях до медіафайлу");
  const original = resolve(campaignRoot, requested);
  if (!mediaRoots(campaignRoot, config).some((root) => pathInside(root, original))) {
    return errorResponse(response, 403, "Медіафайл поза дозволеними теками");
  }
  const thumbnail = join(cacheRoot(campaignRoot, config), basename(original));
  // `thumbnail=only` — лише мініатюра, без відкату на оригінал: так канва
  // дізнається, що мініатюри ще нема і її треба зробити.
  const thumbnailMode = url.searchParams.get("thumbnail");
  let target = thumbnailMode === "1" || thumbnailMode === "only" ? thumbnail : original;
  try {
    await stat(target);
  } catch (error) {
    if (error.code === "ENOENT" && target === thumbnail && thumbnailMode !== "only") target = original;
    else if (error.code === "ENOENT") return errorResponse(response, 404, "Медіафайл не знайдено");
    else throw error;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) return errorResponse(response, 404, "Медіафайл не знайдено");
    response.writeHead(200, { "content-type": "image/webp", "cache-control": "no-store" });
    createReadStream(target).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") return errorResponse(response, 404, "Медіафайл не знайдено");
    throw error;
  }
}

async function serveStatic(requestPath, response) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const path = resolve(STATIC_ROOT, `.${cleanPath}`);
  if (!path.startsWith(`${STATIC_ROOT}${sep}`)) return errorResponse(response, 404, "Не знайдено");
  try {
    const info = await stat(path);
    if (!info.isFile()) return errorResponse(response, 404, "Не знайдено");
    response.writeHead(200, {
      "content-type": MIME_TYPES.get(extname(path)) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(path).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") return errorResponse(response, 404, "Не знайдено");
    throw error;
  }
}

export async function startServer({ base, host = "127.0.0.1", port = 4173 }) {
  const campaignRoot = resolve(base);
  const { config, layoutPath } = await readConfig(campaignRoot);
  let mutationQueue = Promise.resolve();

  const enqueueMutation = (task) => {
    const result = mutationQueue.then(task, task);
    mutationQueue = result.catch(() => {});
    return result;
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/api/health" && request.method === "GET") return json(response, 200, { ok: true });
      if (url.pathname === "/api/board" && request.method === "GET") {
        const state = await readLayout(layoutPath);
        return json(response, 200, { ...state, campaign: campaignRoot, config }, { etag: state.revision });
      }
      if (url.pathname === "/api/entities" && request.method === "GET") {
        return json(response, 200, { entities: await readEntities(campaignRoot, config) });
      }
      if (url.pathname === "/api/notes" && request.method === "GET") {
        return json(response, 200, { notes: await readNotes(campaignRoot, config) });
      }
      if (url.pathname === "/api/notes" && request.method === "POST") {
        let body;
        try { body = JSON.parse(await readBody(request)); }
        catch { return errorResponse(response, 400, "Некоректний JSON"); }
        return json(response, 201, await enqueueMutation(() => createNote(campaignRoot, config, body.mapSlug, body.mapName, body.text)));
      }
      if (url.pathname === "/api/notes" && request.method === "PUT") {
        let body;
        try { body = JSON.parse(await readBody(request)); }
        catch { return errorResponse(response, 400, "Некоректний JSON"); }
        return json(response, 200, await enqueueMutation(() => updateNote(campaignRoot, config, body.reference, body.text)));
      }
      if (url.pathname === "/api/notes" && request.method === "DELETE") {
        let body;
        try { body = JSON.parse(await readBody(request)); }
        catch { return errorResponse(response, 400, "Некоректний JSON"); }
        return json(response, 200, await enqueueMutation(() => deleteNote(campaignRoot, config, body.reference)));
      }
      if (url.pathname === "/api/notes/move" && request.method === "POST") {
        let body;
        try { body = JSON.parse(await readBody(request)); }
        catch { return errorResponse(response, 400, "Некоректний JSON"); }
        return json(response, 200, await enqueueMutation(() => moveNote(campaignRoot, config, body.reference, body.mapSlug, body.mapName)));
      }
      if (url.pathname === "/api/notes/restore" && request.method === "POST") {
        let body;
        try { body = JSON.parse(await readBody(request)); }
        catch { return errorResponse(response, 400, "Некоректний JSON"); }
        return json(response, 200, await enqueueMutation(() => restoreNote(campaignRoot, config, body.reference, body.text)));
      }
      if (url.pathname === "/api/layout" && request.method === "PUT") {
        const expected = request.headers["if-match"];
        let layout;
        try {
          layout = validateLayout(JSON.parse(await readBody(request)));
        } catch (error) {
          return errorResponse(response, 400, error.message);
        }
        const result = await enqueueMutation(async () => {
          const current = await readLayout(layoutPath);
          if (!expected || expected !== current.revision) {
            return { conflict: true, revision: current.revision };
          }
          const source = `${JSON.stringify(layout, null, 2)}\n`;
          await atomicWrite(layoutPath, source);
          return { conflict: false, revision: revisionOf(source) };
        });
        if (result.conflict) {
          return json(response, 409, { error: "Файл змінився поза канвою. Перезавантаж дошку, щоб не втратити зміни.", currentRevision: result.revision });
        }
        return json(response, 200, { revision: result.revision }, { etag: result.revision });
      }
      if (url.pathname === "/api/media" && request.method === "GET") {
        return await serveMedia(config, campaignRoot, url, response);
      }
      if (url.pathname === "/api/media" && request.method === "POST") {
        const kind = request.headers["x-media-kind"];
        if (kind !== "map" && kind !== "illustration") return errorResponse(response, 400, "Тип має бути map або illustration");
        const buffer = await readBuffer(request, 200_000_000);
        if (!isWebP(buffer)) return errorResponse(response, 415, "Канва приймає лише WebP");
        const result = await enqueueMutation(async () => {
          const mediaRoot = safePath(campaignRoot, config.media?.dir);
          const encodedName = request.headers["x-file-name"] || "image";
          let originalName;
          try { originalName = decodeURIComponent(encodedName); } catch { originalName = "image"; }
          const name = await uniqueMediaName(mediaRoot, originalName);
          const subdirectory = kind === "map" ? "maps" : "locations";
          const target = join(mediaRoot, subdirectory, name);
          await atomicWrite(target, buffer);
          return { name, path: relative(campaignRoot, target).split(sep).join("/") };
        });
        return json(response, 201, result);
      }
      if (url.pathname === "/api/thumbnail" && request.method === "POST") {
        const encodedPath = request.headers["x-media-path"] || "";
        let mediaPath;
        try { mediaPath = decodeURIComponent(encodedPath); } catch { mediaPath = ""; }
        const mediaRoot = safePath(campaignRoot, config.media?.dir);
        const original = resolve(campaignRoot, mediaPath || "");
        if (!pathInside(mediaRoot, original)) return errorResponse(response, 403, "Медіафайл поза текою медіа дошки");
        const buffer = await readBuffer(request, 20_000_000);
        if (!isWebP(buffer)) return errorResponse(response, 415, "Мініатюра має бути WebP");
        const target = join(cacheRoot(campaignRoot, config), basename(original));
        await atomicWrite(target, buffer);
        return json(response, 201, { ok: true });
      }
      if (url.pathname.startsWith("/api/")) return errorResponse(response, 404, "Невідомий API endpoint");
      if (request.method !== "GET" && request.method !== "HEAD") return errorResponse(response, 405, "Метод не дозволено");
      return await serveStatic(url.pathname, response);
    } catch (error) {
      console.error(error);
      return errorResponse(response, 500, error.message);
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolveListen);
  });
  const address = server.address();
  return { server, url: `http://${host}:${address.port}`, config, layoutPath };
}
