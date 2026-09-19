import assert from "node:assert/strict";
import test from "node:test";
import {
  appendNoteBlock,
  mapSlugFromPath,
  newNoteDocument,
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
