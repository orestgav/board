import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { entityRecord, finalizeEntities } from "../public/entities.js";

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
    if (!["frame", "image", "entity"].includes(node.type)) throw new Error(`Непідтримуваний тип вузла: ${node.type}`);
    for (const field of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(node[field])) throw new Error(`${node.id}.${field} має бути числом`);
    }
    if (node.x < 0 || node.x > 100 || node.y < 0 || node.y > 100) {
      throw new Error(`${node.id}: x та y мають бути в межах 0..100`);
    }
    if (node.width < 80 || node.height < 60) throw new Error(`${node.id}: вузол замалий`);
    if (node.type === "frame" && typeof node.title !== "string") throw new Error(`${node.id}.title має бути рядком`);
    if (node.type === "image") {
      const imagePath = typeof node.image === "string" ? node.image.replaceAll("\\", "/") : "";
      if (!imagePath.toLowerCase().endsWith(".webp") || imagePath.startsWith("/") || imagePath.split("/").includes("..")) {
        throw new Error(`${node.id}.image має бути безпечним відносним шляхом до WebP`);
      }
    }
    if (node.type === "entity" && (typeof node.entity !== "string" || !node.entity)) {
      throw new Error(`${node.id}.entity має бути непорожнім slug`);
    }
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
  const mediaRoot = safePath(campaignRoot, config.media.dir);
  const mediaByName = await collectMediaPaths(mediaRoot, campaignRoot);
  const documents = await collectMarkdown(campaignRoot, new Set(config.entities.skipDirs));
  const types = new Set(config.entities.types);
  const entities = documents.flatMap(({ path, source }) => {
    const { meta, body } = parser.parseFrontmatter(source, path);
    return types.has(meta.type) ? [entityRecord(path, meta, body, config.entities, mediaByName)] : [];
  });
  return finalizeEntities(entities);
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

async function serveMedia(config, campaignRoot, url, response) {
  const mediaRoot = safePath(campaignRoot, config.media?.dir);
  const requested = url.searchParams.get("path");
  if (!requested) return errorResponse(response, 400, "Потрібен шлях до медіафайлу");
  const original = resolve(campaignRoot, requested);
  if (!pathInside(mediaRoot, original)) return errorResponse(response, 403, "Медіафайл поза дозволеною текою");
  const thumbnail = join(campaignRoot, ".cache", "board", basename(original));
  let target = url.searchParams.get("thumbnail") === "1" ? thumbnail : original;
  try {
    await stat(target);
  } catch (error) {
    if (error.code === "ENOENT" && target === thumbnail) target = original;
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
        if (!pathInside(mediaRoot, original)) return errorResponse(response, 403, "Медіафайл поза дозволеною текою");
        const buffer = await readBuffer(request, 20_000_000);
        if (!isWebP(buffer)) return errorResponse(response, 415, "Мініатюра має бути WebP");
        const target = join(campaignRoot, ".cache", "board", basename(original));
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
