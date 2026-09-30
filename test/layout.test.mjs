import assert from "node:assert/strict";
import test from "node:test";
import { LAYOUT_VERSION, emptyLayout, parseLayout, validateLayout, validateNode } from "../public/layout.js";
import * as server from "../src/server.mjs";

const frame = (fields = {}) => ({ id: "f", type: "frame", title: "Рамка", x: 0, y: 0, width: 10, height: 10, children: [], ...fields });

test("the server and the folder share one layout rule", () => {
  assert.equal(server.validateLayout, validateLayout);
  assert.equal(server.LAYOUT_VERSION, LAYOUT_VERSION);
  assert.deepEqual(server.emptyLayout(), emptyLayout());
});

test("a single node is checked on its own fields, without its children", () => {
  assert.equal(validateNode(frame({ children: [{ nonsense: true }] })).id, "f");
  assert.throws(() => validateNode(frame({ locked: "так" })), /locked має бути булевим/);
  assert.throws(() => validateNode(frame({ children: undefined })), /children має бути масивом/);
  assert.throws(() => validateNode(null), /об'єктом/);
});

test("the whole tree is checked, including ids repeated at different depths", () => {
  assert.throws(() => validateLayout({ formatVersion: 1, children: [frame({ children: [frame()] })] }), /Повторний id вузла: f/);
  assert.throws(() => validateLayout({ formatVersion: 1, children: [frame({ children: [{ nonsense: true }] })] }), /мусить мати id/);
});

test("parsing names the file and says what is wrong", () => {
  assert.deepEqual(parseLayout('{"formatVersion":1,"children":[]}'), emptyLayout());
  assert.throws(() => parseLayout("{", "board/canvas.json"), /^Error: board\/canvas\.json не читається як JSON/);
  assert.throws(() => parseLayout('{"formatVersion":0,"children":[]}', "board/canvas.json"), /board\/canvas\.json: Розкладка має непідтримувану версію: 0/);
  assert.throws(() => parseLayout('{"formatVersion":1}'), /canvas\.json: children має бути масивом/);
});

test("only a picture turns, in 45° steps, and keeps its proportions with it", () => {
  const image = (fields = {}) => ({ id: "i", type: "image", image: "board/media/m.webp", x: 0, y: 0, width: 10, height: 10, children: [], ...fields });
  assert.equal(validateNode(image({ rotation: 135, aspect: 1.5 })).rotation, 135);
  assert.throws(() => validateNode(image({ rotation: 30, aspect: 1.5 })), /rotation має бути одним із/);
  assert.throws(() => validateNode(image({ rotation: 0, aspect: 1.5 })), /rotation має бути одним із/);
  assert.throws(() => validateNode(image({ rotation: 90 })), /aspect має бути додатним числом/);
  assert.throws(() => validateNode(frame({ rotation: 90, aspect: 1 })), /повертати можна лише картинку/);
});

test("spent spell slots are whole positive counts, on the node or on each creature", () => {
  const statblock = (fields) => ({ id: "s", type: "entity", entity: "kliryk", x: 0, y: 0, width: 10, height: 10, children: [], ...fields });
  assert.equal(validateNode(statblock({ slots: { 1: 2, "день:fireball": 1 } })).id, "s");
  assert.equal(validateNode(statblock({ creatures: [{ hp: 3, slots: { 3: 1 } }, { hp: 3 }] })).id, "s");
  assert.throws(() => validateNode(statblock({ slots: { 1: 0 } })), /slots має бути/);
  assert.throws(() => validateNode(statblock({ slots: [1] })), /slots має бути/);
  assert.throws(() => validateNode(statblock({ creatures: [{ slots: { 1: 1.5 } }] })), /slots істоти/);
});
