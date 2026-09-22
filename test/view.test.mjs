import assert from "node:assert/strict";
import test from "node:test";
import { centeredViewOnRect, locationBorderScreenWidth, locationHeaderHeight, maximumScaleForNodes, minimumScaleForNodes, nodeVisualScale, rebasedView, rectWithin, zoomedViewAt , rectsOverlap, worldViewportRect } from "../public/view.js";

test("the selection band takes a node only when it fits inside whole", () => {
  const band = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(rectWithin({ x: 10, y: 10, width: 50, height: 50 }, band), true);
  assert.equal(rectWithin({ x: 0, y: 0, width: 100, height: 100 }, band), true);
  assert.equal(rectWithin({ x: 80, y: 10, width: 50, height: 50 }, band), false);
  assert.equal(rectWithin({ x: -10, y: 10, width: 50, height: 50 }, band), false);
});

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

test("centering a node preserves scale and places its center in the viewport center", () => {
  const rect = { x: -200, y: 300, width: 400, height: 200 };
  const centered = centeredViewOnRect({ x: 10, y: 20, scale: 2 }, rect, 1000, 800);
  assert.deepEqual(centered, { x: 500, y: -400, scale: 2 });
});

test("rebasing keeps huge camera translations out of the DOM transform", () => {
  const view = { x: -500_000_000, y: 250_000_000, scale: 40 };
  const rebased = rebasedView(view, 1200, 800);
  const worldPoint = { x: 12_500_020, y: -6_249_990 };
  assert.equal((worldPoint.x - rebased.originX) * view.scale + rebased.translateX, worldPoint.x * view.scale + view.x);
  assert.equal((worldPoint.y - rebased.originY) * view.scale + rebased.translateY, worldPoint.y * view.scale + view.y);
  assert.deepEqual({ x: rebased.translateX, y: rebased.translateY }, { x: 600, y: 400 });
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

test("minimum board scale keeps the largest node at the given share of the viewport", () => {
  const rects = [
    { width: 320, height: 190 },
    { width: 2000, height: 1200 },
  ];
  assert.equal(minimumScaleForNodes(rects, 1000, 800, 0.7), 700 / 2000);
  assert.equal(minimumScaleForNodes([{ width: 1000, height: 2000 }], 1000, 800, 0.7), 560 / 2000);
  assert.equal(minimumScaleForNodes([], 1000, 800, 0.7), 0);
});

test("maximum board scale fits the smallest node in the viewport", () => {
  const rects = [
    { width: 800, height: 600 },
    { width: 100, height: 50 },
  ];
  assert.equal(maximumScaleForNodes(rects, 1000, 800, 50), 9);
  assert.equal(maximumScaleForNodes([], 1000, 800, 50), Infinity);
});

test("a card drawn as a frame scales by the frame base size", () => {
  const node = { type: "entity", width: 720, height: 460 };
  assert.equal(nodeVisualScale(node), Math.min(720 / 320, 460 / 190));
  assert.equal(nodeVisualScale(node, "frame"), 2);
  assert.equal(locationHeaderHeight(720, 460), 52);
});

test("a location border is bold from afar and disappears at half screen", () => {
  assert.equal(locationBorderScreenWidth(40, 30, 1, 1000, 800), 8);
  assert.equal(locationBorderScreenWidth(500, 400, 1, 1000, 800), 0);
  const middle = locationBorderScreenWidth(300, 240, 1, 1000, 800);
  assert.ok(middle > 0 && middle < 8);
});

test("a location border stays bold until the card is a speck", () => {
  assert.ok(locationBorderScreenWidth(80, 60, 1, 1000, 800) > 7);
  assert.ok(locationBorderScreenWidth(30, 24, 1, 1000, 800) > 5);
});

test("a location border thins back to a hair on the world map", () => {
  assert.equal(locationBorderScreenWidth(10, 8, 1, 1000, 800), 1);
  assert.equal(locationBorderScreenWidth(4, 3, 1, 1000, 800), 1);
  const between = locationBorderScreenWidth(25, 20, 1, 1000, 800);
  assert.ok(between > 1 && between < 8);
});

test("the visible world rect mirrors screen-to-world conversion", () => {
  const view = { x: -200, y: -100, scale: 2 };
  assert.deepEqual(worldViewportRect(view, 800, 600), { x: 100, y: 50, width: 400, height: 300 });
});

test("rects that only touch at an edge still count as visible", () => {
  const screen = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(rectsOverlap({ x: 100, y: 50, width: 40, height: 40 }, screen), true);
  assert.equal(rectsOverlap({ x: 101, y: 50, width: 40, height: 40 }, screen), false);
  assert.equal(rectsOverlap({ x: -60, y: -60, width: 70, height: 70 }, screen), true);
  assert.equal(rectsOverlap({ x: 10, y: 200, width: 10, height: 10 }, screen), false);
});
