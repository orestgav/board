// Формат canvas.json — одне правило на всі місця, де розкладка входить у канву
// чи виходить з неї: сервер, тека кампанії в браузері й вставка з буфера.
// Два окремі набори перевірок уже розходилися, тож тримаємо один.
import { canonicalYouTubeUrl, isMusicStart } from "./music.js";
import { splitNoteReference } from "./notes.js";
import { isGridCount } from "./battlemap.js";
import { isTokenColor } from "./token.js";

// Поле версії існує, щоб старий редактор не відкрив і не перезаписав по-своєму
// розкладку, формату якої ще не знає.
export const LAYOUT_VERSION = 1;
const NODE_TYPES = ["frame", "scene", "image", "entity", "note", "music", "token"];
const ROTATIONS = [45, 90, 135, 180, 225, 270, 315];

export function emptyLayout() {
  return { formatVersion: LAYOUT_VERSION, children: [] };
}

// Власні поля одного вузла, без дітей: так вставка може відкинути битий вузол,
// не викидаючи разом із ним цілу гілку.
export function validateNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error("Кожен вузол має бути об'єктом");
  if (typeof node.id !== "string" || !node.id) throw new Error("Кожен вузол мусить мати id");
  if (!NODE_TYPES.includes(node.type)) throw new Error(`Непідтримуваний тип вузла: ${node.type}`);
  for (const field of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(node[field])) throw new Error(`${node.id}.${field} має бути числом`);
  }
  if (node.width <= 0 || node.height <= 0) throw new Error(`${node.id}: вузол має мати додатний розмір`);
  if (["frame", "scene"].includes(node.type) && typeof node.title !== "string") throw new Error(`${node.id}.title має бути рядком`);
  if (node.type === "image") {
    const imagePath = typeof node.image === "string" ? node.image.replaceAll("\\", "/") : "";
    if (!imagePath.toLowerCase().endsWith(".webp") || imagePath.startsWith("/") || imagePath.split("/").includes("..")) {
      throw new Error(`${node.id}.image має бути безпечним відносним шляхом до WebP`);
    }
  }
  // Поворот картинки кроком 45° за годинниковою; без повороту — без полів.
  // Пропорції неповернутої картинки йдуть у парі з поворотом: з рамки під
  // 45° їх не відновити.
  if (node.rotation !== undefined || node.aspect !== undefined) {
    if (node.type !== "image") throw new Error(`${node.id}: повертати можна лише картинку`);
    if (!ROTATIONS.includes(node.rotation)) throw new Error(`${node.id}.rotation має бути одним із ${ROTATIONS.join(", ")}`);
    if (!Number.isFinite(node.aspect) || node.aspect <= 0) throw new Error(`${node.id}.aspect має бути додатним числом`);
  }
  // Сітка бойової карти — клітинки вздовж ширини й висоти неповернутої картинки.
  if (node.grid !== undefined) {
    if (node.type !== "image") throw new Error(`${node.id}: сітку має лише бойова карта`);
    if (!node.grid || typeof node.grid !== "object" || !isGridCount(node.grid.columns) || !isGridCount(node.grid.rows)) {
      throw new Error(`${node.id}.grid має бути { columns, rows } з цілих чисел від 1`);
    }
  }
  // Токени прилипають до клітинок бойової карти; вимкнене прилипання — false.
  if (node.snap !== undefined && (node.grid === undefined || node.snap !== false)) {
    throw new Error(`${node.id}.snap буває лише false і лише в бойової карти`);
  }
  if (["entity", "token"].includes(node.type) && (typeof node.entity !== "string" || !node.entity)) {
    throw new Error(`${node.id}.entity має бути непорожнім slug`);
  }
  // Колір кільця токена — лише з палітри; червоний за замовчуванням без поля.
  if (node.type === "token" && node.color !== undefined && !isTokenColor(node.color)) {
    throw new Error(`${node.id}.color має бути кольором із палітри токенів`);
  }
  // Поточні HP статблока: у кожної копії істоти свої, тож живуть у вузлі.
  // Мінус — нормальне значення: так видно, наскільки істоту перебили.
  if (node.hp !== undefined && !Number.isFinite(node.hp)) {
    throw new Error(`${node.id}.hp має бути числом`);
  }
  // Кілька однакових істот на одній картці: у кожної свої HP й назва. Поки
  // істота одна, вузол лишається на node.hp і масиву не має.
  if (node.creatures !== undefined) {
    if (!Array.isArray(node.creatures) || !node.creatures.length) {
      throw new Error(`${node.id}.creatures має бути непорожнім масивом`);
    }
    for (const creature of node.creatures) {
      if (!creature || typeof creature !== "object" || Array.isArray(creature)) {
        throw new Error(`${node.id}.creatures: кожна істота має бути об'єктом`);
      }
      if (creature.hp !== undefined && !Number.isFinite(creature.hp)) {
        throw new Error(`${node.id}.creatures: hp істоти має бути числом`);
      }
      if (creature.name !== undefined && typeof creature.name !== "string") {
        throw new Error(`${node.id}.creatures: назва істоти має бути рядком`);
      }
    }
  }
  // Схований опис картки NPC; показаний — за замовчуванням, без поля.
  if (node.hideSummary !== undefined && typeof node.hideSummary !== "boolean") {
    throw new Error(`${node.id}.hideSummary має бути булевим`);
  }
  // Розмитий, як під спойлером, текст нотатки; видимий — без поля.
  if (node.hideText !== undefined && typeof node.hideText !== "boolean") {
    throw new Error(`${node.id}.hideText має бути булевим`);
  }
  if (node.locked !== undefined && typeof node.locked !== "boolean") {
    throw new Error(`${node.id}.locked має бути булевим`);
  }
  if (node.type === "music") {
    if (!canonicalYouTubeUrl(node.url)) throw new Error(`${node.id}.url має бути лінком на ролік YouTube`);
    if (node.title !== undefined && typeof node.title !== "string") throw new Error(`${node.id}.title має бути рядком`);
    // Секунда, з якої «плей» запускає трек; з початку — без поля.
    if (node.start !== undefined && !isMusicStart(node.start)) throw new Error(`${node.id}.start має бути цілим числом секунд від 0`);
  }
  if (node.type === "note") splitNoteReference(node.note);
  if (!Array.isArray(node.children)) throw new Error(`${node.id}.children має бути масивом`);
  return node;
}

export function validateLayout(layout) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) throw new Error("Розкладка має бути об'єктом");
  if (layout.formatVersion !== LAYOUT_VERSION) {
    const relation = Number(layout.formatVersion) > LAYOUT_VERSION ? "новіша за редактор" : "має непідтримувану версію";
    throw new Error(`Розкладка ${relation}: ${layout.formatVersion ?? "відсутня"}`);
  }
  if (!Array.isArray(layout.children)) throw new Error("children має бути масивом");
  const ids = new Set();
  const visit = (node) => {
    validateNode(node);
    if (ids.has(node.id)) throw new Error(`Повторний id вузла: ${node.id}`);
    ids.add(node.id);
    node.children.forEach(visit);
  };
  layout.children.forEach(visit);
  return layout;
}

// Текст canvas.json — у розкладку, з поясненням, що саме не так, замість
// збою десь у рендері. `source` — лише для повідомлення.
export function parseLayout(text, source = "canvas.json") {
  let layout;
  try { layout = JSON.parse(text); }
  catch (error) { throw new Error(`${source} не читається як JSON: ${error.message}`); }
  try { return validateLayout(layout); }
  catch (error) { throw new Error(`${source}: ${error.message}`); }
}
