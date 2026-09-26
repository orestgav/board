// Буфер канви. У системний буфер копія їде як JSON, тож переживає перехід в
// іншу вкладку канви; координати в ньому — абсолютні світові, бо вставити
// гілку можуть у зовсім інший контейнер, де відсотки від старого батька
// нічого не означають.
import { validateNode } from "./layout.js";

export const CLIPBOARD_FORMAT = "crown-board/nodes@1";

export function clipboardPayload(entries, noteTextOf) {
  const items = entries.map(({ node, rect }) => ({ world: { x: rect.x, y: rect.y }, node: structuredClone(node) }));
  const notes = {};
  for (const item of items) collectNotes(item.node, notes, noteTextOf);
  return { format: CLIPBOARD_FORMAT, items, notes };
}

// Тексти нотаток їдуть разом із вузлами: у чужій вкладці посилання
// `map-...#n2` ще ні на що не вказує, а текст потрібен одразу.
function collectNotes(node, notes, noteTextOf) {
  if (node.type === "note" && typeof node.note === "string") {
    const text = noteTextOf(node.note);
    if (typeof text === "string") notes[node.note] = text;
  }
  for (const child of node.children) collectNotes(child, notes, noteTextOf);
}

// У системному буфері може лежати будь-що — чужий JSON, обрізаний текст,
// власноруч підправлена копія, копія з новішої версії канви. Вузол, що не
// проходить ту саму перевірку, що й canvas.json, відкидаємо разом з його
// гілкою: інакше сміття доїде до розкладки, і її вже не вдасться зберегти.
// `rejected` — скільки вузлів так відпало, щоб канва могла про це сказати.
export function parseClipboard(text) {
  if (typeof text !== "string" || !text.includes(CLIPBOARD_FORMAT)) return null;
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (raw?.format !== CLIPBOARD_FORMAT || !Array.isArray(raw.items)) return null;
  const counter = { rejected: 0 };
  const items = raw.items.map((item) => sanitizeItem(item, counter)).filter(Boolean);
  if (!items.length) return null;
  const notes = {};
  for (const [reference, value] of Object.entries(raw.notes ?? {})) {
    if (typeof value === "string") notes[reference] = value;
  }
  return { format: CLIPBOARD_FORMAT, items, notes, rejected: counter.rejected };
}

function countNodes(raw) {
  return 1 + (Array.isArray(raw?.children) ? raw.children.reduce((sum, child) => sum + countNodes(child), 0) : 0);
}

function sanitizeNode(raw, counter) {
  try {
    validateNode(raw);
  } catch {
    counter.rejected += countNodes(raw);
    return null;
  }
  return { ...raw, children: raw.children.map((child) => sanitizeNode(child, counter)).filter(Boolean) };
}

function sanitizeItem(raw, counter) {
  if (!Number.isFinite(raw?.world?.x) || !Number.isFinite(raw?.world?.y)) {
    counter.rejected += countNodes(raw?.node);
    return null;
  }
  const node = sanitizeNode(raw.node, counter);
  return node ? { world: { x: raw.world.x, y: raw.world.y }, node } : null;
}

export function clipboardBounds(items) {
  const left = Math.min(...items.map((item) => item.world.x));
  const top = Math.min(...items.map((item) => item.world.y));
  const right = Math.max(...items.map((item) => item.world.x + item.node.width));
  const bottom = Math.max(...items.map((item) => item.world.y + item.node.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Копія лягає серединою під курсор, зберігши взаємне розташування вузлів.
// Одна копія вставляється скільки завгодно разів, тому щоразу це новий клон
// із новими id.
export function placedItems(payload, point, rect, newId = () => crypto.randomUUID()) {
  const box = clipboardBounds(payload.items);
  const offsetX = point.x - box.width / 2 - box.x;
  const offsetY = point.y - box.height / 2 - box.y;
  return payload.items.map(({ node, world }) => {
    const copy = freshIds(structuredClone(node), newId);
    copy.x = (world.x + offsetX - rect.x) / rect.width * 100;
    copy.y = (world.y + offsetY - rect.y) / rect.height * 100;
    return copy;
  });
}

function freshIds(node, newId) {
  node.id = newId();
  for (const child of node.children) freshIds(child, newId);
  return node;
}

// Нотатка живе у файлі своєї карти, тож кожна копія потребує власної нової
// нотатки. Карту шукаємо спершу серед самих вставлених вузлів (копіювали цілу
// карту разом із нотатками), а вже потім беремо ту, у яку кладемо.
export function noteTargets(nodes, fallbackMap, mapOf) {
  const targets = [];
  const visit = (children, map) => {
    for (const node of children) {
      const own = mapOf(node) ?? map;
      if (node.type === "note") targets.push({ node, map: own });
      visit(node.children, own);
    }
  };
  visit(nodes, fallbackMap);
  return targets;
}

// Нотатку, якій не дісталося карти, прибираємо разом із її вмістом.
export function withoutNodes(nodes, unwanted) {
  return nodes.filter((node) => !unwanted.has(node)).map((node) => {
    node.children = withoutNodes(node.children, unwanted);
    return node;
  });
}
