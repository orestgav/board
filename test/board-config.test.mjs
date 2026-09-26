import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_BOARD_CONFIG, campaignKey, campaignName, normalizeBoardConfig, parseBoardConfig } from "../public/board-config.js";

test("a new campaign needs nothing but the config version", () => {
  const config = normalizeBoardConfig({ boardConfigVersion: 1 });
  assert.equal(config.layout, "board/canvas.json");
  assert.equal(config.frontmatter, null);
  assert.deepEqual(config.notes, { dir: "board/notes", prefix: "map-", type: "board" });
  assert.deepEqual(config.media, { dir: "board/media", entityDir: "_media", cacheDir: "board/cache", format: "webp" });
  assert.deepEqual(config.entities.types, DEFAULT_BOARD_CONFIG.entities.types);
  assert.deepEqual(config.entities.locationMembers, ["npc", "предмети"]);
  assert.deepEqual(config.entities.statblockHiddenSections, ["Тактика", "Де використовувати", "Що знають гравці"]);
  assert.deepEqual(config.travel, { hide: [], extra: [] });
  assert.equal(config.id, null);
  assert.equal(config.name, null);
});

test("given fields win, missing ones fall back to the format's defaults", () => {
  const config = normalizeBoardConfig({
    boardConfigVersion: 1,
    id: "north",
    name: "Північ",
    frontmatter: "tools/frontmatter.mjs",
    notes: { prefix: "scene-" },
    media: { entityDir: "art" },
    entities: { types: ["npc"], locationMembers: ["NPC (ще)", "Звірі"] },
    travel: { hide: ["galley"], extra: [{ id: "sled", label: "Сани", milesPerHour: 3, milesPerDay: 24, hoursPerDay: 8 }] },
  });
  assert.equal(config.notes.dir, "board/notes");
  assert.equal(config.notes.prefix, "scene-");
  assert.equal(config.media.dir, "board/media");
  assert.equal(config.media.entityDir, "art");
  assert.deepEqual(config.entities.types, ["npc"]);
  assert.deepEqual(config.entities.locationMembers, ["npc", "звірі"]);
  assert.equal(config.entities.summarySection, "## На дошці");
  assert.equal(config.travel.extra[0].note, "");
  assert.equal(campaignKey(config, "folder"), "north");
  assert.equal(campaignName(config, "folder"), "Північ");
  const bare = normalizeBoardConfig({ boardConfigVersion: 1 });
  assert.equal(campaignKey(bare, "dnd-campaign"), "dnd-campaign");
  assert.equal(campaignName(bare, "dnd-campaign"), "dnd-campaign");
});

test("a broken config says which field is wrong", () => {
  const broken = (fields) => () => normalizeBoardConfig({ boardConfigVersion: 1, ...fields });
  assert.throws(() => normalizeBoardConfig({}), /boardConfigVersion: відсутня/);
  assert.throws(() => normalizeBoardConfig({ boardConfigVersion: 2 }), /непідтримувана boardConfigVersion: 2/);
  assert.throws(() => normalizeBoardConfig([]), /має бути об'єктом/);
  assert.throws(broken({ layout: "../elsewhere.json" }), /board\.config\.json: layout має бути відносним шляхом/);
  assert.throws(broken({ layout: "C:/board.json" }), /layout має бути відносним/);
  assert.throws(broken({ layout: "board\\canvas.json" }), /layout має бути відносним/);
  assert.throws(broken({ notes: { dir: "/abs" } }), /notes\.dir має бути відносним/);
  assert.throws(broken({ notes: { prefix: "Map " } }), /notes\.prefix/);
  assert.throws(broken({ notes: "board/notes" }), /notes має бути об'єктом/);
  assert.throws(broken({ media: { format: "png" } }), /media\.format підтримує лише webp/);
  assert.throws(broken({ entities: { types: "npc" } }), /entities\.types має бути масивом непорожніх рядків/);
  assert.throws(broken({ entities: { summarySection: "" } }), /entities\.summarySection має бути непорожнім рядком/);
  assert.throws(broken({ name: 7 }), /name має бути непорожнім рядком/);
  assert.throws(broken({ travel: { extra: {} } }), /travel\.extra має бути масивом/);
  assert.throws(broken({ travel: { extra: [{ id: "x", label: "X", milesPerHour: -1, milesPerDay: 1, hoursPerDay: 8 }] } }), /travel\.extra\.x: milesPerHour/);
  const sled = { id: "sled", label: "Сани", milesPerHour: 3, milesPerDay: 24, hoursPerDay: 8 };
  assert.throws(broken({ travel: { extra: [sled, sled] } }), /повторний id: sled/);
});

test("config text is parsed with a readable error", () => {
  assert.equal(parseBoardConfig('{"boardConfigVersion":1}').layout, "board/canvas.json");
  assert.throws(() => parseBoardConfig("{ oops"), /board\.config\.json не читається як JSON/);
});

test("the Crown campaign config is accepted as it is", async (context) => {
  let source;
  try { source = await readFile(new URL("../../dnd-campaign/board.config.json", import.meta.url), "utf8"); }
  catch { return context.skip("теки кампанії поруч немає"); }
  const config = parseBoardConfig(source);
  assert.equal(config.frontmatter, "tools/frontmatter.mjs");
  assert.equal(config.media.entityDir, "_media");
});
