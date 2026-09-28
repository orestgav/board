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

const WORLD_RECT = { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
const NO_INSET = () => 0;

// Місце під дітей у прямокутнику батька: на сторінці вони стоять усередині
// його рамки, і відсотки браузер рахує від того, що лишилося всередині.
function innerArea(rect, border) {
  return {
    x: rect.x + border,
    y: rect.y + border,
    width: Math.max(0, rect.width - border * 2),
    height: Math.max(0, rect.height - border * 2),
  };
}

// Прямокутник, від якого відлічуються відсотки дітей `parent`.
// `inset` — як у nodeIndex.
export function parentRect(layout, parent, { inset = NO_INSET } = {}) {
  if (!parent) return { ...WORLD_RECT };
  return innerArea(absoluteRect(layout, parent.id, { inset }), inset(parent));
}

export function absoluteRect(layout, id, { inset = NO_INSET } = {}) {
  const path = [];
  let entry = findEntry(layout, id);
  if (!entry) return null;
  path.unshift(entry.node);
  while (entry.parent) {
    entry = findEntry(layout, entry.parent.id);
    path.unshift(entry.node);
  }

  let area = WORLD_RECT;
  let rect = null;
  let parent = null;
  for (const node of path) {
    if (parent) area = innerArea(rect, inset(parent));
    rect = {
      x: area.x + node.x * area.width / 100,
      y: area.y + node.y * area.height / 100,
      width: node.width,
      height: node.height,
    };
    parent = node;
  }
  return rect;
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

export function deepestNodeAt(layout, point, { includeLocked = false, excludeId = null, inset = NO_INSET } = {}) {
  const index = nodeIndex(layout, { inset });
  let winner = null;
  let order = 0;
  walkNodes(layout.children, ({ node, depth }) => {
    order += 1;
    if (node.id === excludeId || (excludeId && isDescendant(layout, excludeId, node.id))) return;
    if (!includeLocked && node.locked) return;
    const { rect } = index.get(node.id);
    if (contains(rect, point) && (!winner || depth > winner.depth || (depth === winner.depth && order > winner.order))) {
      winner = { node, depth, order };
    }
  });
  return winner?.node ?? null;
}

export function deepestContainerAt(layout, point, excludeId, { inset = NO_INSET } = {}) {
  return deepestNodeAt(layout, point, { includeLocked: true, excludeId, inset });
}

export function reparentNode(layout, id, newParentId, { inset = NO_INSET } = {}) {
  const entry = findEntry(layout, id);
  if (!entry || id === newParentId || (newParentId && isDescendant(layout, id, newParentId))) return false;
  if ((entry.parent?.id ?? null) === (newParentId ?? null)) return false;

  const absolute = absoluteRect(layout, id, { inset });
  const newParent = newParentId ? findNode(layout, newParentId) : null;
  if (newParentId && !newParent) return false;
  const destination = newParent ? newParent.children : layout.children;
  const targetRect = parentRect(layout, newParent, { inset });
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
export function nodeIndex(layout, { inset = NO_INSET } = {}) {
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
      collect(node.children, innerArea(rect, inset(node)));
    });
  };
  collect(layout.children, WORLD_RECT);
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

// `rect` — місце під дітей знайденого батька: від нього рахуються відсотки.
export function nearestPointParent(layout, point, { inset = NO_INSET } = {}) {
  const parent = deepestNodeAt(layout, point, { includeLocked: true, inset });
  return { parent, rect: parentRect(layout, parent, { inset }) };
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

// Усі вузли гілок — самі корені разом із вмістом на будь-якій глибині, — що
// справджують умову. Контейнер тягне й видаляє вміст разом із собою, тож те,
// що лежить у файлах (нотатки), доводиться шукати й усередині нього.
export function collectNodes(nodes, predicate, result = []) {
  for (const node of nodes) {
    if (predicate(node)) result.push(node);
    collectNodes(node.children, predicate, result);
  }
  return result;
}

// Контейнер тягне вміст за собою, тож із виділення прибираємо все, що лежить
// усередині іншого виділеного вузла: інакше дитина зсунулася б двічі.
export function outermostIds(layout, ids) {
  const chosen = new Set(ids);
  return [...chosen].filter((id) => !lineage(layout, id).slice(1).some((ancestor) => chosen.has(ancestor.id)));
}

// Поворот картинки. Вузол лишається прямокутником уздовж осей — рамкою
// навколо повернутої картинки, — тож вибір, рамка виділення й вкладення
// працюють як завжди. Сама картинка всередині тримає свої пропорції
// (`aspect`, ширина до висоти без повороту): під 45° з рамки їх уже не
// вийняти, бо вона квадратна за будь-яких пропорцій.
export const ROTATION_STEP = 45;

function turn(degrees) {
  const radians = degrees * Math.PI / 180;
  return { cos: Math.abs(Math.cos(radians)), sin: Math.abs(Math.sin(radians)) };
}

// Частки рамки, які займає неповернута картинка: від них CSS її й малює.
export function rotatedImageShare(aspect, degrees) {
  const { cos, sin } = turn(degrees);
  return { width: aspect / (aspect * cos + sin), height: 1 / (aspect * sin + cos) };
}

// `area` — місце під дітей батька вузла, `inset` — рамка самого вузла (як у
// nodeIndex). Центр лишається на місці, а вміст — жетони на карті — обертається
// навколо нього разом із картинкою, щоб не зʼїхати з намальованого місця.
export function rotateImageNode(node, delta, { area, inset = 0 }) {
  const from = node.rotation ?? 0;
  const to = ((from + delta) % 360 + 360) % 360;
  if (to === from) return false;
  const aspect = node.aspect ?? node.width / node.height;
  const pictureWidth = node.width * rotatedImageShare(aspect, from).width;
  const pictureHeight = pictureWidth / aspect;
  const { cos, sin } = turn(to);
  const width = pictureWidth * cos + pictureHeight * sin;
  const height = pictureWidth * sin + pictureHeight * cos;

  const inner = { width: Math.max(0, node.width - inset * 2), height: Math.max(0, node.height - inset * 2) };
  const nextInner = { width: Math.max(0, width - inset * 2), height: Math.max(0, height - inset * 2) };
  const radians = delta * Math.PI / 180;
  for (const child of node.children) {
    const dx = child.x * inner.width / 100 + child.width / 2 - inner.width / 2;
    const dy = child.y * inner.height / 100 + child.height / 2 - inner.height / 2;
    const x = dx * Math.cos(radians) - dy * Math.sin(radians);
    const y = dx * Math.sin(radians) + dy * Math.cos(radians);
    child.x = nextInner.width ? (nextInner.width / 2 + x - child.width / 2) / nextInner.width * 100 : child.x;
    child.y = nextInner.height ? (nextInner.height / 2 + y - child.height / 2) / nextInner.height * 100 : child.y;
  }

  node.x += (node.width - width) / 2 / area.width * 100;
  node.y += (node.height - height) / 2 / area.height * 100;
  node.width = width;
  node.height = height;
  if (to) Object.assign(node, { rotation: to, aspect });
  else {
    delete node.rotation;
    delete node.aspect;
  }
  return true;
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
