import assert from "node:assert/strict";
import test from "node:test";
import {
  addToCast, calibratedPpi, castItem, defaultPpi, emptyCast, itemFrame, moved, parseCast, parsePpi,
  refitted, rememberTransforms, removeFromCast, rotated, scaled, updateItem,
} from "../public/cast.js";

const battleMap = { path: "board/media/maps/street-33x16.webp", name: "street", grid: { columns: 33, rows: 16 } };
const art = { path: "_media/ester.webp", name: "Естер" };

test("a battle map starts at one inch per cell, art fills the screen", () => {
  assert.equal(castItem(battleMap).fit, "inch");
  assert.equal(castItem(art).fit, "screen");
  assert.equal(castItem(art).grid, null);
});

test("cast replaces the scene, add keeps it and does not duplicate", () => {
  const map = castItem(battleMap);
  const portrait = castItem(art);
  let state = addToCast(emptyCast(), map, { replace: true });
  state = addToCast(state, portrait);
  assert.deepEqual(state.items.map((item) => item.path), [battleMap.path, art.path]);
  assert.equal(state.selected, portrait.id);
  state = addToCast(state, castItem(battleMap));
  assert.equal(state.items.length, 2);
  assert.equal(state.selected, map.id, "the same file is just selected again");
  state = addToCast(state, castItem(art), { replace: true });
  assert.deepEqual(state.items.map((item) => item.path), [art.path]);
});

test("casting lifts the blackout", () => {
  const state = addToCast({ ...emptyCast(), blackout: true }, castItem(art));
  assert.equal(state.blackout, false);
});

test("removing the selected item selects the top one left", () => {
  const map = castItem(battleMap);
  const portrait = castItem(art);
  const state = removeFromCast(addToCast(addToCast(emptyCast(), map), portrait), portrait.id);
  assert.equal(state.selected, map.id);
  assert.equal(removeFromCast(state, map.id).selected, null);
});

test("rotation goes in 90° steps both ways", () => {
  assert.deepEqual(rotated({ rotation: 0 }, 1), { rotation: 90 });
  assert.deepEqual(rotated({ rotation: 0 }, -1), { rotation: 270 });
  assert.deepEqual(rotated({ rotation: 270 }, 1), { rotation: 0 });
});

test("scale and move stay within bounds and in inches", () => {
  assert.equal(scaled({ scale: 1 }, 1.05).scale, 1.05);
  assert.equal(scaled({ scale: 0.06 }, 0.5).scale, 0.05);
  assert.deepEqual(moved({ x: 0, y: 0 }, 1, -0.25), { x: 1, y: -0.25 });
});

test("inch fit needs a grid; refitting resets the scale", () => {
  assert.deepEqual(refitted(castItem(art), "inch"), {});
  assert.deepEqual(refitted({ ...castItem(battleMap), scale: 2 }, "screen"), { fit: "screen", scale: 1 });
});

test("a battle map gets exactly one inch per cell, whatever the picture size", () => {
  const frame = itemFrame(castItem(battleMap), { ppi: 40, screen: { width: 1920, height: 1080 }, image: { width: 9900, height: 4800 } });
  assert.equal(frame.width, 33 * 40);
  assert.equal(frame.height, 33 * 40 * 4800 / 9900);
  assert.equal(frame.centerX, 960);
  assert.equal(frame.centerY, 540);
});

test("offset is measured in inches from the screen centre", () => {
  const item = { ...castItem(battleMap), x: 2, y: -1 };
  const frame = itemFrame(item, { ppi: 40, screen: { width: 1920, height: 1080 }, image: { width: 9900, height: 4800 } });
  assert.equal(frame.centerX, 960 + 80);
  assert.equal(frame.centerY, 540 - 40);
});

test("screen fit contains the turned picture", () => {
  const screen = { width: 1920, height: 1080 };
  const image = { width: 1000, height: 2000 };
  const upright = itemFrame(castItem(art), { ppi: 40, screen, image });
  assert.equal(upright.height, 1080);
  const turned = itemFrame({ ...castItem(art), rotation: 90 }, { ppi: 40, screen, image });
  assert.equal(turned.height, 1920, "after 90° the long side lies along the screen width");
});

test("calibration stays in a sane range", () => {
  assert.equal(defaultPpi(1920), 64);
  assert.equal(calibratedPpi(64, 1.02), 65.28);
  assert.equal(parsePpi("abc"), null);
  assert.equal(parsePpi("0.5"), null);
  assert.equal(parsePpi("52.5"), 52.5);
});

test("each picture remembers how it was fitted", () => {
  const state = addToCast(emptyCast(), { ...castItem(battleMap), rotation: 90, x: 3 });
  const memory = rememberTransforms({}, state);
  const again = castItem(battleMap, memory[battleMap.path]);
  assert.equal(again.rotation, 90);
  assert.equal(again.x, 3);
  assert.equal(castItem(art, { fit: "inch" }).fit, "screen", "art without a grid cannot be in inches");
});

test("stored scene is validated", () => {
  const map = castItem(battleMap);
  const stored = JSON.stringify({ items: [map, { id: "x" }, null], selected: "gone", blackout: true, calibrating: true });
  const state = parseCast(stored);
  assert.equal(state.items.length, 1);
  assert.equal(state.selected, map.id);
  assert.equal(state.blackout, true);
  assert.equal(state.calibrating, false);
  assert.deepEqual(parseCast("not json"), emptyCast());
  assert.deepEqual(parseCast(null), emptyCast());
});

test("updateItem changes only the given item", () => {
  const map = castItem(battleMap);
  const portrait = castItem(art);
  const state = updateItem(addToCast(addToCast(emptyCast(), map), portrait), map.id, (item) => rotated(item, 1));
  assert.equal(state.items[0].rotation, 90);
  assert.equal(state.items[1].rotation, 0);
});
