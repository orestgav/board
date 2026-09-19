import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyLayout, startServer, validateLayout } from "../src/server.mjs";

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "crown-board-"));
  await writeFile(join(base, "board.config.json"), JSON.stringify({
    boardConfigVersion: 1,
    layout: "board/canvas.json",
    media: { dir: "_media", format: "webp" },
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

test("layout validation accepts WebP image nodes and rejects unsafe paths", () => {
  const image = { id: "map", type: "image", image: "_media/maps/world.webp", x: 10, y: 20, width: 800, height: 500, children: [] };
  assert.equal(validateLayout({ formatVersion: 1, children: [image] }).children[0].type, "image");
  assert.throws(
    () => validateLayout({ formatVersion: 1, children: [{ ...image, image: "../secret.webp" }] }),
    /безпечним відносним шляхом/,
  );
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

test("media upload chooses a global unique WebP name and serves its thumbnail", async (context) => {
  const running = await fixture();
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
  assert.equal(secondMedia.name, "Мапа-2.webp");

  const thumbnail = await fetch(`${running.url}/api/thumbnail`, {
    method: "POST", headers: { "content-type": "image/webp", "x-media-path": encodeURIComponent(firstMedia.path) }, body: webp,
  });
  assert.equal(thumbnail.status, 201);
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
