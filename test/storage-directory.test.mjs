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
  await assert.rejects(createDirectoryStorage().loadBoard(), /теку кампанії/);
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

test("a broken or newer canvas.json stops the folder from opening, with the reason", async () => {
  const broken = await campaign({ layout: "{ half a file" });
  await assert.rejects(broken.storage.loadBoard(), /board\/canvas\.json не читається як JSON/);

  const newer = await campaign({ layout: JSON.stringify({ formatVersion: 2, children: [] }) });
  await assert.rejects(newer.storage.loadBoard(), /board\/canvas\.json: Розкладка новіша за редактор: 2/);

  const hollow = await campaign({ layout: JSON.stringify({ formatVersion: 1, children: [{ id: "a", type: "frame", title: "A", x: 0, y: 0, width: 1, height: 1 }] }) });
  await assert.rejects(hollow.storage.loadBoard(), /a\.children має бути масивом/);
});

test("an invalid layout is never written into the folder", async () => {
  const { root, storage } = await campaign();
  const { revision } = await storage.loadBoard();
  const bad = { formatVersion: 1, children: [{ id: "x", type: "hologram", x: 0, y: 0, width: 1, height: 1, children: [] }] };
  await assert.rejects(storage.saveLayout(bad, revision), /Непідтримуваний тип вузла/);
  assert.equal(await root.exists("board/canvas.json"), false);
});

// Сховище запамʼятованих тек у памʼяті — замість IndexedDB браузера.
function memoryCampaigns() {
  const entries = new Map();
  return {
    entries,
    async list() { return [...entries.values()].map((entry) => ({ ...entry })); },
    async put(entry) { entries.set(entry.id, { ...entry }); },
    async remove(id) { entries.delete(id); },
  };
}

async function folder(name, config = { boardConfigVersion: 1 }) {
  const root = new MemoryDirectory(name);
  await root.put("board.config.json", JSON.stringify(config));
  return root;
}

test("the most recent campaign reopens by itself, but only while the browser keeps its permission", async () => {
  const campaigns = memoryCampaigns();
  const crown = await folder("dnd-campaign", { boardConfigVersion: 1, name: "Crown" });
  const north = await folder("north");
  await campaigns.put({ id: "a", handle: crown, name: "Crown", folder: "dnd-campaign", openedAt: 2 });
  await campaigns.put({ id: "b", handle: north, name: "north", folder: "north", openedAt: 1 });
  const storage = createDirectoryStorage({ campaigns });
  assert.deepEqual((await storage.recent()).map((entry) => entry.id), ["a", "b"]);
  assert.equal(await storage.restore(), true);
  assert.equal((await storage.loadBoard()).campaign, "Crown");

  crown.permission = "prompt";
  const again = createDirectoryStorage({ campaigns });
  // Мовчки на іншу кампанію не перескакує: без дозволу на останню — екран вибору.
  assert.equal(await again.restore(), false);
});

test("a remembered campaign opens by id, and opening it moves it to the top", async () => {
  const campaigns = memoryCampaigns();
  await campaigns.put({ id: "a", handle: await folder("first"), name: "first", folder: "first", openedAt: 5 });
  await campaigns.put({ id: "b", handle: await folder("second", { boardConfigVersion: 1, id: "second-id", name: "Друга" }), name: "second", folder: "second", openedAt: 1 });
  const storage = createDirectoryStorage({ campaigns });
  await storage.connect({ id: "b" });
  const board = await storage.loadBoard();
  assert.equal(board.campaign, "Друга");
  assert.equal(board.campaignKey, "second-id");
  const [top] = await storage.recent();
  assert.equal(top.id, "b");
  assert.equal(top.name, "Друга");
  await assert.rejects(storage.connect({ id: "gone" }), /вже немає в списку/);
});

test("a campaign whose folder refuses permission is not opened", async () => {
  const campaigns = memoryCampaigns();
  const locked = await folder("locked");
  locked.permission = "denied";
  await campaigns.put({ id: "a", handle: locked, name: "locked", folder: "locked", openedAt: 1 });
  await assert.rejects(createDirectoryStorage({ campaigns }).connect({ id: "a" }), /Потрібен дозвіл/);
});

test("forgetting a campaign drops it from the list but leaves the folder alone", async () => {
  const campaigns = memoryCampaigns();
  const root = await folder("north");
  await campaigns.put({ id: "a", handle: root, name: "north", folder: "north", openedAt: 1 });
  const storage = createDirectoryStorage({ campaigns });
  await storage.forget("a");
  assert.deepEqual(await storage.recent(), []);
  assert.equal(await root.exists("board.config.json"), true);
});

test("a folder without board.config.json is named as not a campaign", async () => {
  const storage = createDirectoryStorage({ root: new MemoryDirectory("Photos"), campaigns: memoryCampaigns() });
  await assert.rejects(storage.loadBoard(), /У теці «Photos» немає board\.config\.json/);
});

test("a campaign without its own parser or portrait folder still indexes its cards", async () => {
  const root = await folder("north", { boardConfigVersion: 1, entities: { types: ["npc"] } });
  await root.put("npcs/yarl.md", "---\ntype: npc\nname: Ярл\n---\n\n## На дошці\nВолодар півночі.\n");
  await root.put("notes/plain.md", "# без метаданих");
  const storage = createDirectoryStorage({ root, campaigns: memoryCampaigns() });
  await storage.loadBoard();
  const [yarl] = await storage.loadEntities();
  assert.equal(yarl.name, "Ярл");
  assert.equal(yarl.summary, "Володар півночі.");
  assert.equal(yarl.portrait, null);
});
