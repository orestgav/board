export const WORLD_SIZE = 10_000;

export function cloneLayout(layout) {
  return structuredClone(layout);
}

export function walkNodes(children, visit, parent = null, depth = 0) {
  children.forEach((node, index) => {
    visit({ node, parent, children, index, depth });
    walkNodes(node.children, visit, node, depth + 1);
  });
}

export function findEntry(layout, id) {
  let result = null;
  walkNodes(layout.children, (entry) => {
    if (!result && entry.node.id === id) result = entry;
  });
  return result;
}

export function findNode(layout, id) {
  return findEntry(layout, id)?.node ?? null;
}

export function parentRect(layout, parent) {
  if (!parent) return { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
  return absoluteRect(layout, parent.id);
}

export function absoluteRect(layout, id) {
  const path = [];
  let entry = findEntry(layout, id);
  if (!entry) return null;
  path.unshift(entry.node);
  while (entry.parent) {
    entry = findEntry(layout, entry.parent.id);
    path.unshift(entry.node);
  }

  let area = { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
  for (const node of path) {
    area = {
      x: area.x + node.x * area.width / 100,
      y: area.y + node.y * area.height / 100,
      width: node.width,
      height: node.height,
    };
  }
  return area;
}

export function isDescendant(layout, ancestorId, candidateId) {
  const ancestor = findNode(layout, ancestorId);
  if (!ancestor) return false;
  let found = false;
  walkNodes(ancestor.children, ({ node }) => { if (node.id === candidateId) found = true; });
  return found;
}

function contains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function deepestNodeAt(layout, point, { includeLocked = false, excludeId = null } = {}) {
  let winner = null;
  let order = 0;
  walkNodes(layout.children, ({ node, depth }) => {
    order += 1;
    if (node.id === excludeId || (excludeId && isDescendant(layout, excludeId, node.id))) return;
    if (!includeLocked && node.locked) return;
    const rect = absoluteRect(layout, node.id);
    if (contains(rect, point) && (!winner || depth > winner.depth || (depth === winner.depth && order > winner.order))) {
      winner = { node, depth, order };
    }
  });
  return winner?.node ?? null;
}

export function deepestContainerAt(layout, point, excludeId) {
  return deepestNodeAt(layout, point, { includeLocked: true, excludeId });
}

export function reparentNode(layout, id, newParentId) {
  const entry = findEntry(layout, id);
  if (!entry || id === newParentId || (newParentId && isDescendant(layout, id, newParentId))) return false;
  if ((entry.parent?.id ?? null) === (newParentId ?? null)) return false;

  const absolute = absoluteRect(layout, id);
  const newParent = newParentId ? findNode(layout, newParentId) : null;
  if (newParentId && !newParent) return false;
  const destination = newParent ? newParent.children : layout.children;
  const targetRect = parentRect(layout, newParent);
  const [node] = entry.children.splice(entry.index, 1);
  node.x = (absolute.x - targetRect.x) / targetRect.width * 100;
  node.y = (absolute.y - targetRect.y) / targetRect.height * 100;
  destination.push(node);
  return true;
}

export function reorderNode(layout, id, operation) {
  const entry = findEntry(layout, id);
  if (!entry) return false;
  const last = entry.children.length - 1;
  const target = operation === "front" ? last
    : operation === "back" ? 0
      : operation === "forward" ? Math.min(last, entry.index + 1)
        : Math.max(0, entry.index - 1);
  if (target === entry.index) return false;
  const [node] = entry.children.splice(entry.index, 1);
  entry.children.splice(target, 0, node);
  return true;
}

// Вузол і його світовий прямокутник за id — одним проходом згори вниз.
// absoluteRect для кожного вузла окремо щоразу шукав би шлях від кореня,
// а цей індекс потрібен на кожен кадр зуму.
//
// `inset` — на скільки від краю батька починається місце для дітей. У моделі
// нуль, а на сторінці діти стоять усередині рамки батька. Рамка там у em, а
// у вузла на всю карту світу вона завтовшки десятки тисяч одиниць, тож без
// поправки прямокутник дитини відʼїжджав би від того, де її справді видно.
export function nodeIndex(layout, { inset = () => 0 } = {}) {
  const index = new Map();
  const collect = (children, area) => {
    children.forEach((node) => {
      const rect = {
        x: area.x + node.x * area.width / 100,
        y: area.y + node.y * area.height / 100,
        width: node.width,
        height: node.height,
      };
      index.set(node.id, { node, rect });
      const border = inset(node);
      collect(node.children, {
        x: rect.x + border,
        y: rect.y + border,
        width: Math.max(0, rect.width - border * 2),
        height: Math.max(0, rect.height - border * 2),
      });
    });
  };
  collect(layout.children, { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE });
  return index;
}

// Нова розкладка (з історії чи збереженої копії) — але з тими самими об'єктами
// вузлів, що й у поточній: значення переносяться в наявний об'єкт за id. Хто
// тримає посилання на вузол (картка на полотні, її обробники подій), бачить
// нові значення, а не застарілу копію. `next` після цього — вже не окремий
// знімок: його вузли стали вузлами `current`.
export function adoptLayout(current, next) {
  const existing = new Map();
  walkNodes(current.children, ({ node }) => existing.set(node.id, node));
  const adopt = (children) => children.map((incoming) => {
    const node = existing.get(incoming.id);
    const adoptedChildren = adopt(incoming.children);
    if (!node) return Object.assign(incoming, { children: adoptedChildren });
    for (const key of Object.keys(node)) if (!(key in incoming)) delete node[key];
    return Object.assign(node, incoming, { children: adoptedChildren });
  });
  next.children = adopt(next.children);
  return next;
}

export function allAbsoluteRects(layout) {
  return [...nodeIndex(layout)].map(([id, { rect }]) => ({ id, ...rect }));
}

// Обхід із прямокутниками напохваті: дочірні відлічуються від батьківського
// прямокутника, тому дерево проходиться один раз, без absoluteRect на вузол.
export function nodesInRect(layout, rect, overlaps, { includeLargest = false } = {}) {
  const rows = [];
  let largest = null;
  const collect = (children, area, depth) => {
    children.forEach((node) => {
      const nodeRect = {
        x: area.x + node.x * area.width / 100,
        y: area.y + node.y * area.height / 100,
        width: node.width,
        height: node.height,
      };
      const row = { node, depth, rect: nodeRect };
      rows.push(row);
      if (!largest || nodeRect.width * nodeRect.height > largest.rect.width * largest.rect.height) largest = row;
      collect(node.children, nodeRect, depth + 1);
    });
  };
  collect(layout.children, { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE }, 0);
  return rows.filter((row) => overlaps(row.rect, rect) || (includeLargest && row === largest));
}

export function nearestPointParent(layout, point) {
  const parent = deepestNodeAt(layout, point, { includeLocked: true });
  const rect = parent ? absoluteRect(layout, parent.id) : { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
  return { parent, rect };
}

export function lineage(layout, id) {
  const result = [];
  let entry = id ? findEntry(layout, id) : null;
  while (entry) {
    result.push(entry.node);
    entry = entry.parent ? findEntry(layout, entry.parent.id) : null;
  }
  return result;
}

export function nearestAncestor(layout, id, predicate) {
  return lineage(layout, id).find(predicate) ?? null;
}

// Контейнер тягне вміст за собою, тож із виділення прибираємо все, що лежить
// усередині іншого виділеного вузла: інакше дитина зсунулася б двічі.
export function outermostIds(layout, ids) {
  const chosen = new Set(ids);
  return [...chosen].filter((id) => !lineage(layout, id).slice(1).some((ancestor) => chosen.has(ancestor.id)));
}

// Сітка дочірніх карток усередині контейнера: спершу ширина за кількістю
// колонок, далі висота із запасом на шапку. Шапка вужчає разом із висотою,
// тому перший прохід бере найбільшу можливу (height = Infinity) — так вміст
// гарантовано влазить.
export function containerGrid(count, { cell, gap, padding, minimum, header }) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const contentWidth = count ? columns * cell.width + (columns - 1) * gap : 0;
  const contentHeight = count ? rows * cell.height + (rows - 1) * gap : 0;
  const width = Math.max(minimum.width, contentWidth + padding * 2);
  const height = Math.max(minimum.height, header(width, Infinity) + contentHeight + padding * 2);
  const top = header(width, height) + padding;
  const cells = Array.from({ length: count }, (_, index) => ({
    x: padding + (index % columns) * (cell.width + gap),
    y: top + Math.floor(index / columns) * (cell.height + gap),
  }));
  return { width, height, cells };
}
