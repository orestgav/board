import assert from "node:assert/strict";
import test from "node:test";
import { minimumScaleForNodes, nodeVisualScale, zoomedViewAt } from "../public/view.js";

test("zoom math accepts arbitrary finite scales", () => {
  assert.equal(zoomedViewAt({ x: 0, y: 0, scale: 1 }, 0, 0, 10).scale, 10);
  assert.equal(zoomedViewAt({ x: 0, y: 0, scale: 1 }, 0, 0, 0.001).scale, 0.001);
});

test("zoom keeps the world point beneath the cursor fixed", () => {
  const view = { x: -200, y: 75, scale: 0.5 };
  const cursor = { x: 340, y: 260 };
  const before = { x: (cursor.x - view.x) / view.scale, y: (cursor.y - view.y) / view.scale };
  const zoomed = zoomedViewAt(view, cursor.x, cursor.y, 25);
  const after = { x: (cursor.x - zoomed.x) / zoomed.scale, y: (cursor.y - zoomed.y) / zoomed.scale };
  assert.deepEqual(after, before);
});

test("zoom rejects only non-positive or non-finite results", () => {
  const view = { x: 0, y: 0, scale: 1 };
  assert.equal(zoomedViewAt(view, 0, 0, 0), null);
  assert.equal(zoomedViewAt(view, 0, 0, Infinity), null);
});

test("node visuals scale with the limiting node dimension", () => {
  assert.equal(nodeVisualScale({ type: "entity", width: 320, height: 190 }), 1);
  assert.equal(nodeVisualScale({ type: "entity", width: 32, height: 19 }), 0.1);
  assert.equal(nodeVisualScale({ type: "entity", width: 640, height: 190 }), 1);
});

test("minimum board scale keeps the largest node visible", () => {
  const rects = [
    { width: 320, height: 190 },
    { width: 2000, height: 1200 },
  ];
  assert.equal(minimumScaleForNodes(rects, 32), 0.016);
  assert.equal(minimumScaleForNodes([], 32), 0);
});
