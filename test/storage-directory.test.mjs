import assert from "node:assert/strict";
import test from "node:test";
import { LayoutConflictError, createDirectoryStorage, revisionOf } from "../public/storage.js";
import { MemoryDirectory } from "./helpers/memory-fs.mjs";

const CONFIG = {
  boardConfigVersion: 1,
  frontmatter: "tools/frontmatter.mjs",
  layout: "board/canvas.json",
  notes: { dir: "board/notes", prefix: "map-", type: "board" },
  media: { dir: "board/media", entityDir: "_media", cacheDir: "board/cache", format: "webp" },
  entities: { skipDirs: [".git", "tools"], types: ["npc"], summarySection: "## На дошці", portraitField: "image" },
};

async function campaign({ config = CONFIG, layout } = {}) {
  const root = new MemoryDirectory();
  await root.put("board.config.json", JSON.stringify(config));
  if (layout !== undefined) await root.put("board/canvas.json", layout);
  const storage = createDirectoryStorage({ root });
  return { root, storage };
}

test("a campaign without canvas.json opens as an empty board", async () => {
  const { storage } = await campaign();
  const board = await storage.loadBoard();
  assert.deepEqual(board.layout, { formatVersion: 1, children: [] });
  assert.equal(board.revision, await revisionOf(`${JSON.stringify(board.layout, null, 2)}\n`));
  assert.equal(board.campaign, "campaign");
});

test("an unsupported board config version is refused", async () => {
  const { storage } = await campaign({ config: { ...CONFIG, boardConfigVersion: 2 } });
  await assert.rejects(storage.loadBoard(), /boardConfigVersion/);
});

test("storage needs an opened folder before loading", async () => {
  await assert.rejects(createDirectoryStorage().loadBoard(), /папку кампанії/);
});

test("layout saves only over the revision it was loaded from", async () => {
  const { root, storage } = await campaign();
  const { revision } = await storage.loadBoard();
  const layout = { formatVersion: 1, children: [{ id: "a", type: "frame", title: "A", x: 1, y: 2, width: 3, height: 4, children: [] }] };
  const saved = await storage.saveLayout(layout, revision);
  assert.deepEqual(JSON.parse(await root.read("board/canvas.json")), layout);
  assert.equal(saved.revision, await revisionOf(await root.read("board/canvas.json")));
  // Той самий старий revision — уже не той, що на диску.
  await assert.rejects(storage.saveLayout(layout, revision), LayoutConflictError);
});

test("an outside change to canvas.json is a conflict until the current revision is taken", async () => {
  const { root, storage } = await campaign({ layout: '{"formatVersion":1,"children":[]}' });
  const { revision } = await storage.loadBoard();
  await root.put("board/canvas.json", "{ broken by someone else");
  await assert.rejects(storage.saveLayout({ formatVersion: 1, children: [] }, revision), (error) => {
    assert.ok(error instanceof LayoutConflictError);
    assert.equal(error.name, "LayoutConflictError");
    return true;
  });
  // «Перезаписати своїм» працює навіть поверх зламаного файла.
  const current = await storage.currentRevision();
  await storage.saveLayout({ formatVersion: 1, children: [] }, current);
  assert.deepEqual(JSON.parse(await root.read("board/canvas.json")), { formatVersion: 1, children: [] });
});

test("notes are created lazily in their map file and keep growing anchors", async () => {
  const { root, storage } = await campaign();
  await storage.loadBoard();
  assert.deepEqual(await storage.loadNotes(), []);
  const first = await storage.createNote("kardosa", "Кардоса", "  Орвен тисне  ");
  const second = await storage.createNote("kardosa", "Кардоса", "Друга");
  assert.deepEqual(first, { reference: "map-kardosa#n1", text: "Орвен тисне" });
  assert.equal(second.reference, "map-kardosa#n2");
  const source = await root.read("board/notes/map-kardosa.md");
  assert.match(source, /^---\ntype: board\nname: "Кардоса \(нотатки дошки\)"\n---/);
  assert.deepEqual((await storage.loadNotes()).map((note) => note.reference), ["map-kardosa#n1", "map-kardosa#n2"]);
});

test("updating a note rewrites only its own block", async () => {
  const { root, storage } = await campaign();
  await storage.loadBoard();
  await storage.createNote("kardosa", "Кардоса", "Перша");
  await storage.createNote("kardosa", "Кардоса", "Друга");
  await storage.updateNote("map-kardosa#n1", "Нова перша");
  const notes = await storage.loadNotes();
  assert.deepEqual(notes.map((note) => note.text), ["Нова перша", "Друга"]);
  await assert.rejects(storage.updateNote("map-kardosa#n9", "x"), /Не знайдено якір/);
  assert.match(await root.read("board/notes/map-kardosa.md"), /Нова перша/);
});

