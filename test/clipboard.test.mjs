import assert from "node:assert/strict";
import test from "node:test";
import { CLIPBOARD_FORMAT, clipboardBounds, clipboardPayload, noteTargets, parseClipboard, placedItems, withoutNodes } from "../public/clipboard.js";

function node(fields) {
  return { id: "a", type: "frame", x: 0, y: 0, width: 100, height: 50, locked: false, children: [], ...fields };
}

const WORLD = { x: 0, y: 0, width: 10_000, height: 10_000 };

test("копія бере абсолютні координати й тексти нотаток", () => {
  const note = node({ id: "n1", type: "note", note: "map-garona#n2" });
  const frame = node({ id: "f1", children: [note] });
  const payload = clipboardPayload([{ node: frame, rect: { x: 300, y: 120, width: 100, height: 50 } }], () => "текст нотатки");
  assert.equal(payload.format, CLIPBOARD_FORMAT);
  assert.deepEqual(payload.items[0].world, { x: 300, y: 120 });
  assert.deepEqual(payload.notes, { "map-garona#n2": "текст нотатки" });
  payload.items[0].node.children[0].note = "інше";
  assert.equal(note.note, "map-garona#n2", "копія не чіпає вузол на дошці");
});

test("розбір відкидає чужий і побитий вміст буфера", () => {
  assert.equal(parseClipboard("просто текст"), null);
  assert.equal(parseClipboard(`{"format":"${CLIPBOARD_FORMAT}"`), null);
  assert.equal(parseClipboard(JSON.stringify({ format: "інше", items: [] })), null);
  assert.equal(parseClipboard(JSON.stringify({ format: CLIPBOARD_FORMAT, items: [] })), null);
  const broken = { format: CLIPBOARD_FORMAT, items: [{ world: { x: 0, y: 0 }, node: { type: "frame", x: 0, y: "тут", width: 10, height: 10 } }] };
  assert.equal(parseClipboard(JSON.stringify(broken)), null);
});

test("розбір лишає дітей і чистить вузли без геометрії", () => {
  const raw = { format: CLIPBOARD_FORMAT, items: [{ world: { x: 0, y: 0 }, node: node({ children: [node({ id: "b" }), { type: "frame" }] }) }] };
  const parsed = parseClipboard(JSON.stringify(raw));
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].node.children.length, 1);
  assert.equal(parsed.items[0].node.children[0].id, "b");
});

test("вставка кладе копію серединою під курсор і зберігає взаємне розташування", () => {
  const payload = {
    format: CLIPBOARD_FORMAT,
    items: [
      { world: { x: 1000, y: 1000 }, node: node({ id: "left", width: 100, height: 100 }) },
      { world: { x: 1300, y: 1000 }, node: node({ id: "right", width: 100, height: 100 }) },
    ],
    notes: {},
  };
  assert.deepEqual(clipboardBounds(payload.items), { x: 1000, y: 1000, width: 400, height: 100 });
  const placed = placedItems(payload, { x: 5000, y: 2000 }, WORLD);
  assert.deepEqual(placed.map((item) => [item.x * 100, item.y * 100]), [[4800, 1950], [5100, 1950]]);
});

test("вставка у контейнер переводить координати у відсотки його прямокутника", () => {
  const payload = { format: CLIPBOARD_FORMAT, items: [{ world: { x: 0, y: 0 }, node: node({ width: 100, height: 100 }) }], notes: {} };
  const [placed] = placedItems(payload, { x: 250, y: 450 }, { x: 200, y: 400, width: 400, height: 200 });
  assert.deepEqual([placed.x, placed.y], [0, 0]);
});

test("кожна вставка отримує власні id по всьому дереву", () => {
  const payload = { format: CLIPBOARD_FORMAT, items: [{ world: { x: 0, y: 0 }, node: node({ children: [node({ id: "b" })] }) }], notes: {} };
  const first = placedItems(payload, { x: 0, y: 0 }, WORLD)[0];
  const second = placedItems(payload, { x: 0, y: 0 }, WORLD)[0];
  const ids = new Set([first.id, first.children[0].id, second.id, second.children[0].id]);
  assert.equal(ids.size, 4);
  assert.equal(payload.items[0].node.id, "a", "буфер лишається придатним для наступної вставки");
});

test("нотатка бере карту з-поміж вставлених вузлів, а без неї — карту під курсором", () => {
  const map = { slug: "map-garona", name: "garona" };
  const inner = { slug: "map-inner", name: "inner" };
  const nodes = [
    node({ id: "n1", type: "note" }),
    node({ id: "m1", type: "image", children: [node({ id: "n2", type: "note" })] }),
  ];
  const targets = noteTargets(nodes, map, (candidate) => candidate.id === "m1" ? inner : null);
  assert.deepEqual(targets.map((target) => [target.node.id, target.map.slug]), [["n1", "map-garona"], ["n2", "map-inner"]]);
  assert.deepEqual(noteTargets(nodes, null, () => null).map((target) => target.map), [null, null]);
});

test("вузли без карти прибираються разом із вмістом", () => {
  const orphan = node({ id: "n1", type: "note", children: [node({ id: "child" })] });
  const nested = node({ id: "n2", type: "note" });
  const nodes = [orphan, node({ id: "f1", children: [nested, node({ id: "keep" })] })];
  const left = withoutNodes(nodes, new Set([orphan, nested]));
  assert.deepEqual(left.map((item) => item.id), ["f1"]);
  assert.deepEqual(left[0].children.map((item) => item.id), ["keep"]);
});
