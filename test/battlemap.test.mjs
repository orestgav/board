import assert from "node:assert/strict";
import test from "node:test";
import { battleMapSize, gridFromName, isBattleMap } from "../public/battlemap.js";
import { validateNode } from "../public/layout.js";

test("battle map grid comes from the file name, oriented by the picture", () => {
  assert.deepEqual(gridFromName("lower-world-street-33x16-grid-300dpi-v9.webp", 9900, 4800), { columns: 33, rows: 16 });
  assert.deepEqual(gridFromName("street-16x33.webp", 9900, 4800), { columns: 33, rows: 16 });
  assert.deepEqual(gridFromName("вулиця 22х16.webp", 4800, 6600), { columns: 16, rows: 22 });
  assert.deepEqual(gridFromName("crypt_20×20.webp", 2000, 2000), { columns: 20, rows: 20 });
  assert.equal(gridFromName("image-10.webp", 1000, 800), null);
  assert.equal(gridFromName("arven (2) (1).webp", 1000, 800), null);
  assert.equal(gridFromName("map-0x12.webp", 1000, 800), null);
});

test("battle map size is its grid in board cells", () => {
  assert.deepEqual(battleMapSize({ columns: 33, rows: 16 }, 25), { width: 825, height: 400 });
});

test("only images carry a valid grid", () => {
  const base = { id: "m", type: "image", image: "board/media/maps/a.webp", x: 0, y: 0, width: 10, height: 10, children: [] };
  assert.doesNotThrow(() => validateNode({ ...base, grid: { columns: 33, rows: 16 } }));
  assert.ok(isBattleMap({ ...base, grid: { columns: 33, rows: 16 } }));
  assert.ok(!isBattleMap(base));
  assert.throws(() => validateNode({ ...base, grid: { columns: 1.5, rows: 16 } }), /grid/);
  assert.throws(() => validateNode({ ...base, grid: { columns: 33 } }), /grid/);
  assert.throws(() => validateNode({ ...base, type: "note", grid: { columns: 3, rows: 3 } }), /сітку має лише/);
});
