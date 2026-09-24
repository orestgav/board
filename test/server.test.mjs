import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyLayout, startServer, validateLayout } from "../src/server.mjs";

async function fixture(media = { dir: "_media", format: "webp" }) {
  const base = await mkdtemp(join(tmpdir(), "crown-board-"));
  await writeFile(join(base, "board.config.json"), JSON.stringify({
    boardConfigVersion: 1,
    layout: "board/canvas.json",
    media,
  }));
  const running = await startServer({ base, port: 0 });
  return { base, ...running };
}

test("empty layout has a supported version", () => {
  assert.deepEqual(emptyLayout(), { formatVersion: 1, children: [] });
  assert.equal(validateLayout(emptyLayout()).formatVersion, 1);
});

test("layout validation rejects duplicate ids", () => {
  const node = { id: "same", type: "frame", title: "A", x: 1, y: 2, width: 100, height: 80, children: [] };
  assert.throws(() => validateLayout({ formatVersion: 1, children: [node, { ...node }] }), /Повторний id/);
});

test("layout validation accepts unbounded coordinates and tiny nodes", () => {
  const node = { id: "far-away", type: "frame", title: "Far", x: -2500, y: 9000, width: 0.001, height: 0.001, children: [] };
  assert.deepEqual(validateLayout({ formatVersion: 1, children: [node] }).children[0], node);
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...node, width: 0 }] }), /додатний розмір/);
});

test("layout validation accepts named scene nodes", () => {
  const scene = { id: "scene-1", type: "scene", title: "Засідка", x: 5, y: 15, width: 300, height: 160, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [scene] }).children[0].title, "Засідка");
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...scene, title: null }] }), /title має бути рядком/);
});

test("layout validation accepts WebP image nodes and rejects unsafe paths", () => {
  const image = { id: "map", type: "image", image: "_media/maps/world.webp", x: 10, y: 20, width: 800, height: 500, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [image] }).children[0].type, "image");
  assert.throws(
    () => validateLayout({ formatVersion: 1, children: [{ ...image, image: "../secret.webp" }] }),
    /безпечним відносним шляхом/,
  );
});

test("layout validation accepts entity nodes", () => {
  const entity = { id: "ester-card", type: "entity", entity: "ester", x: 10, y: 20, width: 320, height: 190, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [entity] }).children[0].entity, "ester");
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...entity, entity: "" }] }), /непорожнім slug/);
});

test("layout validation keeps statblock hit points and rejects broken ones", () => {
  const statblock = { id: "hrap-card", type: "entity", entity: "hrap", hp: 12, x: 10, y: 20, width: 440, height: 640, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [statblock] }).children[0].hp, 12);
  assert.equal(validateLayout({ formatVersion: 1, children: [{ ...statblock, hp: 0 }] }).children[0].hp, 0);
  assert.equal(validateLayout({ formatVersion: 1, children: [{ ...statblock, hp: -7 }] }).children[0].hp, -7);
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...statblock, hp: "12" }] }), /має бути числом/);
});

test("layout validation keeps a squad of identical creatures on one statblock", () => {
  const statblock = { id: "hrap-card", type: "entity", entity: "hrap", x: 10, y: 20, width: 440, height: 640, children: [] };
  const squad = (creatures) => ({ formatVersion: 1, children: [{ ...statblock, creatures }] });
  assert.deepEqual(validateLayout(squad([{ hp: 12 }, { name: "Ватажок", hp: -3 }])).children[0].creatures,
    [{ hp: 12 }, { name: "Ватажок", hp: -3 }]);
  assert.throws(() => validateLayout(squad([])), /непорожнім масивом/);
  assert.throws(() => validateLayout(squad({ hp: 12 })), /непорожнім масивом/);
  assert.throws(() => validateLayout(squad(["Ватажок"])), /має бути об'єктом/);
  assert.throws(() => validateLayout(squad([{ hp: "12" }])), /hp істоти має бути числом/);
  assert.throws(() => validateLayout(squad([{ name: 7 }])), /назва істоти має бути рядком/);
});

test("layout validation keeps a hidden NPC summary flag", () => {
  const npc = { id: "vera-card", type: "entity", entity: "vera", x: 10, y: 20, width: 400, height: 210, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [{ ...npc, hideSummary: true }] }).children[0].hideSummary, true);
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...npc, hideSummary: "так" }] }), /hideSummary має бути булевим/);
});

