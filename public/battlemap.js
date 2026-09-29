// Бойова карта — картинка з карт, у якої відома сітка: скільки клітинок уздовж
// ширини й висоти самої картинки (неповернутої). З неї й клітинки дошки
// (board.config.json → grid.cell) карта отримує розмір, у якому токени стають
// рівно на клітинку. Звичайна карта, як Гарона, сітки не має.
export const MAX_GRID_CELLS = 500;

// «…-33x16-grid…» у назві файлу: латинська x, кирилична х чи ×. Котре число —
// ширина, вирішують пікселі: клітинка має вийти квадратною.
export function gridFromName(name, pixelWidth, pixelHeight) {
  const match = String(name ?? "").match(/(?:^|[^\d])(\d{1,3})\s*[xх×]\s*(\d{1,3})(?!\d)/i);
  if (!match) return null;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if (!isGridCount(a) || !isGridCount(b)) return null;
  const squareness = (columns, rows) => Math.abs(Math.log((pixelWidth / columns) / (pixelHeight / rows)));
  return squareness(a, b) <= squareness(b, a) ? { columns: a, rows: b } : { columns: b, rows: a };
}

export function isGridCount(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_GRID_CELLS;
}

export function isBattleMap(node) {
  return node?.type === "image" && node.grid !== undefined;
}

// Розмір неповернутої картинки на полотні.
export function battleMapSize(grid, cell) {
  return { width: grid.columns * cell, height: grid.rows * cell };
}

// Сітка в осях рамки вузла: під 90° і 270° колонки й рядки міняються місцями.
// Під косим кутом клітинки не лягають уздовж рамки — тоді null.
export function boxGrid(node) {
  const rotation = node.rotation ?? 0;
  if (rotation % 90) return null;
  return rotation % 180 ? { columns: node.grid.rows, rows: node.grid.columns } : { ...node.grid };
}

// Прилипання токенів до клітинок увімкнене за замовчуванням; вимкнене — `snap: false`.
export function snapsTokens(node) {
  return isBattleMap(node) && node.snap !== false && boxGrid(node) !== null;
}

// Токен лягає на цілі клітинки: скільки їх займає — з його розміру, а якщо
// його розтягли не рівно, стає посередині свого прямокутника клітинок.
// Менший за клітинку токен стає в її чверть. `inset` — рамка карти.
export function snapChild(child, map, inset = 0) {
  const grid = boxGrid(map);
  const inner = { width: Math.max(0, map.width - inset * 2), height: Math.max(0, map.height - inset * 2) };
  const axis = (position, size, extent, count) => {
    const cell = extent / count;
    const step = size < cell * 0.75 ? cell / 2 : cell;
    const offset = (Math.max(1, Math.round(size / step)) * step - size) / 2;
    const start = Math.round((position * extent / 100 - offset) / step) * step + offset;
    return extent ? start / extent * 100 : position;
  };
  return {
    x: axis(child.x, child.width, inner.width, grid.columns),
    y: axis(child.y, child.height, inner.height, grid.rows),
  };
}

// Бойова карта, яку випадково розтягли, вертається до розміру своєї сітки
// в клітинках дошки. Центр лишається на місці, діти — на своїх місцях
// картинки, їхні розміри не змінюються. `area` — місце під дітей батька.
export function fitBattleMap(node, cell, { area, inset = 0 }) {
  const picture = battleMapSize(node.grid, cell);
  // Під прямим кутом — точні 0 і 1, щоб розмір лишався рівно в клітинках.
  const rotation = node.rotation ?? 0;
  const radians = rotation * Math.PI / 180;
  const cos = rotation % 90 ? Math.abs(Math.cos(radians)) : rotation % 180 ? 0 : 1;
  const sin = rotation % 90 ? Math.abs(Math.sin(radians)) : rotation % 180 ? 1 : 0;
  const width = picture.width * cos + picture.height * sin;
  const height = picture.width * sin + picture.height * cos;
  if (Math.abs(width - node.width) < 1e-6 && Math.abs(height - node.height) < 1e-6) return false;

  const inner = { width: Math.max(0, node.width - inset * 2), height: Math.max(0, node.height - inset * 2) };
  const nextInner = { width: Math.max(0, width - inset * 2), height: Math.max(0, height - inset * 2) };
  for (const child of node.children) {
    if (!inner.width || !inner.height || !nextInner.width || !nextInner.height) break;
    const centerX = (child.x * inner.width / 100 + child.width / 2) / inner.width;
    const centerY = (child.y * inner.height / 100 + child.height / 2) / inner.height;
    child.x = (centerX * nextInner.width - child.width / 2) / nextInner.width * 100;
    child.y = (centerY * nextInner.height - child.height / 2) / nextInner.height * 100;
  }
  node.x += (node.width - width) / 2 / area.width * 100;
  node.y += (node.height - height) / 2 / area.height * 100;
  node.width = width;
  node.height = height;
  if (node.aspect !== undefined) node.aspect = picture.width / picture.height;
  return true;
}
