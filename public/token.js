// Токен — кругла фішка істоти зі статблока: арт у колі або перша літера
// назви, якщо арту нема. Колір кільця ДМ обирає з палітри; червоний — за
// замовчуванням, тож у вузлі поле живе лише поки колір інший.
export const TOKEN_SIZE = { width: 120, height: 120 };

export const TOKEN_COLORS = [
  ["#c0392b", "Червоний"], ["#7b1f24", "Бордовий"], ["#e67e22", "Помаранчевий"], ["#e0a526", "Бурштиновий"],
  ["#f1d43a", "Жовтий"], ["#9bc53d", "Салатовий"], ["#3f9a4c", "Зелений"], ["#24613a", "Темно-зелений"],
  ["#2a9d8f", "Бірюзовий"], ["#3cb9d6", "Блакитний"], ["#4a8fe0", "Небесний"], ["#2c55b3", "Синій"],
  ["#24336e", "Темно-синій"], ["#6a45b8", "Фіолетовий"], ["#9b3fb0", "Пурпуровий"], ["#cc3a8e", "Малиновий"],
  ["#ee8fae", "Рожевий"], ["#7a4e2d", "Коричневий"], ["#8c8a86", "Сірий"], ["#ece6da", "Білий"],
];

export const DEFAULT_TOKEN_COLOR = TOKEN_COLORS[0][0];

const KNOWN = new Set(TOKEN_COLORS.map(([color]) => color));

export function isTokenColor(value) {
  return KNOWN.has(value);
}

export function tokenColor(node) {
  return isTokenColor(node?.color) ? node.color : DEFAULT_TOKEN_COLOR;
}

// Колір за замовчуванням у файл не пишеться.
export function writeTokenColor(node, color) {
  if (!isTokenColor(color) || color === DEFAULT_TOKEN_COLOR) delete node.color;
  else node.color = color;
  return node;
}

// Літера на світлому кільці — темна, на темному — світла.
export function tokenInk(color) {
  const [red, green, blue] = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.55 ? "#1d1a17" : "#fff8eb";
}

export function tokenInitial(name) {
  const letter = [...String(name ?? "").trim()].find((character) => /[\p{L}\p{N}]/u.test(character));
  return letter ? letter.toLocaleUpperCase("uk") : "?";
}