test("layout validation keeps a hidden note text flag", () => {
  const note = { id: "note-1", type: "note", note: "map-world#n1", x: 10, y: 20, width: 320, height: 190, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [{ ...note, hideText: true }] }).children[0].hideText, true);
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...note, hideText: "так" }] }), /hideText має бути булевим/);
});

test("layout validation accepts note references and rejects unsafe ones", () => {
  const note = { id: "note-1", type: "note", note: "map-world#n1", x: 10, y: 20, width: 320, height: 190, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [note] }).children[0].note, "map-world#n1");
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...note, note: "../secret#n1" }] }), /Некоректне посилання/);
});

test("layout validation keeps music cards pointing at a real YouTube video", () => {
  const music = { id: "track-1", type: "music", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Тема таверни", x: 10, y: 20, width: 320, height: 46, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [music] }).children[0].url, music.url);
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...music, url: "https://evil.example/track" }] }), /ролік YouTube/);
  assert.throws(() => validateLayout({ formatVersion: 1, children: [{ ...music, title: 7 }] }), /має бути рядком/);
});

test("entity API indexes configured markdown through the campaign parser", async (context) => {
  const base = await mkdtemp(join(tmpdir(), "crown-board-entities-"));
  await mkdir(join(base, "tools"), { recursive: true });
  await mkdir(join(base, "npcs"), { recursive: true });
  await mkdir(join(base, "_media", "npcs"), { recursive: true });
  await writeFile(join(base, "tools", "frontmatter.mjs"), `export function parseFrontmatter(source) {
    const [, header, body] = source.match(/^---\\n([\\s\\S]*?)\\n---\\n([\\s\\S]*)$/);
    return { meta: Object.fromEntries(header.split("\\n").map(line => line.split(/: +/, 2))), body };
  }`);
  await writeFile(join(base, "npcs", "ester.md"), "---\ntype: npc\nname: Естер\nimage: ester.webp\n---\n## На дошці\nСоюзниця");
  await writeFile(join(base, "_media", "npcs", "ester.webp"), "webp");
  await writeFile(join(base, "board.config.json"), JSON.stringify({
    boardConfigVersion: 1,
    frontmatter: "tools/frontmatter.mjs",
    layout: "board/canvas.json",
    media: { dir: "board/media", entityDir: "_media", cacheDir: "board/cache", format: "webp" },
    entities: { skipDirs: ["tools"], types: ["npc"], summarySection: "## На дошці", portraitField: "image" },
  }));
  const running = await startServer({ base, port: 0 });
  context.after(() => running.server.close());
  const response = await fetch(`${running.url}/api/entities`);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.entities.map(({ slug, name, portrait, summary }) => ({ slug, name, portrait, summary })), [{
    slug: "ester", name: "Естер", portrait: "_media/npcs/ester.webp", summary: "Союзниця",
  }]);
});

test("note API creates, updates and safely moves markdown blocks", async (context) => {
  const base = await mkdtemp(join(tmpdir(), "crown-board-notes-"));
  await writeFile(join(base, "board.config.json"), JSON.stringify({
    boardConfigVersion: 1,
    layout: "board/canvas.json",
    notes: { dir: "board/notes", prefix: "map-", type: "board" },
    media: { dir: "_media", format: "webp" },
  }));
  const running = await startServer({ base, port: 0 });
  context.after(() => running.server.close());
  const created = await (await fetch(`${running.url}/api/notes`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mapSlug: "world", mapName: "Світ", text: "Початок" }),
  })).json();
  assert.equal(created.reference, "map-world#n1");
  const updated = await (await fetch(`${running.url}/api/notes`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference: created.reference, text: "Оновлений [[ester]]" }),
  })).json();
  assert.equal(updated.text, "Оновлений [[ester]]");
  const moved = await (await fetch(`${running.url}/api/notes/move`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference: created.reference, mapSlug: "kardosa", mapName: "Кардоса" }),
  })).json();
  assert.equal(moved.reference, "map-kardosa#n1");
  const notes = await (await fetch(`${running.url}/api/notes`)).json();
  assert.deepEqual(notes.notes, [{ reference: "map-kardosa#n1", anchor: "n1", text: "Оновлений [[ester]]" }]);
  assert.doesNotMatch(await readFile(join(base, "board/notes/map-world.md"), "utf8"), /Оновлений/);
  const deleted = await (await fetch(`${running.url}/api/notes`, {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference: moved.reference }),
  })).json();
  assert.equal(deleted.text, "Оновлений [[ester]]");
  assert.deepEqual((await (await fetch(`${running.url}/api/notes`)).json()).notes, []);
  await fetch(`${running.url}/api/notes/restore`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(deleted),
  });
  assert.equal((await (await fetch(`${running.url}/api/notes`)).json()).notes[0].reference, moved.reference);
});

