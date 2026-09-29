import assert from "node:assert/strict";
import test from "node:test";
import { battleMapSize, boxGrid, fitBattleMap, gridFromName, isBattleMap, snapChild, snapsTokens } from "../public/battlemap.js";
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

const map = (fields = {}) => ({ id: "m", type: "image", image: "board/media/maps/a.webp", grid: { columns: 4, rows: 2 }, x: 10, y: 20, width: 100, height: 50, children: [], ...fields });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("snapping is on by default and needs the grid along the frame", () => {
  assert.ok(snapsTokens(map()));
  assert.ok(!snapsTokens(map({ snap: false })));
  assert.ok(!snapsTokens(map({ rotation: 45, aspect: 2 })));
  assert.deepEqual(boxGrid(map({ rotation: 270, aspect: 2 })), { columns: 2, rows: 4 });
  assert.doesNotThrow(() => validateNode(map({ snap: false })));
  assert.throws(() => validateNode(map({ snap: true })), /snap/);
});

test("token snaps onto whole cells, a small one into a quarter", () => {
  // Клітинка 25 × 25: карта 100 × 50 на 4 × 2.
  const medium = snapChild({ x: 30, y: 10, width: 25, height: 25 }, map());
  near(medium.x, 25); near(medium.y, 0);
  const large = snapChild({ x: 40, y: 45, width: 50, height: 50 }, map());
  near(large.x, 50); near(large.y, 50);
  const tiny = snapChild({ x: 13, y: 30, width: 12.5, height: 12.5 }, map());
  near(tiny.x, 12.5); near(tiny.y, 25);
  // Трохи розтягнутий токен стає посередині своєї клітинки.
  const stretched = snapChild({ x: 26, y: 2, width: 27, height: 27 }, map());
  near(stretched.x, 24); near(stretched.y, -2);
});

test("a resized battle map goes back to its grid in board cells", () => {
  const token = { id: "t", type: "token", entity: "raud", x: 50, y: 50, width: 25, height: 25, children: [] };
  const node = map({ width: 200, height: 100, children: [token] });
  assert.ok(fitBattleMap(node, 25, { area: { x: 0, y: 0, width: 1000, height: 1000 } }));
  assert.equal(node.width, 100);
  assert.equal(node.height, 50);
  near(node.x, 15); near(node.y, 22.5);
  // Центр токена лишився в тій самій точці картинки: 112.5 з 200.
  near((token.x * node.width / 100 + 12.5) / node.width, 112.5 / 200);
  assert.equal(fitBattleMap(node, 25, { area: { x: 0, y: 0, width: 1000, height: 1000 } }), false);
  const turned = map({ rotation: 90, aspect: 2, width: 60, height: 120 });
  fitBattleMap(turned, 25, { area: { x: 0, y: 0, width: 1000, height: 1000 } });
  assert.equal(turned.width, 50);
  assert.equal(turned.height, 100);
});