test("moving a note carries its text to the other map file under a fresh anchor", async () => {
  const { root, storage } = await campaign();
  await storage.loadBoard();
  await storage.createNote("kardosa", "Кардоса", "Мандрівна");
  await storage.createNote("world", "World", "Уже тут");
  const moved = await storage.moveNote("map-kardosa#n1", "world", "World");
  assert.deepEqual(moved, { reference: "map-world#n2", text: "Мандрівна" });
  assert.doesNotMatch(await root.read("board/notes/map-kardosa.md"), /Мандрівна/);
  assert.match(await root.read("board/notes/map-world.md"), /<!-- note n2 -->\nМандрівна/);
  // Переїзд у той самий файл нічого не міняє.
  assert.deepEqual(await storage.moveNote("map-world#n1", "world", "World"), { reference: "map-world#n1", text: "Уже тут" });
});

test("moving into a map without a notes file creates it", async () => {
  const { root, storage } = await campaign();
  await storage.loadBoard();
  await storage.createNote("kardosa", "Кардоса", "Текст");
  await storage.moveNote("map-kardosa#n1", "port", "Порт");
  assert.match(await root.read("board/notes/map-port.md"), /name: "Порт \(нотатки дошки\)"/);
});

test("a deleted note can be restored under the same reference, but not twice", async () => {
  const { storage } = await campaign();
  await storage.loadBoard();
  await storage.createNote("kardosa", "Кардоса", "Жива");
  assert.deepEqual(await storage.deleteNote("map-kardosa#n1"), { reference: "map-kardosa#n1", text: "Жива" });
  assert.deepEqual(await storage.loadNotes(), []);
  await assert.rejects(storage.deleteNote("map-kardosa#n1"), /Не знайдено нотатку/);
  await storage.restoreNote("map-kardosa#n1", "Жива");
  assert.deepEqual((await storage.loadNotes()).map((note) => note.reference), ["map-kardosa#n1"]);
  await assert.rejects(storage.restoreNote("map-kardosa#n1", "Жива"), /вже існує/);
});

test("note text cannot smuggle in a service anchor", async () => {
  const { storage } = await campaign();
  await storage.loadBoard();
  await assert.rejects(storage.createNote("kardosa", "Кардоса", "a\n<!-- note n5 -->\nb"), /зарезервований/);
});

test("media names stay unique across the whole board media folder", async () => {
  const { root, storage } = await campaign();
  await storage.loadBoard();
  await root.put("board/media/locations/map.webp", "old");
  const saved = await storage.saveMedia(new Blob(["new"]), "map", "map.png");
  assert.deepEqual(saved, { name: "map-2.webp", path: "board/media/maps/map-2.webp" });
  const illustration = await storage.saveMedia(new Blob(["pic"]), "illustration", "bad:name?.jpg");
  assert.equal(illustration.path, "board/media/locations/bad-name-.webp");
  assert.equal(await root.read("board/media/maps/map-2.webp"), "new");
});

test("thumbnails live in the cache folder and are optional", async () => {
  const { root, storage } = await campaign();
  await storage.loadBoard();
  assert.equal(await storage.cachedThumbnail("board/media/maps/world.webp"), null);
  await storage.saveThumbnail(new Blob(["small"]), "board/media/maps/world.webp");
  assert.equal(await root.read("board/cache/world.webp"), "small");
  assert.equal(await (await storage.cachedThumbnail("board/media/maps/world.webp")).text(), "small");
});

test("media URLs are cached per file and fall back to the original without a thumbnail", async () => {
  const { root, storage } = await campaign();
  await storage.loadBoard();
  await root.put("board/media/maps/world.webp", "full");
  const full = await storage.mediaUrl("board/media/maps/world.webp");
  assert.match(full, /^blob:/);
  assert.equal(await storage.mediaUrl("board/media/maps/world.webp"), full);
  assert.equal(await storage.mediaUrl("board/media/maps/world.webp", true), full);
  await assert.rejects(storage.mediaUrl("board/media/maps/missing.webp"), { name: "NotFoundError" });
  await assert.rejects(storage.mediaUrl("../secret.webp"), /Небезпечний шлях/);
});

test("without a remembered folder the board asks to choose one", async () => {
  // У Node немає IndexedDB: відновлення тихо не вдається, як і в браузері,
  // де теку ще ні разу не обирали, — канва покаже екран вибору.
  assert.equal(await createDirectoryStorage().restore(), false);
});
