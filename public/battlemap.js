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
