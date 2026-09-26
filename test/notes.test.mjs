import assert from "node:assert/strict";
import test from "node:test";
import {
  appendNoteBlock,
  mapSlugFromPath,
  newNoteDocument,
  noteFileSlug,
  nextNoteAnchor,
  parseNoteBlocks,
  removeNoteBlock,
  splitNoteReference,
  updateNoteBlock,
} from "../public/notes.js";

test("note blocks round-trip without putting content in canvas data", () => {
  let source = newNoteDocument("board", "Кардоса (нотатки дошки)");
  source = appendNoteBlock(source, nextNoteAnchor(source), "Перша нотатка");
  source = appendNoteBlock(source, nextNoteAnchor(source), "Друга\nз [[link]]");
  assert.deepEqual(parseNoteBlocks(source, "map-kardosa"), [
    { reference: "map-kardosa#n1", anchor: "n1", text: "Перша нотатка" },
    { reference: "map-kardosa#n2", anchor: "n2", text: "Друга\nз [[link]]" },
  ]);
  source = updateNoteBlock(source, "n1", "Оновлено");
  source = removeNoteBlock(source, "n2");
  assert.equal(parseNoteBlocks(source, "map-kardosa")[0].text, "Оновлено");
  assert.equal(parseNoteBlocks(source, "map-kardosa").length, 1);
});

test("note references and map filenames are safe and deterministic", () => {
  assert.deepEqual(splitNoteReference("map-kardosa#n7"), { fileSlug: "map-kardosa", anchor: "n7" });
  assert.throws(() => splitNoteReference("../secret#n1"), /Некоректне посилання/);
  assert.match(mapSlugFromPath("_media/maps/Карта Кардоси.webp"), /^karta-kardosy-[a-z0-9]+$/);
  assert.equal(mapSlugFromPath("_media/maps/world.webp"), "world");
  assert.equal(mapSlugFromPath("_media/maps/World_Political.webp"), "world-political");
  assert.throws(() => appendNoteBlock(newNoteDocument("board", "Map"), "n1", "<!-- note n2 -->"), /зарезервований/);
});

test("next anchor follows the largest one, even with gaps left by deletions", () => {
  assert.equal(nextNoteAnchor(newNoteDocument("board", "Map")), "n1");
  const source = "---\ntype: board\n---\n\n<!-- note n2 -->\nA\n\n<!-- note n7 -->\nB\n";
  assert.equal(nextNoteAnchor(source), "n8");
});

test("a file with a repeated anchor is refused rather than guessed", () => {
  const source = "<!-- note n1 -->\nA\n\n<!-- note n1 -->\nB\n";
  assert.throws(() => parseNoteBlocks(source, "map-x"), /Повторний якір/);
  assert.throws(() => updateNoteBlock(source, "n1", "C"), /Повторний якір/);
  assert.throws(() => removeNoteBlock(source, "n1"), /Повторний якір/);
});

test("Windows line endings read the same and are normalised on write", () => {
  const source = "---\r\ntype: board\r\n---\r\n\r\n<!-- note n1 -->\r\nРядок 1\r\nРядок 2\r\n";
  assert.equal(parseNoteBlocks(source, "map-x")[0].text, "Рядок 1\nРядок 2");
  assert.doesNotMatch(updateNoteBlock(source, "n1", "Нове"), /\r/);
});

test("updating and removing a missing anchor fails loudly", () => {
  const source = appendNoteBlock(newNoteDocument("board", "Map"), "n1", "A");
  assert.throws(() => updateNoteBlock(source, "n2", "B"), /Не знайдено якір/);
  assert.throws(() => removeNoteBlock(source, "n2"), /Не знайдено якір/);
});

test("removing a block takes its blank lines along and keeps its neighbours intact", () => {
  let source = newNoteDocument("board", "Map");
  for (const text of ["Перша", "Друга", "Третя"]) source = appendNoteBlock(source, nextNoteAnchor(source), text);
  const removed = removeNoteBlock(source, "n2");
  assert.equal(removed, `${newNoteDocument("board", "Map")}\n<!-- note n1 -->\nПерша\n\n<!-- note n3 -->\nТретя\n`);
  assert.deepEqual(parseNoteBlocks(removed, "map-x").map((note) => note.text), ["Перша", "Третя"]);
});

test("an empty note is a valid block, and a marker-looking line inside text is rejected everywhere", () => {
  const source = appendNoteBlock(newNoteDocument("board", "Map"), "n1", "   ");
  assert.equal(parseNoteBlocks(source, "map-x")[0].text, "");
  assert.throws(() => updateNoteBlock(source, "n1", "x\n<!-- note n9 -->"), /зарезервований/);
  assert.throws(() => appendNoteBlock(source, "n2", 42), /має бути рядком/);
});

test("the notes document quotes its map name so any title stays valid frontmatter", () => {
  assert.equal(newNoteDocument("board", 'Карта "Порт": нова'), '---\ntype: board\nname: "Карта \\"Порт\\": нова"\n---\n');
});

test("map slugs never collide for names that only differ in characters a slug drops", () => {
  const first = mapSlugFromPath("board/media/maps/arven (2) (1).webp");
  const second = mapSlugFromPath("board/media/maps/arven (2)-(1).webp");
  assert.match(first, /^arven-2-1-[a-z0-9]+$/);
  assert.notEqual(first, second);
  assert.match(mapSlugFromPath("board/media/maps/!!!.webp"), /^image-[a-z0-9]+$/);
  assert.equal(noteFileSlug("world", { prefix: "map-" }), "map-world");
});
