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
