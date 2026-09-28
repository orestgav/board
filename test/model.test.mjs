import assert from "node:assert/strict";
import test from "node:test";
import { absoluteRect, adoptLayout, allAbsoluteRects, collectNodes, containerGrid, deepestContainerAt, findEntry, nearestAncestor, nearestPointParent, nodeIndex, nodesInRect, outermostIds, reparentNode, reorderNode, rotateImageNode, rotatedImageShare } from "../public/model.js";
import { rectWithin } from "../public/view.js";

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

test("reparent preserves coordinates outside the parent bounds", () => {
  const layout = { formatVersion: 1, children: [frame("parent", 10, 10, 1000, 800), frame("child", 9, 9, 400, 300)] };
  assert.equal(reparentNode(layout, "child", "parent"), true);
  assert.equal(findEntry(layout, "child").node.x, -10);
  assert.equal(findEntry(layout, "child").node.y, -12.5);
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

const gridOptions = {
  cell: { width: 320, height: 190 },
  gap: 24,
  padding: 28,
  minimum: { width: 360, height: 230 },
  header: (width, height) => 38 * Math.min(width / 360, height / 230),
};

test("an empty container keeps the minimum frame size", () => {
  const grid = containerGrid(0, gridOptions);
  assert.deepEqual([grid.width, grid.height, grid.cells], [360, 230, []]);
});

test("container cells fill a square-ish grid below the header", () => {
  const grid = containerGrid(5, gridOptions);
  const header = 38 * Math.min(grid.width / 360, grid.height / 230);
  assert.equal(grid.width, 3 * 320 + 2 * 24 + 56);
  assert.equal(grid.cells.length, 5);
  assert.deepEqual(grid.cells[0], { x: 28, y: header + 28 });
  assert.deepEqual(grid.cells[3], { x: 28, y: header + 28 + 190 + 24 });
});

test("every container cell stays inside the container", () => {
  for (const count of [1, 2, 4, 7, 13, 40]) {
    const grid = containerGrid(count, gridOptions);
    for (const cell of grid.cells) {
      assert.ok(cell.x + 320 <= grid.width - 28 + 0.001, `ширина для ${count}`);
      assert.ok(cell.y + 190 <= grid.height - 28 + 0.001, `висота для ${count}`);
    }
  }
});

test("only nodes overlapping the rect are listed, with their depth", () => {
  const overlaps = (first, second) => first.x <= second.x + second.width && second.x <= first.x + first.width
    && first.y <= second.y + second.height && second.y <= first.y + first.height;
  const layout = {
    formatVersion: 1,
    children: [
      frame("near", 10, 10, 500, 400, [frame("inside", 10, 10, 100, 80), frame("outside", 90, 90, 100, 80)]),
      frame("far", 80, 80, 400, 300),
    ],
  };
  const rows = nodesInRect(layout, { x: 900, y: 900, width: 300, height: 300 }, overlaps);
  assert.deepEqual(rows.map(({ node, depth }) => [node.id, depth]), [["near", 0], ["inside", 1]]);
  assert.deepEqual(rows[1].rect, absoluteRect(layout, "inside"));
});

test("a selection drops nodes that live inside another selected node", () => {
  const layout = {
    formatVersion: 1,
    children: [frame("parent", 10, 10, 1000, 800, [frame("child", 10, 10, 200, 150)]), frame("other", 50, 50)],
  };
  assert.deepEqual(outermostIds(layout, ["child", "parent", "other"]), ["parent", "other"]);
});

test("a selection without nesting keeps the order it was collected in", () => {
  const layout = { formatVersion: 1, children: [frame("a", 1, 1), frame("b", 2, 2)] };
  assert.deepEqual(outermostIds(layout, ["b", "a", "b"]), ["b", "a"]);
});

test("the selection band takes whole nodes and leaves the container around them", () => {
  const layout = {
    formatVersion: 1,
    children: [frame("map", 10, 10, 2000, 1600, [frame("card", 5, 5, 200, 150), frame("far", 90, 90, 200, 150)])],
  };
  const band = { x: 1050, y: 1050, width: 400, height: 300 };
  assert.deepEqual(nodesInRect(layout, band, rectWithin).map(({ node }) => node.id), ["card"]);
});

test("a rect far from every node lists nothing", () => {
  const overlaps = (first, second) => first.x < second.x + second.width && second.x < first.x + first.width
    && first.y < second.y + second.height && second.y < first.y + first.height;
  const layout = { formatVersion: 1, children: [frame("only", 10, 10, 400, 300)] };
  assert.deepEqual(nodesInRect(layout, { x: 8000, y: 8000, width: 200, height: 200 }, overlaps), []);
});

test("the largest node can stay listed outside the visible rect", () => {
  const overlaps = (first, second) => first.x < second.x + second.width && second.x < first.x + first.width
    && first.y < second.y + second.height && second.y < first.y + first.height;
  const layout = {
    formatVersion: 1,
    children: [frame("largest", 70, 70, 1200, 900), frame("visible", 1, 1, 200, 150), frame("hidden", 80, 10, 300, 200)],
  };
  const rows = nodesInRect(layout, { x: 0, y: 0, width: 500, height: 500 }, overlaps, { includeLargest: true });
  assert.deepEqual(rows.map(({ node }) => node.id), ["largest", "visible"]);
});

test("node index gives every node with its world rect in tree order", () => {
  const layout = { formatVersion: 1, children: [frame("parent", 10, 20, 500, 400, [frame("child", 50, 25, 100, 80)]), frame("other", 0, 0)] };
  const index = nodeIndex(layout);
  assert.deepEqual([...index.keys()], ["parent", "child", "other"]);
  assert.deepEqual(index.get("child").rect, absoluteRect(layout, "child"));
  assert.equal(index.get("child").node, layout.children[0].children[0]);
  assert.deepEqual(allAbsoluteRects(layout).map(({ id }) => id), ["parent", "child", "other"]);
});

test("node index can place children inside the parent's border", () => {
  const layout = { formatVersion: 1, children: [frame("parent", 0, 0, 500, 400, [frame("child", 50, 50, 100, 80)])] };
  const index = nodeIndex(layout, { inset: (node) => (node.id === "parent" ? 10 : 0) });
  assert.deepEqual(index.get("child").rect, { x: 10 + 240, y: 10 + 190, width: 100, height: 80 });
});

test("adopting a layout keeps node objects and takes the new values", () => {
  const child = frame("child", 10, 10, 100, 80);
  const parent = frame("parent", 0, 0, 500, 400, [child]);
  const current = { formatVersion: 1, children: [parent] };
  const next = structuredClone(current);
  next.children[0].children[0].x = 42;
  delete next.children[0].children[0].locked;
  next.children[0].children.push(frame("added", 1, 1));
  const adopted = adoptLayout(current, next);
  assert.equal(adopted.children[0], parent);
  assert.equal(adopted.children[0].children[0], child);
  assert.equal(child.x, 42);
  assert.equal("locked" in child, false);
  assert.deepEqual(adopted.children[0].children.map(({ id }) => id), ["child", "added"]);
});

test("adopting a layout can move a node to another parent", () => {
  const child = frame("child", 10, 10, 100, 80);
  const current = { formatVersion: 1, children: [frame("a", 0, 0, 500, 400, [child]), frame("b", 50, 50)] };
  const next = { formatVersion: 1, children: [frame("a", 0, 0, 500, 400), frame("b", 50, 50, 400, 300, [frame("child", 5, 5, 100, 80)])] };
  const adopted = adoptLayout(current, next);
  assert.equal(adopted.children[1].children[0], child);
  assert.deepEqual(adopted.children[0].children, []);
});

test("collectNodes finds matching nodes inside containers at any depth", () => {
  const note = (id) => ({ id, type: "note", children: [] });
  const tree = [
    { id: "frame", type: "frame", children: [note("n1"), { id: "scene", type: "scene", children: [note("n2")] }] },
    note("n3"),
  ];
  assert.deepEqual(collectNodes(tree, (node) => node.type === "note").map((node) => node.id), ["n1", "n2", "n3"]);
  assert.deepEqual(collectNodes([], () => true), []);
});

// На сторінці діти стоять усередині рамки батька. Вставка, пошук під курсором
// і перенесення мусять рахувати так само, як рендер, інакше на карті світу з
// рамкою в десятки тисяч одиниць картка лягає далеко від курсора.
test("geometry with a border inset matches the rendered node index", () => {
  const inset = (node) => (node.id === "world" ? 1000 : node.id === "city" ? 10 : 0);
  const layout = { formatVersion: 1, children: [
    frame("world", 0, 0, 100_000, 80_000, [frame("city", 40, 60, 20_000, 10_000, [frame("card", 30, 70, 320, 190)])]),
  ] };
  const index = nodeIndex(layout, { inset });
  for (const id of ["world", "city", "card"]) assert.deepEqual(absoluteRect(layout, id, { inset }), index.get(id).rect);

  const card = index.get("card").rect;
  const point = { x: card.x + 1, y: card.y + 1 };
  assert.equal(nearestPointParent(layout, point, { inset }).parent.id, "card");

  const city = layout.children[0].children[0];
  const { rect } = nearestPointParent(layout, { x: index.get("city").rect.x + 50, y: index.get("city").rect.y + 50 }, { inset });
  const x = (point.x - rect.x) / rect.width * 100;
  const y = (point.y - rect.y) / rect.height * 100;
  city.children.push(frame("placed", x, y, 50, 50));
  const placed = absoluteRect(layout, "placed", { inset });
  assert.ok(Math.abs(placed.x - point.x) < 1e-6 && Math.abs(placed.y - point.y) < 1e-6);

  assert.equal(reparentNode(layout, "placed", "world", { inset }), true);
  const moved = absoluteRect(layout, "placed", { inset });
  assert.ok(Math.abs(moved.x - point.x) < 1e-6 && Math.abs(moved.y - point.y) < 1e-6);
});

const image = (fields = {}) => ({ id: "map", type: "image", image: "board/media/maps/m.webp", x: 10, y: 10, width: 400, height: 200, children: [], ...fields });
const WORLD = { width: 10_000, height: 10_000 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);

test("a quarter turn swaps the frame around the same centre", () => {
  const node = image();
  assert.equal(rotateImageNode(node, 90, { area: WORLD }), true);
  close(node.width, 200);
  close(node.height, 400);
  close(node.x * 100 + node.width / 2, 10 * 100 + 200);
  close(node.y * 100 + node.height / 2, 10 * 100 + 100);
  assert.equal(node.rotation, 90);
  assert.equal(node.aspect, 2);
});

test("at 45° the frame bounds the picture, and the picture keeps its proportions", () => {
  const node = image();
  rotateImageNode(node, 45, { area: WORLD });
  close(node.width, 600 / Math.SQRT2);
  close(node.height, 600 / Math.SQRT2);
  const share = rotatedImageShare(node.aspect, node.rotation);
  close(node.width * share.width, 400);
  close(node.height * share.height, 200);
});

test("a full circle of steps restores the node and drops the rotation fields", () => {
  const node = image({ children: [image({ id: "token", x: 10, y: 20, width: 20, height: 20 })] });
  for (let step = 0; step < 8; step += 1) rotateImageNode(node, 45, { area: WORLD, inset: 2 });
  close(node.x, 10);
  close(node.width, 400);
  close(node.height, 200);
  close(node.children[0].x, 10);
  close(node.children[0].y, 20);
  assert.equal("rotation" in node, false);
  assert.equal("aspect" in node, false);
});

test("content turns with the picture around its centre", () => {
  // Жетон у правому верхньому куті після чверті оберту — у правому нижньому.
  const node = image({ children: [image({ id: "token", x: 90, y: 0, width: 40, height: 20 })] });
  rotateImageNode(node, 90, { area: WORLD });
  const [token] = node.children;
  close(token.x * node.width / 100 + token.width / 2, 200 - 10);
  close(token.y * node.height / 100 + token.height / 2, 400 - 20);
  rotateImageNode(node, -90, { area: WORLD });
  close(token.x, 90);
  close(token.y, 0);
});
