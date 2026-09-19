import assert from "node:assert/strict";
import test from "node:test";
import { absoluteRect, deepestContainerAt, findEntry, nearestAncestor, reparentNode, reorderNode } from "../public/model.js";

const frame = (id, x, y, width = 400, height = 300, children = []) => ({ id, type: "frame", title: id, x, y, width, height, locked: false, children });

test("nested positions are percentages of the immediate parent", () => {
  const layout = { formatVersion: 1, children: [frame("parent", 10, 20, 500, 400, [frame("child", 50, 25, 100, 80)])] };
  assert.deepEqual(absoluteRect(layout, "child"), { x: 1250, y: 2100, width: 100, height: 80 });
});

test("reparent keeps the absolute position", () => {
  const layout = { formatVersion: 1, children: [frame("parent", 10, 10, 1000, 800), frame("child", 15, 15, 100, 80)] };
  const before = absoluteRect(layout, "child");
  assert.equal(reparentNode(layout, "child", "parent"), true);
  assert.deepEqual(absoluteRect(layout, "child"), before);
  assert.equal(findEntry(layout, "child").parent.id, "parent");
});

test("a child can be extracted back to the root", () => {
  const child = frame("child", 120, 30, 100, 80);
  const layout = { formatVersion: 1, children: [frame("parent", 10, 10, 500, 400, [child])] };
  const before = absoluteRect(layout, "child");
  assert.equal(reparentNode(layout, "child", null), true);
  const after = absoluteRect(layout, "child");
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
  assert.equal(after.width, before.width);
  assert.equal(after.height, before.height);
  assert.equal(findEntry(layout, "child").parent, null);
});

test("reparent clamps coordinates to the valid percentage range", () => {
  const layout = { formatVersion: 1, children: [frame("parent", 10, 10, 1000, 800), frame("child", 9, 9, 400, 300)] };
  assert.equal(reparentNode(layout, "child", "parent"), true);
  assert.equal(findEntry(layout, "child").node.x, 0);
  assert.equal(findEntry(layout, "child").node.y, 0);
});

test("container hit testing chooses the deepest node", () => {
  const layout = { formatVersion: 1, children: [frame("parent", 10, 10, 1000, 800, [frame("child", 10, 10, 200, 150)])] };
  assert.equal(deepestContainerAt(layout, { x: 1120, y: 1100 }, null).id, "child");
});

test("z-order operations only reorder siblings", () => {
  const layout = { formatVersion: 1, children: [frame("a", 1, 1), frame("b", 2, 2), frame("c", 3, 3)] };
  assert.equal(reorderNode(layout, "a", "front"), true);
  assert.deepEqual(layout.children.map(({ id }) => id), ["b", "c", "a"]);
});

test("nearest ancestor walks from the immediate node toward the root", () => {
  const map = { id: "map", type: "image", image: "_media/maps/world.webp", x: 1, y: 1, width: 800, height: 600, children: [frame("scene", 10, 10, 300, 200, [frame("note", 10, 10)])] };
  const layout = { formatVersion: 1, children: [map] };
  assert.equal(nearestAncestor(layout, "note", (node) => node.type === "image").id, "map");
});