test("API creates and updates canvas.json", async (context) => {
  const running = await fixture();
  context.after(() => running.server.close());
  const loaded = await fetch(`${running.url}/api/board`);
  const initial = await loaded.json();
  assert.equal(initial.layout.children.length, 0);

  initial.layout.children.push({ id: "f1", type: "frame", title: "Сцена", x: 40, y: 50, width: 320, height: 200, locked: false, children: [] });
  const saved = await fetch(`${running.url}/api/layout`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": initial.revision },
    body: JSON.stringify(initial.layout),
  });
  assert.equal(saved.status, 200);
  const disk = JSON.parse(await readFile(join(running.base, "board/canvas.json"), "utf8"));
  assert.equal(disk.children[0].title, "Сцена");
});

test("server exposes the editor and its model module", async (context) => {
  const running = await fixture();
  context.after(() => running.server.close());
  const [page, model, storage] = await Promise.all([
    fetch(`${running.url}/`),
    fetch(`${running.url}/model.js`),
    fetch(`${running.url}/storage.js`),
  ]);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="layer-tree"/);
  assert.doesNotMatch(html, /(?:src|href)="\//);
  assert.equal(model.status, 200);
  assert.match(model.headers.get("content-type"), /text\/javascript/);
  assert.equal(storage.status, 200);
  assert.deepEqual(await (await fetch(`${running.url}/api/health`)).json(), { ok: true });
});

test("media upload chooses a unique board WebP name and serves its configured thumbnail", async (context) => {
  const running = await fixture({ dir: "board/media", entityDir: "_media", cacheDir: "board/cache", format: "webp" });
  context.after(() => running.server.close());
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
  const upload = () => fetch(`${running.url}/api/media`, {
    method: "POST",
    headers: { "content-type": "image/webp", "x-media-kind": "map", "x-file-name": encodeURIComponent("Мапа.png") },
    body: webp,
  });
  const first = await upload();
  const firstMedia = await first.json();
  const secondMedia = await (await upload()).json();
  assert.equal(first.status, 201);
  assert.equal(firstMedia.name, "Мапа.webp");
  assert.equal(firstMedia.path, "board/media/maps/Мапа.webp");
  assert.equal(secondMedia.name, "Мапа-2.webp");

  const thumbnail = await fetch(`${running.url}/api/thumbnail`, {
    method: "POST", headers: { "content-type": "image/webp", "x-media-path": encodeURIComponent(firstMedia.path) }, body: webp,
  });
  assert.equal(thumbnail.status, 201);
  assert.equal(Buffer.compare(await readFile(join(running.base, "board/cache/Мапа.webp")), webp), 0);
  const served = await fetch(`${running.url}/api/media?thumbnail=1&path=${encodeURIComponent(firstMedia.path)}`);
  assert.equal(served.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await served.arrayBuffer()), webp), 0);
});

test("API refuses a stale write", async (context) => {
  const running = await fixture();
  context.after(() => running.server.close());
  const initial = await (await fetch(`${running.url}/api/board`)).json();
  initial.layout.children.push({ id: "changed", type: "frame", title: "Зміна", x: 10, y: 10, width: 100, height: 80, children: [] });
  const first = await fetch(`${running.url}/api/layout`, {
    method: "PUT", headers: { "content-type": "application/json", "if-match": initial.revision }, body: JSON.stringify(initial.layout),
  });
  assert.equal(first.status, 200);
  const stale = await fetch(`${running.url}/api/layout`, {
    method: "PUT", headers: { "content-type": "application/json", "if-match": initial.revision }, body: JSON.stringify(initial.layout),
  });
  assert.equal(stale.status, 409);
});

test("only one of two concurrent writes with the same revision wins", async (context) => {
  const running = await fixture();
  context.after(() => running.server.close());
  const initial = await (await fetch(`${running.url}/api/board`)).json();
  const headers = { "content-type": "application/json", "if-match": initial.revision };
  const makeLayout = (id) => ({
    formatVersion: 1,
    children: [{ id, type: "frame", title: id, x: 20, y: 20, width: 120, height: 80, children: [] }],
  });
  const responses = await Promise.all([
    fetch(`${running.url}/api/layout`, { method: "PUT", headers, body: JSON.stringify(makeLayout("one")) }),
    fetch(`${running.url}/api/layout`, { method: "PUT", headers, body: JSON.stringify(makeLayout("two")) }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
});
