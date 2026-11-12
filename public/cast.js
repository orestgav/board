// Трансляція: друга вкладка (cast.html) на телевізорі, що лежить на столі під
// мініатюрами. Сцену веде дошка — вона тримає стан, а вкладка лише малює.
// Тут лише чиста модель: без DOM, щоб її можна було перевірити тестами.
//
// Одиниця на телевізорі — дюйм: мініатюри стоять на клітинках по 1″, тож
// бойова карта зі сіткою отримує рівно 1″ на клітинку. Зсув теж у дюймах від
// центру екрана, а скільки пікселів у дюймі — каже калібрування.

export const CAST_CHANNEL = "crown-board.cast";
export const CAST_PPI_KEY = "board.cast-ppi";
// Як лежить телевізор: куди дивиться верх нової картинки. Як і калібрування,
// це властивість столу, а не кампанії — спільне для всіх кампаній.
export const CAST_ROTATION_KEY = "board.cast-rotation";
// Поки телевізор не відкалібровано, вважаємо, що в ширину на нього стає
// стільки дюймів — так ДМ оцінив свій екран (карта 30×20″).
export const DEFAULT_SCREEN_INCHES = 30;
// Сторона квадрата калібрування на телевізорі.
export const CALIBRATION_INCHES = 4;
// Арт, вписаний в екран, не впирається в краї: з кожного боку лишається
// така частка екрана.
export const SCREEN_MARGIN = 0.1;
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 20;
const MIN_PPI = 5;
const MAX_PPI = 1000;

export function emptyCast() {
  return { items: [], selected: null, blackout: false, calibrating: false };
}

// Що саме транслюється: файл картинки (не вузол — на ТВ не має потрапити нічого
// з того, що лежить на карті на дошці) і, якщо це бойова карта, її сітка.
// Картка з дошки (локація, предмет) транслюється знімком: `snapshot` — id її
// вузла, `version` міняється з кожним новим знімком, щоб ТВ узяв свіжий.
export function castItem({ path, name, grid = null, snapshot = null }, remembered = null, { rotation = 0, version = 0 } = {}) {
  const item = {
    id: `cast-${Math.random().toString(36).slice(2, 10)}`,
    path,
    name: name || path.split("/").at(-1),
    grid: grid ? { columns: grid.columns, rows: grid.rows } : null,
    rotation: parseRotation(rotation),
    scale: 1,
    x: 0,
    y: 0,
    fit: grid ? "inch" : "screen",
    snapshot,
    version,
  };
  return remembered ? { ...item, ...pickTransform(remembered, item) } : item;
}

// «Транслювати» міняє все на ТВ, «Додати» кладе поверх. Та сама картинка
// двічі не додається — її просто стає видно й вибрано.
export function addToCast(state, item, { replace = false } = {}) {
  const kept = replace ? [] : state.items.filter((other) => other.path !== item.path);
  const existing = replace ? null : state.items.find((other) => other.path === item.path);
  const next = existing ? { ...existing, version: item.version } : item;
  return { ...state, items: [...kept, next], selected: next.id, blackout: false };
}

export function removeFromCast(state, id) {
  const items = state.items.filter((item) => item.id !== id);
  const selected = state.selected === id ? (items.at(-1)?.id ?? null) : state.selected;
  return { ...state, items, selected };
}

export function updateItem(state, id, change) {
  return { ...state, items: state.items.map((item) => (item.id === id ? { ...item, ...change(item) } : item)) };
}

// Крок — 90°: під іншим кутом клітинки карти не лягають уздовж країв екрана.
export function rotated(item, direction) {
  return { rotation: (((item.rotation + 90 * Math.sign(direction)) % 360) + 360) % 360 };
}

export function scaled(item, factor) {
  return { scale: clamp(item.scale * factor, MIN_SCALE, MAX_SCALE) };
}

export function moved(item, dx, dy) {
  return { x: round(item.x + dx), y: round(item.y + dy) };
}

// «1 клітинка = 1″» — лише для карти зі сіткою; інакше картинка вписується в екран.
export function refitted(item, fit) {
  if (fit === "inch" && !item.grid) return {};
  return { fit, scale: 1 };
}

export function centered() {
  return { x: 0, y: 0 };
}

// Положення кожної картинки памʼятається: знову відкрита карта стає так само,
// як її підігнали минулого разу.
export function pickTransform(source, item = source) {
  const fit = source.fit === "inch" && item.grid ? "inch" : "screen";
  return {
    rotation: [0, 90, 180, 270].includes(source.rotation) ? source.rotation : 0,
    scale: Number.isFinite(source.scale) ? clamp(source.scale, MIN_SCALE, MAX_SCALE) : 1,
    x: Number.isFinite(source.x) ? source.x : 0,
    y: Number.isFinite(source.y) ? source.y : 0,
    fit,
  };
}

export function rememberTransforms(memory, state) {
  const next = { ...memory };
  for (const item of state.items) next[item.path] = pickTransform(item);
  return next;
}

// Розмір і центр картинки на екрані телевізора, у CSS-пікселях вкладки.
// `width`/`height` — неповернутої картинки; поворот накладається поверх.
export function itemFrame(item, { ppi, screen, image }) {
  const aspect = image.width && image.height ? image.height / image.width : 1;
  let width;
  if (item.fit === "inch" && item.grid) {
    width = item.grid.columns * ppi;
  } else {
    const turned = item.rotation % 180 !== 0;
    const boxWidth = turned ? image.height : image.width;
    const boxHeight = turned ? image.width : image.height;
    const room = 1 - SCREEN_MARGIN * 2;
    const contain = boxWidth && boxHeight ? Math.min(screen.width * room / boxWidth, screen.height * room / boxHeight) : 1;
    width = image.width * contain;
  }
  width *= item.scale;
  return {
    width,
    height: width * aspect,
    centerX: screen.width / 2 + item.x * ppi,
    centerY: screen.height / 2 + item.y * ppi,
    rotation: item.rotation,
  };
}

export function parseRotation(value) {
  const number = Number(value);
  return [0, 90, 180, 270].includes(number) ? number : 0;
}

export function defaultPpi(screenWidth) {
  return screenWidth > 0 ? screenWidth / DEFAULT_SCREEN_INCHES : 40;
}

export function parsePpi(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= MIN_PPI && number <= MAX_PPI ? number : null;
}

export function calibratedPpi(ppi, factor) {
  return clamp(round(ppi * factor, 100), MIN_PPI, MAX_PPI);
}

// Збережений стан сцени — з localStorage, тож усе перевіряється.
export function parseCast(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return emptyCast(); }
  if (!raw || !Array.isArray(raw.items)) return emptyCast();
  const items = raw.items
    .filter((item) => item && typeof item.path === "string" && item.path && typeof item.id === "string")
    .map((item) => {
      const grid = item.grid && Number.isInteger(item.grid.columns) && Number.isInteger(item.grid.rows)
        && item.grid.columns > 0 && item.grid.rows > 0 ? { columns: item.grid.columns, rows: item.grid.rows } : null;
      const base = {
        id: item.id, path: item.path, name: typeof item.name === "string" ? item.name : item.path, grid,
        snapshot: typeof item.snapshot === "string" ? item.snapshot : null,
        version: Number.isFinite(item.version) ? item.version : 0,
      };
      return { ...base, ...pickTransform(item, base) };
    });
  const selected = items.some((item) => item.id === raw.selected) ? raw.selected : (items.at(-1)?.id ?? null);
  return { items, selected, blackout: raw.blackout === true, calibrating: false };
}

export function parseMemory(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return {}; }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, precision = 1000) {
  return Math.round(value * precision) / precision;
}
