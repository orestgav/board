import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renameWithRetry, startServer, validateLayout } from "../src/server.mjs";

const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);

async function fixture(context) {
  const base = await mkdtemp(join(tmpdir(), "crown-board-guards-"));
  await writeFile(join(base, "board.config.json"), JSON.stringify({
    boardConfigVersion: 1,
    layout: "board/canvas.json",
    notes: { dir: "board/notes", prefix: "map-", type: "board" },
    media: { dir: "board/media", entityDir: "_media", cacheDir: "board/cache", format: "webp" },
  }));
  await mkdir(join(base, "board/media/maps"), { recursive: true });
  await writeFile(join(base, "board/media/maps/world.webp"), WEBP);
  await writeFile(join(base, "secret.md"), "секрет ДМа");
  const running = await startServer({ base, port: 0 });
  context.after(() => running.server.close());
  return { base, ...running };
}

const json = (url, method, body) => fetch(url, { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("the server refuses to start without a supported board config", async () => {
  const base = await mkdtemp(join(tmpdir(), "crown-board-noconfig-"));
  await assert.rejects(startServer({ base, port: 0 }), /Не знайдено/);
  await writeFile(join(base, "board.config.json"), JSON.stringify({ boardConfigVersion: 2, layout: "board/canvas.json" }));
  await assert.rejects(startServer({ base, port: 0 }), /boardConfigVersion/);
  await writeFile(join(base, "board.config.json"), JSON.stringify({ boardConfigVersion: 1, layout: "../outside.json" }));
  await assert.rejects(startServer({ base, port: 0 }), /layout має бути відносним шляхом усередині кампанії/);
});

test("a layout from a newer editor or of an unknown node type is refused", () => {
  assert.throws(() => validateLayout({ formatVersion: 2, children: [] }), /новіша за редактор/);
  assert.throws(() => validateLayout({ children: [] }), /відсутня/);
  const node = { id: "x", type: "hologram", x: 0, y: 0, width: 1, height: 1, children: [] };
  assert.throws(() => validateLayout({ formatVersion: 1, children: [node] }), /Непідтримуваний тип/);
  assert.throws(() => validateLayout([]), /об'єктом/);
});

test("an invalid layout is not written over canvas.json", async (context) => {
  const running = await fixture(context);
  const { revision } = await (await fetch(`${running.url}/api/board`)).json();
  const response = await fetch(`${running.url}/api/layout`, {
    method: "PUT", headers: { "content-type": "application/json", "if-match": revision }, body: JSON.stringify({ formatVersion: 1, children: [{ id: "a" }] }),
  });
  assert.equal(response.status, 400);
  await assert.rejects(readFile(join(running.base, "board/canvas.json")), { code: "ENOENT" });
  const noRevision = await fetch(`${running.url}/api/layout`, { method: "PUT", body: JSON.stringify({ formatVersion: 1, children: [] }) });
  assert.equal(noRevision.status, 409);
});

test("media is served only from the configured media folders", async (context) => {
  const running = await fixture(context);
  const inside = await fetch(`${running.url}/api/media?path=${encodeURIComponent("board/media/maps/world.webp")}`);
  assert.equal(inside.status, 200);
  assert.equal(inside.headers.get("content-type"), "image/webp");
  for (const path of ["secret.md", "board/media/../../secret.md", "../secret.md", "board/canvas.json"]) {
    const response = await fetch(`${running.url}/api/media?path=${encodeURIComponent(path)}`);
    assert.equal(response.status, 403, path);
  }
  assert.equal((await fetch(`${running.url}/api/media`)).status, 400);
  assert.equal((await fetch(`${running.url}/api/media?path=${encodeURIComponent("board/media/maps/none.webp")}`)).status, 404);
  // Без мініатюри звичайний запит мініатюри відкочується на оригінал.
  assert.equal((await fetch(`${running.url}/api/media?thumbnail=1&path=${encodeURIComponent("board/media/maps/world.webp")}`)).status, 200);
});

test("uploads accept only WebP of a known kind, thumbnails only for board media", async (context) => {
  const running = await fixture(context);
  const upload = (headers, body = WEBP) => fetch(`${running.url}/api/media`, { method: "POST", headers: { "content-type": "image/webp", ...headers }, body });
  assert.equal((await upload({ "x-media-kind": "portrait" })).status, 400);
  assert.equal((await upload({ "x-media-kind": "map" }, Buffer.from("\x89PNG not webp"))).status, 415);
  const broken = await (await upload({ "x-media-kind": "illustration", "x-file-name": "%E0%A4%A" })).json();
  assert.equal(broken.path, "board/media/locations/image.webp");

  const thumbnail = (path, body = WEBP) => fetch(`${running.url}/api/thumbnail`, {
    method: "POST", headers: { "content-type": "image/webp", "x-media-path": encodeURIComponent(path) }, body,
  });
  assert.equal((await thumbnail("secret.md")).status, 403);
  assert.equal((await thumbnail("_media/npcs/ester.webp")).status, 403);
  assert.equal((await thumbnail("board/media/maps/world.webp", Buffer.from("nope"))).status, 415);
  assert.equal((await thumbnail("board/media/maps/world.webp")).status, 201);
});

test("note endpoints reject broken input without touching files", async (context) => {
  const running = await fixture(context);
  assert.equal((await json(`${running.url}/api/notes`, "POST", "{not json")).status, 400);
  const badSlug = await json(`${running.url}/api/notes`, "POST", { mapSlug: "../secret", mapName: "x", text: "a" });
  assert.equal(badSlug.status, 500);
  assert.match((await badSlug.json()).error, /slug карти/);
  const badReference = await json(`${running.url}/api/notes`, "PUT", { reference: "../secret#n1", text: "a" });
  assert.match((await badReference.json()).error, /Некоректне посилання/);
  const missing = await json(`${running.url}/api/notes`, "DELETE", { reference: "map-world#n1" });
  assert.equal(missing.status, 500);
  await assert.rejects(readFile(join(running.base, "board/notes/map-world.md")), { code: "ENOENT" });
  // Імʼя карти з переносом рядка не ламає фронтматер нового файла.
  await json(`${running.url}/api/notes`, "POST", { mapSlug: "world", mapName: "Світ\ntype: npc", text: "a" });
  assert.match(await readFile(join(running.base, "board/notes/map-world.md"), "utf8"), /^---\ntype: board\nname: "Світ type: npc \(нотатки дошки\)"\n---/);
});

test("static files cannot be escaped and unknown API paths are reported", async (context) => {
  const running = await fixture(context);
  assert.equal((await fetch(`${running.url}/..%2f..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${running.url}/%2e%2e/src/server.mjs`)).status, 404);
  assert.equal((await fetch(`${running.url}/missing.js`)).status, 404);
  assert.equal((await fetch(`${running.url}/api/nothing`)).status, 404);
  assert.equal((await fetch(`${running.url}/index.html`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${running.url}/favicon.svg`)).headers.get("content-type"), "image/svg+xml");
});

test("a rename blocked for a moment by another reader is retried, a real failure is not", async () => {
  const busy = (code) => Object.assign(new Error(code), { code });
  let calls = 0;
  await renameWithRetry("a", "b", { delay: 1, renameFile: async () => { calls += 1; if (calls < 3) throw busy("EPERM"); } });
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(renameWithRetry("a", "b", { delay: 1, renameFile: async () => { calls += 1; throw busy("ENOENT"); } }), /ENOENT/);
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(renameWithRetry("a", "b", { attempts: 4, delay: 1, renameFile: async () => { calls += 1; throw busy("EBUSY"); } }), /EBUSY/);
  assert.equal(calls, 4);
});

test("a campaign with the minimal config opens: its name, its key, cards read by the built-in parser", async (context) => {
  const base = await mkdtemp(join(tmpdir(), "north-"));
  await writeFile(join(base, "board.config.json"), JSON.stringify({ boardConfigVersion: 1, name: "Північ" }));
  await mkdir(join(base, "npcs"), { recursive: true });
  await writeFile(join(base, "npcs/yarl.md"), "---\ntype: npc\nname: Ярл\n---\n\n## На дошці\nВолодар.\n");
  const running = await startServer({ base, port: 0 });
  context.after(() => running.server.close());
  const board = await (await fetch(`${running.url}/api/board`)).json();
  assert.equal(board.campaign, "Північ");
  assert.match(board.campaignKey, /^north-/);
  assert.equal(board.config.notes.dir, "board/notes");
  const { entities } = await (await fetch(`${running.url}/api/entities`)).json();
  assert.deepEqual(entities.map((entity) => [entity.slug, entity.name, entity.summary]), [["yarl", "Ярл", "Володар."]]);
});

test("a broken board config stops the server with the field named", async () => {
  const base = await mkdtemp(join(tmpdir(), "crown-board-badconfig-"));
  await writeFile(join(base, "board.config.json"), JSON.stringify({ boardConfigVersion: 1, notes: { prefix: "Нотатки " } }));
  await assert.rejects(startServer({ base, port: 0 }), /board\.config\.json: notes\.prefix/);
  await writeFile(join(base, "board.config.json"), "{ oops");
  await assert.rejects(startServer({ base, port: 0 }), /не читається як JSON/);
});
