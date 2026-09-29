// board.config.json — усе, чим одна кампанія відрізняється від іншої. Будь-яке
// поле можна пропустити: тоді береться типове значення формату, тож новій
// кампанії досить `{ "boardConfigVersion": 1 }`. Перевірка тут одна для
// сервера й теки в браузері, і каже, яке саме поле не так.
import { linkLabel } from "./entities.js";
import { DEFAULT_HIDDEN_SECTIONS } from "./statblock.js";
import { validateTravelMode } from "./travel.js";

export const BOARD_CONFIG_VERSION = 1;
const FILE = "board.config.json";

export const DEFAULT_BOARD_CONFIG = Object.freeze({
  layout: "board/canvas.json",
  // Без власного парсера кампанія читається вбудованим (public/frontmatter.js).
  frontmatter: null,
  notes: { dir: "board/notes", prefix: "map-", type: "board" },
  media: { dir: "board/media", entityDir: "_media", cacheDir: "board/cache", format: "webp" },
  entities: {
    skipDirs: [".git", ".github", ".obsidian", "node_modules", "tools", "_templates"],
    types: ["npc", "location", "faction", "item", "creature", "player", "encounter", "world"],
    summarySection: "## На дошці",
    linksSection: "## Звʼязки",
    portraitField: "image",
    // Рядки секції звʼязків локації, чиї картки кнопка «Локація» кладе
    // всередину рамки, — у цьому порядку.
    locationMembers: ["NPC", "Предмети"],
    statblockHiddenSections: DEFAULT_HIDDEN_SECTIONS,
  },
  travel: { hide: [], extra: [] },
  // Клітинка бойової карти в одиницях полотна — одна на всю дошку. Токен
  // Середньої істоти займає рівно її, більші — кілька.
  grid: { cell: 120 },
  // Панель «Партія»: живі листи D&D Beyond через посередника (worker/ddb-proxy.js).
  // Без proxy панелі немає. ID листа — у фронтматері картки гравця, поле idField.
  party: { proxy: null, interval: 15, idField: "ddb_id" },
});

function fail(field, message) {
  throw new Error(`${FILE}: ${field} ${message}`);
}

function object(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field, "має бути об'єктом");
  return value;
}

function text(value, field, fallback, { optional = false } = {}) {
  if (value === undefined) return fallback;
  if (optional && value === null) return null;
  if (typeof value !== "string" || !value.trim()) fail(field, "має бути непорожнім рядком");
  return value;
}

// Шлях усередині кампанії: відносний, без «..», з прямими скісними.
function path(value, field, fallback, options) {
  const result = text(value, field, fallback, options);
  if (result === null) return null;
  const parts = result.split("/");
  if (result.startsWith("/") || /^[a-z]:/i.test(result) || result.includes("\\") || parts.includes("..") || parts.includes(".")) {
    fail(field, `має бути відносним шляхом усередині кампанії (через «/», без «..»): ${result}`);
  }
  return parts.filter(Boolean).join("/");
}

function positive(value, field, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(field, "має бути додатним числом");
  return value;
}

// Адреса посередника: https, або http лише для цього ж компʼютера.
function proxyUrl(value, field) {
  if (value === undefined || value === null) return null;
  let url;
  try { url = new URL(text(value, field, null)); }
  catch { fail(field, `має бути адресою: ${value}`); }
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) fail(field, "має бути https-адресою (http — лише 127.0.0.1)");
  return url.href.replace(/\/+$/, "");
}

function strings(value, field, fallback) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) fail(field, "має бути масивом непорожніх рядків");
  return [...value];
}

export function normalizeBoardConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${FILE} має бути об'єктом`);
  if (raw.boardConfigVersion !== BOARD_CONFIG_VERSION) {
    throw new Error(`${FILE}: непідтримувана boardConfigVersion: ${raw.boardConfigVersion ?? "відсутня"} (канва знає ${BOARD_CONFIG_VERSION})`);
  }
  const defaults = DEFAULT_BOARD_CONFIG;
  const notes = object(raw.notes, "notes");
  const media = object(raw.media, "media");
  const entities = object(raw.entities, "entities");
  const travel = object(raw.travel, "travel");
  const grid = object(raw.grid, "grid");
  const party = object(raw.party, "party");

  const prefix = notes.prefix === undefined ? defaults.notes.prefix : notes.prefix;
  if (typeof prefix !== "string" || !/^[a-z0-9-]*$/.test(prefix)) fail("notes.prefix", "має складатися з латинських літер, цифр і дефісів");
  const format = media.format ?? defaults.media.format;
  if (format !== "webp") fail("media.format", "підтримує лише webp");

  const extra = travel.extra === undefined ? [] : travel.extra;
  if (!Array.isArray(extra)) fail("travel.extra", "має бути масивом");
  const modes = extra.map((mode) => validateTravelMode(mode, `${FILE}: travel.extra`));
  const ids = new Set();
  for (const mode of modes) {
    if (ids.has(mode.id)) fail("travel.extra", `має повторний id: ${mode.id}`);
    ids.add(mode.id);
  }

  const interval = positive(party.interval, "party.interval", defaults.party.interval);
  if (interval < 5) fail("party.interval", "має бути не менше 5 секунд");

  const mediaDir = path(media.dir, "media.dir", defaults.media.dir);
  return {
    boardConfigVersion: BOARD_CONFIG_VERSION,
    id: text(raw.id, "id", null),
    name: text(raw.name, "name", null),
    layout: path(raw.layout, "layout", defaults.layout),
    frontmatter: path(raw.frontmatter, "frontmatter", defaults.frontmatter, { optional: true }),
    notes: {
      dir: path(notes.dir, "notes.dir", defaults.notes.dir),
      prefix,
      type: text(notes.type, "notes.type", defaults.notes.type),
    },
    media: {
      dir: mediaDir,
      entityDir: path(media.entityDir, "media.entityDir", defaults.media.entityDir),
      cacheDir: path(media.cacheDir, "media.cacheDir", defaults.media.cacheDir),
      format,
    },
    entities: {
      skipDirs: strings(entities.skipDirs, "entities.skipDirs", defaults.entities.skipDirs),
      types: strings(entities.types, "entities.types", defaults.entities.types),
      summarySection: text(entities.summarySection, "entities.summarySection", defaults.entities.summarySection),
      linksSection: text(entities.linksSection, "entities.linksSection", defaults.entities.linksSection),
      portraitField: text(entities.portraitField, "entities.portraitField", defaults.entities.portraitField),
      // Мітки порівнюються так само, як їх читає секція звʼязків: без регістру
      // й уточнень у дужках, з будь-яким апострофом.
      locationMembers: strings(entities.locationMembers, "entities.locationMembers", defaults.entities.locationMembers).map(linkLabel),
      statblockHiddenSections: strings(entities.statblockHiddenSections, "entities.statblockHiddenSections", defaults.entities.statblockHiddenSections),
    },
    travel: {
      hide: strings(travel.hide, "travel.hide", defaults.travel.hide),
      extra: modes,
    },
    grid: { cell: positive(grid.cell, "grid.cell", defaults.grid.cell) },
    party: {
      proxy: proxyUrl(party.proxy, "party.proxy"),
      interval,
      idField: text(party.idField, "party.idField", defaults.party.idField),
    },
  };
}

// Текст board.config.json — у готовий конфіг, з поясненням замість збою.
export function parseBoardConfig(source) {
  let raw;
  try { raw = JSON.parse(source); }
  catch (error) { throw new Error(`${FILE} не читається як JSON: ${error.message}`); }
  return normalizeBoardConfig(raw);
}

// Під цим ключем канва тримає стан кампанії у браузері: позицію полотна,
// масштаб лінійки. `id` з конфігу переживає перейменування теки; без нього —
// назва теки.
export function campaignKey(config, folderName) {
  return config.id ?? folderName;
}

export function campaignName(config, folderName) {
  return config.name ?? folderName;
}
