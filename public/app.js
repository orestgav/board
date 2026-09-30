import {
  ROTATION_STEP,
  WORLD_SIZE,
  absoluteRect,
  adoptLayout,
  allAbsoluteRects,
  cloneLayout,
  collectNodes,
  containerGrid,
  deepestContainerAt,
  deepestNodeAt,
  findEntry,
  findNode,
  nearestAncestor,
  nearestPointParent,
  nodeIndex,
  nodesInRect,
  outermostIds,
  parentRect,
  reparentNode,
  reorderNode,
  rotateImageNode,
  rotatedImageShare,
} from "./model.js";
import { LayoutConflictError, createStorage } from "./storage.js";
import { clipboardPayload, noteTargets, parseClipboard, placedItems, withoutNodes } from "./clipboard.js";
import { backlinks, matchesEntity } from "./entities.js";
import { iconElement } from "./icons.js";
import { renderInline, renderMarkdown } from "./markdown.js";
import {
  creatureHitPoints, creatureLabel, creatureList, maxHitPoints, parseHitPoints, spellSlots, spellTexts, spellTooltipMarkup,
  statblockMarkup, usedSlots, withUsedSlots, writeCreatures,
} from "./statblock.js";
import { mapSlugFromPath } from "./notes.js";
import { battleMapSize, fitBattleMap, gridFromName, isBattleMap, isGridCount, snapChild, snapsTokens } from "./battlemap.js";
import { TOKEN_COLORS, TOKEN_ENTITY_TYPES, initialTokenColor, tokenColor, tokenInitial, tokenInk, tokenSide, writeTokenColor } from "./token.js";
import { noteMarkup, toggleBold } from "./note-format.js";
import { NOTE_FONT_EM, STATBLOCK_FONT_EM, SUMMARY_FONT_EM, SUMMARY_MIN_RATIO, TEXT_MIN_RATIO, fitBoxKey, fittedFontSize, fittingRatio, notePadding, reservedFitRatio, textShape } from "./text-fit.js";
import { canonicalYouTubeUrl, musicTitle, oEmbedUrl, parseMusicStart, playbackUrl } from "./music.js";
import { centeredViewOnRect, locationBorderScreenWidth, locationHeaderHeight, maximumScaleForNodes, minimumScaleForNodes, nodeVisualScale, rebasedView, rectWithin, rectsOverlap, worldViewportRect, zoomedViewAt } from "./view.js";
import { elementToPng, urlToPng, writeImageToClipboard } from "./snapshot.js";
import { BOARD_THUMBNAIL_SIZE, PORTRAIT_THUMBNAIL_SIZE, createThumbnails, wantsFullImage } from "./thumbnails.js";
import { ageLabel, createPartyMonitor, partyCardMarkup, partyDetailsMarkup, partyGoldLabel, partyMembers } from "./party.js";
import { CALIBRATION_MILES, milesLabel, parseScale, plural as pluralForm, routeMiles, scaleFromCalibration, travelEstimates, travelModes } from "./travel.js";

const MIN_NODE_SIZE = Number.EPSILON;
const MIN_ZOOM_VIEWPORT_COVERAGE = 0.7;
const MAX_ZOOM_VIEWPORT_PADDING = 32;
const SAVE_DELAY = 450;
const HP_COMMIT_DELAY = 500;
const UNDO_LIMIT = 200;
const ENTITY_CARD = { width: 320, height: 190 };
const NPC_CARD = { width: 400, height: 210 };
const STATBLOCK_CARD = { width: 440, height: 640 };
const FRAME_SIZE = { width: 360, height: 230 };
const SCENE_SIZE = { width: 300, height: 160 };
// Картка музики — заввишки з саму шапку: назва треку й кнопка «плей».
const MUSIC_CARD = { width: 320, height: 46 };
const MUSIC_LOOKUP_DELAY = 350;
const TEXT_FIT_CACHE_LIMIT = 400;
// Скільки тиші після останнього кроку зуму чи панорамування вважаємо кінцем
// жесту: тоді й доробляємо те, що під час руху не видно.
const VIEW_SETTLE_DELAY = 160;
// Поза екраном вузли не малюються. Запас — частка екрана з кожного боку:
// за один кадр панорамування чи зуму край не встигає показати порожнечу.
const OFFSCREEN_MARGIN = 0.5;
// Коротша протяжка — це ще клік по порожньому полотну, а не рамка виділення.
const MARQUEE_THRESHOLD = 3;
const CONTAINER_GAP = 24;
const CONTAINER_PADDING = 28;
const CONTEXT_MENU_NODE_TYPES = new Set(["image", "entity", "note", "music", "scene", "token"]);
const CLIPBOARD_IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// Типи карток із власним виглядом і власною кнопкою на полотні. Решта типів
// поки малюється спільною карткою й додається кнопкою «Картка».
const ENTITY_KINDS = {
  location: {
    icon: "location_on",
    variant: "frame",
    command: "Додати локацію",
    pickerTitle: "Локація з репозиторію",
    searchPlaceholder: "Назва або slug локації…",
  },
  npc: {
    icon: "person",
    variant: "npc",
    size: NPC_CARD,
    command: "Додати NPC",
    pickerTitle: "NPC з репозиторію",
    searchPlaceholder: "Назва або slug NPC…",
  },
  creature: {
    icon: "skull",
    variant: "statblock",
    size: STATBLOCK_CARD,
    command: "Додати статблок",
    pickerTitle: "Статблок із бестіарію",
    searchPlaceholder: "Назва або slug істоти…",
  },
};

// Типи без власної кнопки, але з упізнаваною карткою: своя іконка в шапці,
// розмір як у NPC і палітра, яку CSS дає за data-entity-type вузла. Такі
// картки, як і NPC, не згортаються на дальньому зумі.
const ENTITY_CARD_TYPES = {
  item: { icon: "inventory_2", size: NPC_CARD },
  faction: { icon: "flag", size: NPC_CARD },
};

const viewport = document.querySelector("#viewport");
const scene = document.querySelector("#scene");
const grid = document.querySelector("#grid");
const marquee = document.querySelector("#marquee");
const workspace = document.querySelector(".workspace");
const toggleLayersButton = document.querySelector("#toggle-layers");
const togglePartyButton = document.querySelector("#toggle-party");
const partyList = document.querySelector("#party-list");
const partyAge = document.querySelector("#party-age");
const partyGold = document.querySelector("#party-gold");
const canvasActions = document.querySelector(".canvas-actions");
const status = document.querySelector("#save-status");
const emptyState = document.querySelector("#empty-state");
const toast = document.querySelector("#toast");
const layerTree = document.querySelector("#layer-tree");
const layerActions = document.querySelector("#layer-actions");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const dropOverlay = document.querySelector("#drop-overlay");
const dropChoice = document.querySelector("#drop-choice");
const dropChoiceTitle = document.querySelector("#drop-choice-title");
const connectionScreen = document.querySelector("#connection-screen");
const connectionHint = document.querySelector("#connection-hint");
const openCampaignButton = document.querySelector("#open-campaign");
const changeCampaignButton = document.querySelector("#change-campaign");
const cancelCampaignButton = document.querySelector("#cancel-campaign");
const openCampaignLabel = document.querySelector("#open-campaign-label");
const recentCampaigns = document.querySelector("#recent-campaigns");
const campaignNameLabel = document.querySelector("#campaign-name");
const loadingScreen = document.querySelector("#loading-screen");
const loadingTitle = document.querySelector("#loading-title");
const loadingStep = document.querySelector("#loading-step");
const addEntityButton = document.querySelector("#add-entity");
const addLocationButton = document.querySelector("#add-location");
const addNpcButton = document.querySelector("#add-npc");
const addStatblockButton = document.querySelector("#add-statblock");
const addTokenButton = document.querySelector("#add-token");
const tokenColorsMenu = document.querySelector("#token-colors");
const entityPicker = document.querySelector("#entity-picker");
const entitySearch = document.querySelector("#entity-search");
const entityResults = document.querySelector("#entity-results");
const pickerTitle = document.querySelector("#entity-picker-title");
const entityDetails = document.querySelector("#entity-details");
const entityDetailsContent = document.querySelector("#entity-details-content");
const nodeContextMenu = document.querySelector("#node-context-menu");
const sceneRenameDialog = document.querySelector("#scene-rename-dialog");
const sceneRenameForm = document.querySelector("#scene-rename-form");
const battleGridDialog = document.querySelector("#battle-grid-dialog");
const battleGridForm = document.querySelector("#battle-grid-form");
const battleGridFile = document.querySelector("#battle-grid-file");
const battleGridColumns = document.querySelector("#battle-grid-columns");
const battleGridRows = document.querySelector("#battle-grid-rows");
const battleGridHint = document.querySelector("#battle-grid-hint");
const sceneNameInput = document.querySelector("#scene-name");
const renameDialogTitle = document.querySelector("#rename-dialog-title");
const renameDialogHint = document.querySelector("#rename-dialog-hint");
const musicDialog = document.querySelector("#music-dialog");
const musicUrlInput = document.querySelector("#music-url");
const musicTitleInput = document.querySelector("#music-title");
const musicStartInput = document.querySelector("#music-start");
const musicHint = document.querySelector("#music-hint");
const measureRouteButton = document.querySelector("#measure-route");
const routeOverlay = document.querySelector("#route-overlay");
const routeHint = document.querySelector("#route-hint");
const routeHintText = document.querySelector("#route-hint-text");
const routeRecalibrateButton = document.querySelector("#route-recalibrate");
const routePopup = document.querySelector("#route-popup");
const routeTotal = document.querySelector("#route-total");
const routeLegs = document.querySelector("#route-legs");
const routeRows = document.querySelector("#route-rows");
const conflictBar = document.querySelector("#conflict-bar");

let storage;
let layout;
let revision;
// Виділення — множина: рамкою беруться кілька вузлів одразу. Порядок
// додавання зберігається, бо від нього залежить порядок z-операцій.
let selectedIds = new Set();
let saveTimer = null;
let saving = false;
let saveAgain = false;
// Розкладка змінена, але ще не на диску. Разом із записами файлів нотаток і
// недокрученими HP це те, що пропало б із закриттям вкладки.
let dirty = false;
let pendingWrites = 0;
// canvas.json змінився поза канвою: автозбереження спиняється, доки ДМ не
// вирішить, чиї зміни лишити, — інакше кожна правка знову впиралася б у той
// самий конфлікт.
let conflicted = false;
let interaction = null;
let spacePressed = false;
let undoStack = [];
let redoStack = [];
let pendingDrop = null;
let entities = [];
let entitiesBySlug = new Map();
// Документи поза індексом карток (сесії, службові): лише для попапа й backlinks.
let referencesBySlug = new Map();
let notesByRef = new Map();
let boardConfig = null;
let editingNoteId = null;
const textRatioByBox = new Map();
// Перемальовка вузла не має губити те, що ДМ уже набрав або догортав на
// статблоці: розкладці ці дрібниці не належать, тож тримаємо їх тут.
const hpAmountByNode = new Map();
const statblockScrollByNode = new Map();
// Підказка з текстом закляття висить поверх усього в екранних пікселях, тож
// читається однаково на будь-якому зумі полотна.
const spellTip = document.createElement("div");
spellTip.className = "spell-tip";
spellTip.hidden = true;
document.body.append(spellTip);
let spellTipAnchor = null;
let hitPointEdit = null;
let historyBusy = false;
const newNoteIds = new Set();
let pendingNoteInput = null;
let pickerSelection = 0;
let pickerTypes = null;
// Той самий пошук по бестіарію кладе на полотно або статблок, або токен.
let pickerMakesToken = false;
let insertPoint = null;
let contextMenuNodeId = null;
let contextMenuCreature = null;
let contextMenuPoint = null;
let renamingNodeId = null;
let renamingCreature = null;
let rightPointerGesture = null;
// Власна копія поруч із системним буфером: читати системний дозволено не
// завжди (контекстне меню без дозволу на clipboard-read), а вставляти щось
// одразу після свого ж «копіювати» треба без запитань.
let internalClipboard = null;
let pointerClient = null;
// Назву ютуб віддає асинхронно, тож рахуємо запити: у поле потрапляє лише
// відповідь на останній лінк, а вручну вписана назва не затирається.
let musicLookup = 0;
let musicLookupTimer = null;
let musicTitleEdited = false;
let renderOrigin = { x: 0, y: 0 };
let viewFrame = 0;
let viewSettleTimer = null;
// Вузли й світові прямокутники на момент останнього кадру: за ними кадр
// вирішує, що видно, а картинка — чи брати оригінал.
let viewIndex = new Map();
// Справжня товщина рамки кожного вузла за id — див. renderedIndex.
const nodeBorders = new Map();
// Геометрія такою, як її видно на сторінці. Усе, що кладе вузол під курсор
// чи шукає вузол під ним, рахує саме так: у моделі без рамок картка на карті
// світу лягала б за десятки тисяч одиниць від курсора.
const RENDERED = { inset: (node) => nodeBorders.get(node.id) ?? 0 };
// Мініатюри памʼятаються за шляхом файла, а шляхи в різних кампаніях
// збігаються, тож кожна кампанія дістає власний набір.
function newThumbnails() {
  return createThumbnails({
    readCached: (path) => storage.cachedThumbnail(path),
    saveCached: (path, blob) => storage.saveThumbnail(blob, path),
    readOriginal: async (path) => (await fetch(await storage.mediaUrl(path, false))).blob(),
    shrink: shrinkImage,
  });
}
let thumbnails = newThumbnails();
// Масштаб карти переживає перезавантаження, сам маршрут — ні: він потрібен
// рівно на ту розмову, у якій його проклали.
let routeScale = null;
let routeMode = null;
let routePoints = [];
let routePointer = null;

// localStorage буває недоступним (приватне вікно, заборонені дані сайту) —
// тоді канва просто нічого не памʼятає між відкриттями.
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function removeStorage(key) {
  try { localStorage.removeItem(key); } catch {}
}

// Позиція полотна й масштаб лінійки — свої в кожної кампанії, під ключем із
// board.config.json (`id`) або назвою теки. Колись вони були спільні, під
// ключами crown-board.*; їх забирає перша кампанія, відкрита після оновлення.
let campaignStateKey = null;
const LEGACY_CAMPAIGN_KEYS = { viewport: "crown-board.viewport", "route-scale": "crown-board.route-scale" };

function campaignSetting(name) {
  const key = `board.${campaignStateKey}.${name}`;
  const own = readStorage(key);
  if (own !== null) return own;
  const legacyKey = LEGACY_CAMPAIGN_KEYS[name];
  const legacy = legacyKey ? readStorage(legacyKey) : null;
  if (legacy === null) return null;
  writeStorage(key, legacy);
  removeStorage(legacyKey);
  return legacy;
}

function setCampaignSetting(name, value) {
  if (campaignStateKey !== null) writeStorage(`board.${campaignStateKey}.${name}`, value);
}

// Відкрита панель шарів — звичка ДМа, а не кампанії, тож вона спільна.
const LAYERS_KEY = "board.layers-open";
let layersOpen = (readStorage(LAYERS_KEY) ?? readStorage("crown-board.layers-open")) === "true";
let view = loadView(null);

function setLayersOpen(open, persist = true) {
  if (open && partyOpen) setPartyOpen(false, persist);
  layersOpen = open;
  workspace.classList.toggle("layers-open", open);
  toggleLayersButton.replaceChildren(iconElement(open ? "chevron_left" : "layers"));
  toggleLayersButton.title = open ? "Закрити шари" : "Відкрити шари";
  toggleLayersButton.setAttribute("aria-label", toggleLayersButton.title);
  toggleLayersButton.setAttribute("aria-expanded", String(open));
  if (persist) {
    writeStorage(LAYERS_KEY, String(open));
    removeStorage("crown-board.layers-open");
  }
  if (open) renderLayers();
}

// Партія й шари ділять ліву панель: відкрита лише одна з них.
const PARTY_KEY = "board.party-open";
let partyOpen = false;
let partyMonitor = null;
let partyRenderTimer = null;
let partyAgeTimer = null;

function setPartyOpen(open, persist = true) {
  if (open && layersOpen) setLayersOpen(false, persist);
  partyOpen = open && Boolean(partyMonitor);
  workspace.classList.toggle("party-open", partyOpen);
  togglePartyButton.replaceChildren(iconElement(partyOpen ? "chevron_left" : "groups"));
  togglePartyButton.title = partyOpen ? "Закрити партію" : "Відкрити партію";
  togglePartyButton.setAttribute("aria-label", togglePartyButton.title);
  togglePartyButton.setAttribute("aria-expanded", String(partyOpen));
  if (persist) writeStorage(PARTY_KEY, String(open));
  syncPartyPolling();
  if (partyOpen) renderParty();
}

setLayersOpen(layersOpen, false);

function loadView(stored) {
  const fallback = { x: innerWidth / 2 - WORLD_SIZE / 2, y: innerHeight / 2 - WORLD_SIZE / 2, scale: 1 };
  try {
    const loaded = { ...fallback, ...JSON.parse(stored) };
    if (!Number.isFinite(loaded.x) || !Number.isFinite(loaded.y) || !Number.isFinite(loaded.scale) || loaded.scale <= 0) throw new Error("Invalid viewport");
    return loaded;
  } catch {
    return fallback;
  }
}

function persistView() {
  setCampaignSetting("viewport", JSON.stringify(view));
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function layoutsEqual(first, second) { return JSON.stringify(first) === JSON.stringify(second); }
function selectionIds() { return [...selectedIds]; }
function isSelected(id) { return selectedIds.has(id); }
function soleSelectedId() { return selectedIds.size === 1 ? selectedIds.values().next().value : null; }
function setSelection(ids) { selectedIds = new Set(ids); }
function selectedNodes() { return selectionIds().map((id) => findNode(layout, id)).filter(Boolean); }
// Рухається, видаляється й переупорядковується лише зовнішній шар виділення:
// вміст контейнера їде разом із ним, а окремо — поїхав би двічі.
function selectedRoots() { return outermostIds(layout, selectionIds()).map((id) => findNode(layout, id)).filter(Boolean); }
function plural(count, one, many) { return count > 1 ? many : one; }
function nodeLabel(node) {
  if (node.type === "image") return node.image.split("/").at(-1);
  if (node.type === "entity" || node.type === "token") return entitiesBySlug.get(node.entity)?.name ?? `[[${node.entity}]]`;
  if (node.type === "note") return notesByRef.get(node.note)?.text.split("\n").find((line) => line.trim())?.slice(0, 60) || "Нотатка";
  if (node.type === "music") return musicTitle(node.title, node.url);
  return node.title || "Без назви";
}

function summarySection() {
  return boardConfig?.entities?.summarySection ?? "";
}

function nodeEntity(node) {
  return node.type === "entity" ? entitiesBySlug.get(node.entity) ?? null : null;
}

// Картка, на яку спирається вузол: сама картка сутності або токен її істоти.
function linkedEntity(node) {
  return ["entity", "token"].includes(node.type) ? entitiesBySlug.get(node.entity) ?? null : null;
}

function entityKind(entity) {
  return ENTITY_KINDS[entity?.type] ?? null;
}

// Тип із власним виглядом бере глиф зі свого опису, решта — з ENTITY_CARD_TYPES.
function entityIcon(entity) {
  return entityKind(entity)?.icon ?? ENTITY_CARD_TYPES[entity?.type]?.icon ?? "description";
}

// Згортання на дальньому зумі: картка з власним виглядом лишається цілою.
function isFarCollapsed(node) {
  return !ENTITY_CARD_TYPES[nodeEntity(node)?.type] && node.width * view.scale < 180;
}

function nodeVariant(node) {
  return entityKind(nodeEntity(node))?.variant ?? node.type;
}

function isLocationNode(node) {
  return entityKind(nodeEntity(node))?.variant === "frame";
}

function locationAtPoint(point, excludeId = null) {
  const target = deepestContainerAt(layout, point, excludeId, RENDERED);
  if (!target) return null;
  return isLocationNode(target) ? target : nearestAncestor(layout, target.id, isLocationNode);
}

// Картка показує «На дошці» без блокової розмітки (заголовки, списки, цитати
// знімаємо з початку рядків), але з inline: **жирний**, *курсив* тощо.
function summaryMarkup(source) {
  const text = source.replace(/<!--.*?-->/gs, "").replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .split("\n").map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  return renderInline(text);
}

async function setDirectImageSource(image, path) {
  try { image.src = await storage.mediaUrl(path, false); } catch (error) { console.warn(error); }
}

// Картинка на полотні: мініатюра, а оригінал — лише коли вузол видно і на
// екрані він уже завбільшки з мініатюру. Мініатюри карт дошки зберігаються в
// кеші на диску; портретів — лише на сесію: їх кладуть і поза текою медіа
// дошки, а в кеші тримаються самі імена файлів, які там можуть збігтися.
function showMedia(image, path, { node = null, size = PORTRAIT_THUMBNAIL_SIZE, persist = false } = {}) {
  image.decoding = "async";
  image.dataset.mediaPath = path;
  image.dataset.mediaNode = node?.id ?? "";
  image.dataset.thumbnailSize = size;
  image.dataset.persistThumbnail = persist;
  refreshMedia(image);
}

function refreshMedia(image) {
  const path = image.dataset.mediaPath;
  const size = Number(image.dataset.thumbnailSize);
  const entry = viewIndex.get(image.dataset.mediaNode);
  const full = Boolean(entry) && rectsOverlap(entry.rect, screenWorldRect())
    && wantsFullImage(entry.node.width * view.scale, size);
  const key = `${full ? "full" : size}:${path}`;
  if (image.dataset.sourceKey === key) return;
  image.dataset.sourceKey = key;
  // Поки нове джерело вантажиться, лишається старе: краще трохи розмите чи
  // зайве чітке, ніж порожня рамка.
  const url = full ? storage.mediaUrl(path, false) : thumbnails.url(path, size, { persist: image.dataset.persistThumbnail === "true" });
  url.then((source) => { if (image.dataset.sourceKey === key) image.src = source; }).catch((error) => console.warn(error));
}

function updateImageSources() {
  if (!layout) return;
  scene.querySelectorAll("img[data-media-path]").forEach(refreshMedia);
}

async function shrinkImage(blob, size) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (Math.max(bitmap.width, bitmap.height) <= size) return blob;
    return await canvasBlob(bitmap, 0.8, size);
  } finally {
    bitmap.close();
  }
}

function screenWorldRect(margin = 0) {
  const screen = worldViewportRect(view, viewport.clientWidth, viewport.clientHeight);
  return {
    x: screen.x - screen.width * margin,
    y: screen.y - screen.height * margin,
    width: screen.width * (1 + margin * 2),
    height: screen.height * (1 + margin * 2),
  };
}

function boardScaleLimits() {
  if (!layout) return { minimum: 0, maximum: Infinity };
  const rects = allAbsoluteRects(layout);
  const minimum = minimumScaleForNodes(rects, viewport.clientWidth, viewport.clientHeight, MIN_ZOOM_VIEWPORT_COVERAGE);
  const maximum = maximumScaleForNodes(rects, viewport.clientWidth, viewport.clientHeight, MAX_ZOOM_VIEWPORT_PADDING);
  return { minimum, maximum: Math.max(minimum, maximum) };
}

function constrainViewScale(localX = viewport.clientWidth / 2, localY = viewport.clientHeight / 2) {
  const limits = boardScaleLimits();
  const constrainedScale = clamp(view.scale, limits.minimum, limits.maximum);
  if (view.scale === constrainedScale) return false;
  view = zoomedViewAt(view, localX, localY, constrainedScale / view.scale);
  return true;
}

// Одразу й повністю: для переходів, після яких нічого не рухається далі.
function applyView() {
  cancelAnimationFrame(viewFrame);
  viewFrame = 0;
  clearTimeout(viewSettleTimer);
  viewSettleTimer = null;
  drawView();
  settleView();
}

// Колесо, тачпад і панорамування шлють подій більше, ніж браузер малює
// кадрів, тож усі кроки між двома кадрами збираються в один. Решту — те, чого
// під час руху не видно, — робимо, коли жест стихне.
function requestView() {
  if (!viewFrame) viewFrame = requestAnimationFrame(() => { viewFrame = 0; drawView(); });
  clearTimeout(viewSettleTimer);
  viewSettleTimer = setTimeout(() => { viewSettleTimer = null; settleView(); }, VIEW_SETTLE_DELAY);
}

function drawView() {
  constrainViewScale();
  const rebased = rebasedView(view, viewport.clientWidth, viewport.clientHeight);
  renderOrigin = { x: rebased.originX, y: rebased.originY };
  scene.style.transform = `translate(${rebased.translateX}px, ${rebased.translateY}px) scale(${view.scale})`;
  updateRootRenderPositions();
  scene.querySelectorAll(".resize-handle").forEach(sizeResizeHandle);
  const gridSize = 24 * view.scale;
  grid.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  grid.style.backgroundPosition = `${view.x % gridSize}px ${view.y % gridSize}px`;
  if (layout) {
    viewIndex = renderedIndex();
    updateFarCards();
    updateOffscreenNodes();
    updateLocationBorders();
  }
  // Маршрут живе у світових координатах, а малюється в екранних, тож після
  // кожного зсуву й зуму його доводиться перекладати наново.
  renderRoute();
}

// Прямокутники вузлів такими, як їх видно на сторінці: діти стоять усередині
// рамки батька. Товщину рамки беремо в браузера, а не рахуємо з 1em: він
// округлює її до пікселя і ще й обмежує зверху — у вузла на всю карту світу
// em за сорок тисяч, а рамка лише десять тисяч.
function renderedIndex() {
  return nodeIndex(layout, RENDERED);
}

function measureBorder(element) {
  nodeBorders.set(element.dataset.id, Number.parseFloat(getComputedStyle(element).borderLeftWidth) || 0);
}

function settleView() {
  persistView();
  renderLayers();
  updateImageSources();
}

// Маркер тримає однаковий екранний розмір за будь-якого зуму. Змінні стоять на
// самих маркерах, а не на сцені: змінна на сцені на кожен кадр перераховувала б
// стилі всього її вмісту.
function sizeResizeHandle(handle) {
  handle.style.setProperty("--resize-handle-size", `${13 / view.scale}px`);
  handle.style.setProperty("--resize-handle-offset", `${-6.5 / view.scale}px`);
  handle.style.setProperty("--resize-handle-border", `${2 / view.scale}px`);
  handle.style.setProperty("--resize-handle-radius", `${3 / view.scale}px`);
}

function updateFarCards() {
  scene.querySelectorAll(".entity-node").forEach((element) => {
    const node = viewIndex.get(element.dataset.id)?.node;
    if (!node || element.classList.contains("entity-far") === isFarCollapsed(node)) return;
    element.classList.toggle("entity-far");
    // Картка, що саме розгорнулася з дальнього зуму, показує підпис уперше —
    // до цієї миті його прямокутник не мав висоти й кегль не підбирався.
    fitNodeTexts(element);
  });
}

// Прихований вузол браузер не малює, а картинку в ньому — не розпаковує.
// Дитина ховається чи показується сама: видимість у .node задана кожному
// вузлу окремо, тож не успадковується від прихованого контейнера. Нотатку,
// що редагується, не чіпаємо: поле з фокусом сховати — значить його закрити.
function updateOffscreenNodes() {
  const area = screenWorldRect(OFFSCREEN_MARGIN);
  scene.querySelectorAll(".node").forEach((element) => {
    const entry = viewIndex.get(element.dataset.id);
    const hidden = Boolean(entry) && entry.node.id !== editingNoteId && !rectsOverlap(entry.rect, area);
    if (element.classList.contains("offscreen") !== hidden) element.classList.toggle("offscreen", hidden);
  });
}

function updateLocationBorders() {
  scene.querySelectorAll(".location-node").forEach((element) => {
    const node = viewIndex.get(element.dataset.id)?.node;
    if (!node) return;
    const screenWidth = locationBorderScreenWidth(
      node.width,
      node.height,
      view.scale,
      viewport.clientWidth,
      viewport.clientHeight,
    );
    // Обвід, а не рамка: рамка з box-sizing: border-box їсть картку всередину,
    // а діти позиційовані у відсотках від padding-box — тож на дальньому зумі,
    // де вона завтовшки в десятки світових пікселів, вони б повилазили за край.
    // Сцена масштабується цілком, тому переводимо екранні пікселі в локальні.
    element.style.outlineWidth = `${screenWidth / view.scale}px`;
  });
}

// Полотно зводиться до розкладки, але з уже намальованого береться все, що
// можна: картка будується наново, лише коли змінилося те, що вона показує.
// Свіжий DOM дошки браузер уперше розкладає сотні мілісекунд, тож повна
// перебудова на кожен зсув стрілкою чи undo була помітною паузою.
function render() {
  // Індекс — до вузлів: за ним картинки вирішують, з чого почати. Рамки
  // нових вузлів ще не поміряні, тож після вставки індекс перебудовуємо.
  viewIndex = renderedIndex();
  const previous = new Map([...scene.querySelectorAll(".node")].map((element) => [element.dataset.id, element]));
  const fresh = [];
  scene.querySelectorAll(".resize-handle").forEach((handle) => handle.remove());
  reconcileChildren(scene, layout.children, true, previous, fresh);
  fresh.forEach(measureBorder);
  viewIndex = renderedIndex();
  for (const id of nodeBorders.keys()) if (!viewIndex.has(id)) nodeBorders.delete(id);
  updateOffscreenNodes();
  updateFarCards();
  showSelection();
  updateImageSources();
  updateLocationBorders();
  emptyState.hidden = layout.children.length !== 0;
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
  if (constrainViewScale()) applyView();
  // Кегль підписів, нотаток і статблоків підбирається по вже вставлених у сцену
  // картках: раніше міряти нічого, бо прямокутник тексту ще не має висоти.
  fresh.forEach(fitOwnTexts);
  // Назва під курсором могла зникнути разом зі старим вузлом.
  if (spellTipAnchor && !spellTipAnchor.isConnected) hideSpellTip();
}

// Вузли одного контейнера в порядку розкладки. Готовий елемент переїжджає
// в новий контейнер сам, разом зі своїми дітьми; якщо порядок не змінився,
// DOM не чіпаємо зовсім.
function reconcileChildren(container, nodes, isRoot, previous, fresh) {
  const elements = nodes.map((node) => {
    const signature = nodeSignature(node, isRoot);
    let element = previous.get(node.id);
    if (element?.dataset.signature === signature) {
      updateNodeGeometry(node, element);
    } else {
      element = renderNode(node, isRoot);
      element.dataset.signature = signature;
      fresh.push(element);
    }
    reconcileChildren(element, node.children, false, previous, fresh);
    return element;
  });
  const wanted = new Set(elements);
  const current = [...container.children].filter((child) => child.classList.contains("node"));
  for (const child of current) if (!wanted.has(child)) child.remove();
  const kept = current.filter((child) => wanted.has(child));
  if (kept.length !== elements.length || kept.some((child, index) => child !== elements[index])) container.append(...elements);
}

// Усе, від чого залежить вигляд самої картки, крім місця й розміру: їх
// оновлюють на готовому елементі. Сам об'єкт вузла теж тут — його тримають
// обробники подій картки; adoptLayout береже його після undo.
function nodeSignature(node, isRoot) {
  const { children, x, y, width, height, ...own } = node;
  const note = node.type === "note" ? notesByRef.get(node.note) : null;
  // Порожня рамка чи сцена показує підказку замість вмісту.
  return JSON.stringify([own, isRoot, children.length > 0, editingNoteId === node.id, objectKey(node), objectKey(linkedEntity(node)), objectKey(note)]);
}

const objectKeys = new WeakMap();
let nextObjectKey = 1;
function objectKey(value) {
  if (!value || typeof value !== "object") return 0;
  if (!objectKeys.has(value)) objectKeys.set(value, nextObjectKey++);
  return objectKeys.get(value);
}

function nodeElement(id) {
  return [...scene.querySelectorAll(".node")].find((candidate) => candidate.dataset.id === id) ?? null;
}

function fitNodeTexts(root = scene) {
  root.querySelectorAll(".entity-summary").forEach((summary) => fitSummary(summary));
  root.querySelectorAll(".note-content, .note-editor").forEach((note) => fitNote(note));
  root.querySelectorAll(".statblock-sheet").forEach((sheet) => fitStatblock(sheet));
}

function fitSummary(summary) {
  fitBoxText(summary, {
    kind: "summary",
    shape: textShape(summary.textContent),
    minRatio: SUMMARY_MIN_RATIO,
    apply: (ratio) => applyFontRatio(summary, SUMMARY_FONT_EM, ratio),
  });
}

// Статблок має влазити в картку без скролу: зменшуємо весь аркуш разом, щоб
// пропорції заголовків, таблиці й тексту лишалися бестіарними. Міряємо тіло
// картки, а не аркуш: скролиться саме воно, і його поля від кегля не залежать.
// Рядки лічильника HP забирають висоту в тіла, тож їх кількість теж у ключі.
function fitStatblock(sheet) {
  const body = sheet.parentElement;
  const rows = body.parentElement?.querySelectorAll(":scope > :is(.statblock-hp, .statblock-slots)").length ?? 0;
  fitBoxText(sheet, {
    kind: "statblock",
    box: body,
    shape: `${rows}.${textShape(sheet.textContent)}`,
    apply: (ratio) => applyFontRatio(sheet, STATBLOCK_FONT_EM, ratio),
  });
}

// Нотатка підбирає кегль так само, як підпис картки, але з двома відмінностями.
// Перша: на відміну від картки, вона не лише зменшує текст, а й збільшує —
// нотатку пишуть під її розмір, тож короткий запис має бути видно здалеку.
// Друга: у режимі редагування той самий кегль має дістати й дзеркало каретки,
// інакше каретка стане не там, де курсор.
function fitNote(note) {
  const mirror = note.parentElement?.querySelector(":scope > .note-caret-mirror");
  const text = note.tagName === "TEXTAREA" ? note.value : note.textContent;
  fitBoxText(note, {
    kind: "note",
    shape: textShape(text),
    // Порожню нотатку розганяти нема по чому: кегль виріс би до стелі, а видно
    // було б саму каретку на всю картку.
    maxRatio: text.trim() ? noteMaxRatio : undefined,
    apply: (ratio) => {
      applyNoteRatio(note, ratio);
      if (mirror) applyNoteRatio(mirror, ratio);
    },
  });
}

// Стеля росту — не число зі стелі, а сама картка: кегль, за якого й один рядок
// уже вищий за неї, не влізе ніколи, тож вище шукати нема чого. Міряємо з
// базовим кеглем, тож частка — це просто «скільки таких рядків тут поміститься».
function noteMaxRatio(note) {
  const lineHeight = Number.parseFloat(getComputedStyle(note).lineHeight);
  if (!lineHeight) return 1;
  return Math.max(1, note.clientHeight / lineHeight);
}

// Спільне для підпису, нотатки й статблока: прямокутник той самий на будь-якому зумі, тож
// підібрану частку кегля кешуємо за його пропорціями в em.
function fitBoxText(element, { kind, shape, apply, box = element, minRatio = TEXT_MIN_RATIO, maxRatio = () => 1 }) {
  const card = element.closest(".node");
  // Кегль вузла — це nodeVisualScale, а не зум: сцена масштабується трансформом,
  // тож те, що ми міряємо, від наближення не залежить.
  const fontSize = Number.parseFloat(card?.style.fontSize);
  if (!fontSize) return;
  const key = fitBoxKey(
    kind,
    Number.parseFloat(card.style.width),
    Number.parseFloat(card.style.height),
    fontSize,
    shape,
  );
  const cached = textRatioByBox.get(key);
  if (cached !== undefined) return apply(cached);
  apply(1);
  // Прямокутник без висоти — картка згорнута на дальньому зумі: міряти нічого.
  if (!box.clientHeight) return;
  const fittedRatio = fittingRatio((candidate) => {
    apply(candidate);
    if (box.scrollHeight > box.clientHeight) return false;
    // Ширину питаємо лише на зростанні: слова не переносяться всередині себе,
    // тож найдовше з них вилазить убік, не додаючи висоти, — і без цієї
    // перевірки текст ріс би просто повз край картки.
    return candidate <= 1 || box.scrollWidth <= box.clientWidth;
  }, { minRatio, maxRatio: maxRatio(element) });
  const ratio = reservedFitRatio(fittedRatio, minRatio);
  apply(ratio);
  // Кеш росте лише від нових пропорцій картки — за протяжку кутом їх стільки,
  // скільки кадрів, тож переповнений просто скидаємо.
  if (textRatioByBox.size >= TEXT_FIT_CACHE_LIMIT) textRatioByBox.clear();
  textRatioByBox.set(key, ratio);
}

function applyFontRatio(element, base, ratio) {
  // Однакове значення не переписуємо: інакше кожен кадр протяжки скидав би
  // розкладку картки задарма.
  const value = fittedFontSize(base, ratio);
  if (element.style.fontSize !== value) element.style.fontSize = value;
}

function applyNoteRatio(element, ratio) {
  applyFontRatio(element, NOTE_FONT_EM, ratio);
  const padding = notePadding(ratio);
  if (element.style.padding !== padding) element.style.padding = padding;
}

// Елемент можна передати готовим: під час групового перетягування пошук по
// сцені для кожного вузла на кожен кадр коштував би квадрата від їх кількості.
// Однакові значення не переписуємо: render проходить так кожен вузол дошки, і
// кожен зайвий запис змусив би браузер наново розкладати картку.
function updateNodeGeometry(node, element = nodeElement(node.id)) {
  if (!element) return;
  updateNodePosition(element, node);
  const width = `${node.width}px`;
  const height = `${node.height}px`;
  const fontSize = `${nodeVisualScale(node, nodeVariant(node))}px`;
  if (element.style.width === width && element.style.height === height && element.style.fontSize === fontSize) return;
  element.style.width = width;
  element.style.height = height;
  if (element.style.fontSize !== fontSize) {
    element.style.fontSize = fontSize;
    measureBorder(element);
  }
  // Протяжка кутом міняє пропорції картки, а з ними й місце під текст.
  fitOwnTexts(element);
}

function fitOwnTexts(element) {
  const summary = element.querySelector(":scope > .entity-content > .entity-summary");
  if (summary) fitSummary(summary);
  const note = element.querySelector(":scope > .note-content, :scope > .note-editor");
  if (note) fitNote(note);
  const sheet = element.querySelector(":scope > .statblock-body > .statblock-sheet");
  if (sheet) fitStatblock(sheet);
}

function updateNodePosition(element, node) {
  const root = element.dataset.root === "true";
  const left = root ? `${node.x * WORLD_SIZE / 100 - renderOrigin.x}px` : `${node.x}%`;
  const top = root ? `${node.y * WORLD_SIZE / 100 - renderOrigin.y}px` : `${node.y}%`;
  if (element.style.left !== left) element.style.left = left;
  if (element.style.top !== top) element.style.top = top;
}

function updateRootRenderPositions() {
  layout?.children.forEach((node) => {
    const element = [...scene.children].find((candidate) => candidate.dataset.id === node.id);
    if (element) updateNodePosition(element, node);
  });
}

function renderNode(node, isRoot = false) {
  const element = document.createElement("article");
  element.className = `node${isSelected(node.id) ? " selected" : ""}${node.locked ? " locked" : ""}`;
  element.dataset.id = node.id;
  element.dataset.root = isRoot;
  updateNodePosition(element, node);
  element.style.width = `${node.width}px`;
  element.style.height = `${node.height}px`;
  element.style.fontSize = `${nodeVisualScale(node, nodeVariant(node))}px`;
  if (node.type === "note") {
    element.classList.add("note-node");
    element.classList.toggle("editing", editingNoteId === node.id);
    const dragHandle = document.createElement("div");
    dragHandle.className = "note-drag-handle";
    dragHandle.dataset.id = node.id;
    dragHandle.title = "Перетягнути нотатку";
    dragHandle.setAttribute("aria-label", "Перетягнути нотатку");
    dragHandle.append(iconElement("drag_pan"));
    dragHandle.addEventListener("pointerdown", onNodePointerDown);
    element.append(dragHandle);
    const note = notesByRef.get(node.note);
    if (editingNoteId === node.id) {
      const indicator = document.createElement("span");
      indicator.className = "note-editing-indicator";
      indicator.title = "Нотатка редагується";
      indicator.setAttribute("role", "img");
      indicator.setAttribute("aria-label", "Нотатка редагується");
      indicator.append(iconElement("edit"));
      const editor = document.createElement("textarea");
      editor.className = "note-editor";
      editor.value = note?.text ?? "";
      editor.placeholder = "Текст нотатки…";
      editor.addEventListener("pointerdown", (event) => event.stopPropagation());
      editor.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); editor.blur(); }
        else if (event.key === "Escape") {
          event.preventDefault();
          editor.dataset.cancelled = "true";
          editingNoteId = null;
          if (newNoteIds.delete(node.id)) undo();
          else render();
        }
      });
      editor.addEventListener("blur", () => {
        if (editor.dataset.cancelled !== "true") finishNoteEdit(node, editor.value);
      }, { once: true });
      element.append(indicator, editor);
      // Кегль перебираємо перед тим, як каретка порахує своє місце: її слухач
      // "input" навішується нижче, тож працює вже з новим кеглем.
      editor.addEventListener("input", () => fitNote(editor));
      const updateCaret = attachNoteCaret(editor, element);
      element.append(boldButton(editor, updateCaret));
      const pendingKey = pendingNoteInput?.id === node.id ? pendingNoteInput.key : null;
      if (pendingNoteInput?.id === node.id) pendingNoteInput = null;
      requestAnimationFrame(() => {
        editor.focus();
        let position = editor.value.length;
        if (pendingKey === "Backspace" && position > 0) {
          editor.setRangeText("", position - 1, position, "end");
          position -= 1;
        } else if (pendingKey && pendingKey.length === 1) {
          editor.setRangeText(pendingKey, position, position, "end");
          position += pendingKey.length;
        }
        // Перша натиснута клавіша вставляється без події "input", тож кегль
        // перебираємо тут самі.
        if (pendingKey) fitNote(editor);
        editor.setSelectionRange(position, position);
        updateCaret();
      });
    } else {
      const content = document.createElement("div");
      content.className = `note-content${node.hideText === true ? " text-hidden" : ""}`;
      // Зірочки жирного в показаній нотатці ні до чого: їх видно лише в полі,
      // де їх і ставить кнопка.
      content.innerHTML = noteMarkup(note?.text || `Не знайдено ${node.note}`);
      content.addEventListener("pointerdown", (event) => event.stopPropagation());
      content.addEventListener("click", (event) => {
        event.stopPropagation();
        if (node.locked) return;
        if (event.shiftKey) return toggleSelected(node.id);
        setSelection([node.id]);
        editingNoteId = node.id;
        render();
      });
      element.append(content);
    }
  } else if (node.type === "entity") {
    const entity = nodeEntity(node);
    const kind = entityKind(entity);
    if (!entity) {
      element.classList.add("entity-node");
      const missing = document.createElement("div");
      missing.className = "entity-missing";
      missing.textContent = `Не знайдено картку [[${node.entity}]]`;
      missing.addEventListener("click", (event) => selectFrom(event, node.id));
      element.append(missing);
    } else if (kind?.variant === "statblock") {
      // Статблок: шапка, лічильник HP і «паперова» частина бестіарію під ними.
      element.classList.add("statblock-node");
      element.append(nodeHeader(node, { icon: kind.icon, entity }));
      const maximum = maxHitPoints(entity.meta);
      // Однакових істот у бою буває кілька, тож кожна дістає власний рядок
      // лічильника; поки істота одна, рядок виглядає точно як раніше.
      const creatures = maximum ? creatureList(node) : [];
      // Комірки заклинача — одразу під HP своєї істоти: так у загоні видно, чиї
      // вони, і рядки не губляться при скролі й не дрібніють з кеглем аркуша.
      const slots = spellSlots(entity.body);
      const rows = creatures.length || !slots.length ? creatures : creatureList(node);
      for (const index of rows.keys()) {
        if (maximum) element.append(hitPointTracker(node, entity, maximum, creatures, index));
        if (slots.length) element.append(spellSlotTracker(node, entity, slots, rows, index));
      }
      const body = document.createElement("div");
      body.className = "statblock-body";
      // Аркуш — окремий шар, щоб підібраний кегль не чіпав полів самого тіла.
      const sheet = document.createElement("div");
      sheet.className = "statblock-sheet";
      sheet.innerHTML = statblockMarkup(entity, { hiddenSections: boardConfig.entities.statblockHiddenSections });
      // Арт вантажиться вже після підбору кегля, тож рамка під нього має
      // фіксований розмір у стилях — інакше картинка знову б дала скрол.
      const art = sheet.querySelector(".sb-art > img");
      if (art) showMedia(art, entity.portrait, { node });
      body.append(sheet);
      body.addEventListener("pointerdown", (event) => event.stopPropagation());
      body.addEventListener("click", (event) => { event.stopPropagation(); selectFrom(event, node.id); });
      body.addEventListener("wheel", onStatblockWheel);
      body.addEventListener("scroll", () => statblockScrollByNode.set(node.id, body.scrollTop));
      const scrolled = statblockScrollByNode.get(node.id) ?? 0;
      if (scrolled) requestAnimationFrame(() => { body.scrollTop = scrolled; });
      const spells = spellTexts(entity.body);
      if (spells.size) {
        body.addEventListener("pointerover", (event) => {
          const name = event.target.closest?.(".sb-spell");
          if (name) showSpellTip(name, spells.get(name.dataset.spell));
        });
        body.addEventListener("pointerout", (event) => {
          const name = event.target.closest?.(".sb-spell");
          if (name && !name.contains(event.relatedTarget)) hideSpellTip();
        });
        body.addEventListener("scroll", hideSpellTip, { passive: true });
        body.addEventListener("wheel", hideSpellTip, { passive: true });
      }
      element.append(body);
    } else if (kind?.variant === "frame") {
      // Локація — контейнер: лише шапка з назвою, без портрета й секції картки.
      element.classList.add("location-node");
      element.append(nodeHeader(node, { icon: kind.icon, entity }));
    } else {
      // NPC не згортається на дальньому зумі: арт і текст видно завжди.
      const npc = kind?.variant === "npc";
      element.classList.add(npc ? "npc-node" : "entity-node");
      // Тип на самій картці: за ним CSS дає айтему й фракції свою палітру.
      // Незнайомий тип лишається на загальній.
      if (!npc && entity.type) element.dataset.entityType = entity.type;
      if (!npc) element.classList.toggle("entity-far", isFarCollapsed(node));
      // Айтем замість слова типу показує ціну, а рідкість — смугою під шапкою.
      const item = entity.type === "item";
      const rarity = item ? String(entity.meta?.rarity ?? "").trim() : "";
      if (rarity) element.dataset.rarity = rarity.replace(/\s+/g, "-");
      const badge = npc ? "" : item ? String(entity.meta?.price ?? "").trim() : entity.type;
      element.append(nodeHeader(node, { icon: entityIcon(entity), entity, badge }));

      // Сховати опис можна лише NPC з портретом: тоді арт займає картку цілком.
      const summaryHidden = npc && node.hideSummary === true && Boolean(entity.portrait);
      const content = document.createElement("div");
      content.className = `entity-content${entity.portrait ? "" : " no-portrait"}${summaryHidden ? " summary-hidden" : ""}`;
      if (entity.portrait) {
        const portrait = document.createElement("img");
        portrait.className = "entity-portrait";
        portrait.alt = "";
        portrait.draggable = false;
        // Арт, де предмет упритул до країв кадру, з прапорцем отримує поле.
        if (item && String(entity.meta?.image_padding ?? "").trim() === "true") portrait.classList.add("padded");
        showMedia(portrait, entity.portrait, { node });
        content.append(portrait);
        // Налаштування — трикутник з «A» у кутку арту, у кольорі рідкості.
        if (item && String(entity.meta?.attunement ?? "").trim() === "true") {
          const mark = document.createElement("span");
          mark.className = "attunement-mark";
          mark.textContent = "A";
          mark.title = "Потребує налаштування";
          content.append(mark);
        }
      }
      if (!summaryHidden) {
        const summary = document.createElement("p");
        summary.className = "entity-summary";
        if (entity.summary) summary.innerHTML = summaryMarkup(entity.summary);
        else summary.textContent = `Немає секції «${summarySection()}»`;
        content.append(summary);
      }
      content.addEventListener("click", (event) => {
        event.stopPropagation();
        selectFrom(event, node.id);
      });
      element.append(content);
    }
  } else if (node.type === "scene") {
    element.classList.add("scene-node");
    element.append(nodeHeader(node));
    const body = document.createElement("div");
    body.className = "node-body";
    body.textContent = node.children.length ? "" : "Сцена порожня";
    element.append(body);
  } else if (node.type === "music") {
    element.classList.add("music-node");
    const header = nodeHeader(node, { icon: "music_note" });
    header.append(playLink(node));
    element.append(header);
  } else if (node.type === "token") {
    element.classList.add("token-node");
    element.append(tokenFace(node));
  } else if (node.type === "image") {
    element.classList.add("image-node");
    const image = document.createElement("img");
    image.className = "node-image";
    image.dataset.id = node.id;
    image.alt = nodeLabel(node);
    image.draggable = false;
    showMedia(image, node.image, { node, size: BOARD_THUMBNAIL_SIZE, persist: true });
    image.addEventListener("pointerdown", onNodePointerDown);
    if (node.rotation) {
      // Частки рамки від розміру не залежать, тож протяжка кутом їх не чіпає.
      const share = rotatedImageShare(node.aspect, node.rotation);
      element.classList.add("rotated");
      image.style.setProperty("--image-width", `${share.width * 100}%`);
      image.style.setProperty("--image-height", `${share.height * 100}%`);
      image.style.setProperty("--image-rotation", `${node.rotation}deg`);
    }
    element.append(image);
  } else {
    element.append(nodeHeader(node, { icon: "crop_square" }));

    const body = document.createElement("div");
    body.className = "node-body";
    body.textContent = node.children.length ? "" : "Рамка для вмісту";
    element.append(body);
  }
  // Дітей і маркери розміру додає render: діти можуть бути вже готові з
  // попереднього разу, а маркери залежать від виділення, не від вузла.
  return element;
}

// Коло токена саме й тягається: шапки, за яку братися, у нього нема.
function tokenFace(node) {
  const entity = linkedEntity(node);
  const color = tokenColor(node);
  const face = document.createElement("div");
  face.className = "token-face";
  face.dataset.id = node.id;
  face.title = nodeLabel(node);
  face.style.setProperty("--token-color", color);
  face.style.setProperty("--token-ink", tokenInk(color));
  if (entity?.portrait) {
    const art = document.createElement("img");
    art.className = "token-art";
    art.alt = "";
    art.draggable = false;
    showMedia(art, entity.portrait, { node });
    face.append(art);
  } else {
    const letter = document.createElement("span");
    letter.className = "token-letter";
    letter.textContent = tokenInitial(entity?.name ?? node.entity);
    face.append(letter);
  }
  face.addEventListener("pointerdown", onNodePointerDown);
  return face;
}

// Маркери розміру — лише коли вибрано рівно один вузол: групового ресайзу нема.
function hasResizeHandles(node) {
  return node.id === soleSelectedId() && !node.locked;
}

function resizeHandles(node) {
  return ["nw", "ne", "sw", "se"].map((corner) => {
    const handle = document.createElement("span");
    handle.className = `resize-handle ${corner}`;
    handle.dataset.corner = corner;
    handle.dataset.id = node.id;
    handle.addEventListener("pointerdown", onResizePointerDown);
    sizeResizeHandle(handle);
    return handle;
  });
}

// Від виділення на полотні залежать лише підсвітка й маркери розміру, тож
// міняємо тільки їх. Повний render перебудовує всю дошку разом із розкладкою
// кожної картки, а виділення — перший крок правого кліку: контекстне меню
// через це чекало на ноуті понад секунду.
function showSelection() {
  scene.querySelectorAll(".node").forEach((element) => {
    const selected = isSelected(element.dataset.id);
    if (element.classList.contains("selected") !== selected) element.classList.toggle("selected", selected);
  });
  const sole = soleSelectedId();
  scene.querySelectorAll(".resize-handle").forEach((handle) => {
    if (handle.dataset.id !== sole) handle.remove();
  });
  const node = sole ? viewIndex.get(sole)?.node ?? findNode(layout, sole) : null;
  const element = sole ? nodeElement(sole) : null;
  if (node && element && hasResizeHandles(node) && !element.querySelector(":scope > .resize-handle")) {
    element.append(...resizeHandles(node));
  }
  renderLayers();
}

function nodeHeader(node, { icon, entity = null, badge = "" } = {}) {
  const header = document.createElement("div");
  header.className = "node-header";
  header.dataset.id = node.id;
  header.innerHTML = '<span class="node-title"></span>'
    + (badge ? '<span class="entity-type"></span>' : "");
  header.querySelector(".node-title").textContent = nodeLabel(node);
  if (badge) header.querySelector(".entity-type").textContent = badge;
  if (icon) header.prepend(iconElement(icon, "node-glyph"));
  if (node.locked) header.append(iconElement("lock", "node-lock-indicator"));
  header.addEventListener("pointerdown", onNodePointerDown);
  if (entity) header.append(detailsButton(node, entity));
  return header;
}

// Ютуб памʼятає, де ролик спинили минулого разу, тож «плей» веде на лінк із
// явною нульовою позначкою часу — трек на сесії починається спочатку.
function musicStartLabel(node) {
  if (!node.start) return "Слухати з початку";
  const minutes = Math.floor(node.start / 60);
  const seconds = String(node.start % 60).padStart(2, "0");
  return `Слухати з ${minutes}:${seconds}`;
}

function playLink(node) {
  const link = document.createElement("a");
  link.className = "node-play";
  link.href = playbackUrl(node.url, node.start) ?? node.url;
  // Голий target="_blank" — найпростіше прохання «нова вкладка»: у Chrome
  // і Edge, яких дошка й так вимагає, він сам означає noopener, а явний rel
  // деякі браузери читають як прохання відкрити цілим вікном.
  link.target = "_blank";
  link.title = `${musicStartLabel(node)}: ${nodeLabel(node)}`;
  link.setAttribute("aria-label", link.title);
  link.append(iconElement("play_arrow"));
  // Клік лише не доходить до канви: вибір картки перемалював би шапку
  // просто зараз і забрав би з-під курсора сам лінк, який має відкритися.
  link.addEventListener("pointerdown", (event) => event.stopPropagation());
  link.addEventListener("click", (event) => event.stopPropagation());
  return link;
}

function detailsButton(node, entity) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "node-details";
  button.append(iconElement("info"));
  button.title = `Деталі: ${entity.name}`;
  button.setAttribute("aria-label", `Деталі: ${entity.name}`);
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    select(node.id);
    showEntityDetails(entity);
  });
  return button;
}

// Поточні HP живуть у розкладці (у кожної копії істоти свої), а не в картці
// бестіарію: на полотні може стояти три однакові стражники з різним здоров'ям.
function currentHitPoints(node, index, maximum) {
  return creatureHitPoints(creatureList(node)[index], maximum);
}

// Записуємо назад через увесь список: вузол сам вирішує, лишитися на node.hp
// чи перейти на масив істот.
function setHitPoints(node, index, value) {
  const creatures = creatureList(node);
  if (!creatures[index]) return;
  creatures[index] = { ...creatures[index], hp: value };
  writeCreatures(node, creatures);
}

// Червоним число стає, щойно в істоти лишилося менше за половину здоров'я.
function hurt(value, maximum) {
  return value < maximum / 2;
}

// Поле кількості порожнє (нуль) доти, доки ДМ не набрав шкоду чи лікування.
function hpAmount(key) {
  const value = hpAmountByNode.get(key);
  return Number.isFinite(value) ? value : 0;
}

// Після додавання чи видалення істоти набрані числа зсунулися б не до тих
// рядків, тож просто скидаємо їх разом із перебудовою списку.
function forgetHitPointAmounts(nodeId) {
  for (const key of [...hpAmountByNode.keys()]) {
    if (key === nodeId || key.startsWith(`${nodeId}:`)) hpAmountByNode.delete(key);
  }
}

// Колесо міняє HP без окремої команди на кожен клац: історія отримує один
// запис, коли ДМ зупинився — так само, як під час перетягування вузла.
function beginHitPointEdit(node) {
  if (hitPointEdit && hitPointEdit.nodeId !== node.id) commitHitPoints();
  hitPointEdit ??= { nodeId: node.id, before: cloneLayout(layout), beforeSelection: selectionIds(), timer: null };
  clearTimeout(hitPointEdit.timer);
  hitPointEdit.timer = setTimeout(commitHitPoints, HP_COMMIT_DELAY);
}

function commitHitPoints() {
  if (!hitPointEdit) return;
  const { before, beforeSelection, timer } = hitPointEdit;
  clearTimeout(timer);
  hitPointEdit = null;
  commitLiveCommand("Змінити HP", before, beforeSelection);
}

function hitPointTracker(node, entity, maximum, creatures, index) {
  const several = creatures.length > 1;
  const label = creatureLabel(creatures[index], index);
  // Поки істота одна, вона безіменна: підпис лише заважав би на вузькій картці.
  const who = several ? `${entity.name} — ${label}` : entity.name;
  const amountKey = `${node.id}:${index}`;

  const tracker = document.createElement("div");
  tracker.className = "statblock-hp";
  tracker.dataset.creature = String(index);
  tracker.addEventListener("pointerdown", (event) => event.stopPropagation());

  const current = document.createElement("input");
  current.className = "hp-current";
  current.type = "text";
  current.inputMode = "numeric";
  current.autocomplete = "off";
  current.value = String(currentHitPoints(node, index, maximum));
  current.title = "Поточні HP: впиши число або крути колесом";
  current.setAttribute("aria-label", `Поточні HP: ${who}`);
  current.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.deltaY) return;
    const step = (event.shiftKey ? 10 : 1) * (event.deltaY < 0 ? 1 : -1);
    const next = Math.min(currentHitPoints(node, index, maximum) + step, maximum);
    // Знімок «до» — раніше за першу зміну: інакше перший клац колеса не
    // потрапив би ні в історію, ні на диск.
    beginHitPointEdit(node);
    setHitPoints(node, index, next);
    current.value = String(next);
    tracker.classList.toggle("hurt", hurt(next, maximum));
  }, { passive: false });
  current.addEventListener("keydown", (event) => { if (event.key === "Enter") current.blur(); });
  current.addEventListener("change", () => {
    commitHitPoints();
    const typed = parseHitPoints(current.value);
    if (typed === null) {
      current.value = String(currentHitPoints(node, index, maximum));
      return;
    }
    executeCommand("Змінити HP", () => setHitPoints(node, index, Math.min(typed, maximum)));
  });
  current.addEventListener("blur", commitHitPoints);

  const total = document.createElement("span");
  total.className = "hp-max";
  total.textContent = `/ ${maximum}`;

  const amount = document.createElement("input");
  amount.className = "hp-amount";
  amount.type = "text";
  amount.inputMode = "numeric";
  amount.autocomplete = "off";
  amount.value = String(hpAmount(amountKey));
  amount.title = "Скільки HP додати або зняти: впиши число або крути колесом";
  amount.setAttribute("aria-label", `Скільки HP: ${who}`);
  amount.addEventListener("input", () => {
    hpAmountByNode.set(amountKey, Math.max(0, Math.trunc(Number(amount.value)) || 0));
  });
  amount.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.deltaY) return;
    const step = (event.shiftKey ? 10 : 1) * (event.deltaY < 0 ? 1 : -1);
    const next = Math.max(0, hpAmount(amountKey) + step);
    hpAmountByNode.set(amountKey, next);
    amount.value = String(next);
  }, { passive: false });

  const applyAmount = (sign, commandLabel) => {
    const delta = sign * hpAmount(amountKey);
    if (!delta) return;
    commitHitPoints();
    // Число згоріло разом із ударом: наступний удар набирається з нуля.
    hpAmountByNode.set(amountKey, 0);
    amount.value = "0";
    executeCommand(commandLabel, () => {
      setHitPoints(node, index, Math.min(currentHitPoints(node, index, maximum) + delta, maximum));
    });
  };
  const damage = hitPointButton("damage", "−", `Завдати шкоди: ${who}`, () => applyAmount(-1, "Зняти HP"));
  const heal = hitPointButton("heal", "+", `Вилікувати ${who}`, () => applyAmount(1, "Вилікувати HP"));

  const controls = document.createElement("div");
  controls.className = "hp-controls";
  controls.append(amount, damage, heal);
  tracker.append(current, total);
  // Підпис стає між числом і кнопками — там, де на одинокому рядку порожньо.
  if (several) {
    const name = document.createElement("span");
    name.className = "hp-name";
    name.textContent = label;
    name.title = label;
    tracker.append(name);
  }
  tracker.append(controls);
  tracker.classList.toggle("hurt", hurt(currentHitPoints(node, index, maximum), maximum));
  return tracker;
}

// Комірки заклинача: у кожної істоти загону власний рядок. Заповнений кружок —
// комірка ще є; клік по ньому витрачає одну, клік по порожньому повертає.
// «⟲» — тривалий відпочинок: усе знову повне.
function spellSlotTracker(node, entity, slots, creatures, index) {
  // Підпис істоти стоїть у рядку HP над цим, тут він лише для читача екрана.
  const who = creatures.length > 1 ? `${entity.name} — ${creatureLabel(creatures[index], index)}` : entity.name;
  const creature = creatures[index];
  const tracker = document.createElement("div");
  tracker.className = "statblock-slots";
  tracker.dataset.creature = String(index);
  tracker.addEventListener("pointerdown", (event) => event.stopPropagation());
  tracker.addEventListener("click", (event) => event.stopPropagation());
  const groups = document.createElement("div");
  groups.className = "slots-groups";
  for (const slot of slots) {
    const used = usedSlots(creature, slot);
    const group = document.createElement("span");
    group.className = "slots-group";
    group.title = `${slot.title}: ${slot.max - used} з ${slot.max}`;
    const caption = document.createElement("span");
    caption.className = "slots-label";
    caption.textContent = slot.label;
    group.append(caption);
    for (let pip = 0; pip < slot.max; pip += 1) {
      const left = pip < slot.max - used;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `slot-pip${left ? " on" : ""}`;
      button.setAttribute("aria-label", `${left ? "Витратити" : "Повернути"}: ${slot.title} — ${who}`);
      button.addEventListener("click", () => {
        executeCommand(left ? "Витратити комірку" : "Повернути комірку", () => {
          const all = creatureList(node);
          const current = usedSlots(all[index], slot);
          writeCreatures(node, all.with(index, withUsedSlots(all[index], slot, current + (left ? 1 : -1))));
        });
      });
      group.append(button);
    }
    groups.append(group);
  }
  const rest = document.createElement("button");
  rest.type = "button";
  rest.className = "slots-rest";
  rest.textContent = "⟲";
  rest.title = `Тривалий відпочинок: відновити всі комірки — ${who}`;
  rest.disabled = slots.every((slot) => !usedSlots(creature, slot));
  rest.addEventListener("click", () => {
    executeCommand("Відновити комірки", () => {
      const all = creatureList(node);
      const { slots: _spent, ...fresh } = all[index];
      writeCreatures(node, all.with(index, fresh));
    });
  });
  tracker.append(groups, rest);
  return tracker;
}

function showSpellTip(anchorElement, spell) {
  if (!spell || !anchorElement.isConnected) return;
  spellTipAnchor = anchorElement;
  spellTip.innerHTML = spellTooltipMarkup(spell);
  spellTip.hidden = false;
  const anchor = anchorElement.getBoundingClientRect();
  const size = spellTip.getBoundingClientRect();
  const margin = 12;
  const below = anchor.bottom + 8;
  const top = below + size.height <= window.innerHeight - margin ? below : anchor.top - size.height - 8;
  spellTip.style.left = `${clamp(anchor.left, margin, window.innerWidth - size.width - margin)}px`;
  spellTip.style.top = `${clamp(top, margin, window.innerHeight - size.height - margin)}px`;
}

function hideSpellTip() {
  spellTipAnchor = null;
  spellTip.hidden = true;
}

function hitPointButton(kind, glyph, title, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `hp-button ${kind}`;
  button.textContent = glyph;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => { event.stopPropagation(); action(); });
  return button;
}

// Довгий статблок гортається всередині картки, але на краях списку колесо
// знову дістається канві — інакше зум перестав би працювати над карткою.
function onStatblockWheel(event) {
  const body = event.currentTarget;
  if (!event.deltaY || body.scrollHeight - body.clientHeight <= 1) return;
  const up = event.deltaY < 0;
  if (up ? body.scrollTop <= 0 : body.scrollTop + body.clientHeight >= body.scrollHeight - 1) return;
  event.stopPropagation();
}

function layerIcon(node) {
  if (node.type === "token") return "circle";
  const entity = nodeEntity(node);
  if (entity) return entityIcon(entity);
  return node.type === "image" ? "image" : node.type === "entity" ? "description"
    : node.type === "note" ? "sticky_note_2" : node.type === "music" ? "music_note" : node.type === "token" ? "circle" : "crop_square";
}

// Список показує видимі вузли та найбільший вузол борду, навіть коли той поза екраном.
function visibleLayerRows() {
  const screen = worldViewportRect(view, viewport.clientWidth, viewport.clientHeight);
  return nodesInRect(layout, screen, rectsOverlap, { includeLargest: true });
}

// Панорамування перемальовує панель на кожен крок, тож однаковий вміст
// не перезбирається: інакше губився б скрол і підсвітка під курсором.
function layersSignature(rows) {
  return JSON.stringify(rows.map(({ node, depth }) => [node.id, depth, nodeLabel(node), node.locked === true, isSelected(node.id)]));
}

let lastLayersSignature = null;

function renderLayers() {
  if (!layout) return;
  if (!layout.children.length) {
    lastLayersSignature = null;
    layerTree.innerHTML = '<div class="layer-empty">Вузли з’являться тут після створення першої рамки.</div>';
    layerActions.hidden = true;
    return;
  }
  const rows = visibleLayerRows();
  const signature = layersSignature(rows);
  if (signature === lastLayersSignature) {
    layerActions.hidden = !selectedIds.size;
    return;
  }
  lastLayersSignature = signature;
  if (!rows.length) {
    layerTree.innerHTML = '<div class="layer-empty">У полі зору немає вузлів. Зменште масштаб, щоб побачити решту.</div>';
    layerActions.hidden = !selectedIds.size;
    return;
  }
  const fragment = document.createDocumentFragment();
  rows.forEach(({ node, depth }) => {
    const row = document.createElement("div");
    row.className = `layer-row${isSelected(node.id) ? " selected" : ""}${node.locked ? " locked" : ""}`;
    row.style.setProperty("--depth", depth);
    row.dataset.id = node.id;
    row.innerHTML = '<span class="layer-title"></span><button class="layer-lock" type="button"></button>';
    row.prepend(iconElement(layerIcon(node), "layer-glyph"));
    row.querySelector(".layer-title").textContent = nodeLabel(node);
    const lock = row.querySelector(".layer-lock");
    lock.append(iconElement(node.locked ? "lock_filled" : "lock_open"));
    lock.title = node.locked ? "Розблокувати" : "Заблокувати";
    lock.setAttribute("aria-label", lock.title);
    lock.addEventListener("click", (event) => {
      event.stopPropagation();
      select(node.id);
      toggleLock();
    });
    row.addEventListener("click", () => select(node.id));
    row.addEventListener("dblclick", (event) => {
      if (!event.target.closest("button")) centerNode(node.id);
    });
    fragment.append(row);
  });
  layerTree.replaceChildren(fragment);
  layerActions.hidden = !selectedIds.size;
}

function centerNode(id) {
  const rect = absoluteRect(layout, id, RENDERED);
  if (!rect) return;
  setSelection([id]);
  view = centeredViewOnRect(view, rect, viewport.clientWidth, viewport.clientHeight);
  render();
  applyView();
}

function select(id) {
  if (selectedIds.size === (id ? 1 : 0) && (!id || isSelected(id))) return;
  setSelection(id ? [id] : []);
  showSelection();
}

// Shift по вузлу додає його до виділення або прибирає звідти.
function toggleSelected(id) {
  if (!selectedIds.delete(id)) selectedIds.add(id);
  showSelection();
}

// Клік по тілу картки виділяє її так само, як клік по шапці, — разом із Shift.
function selectFrom(event, id) {
  if (event.shiftKey) toggleSelected(id);
  else select(id);
}

function beginNoteEdit(node, key = null) {
  if (!node || node.type !== "note" || node.locked) return false;
  setSelection([node.id]);
  editingNoteId = node.id;
  pendingNoteInput = key ? { id: node.id, key } : null;
  render();
  return true;
}

// Кнопка під ручкою перетягування: робить вибране жирним, а вже жирне —
// звичайним. Фокус їй віддавати не можна — втрата фокуса завершує редагування,
// тож натиск гасимо ще на pointerdown, а працюємо вже по кліку.
function boldButton(editor, updateCaret) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-bold";
  button.title = "Жирний";
  button.setAttribute("aria-label", "Зробити вибране жирним");
  button.append(iconElement("format_bold"));
  button.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const change = toggleBold(editor.value, editor.selectionStart, editor.selectionEnd);
    // Заміною, а не переписаним полем: так Ctrl+Z скасовує саме натиск кнопки.
    editor.setRangeText(change.text, change.start, change.end, "preserve");
    editor.setSelectionRange(change.selectionStart, change.selectionEnd);
    // Текст змінився не набором, тож події "input" не буде: кегль і каретку
    // доводиться перепитати самим.
    fitNote(editor);
    updateCaret();
  });
  return button;
}

// Нативна риска textarea має майже сталу піксельну ширину, тоді як текст
// нотатки масштабується разом із карткою. Дзеркало знаходить позицію вводу,
// а власна риска масштабує товщину разом із кеглем.
function attachNoteCaret(editor, noteElement) {
  const mirror = document.createElement("div");
  mirror.className = "note-caret-mirror";
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  const caret = document.createElement("span");
  caret.className = "note-caret";
  caret.hidden = true;
  noteElement.append(mirror, caret);

  const update = () => {
    const position = editor.selectionStart;
    const collapsed = position === editor.selectionEnd;
    caret.hidden = document.activeElement !== editor || !collapsed;
    if (caret.hidden) return;
    mirror.style.width = `${editor.clientWidth}px`;
    mirror.style.height = `${editor.clientHeight}px`;
    mirror.replaceChildren(document.createTextNode(editor.value.slice(0, position)), marker);
    const left = marker.offsetLeft - editor.scrollLeft;
    const top = marker.offsetTop - editor.scrollTop;
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight);
    caret.hidden = left < 0 || left > editor.clientWidth || top < 0 || top + lineHeight > editor.clientHeight;
    caret.style.left = `${left}px`;
    caret.style.top = `${top}px`;
    // Кегль нотатки підбирається під її розмір, тож висоту каретки беремо не
    // зі стилів, а з рядка, який вона показує.
    caret.style.height = `${lineHeight}px`;
  };

  for (const eventName of ["input", "select", "keyup", "click", "scroll", "focus", "blur"]) {
    editor.addEventListener(eventName, update);
  }
  requestAnimationFrame(update);
  return update;
}

function screenToWorld(clientX, clientY) {
  const bounds = viewport.getBoundingClientRect();
  return { x: (clientX - bounds.left - view.x) / view.scale, y: (clientY - bounds.top - view.y) / view.scale };
}

// Кожен крок історії тримає дві повні копії розкладки, тож без стелі пам'ять
// за довгу сесію росла б без кінця. Найстаріші кроки просто забуваються.
function pushUndo(command) {
  undoStack.push(command);
  if (undoStack.length > UNDO_LIMIT) undoStack.splice(0, undoStack.length - UNDO_LIMIT);
}

function executeCommand(label, mutate, metadata = {}) {
  const before = cloneLayout(layout);
  const beforeSelection = selectionIds();
  if (mutate() === false || layoutsEqual(before, layout)) return false;
  pushUndo({ label, before, after: cloneLayout(layout), beforeSelection, afterSelection: selectionIds(), ...metadata });
  redoStack = [];
  render();
  changed();
  return true;
}

function commitLiveCommand(label, before, beforeSelection, metadata = {}) {
  if (layoutsEqual(before, layout)) {
    render();
    return false;
  }
  pushUndo({ label, before, after: cloneLayout(layout), beforeSelection, afterSelection: selectionIds(), ...metadata });
  redoStack = [];
  render();
  changed();
  return true;
}

async function applyHistory(command, direction) {
  const target = cloneLayout(direction === "undo" ? command.before : command.after);
  for (const effect of command.noteLifecycles ?? []) {
    const shouldExist = effect.kind === "create" ? direction === "redo" : direction === "undo";
    if (shouldExist) {
      const restored = await storage.restoreNote(effect.reference, effect.text);
      notesByRef.set(restored.reference, restored);
    } else {
      const deleted = await storage.deleteNote(effect.reference);
      effect.text = deleted.text;
      notesByRef.delete(effect.reference);
    }
  }
  for (const noteMove of command.noteMoves ?? []) {
    const current = findNode(layout, noteMove.nodeId);
    const destination = direction === "undo" ? noteMove.beforeMap : noteMove.afterMap;
    if (!current || !destination) throw new Error("Не вдалося відновити контекст перенесеної нотатки");
    const previousReference = current.note;
    const moved = await storage.moveNote(previousReference, destination.slug, destination.name);
    notesByRef.delete(previousReference);
    notesByRef.set(moved.reference, moved);
    const targetNode = findNode(target, noteMove.nodeId);
    if (!targetNode) throw new Error("Не знайдено нотатку в історії команд");
    targetNode.note = moved.reference;
    const snapshot = direction === "undo" ? command.before : command.after;
    findNode(snapshot, noteMove.nodeId).note = moved.reference;
    updateNoteHistoryReference(noteMove.nodeId, moved.reference);
  }
  layout = adoptLayout(layout, target);
  setSelection(direction === "undo" ? command.beforeSelection : command.afterSelection);
}

function updateNoteHistoryReference(nodeId, reference) {
  for (const command of [...undoStack, ...redoStack]) {
    for (const effect of command.noteLifecycles ?? []) if (effect.nodeId === nodeId) effect.reference = reference;
    const beforeNode = findNode(command.before, nodeId);
    const afterNode = findNode(command.after, nodeId);
    if (beforeNode?.type === "note") beforeNode.note = reference;
    if (afterNode?.type === "note") afterNode.note = reference;
  }
}

async function undo() {
  if (historyBusy) return;
  commitHitPoints();
  const command = undoStack.pop();
  if (!command) return;
  historyBusy = true;
  try {
    await applyHistory(command, "undo");
    redoStack.push(command);
    render();
    changed();
  } catch (error) {
    undoStack.push(command);
    setStatus("Помилка undo", "error");
    showToast(error.message);
  } finally {
    historyBusy = false;
  }
}

async function redo() {
  if (historyBusy) return;
  commitHitPoints();
  const command = redoStack.pop();
  if (!command) return;
  historyBusy = true;
  try {
    await applyHistory(command, "redo");
    pushUndo(command);
    render();
    changed();
  } catch (error) {
    redoStack.push(command);
    setStatus("Помилка redo", "error");
    showToast(error.message);
  } finally {
    historyBusy = false;
  }
}

function addFrame() {
  if (!layout) return;
  const bounds = viewport.getBoundingClientRect();
  const center = screenToWorld(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  executeCommand("Створити рамку", () => {
    const width = 360;
    const height = 230;
    const node = {
      id: crypto.randomUUID(), type: "frame", title: `Нова рамка ${countNodes() + 1}`,
      x: (center.x - width / 2) / WORLD_SIZE * 100,
      y: (center.y - height / 2) / WORLD_SIZE * 100,
      width, height, locked: false, children: [],
    };
    enlargeForZoom(node, center, parentRect(layout, null));
    layout.children.push(node);
    setSelection([node.id]);
  });
}

function addScene(location, point) {
  if (!isLocationNode(location)) return;
  const rect = absoluteRect(layout, location.id, RENDERED);
  const area = parentRect(layout, location, RENDERED);
  const horizontalInset = Math.min(16, location.width * .1);
  const header = locationHeaderHeight(location.width, location.height);
  const verticalInset = Math.min(16, Math.max(0, location.height - header) * .1);
  const width = Math.max(MIN_NODE_SIZE, Math.min(SCENE_SIZE.width, location.width - horizontalInset * 2));
  const height = Math.max(MIN_NODE_SIZE, Math.min(SCENE_SIZE.height, location.height - header - verticalInset * 2));
  const wantedX = (point?.x ?? rect.x + rect.width / 2) - rect.x - width / 2;
  const wantedY = (point?.y ?? rect.y + rect.height / 2) - rect.y - height / 2;
  const left = clamp(wantedX, horizontalInset, Math.max(horizontalInset, location.width - width - horizontalInset));
  const top = clamp(wantedY, header + verticalInset, Math.max(header + verticalInset, location.height - height - verticalInset));
  const titles = new Set(location.children.filter((child) => child.type === "scene").map((child) => child.title));
  let number = 1;
  while (titles.has(`Сцена ${number}`)) number += 1;
  const sceneNode = {
    id: crypto.randomUUID(), type: "scene", title: `Сцена ${number}`,
    x: (rect.x + left - area.x) / area.width * 100,
    y: (rect.y + top - area.y) / area.height * 100,
    width, height, locked: false, children: [],
  };
  executeCommand("Додати сцену", () => {
    location.children.push(sceneNode);
    setSelection([sceneNode.id]);
  });
}

function renameNode(node) {
  if (!["scene", "music"].includes(node.type) || node.locked) return;
  const scene = node.type === "scene";
  renamingNodeId = node.id;
  renamingCreature = null;
  renameDialogTitle.textContent = scene ? "Назва сцени" : "Назва музики";
  renameDialogHint.textContent = scene
    ? "Назва відображатиметься в шапці сцени та списку шарів."
    : "Назва відображатиметься в шапці музичної картки та списку шарів.";
  sceneNameInput.placeholder = scene ? "Наприклад, Засідка біля брами" : "Наприклад, Тема таверни";
  sceneNameInput.value = scene ? node.title : musicTitle(node.title, node.url);
  sceneNameInput.setCustomValidity("");
  sceneRenameDialog.showModal();
  requestAnimationFrame(() => {
    sceneNameInput.focus();
    sceneNameInput.select();
  });
}

// Номер рядка лічильника під курсором; поза лічильником — null.
function creatureRowIndex(target) {
  const row = target?.closest?.(":is(.statblock-hp, .statblock-slots)");
  return row ? Number(row.dataset.creature) : null;
}

function addCreature(node) {
  const creatures = contextMenuCreatures(node);
  if (!creatures || node.locked) return;
  const maximum = maxHitPoints(nodeEntity(node).meta);
  forgetHitPointAmounts(node.id);
  // Свіже поповнення виходить у бій цілим.
  executeCommand("Додати істоту", () => writeCreatures(node, [...creatures, { name: "", hp: maximum }]));
}

// Остання істота не прибирається: без жодного рядка картку не було б куди
// рахувати.
function removeCreature(node, index) {
  const creatures = contextMenuCreatures(node);
  if (!creatures || creatures.length < 2 || !creatures[index] || node.locked) return;
  forgetHitPointAmounts(node.id);
  executeCommand("Прибрати істоту", () => writeCreatures(node, creatures.toSpliced(index, 1)));
}

function renameCreature(node, index) {
  const creatures = contextMenuCreatures(node);
  if (!creatures || creatures.length < 2 || !creatures[index]) return;
  renamingNodeId = null;
  renamingCreature = { nodeId: node.id, index };
  renameDialogTitle.textContent = "Назва істоти";
  renameDialogHint.textContent = "Назва відображатиметься в рядку лічильника HP цієї істоти.";
  sceneNameInput.placeholder = `Наприклад, ${creatureLabel(null, index)}`;
  sceneNameInput.value = creatureLabel(creatures[index], index);
  sceneNameInput.setCustomValidity("");
  sceneRenameDialog.showModal();
  requestAnimationFrame(() => {
    sceneNameInput.focus();
    sceneNameInput.select();
  });
}

function countNodes() {
  let count = 0;
  const visit = (children) => children.forEach((node) => { count += 1; visit(node.children); });
  visit(layout.children);
  return count;
}

function isMapNode(node) {
  return node?.type === "image" && node.image.startsWith(`${boardConfig?.media?.dir}/maps/`);
}

function mapDescriptor(node) {
  const fileName = node.image.split("/").at(-1);
  return { node, slug: mapSlugFromPath(node.image), name: fileName.replace(/\.[^.]+$/, "") };
}

function mapContext(tree, startId) {
  const map = nearestAncestor(tree, startId, isMapNode);
  return map ? mapDescriptor(map) : null;
}

function noteMapContext(tree, noteId) {
  const entry = findEntry(tree, noteId);
  return mapContext(tree, entry?.parent?.id ?? null);
}

async function createNoteAt(point) {
  const parent = deepestNodeAt(layout, point, { includeLocked: true, ...RENDERED });
  const map = mapContext(layout, parent?.id ?? null);
  if (!map) return showToast("Нотатку можна створити лише всередині карти");
  setStatus("Створення нотатки…", "dirty");
  try {
    const note = await storage.createNote(map.slug, map.name, "");
    notesByRef.set(note.reference, note);
    const rect = parentRect(layout, parent, RENDERED);
    const id = crypto.randomUUID();
    executeCommand("Створити нотатку", () => {
      const node = {
        id, type: "note", note: note.reference,
        x: (point.x - rect.x) / rect.width * 100,
        y: (point.y - rect.y) / rect.height * 100,
        width: 320, height: 190, locked: false, children: [],
      };
      centeredAt(node, rect);
      enlargeForZoom(node, point, rect);
      (parent ? parent.children : layout.children).push(node);
      setSelection([id]);
      editingNoteId = id;
      newNoteIds.add(id);
    }, { noteLifecycles: [{ kind: "create", nodeId: id, reference: note.reference, text: note.text }] });
  } catch (error) {
    setStatus("Помилка створення нотатки", "error");
    showToast(error.message);
  }
}

async function finishNoteEdit(node, text) {
  editingNoteId = null;
  setStatus("Збереження нотатки…", "dirty");
  try {
    const note = await storage.updateNote(node.note, text);
    notesByRef.set(note.reference, note);
    newNoteIds.delete(node.id);
    render();
    setStatus("Збережено");
  } catch (error) {
    render();
    setStatus("Помилка збереження нотатки", "error");
    showToast(error.message);
  }
}

function defaultInsertPoint() {
  const bounds = viewport.getBoundingClientRect();
  return screenToWorld(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
}

// Свіжа картка на віддаленій карті світу завбільшки кілька пікселів: 320
// одиниць там — ніщо. Тож на віддаленні вона росте разом із вмістом навколо
// точки вставки, аж поки на екрані не стане свого звичайного розміру. Більшою
// за половину батька не стає, а на наближенні лишається як є. Вставлена копія
// зберігає розмір оригіналу — її це не стосується.
function enlargeForZoom(node, point, area) {
  const roomy = Math.min(area.width / node.width, area.height / node.height) / 2;
  const factor = Math.max(1, Math.min(1 / view.scale, roomy));
  if (!Number.isFinite(factor) || factor === 1) return node;
  const left = area.x + node.x * area.width / 100;
  const top = area.y + node.y * area.height / 100;
  node.x = (point.x + (left - point.x) * factor - area.x) / area.width * 100;
  node.y = (point.y + (top - point.y) * factor - area.y) / area.height * 100;
  scaleSizes(node, factor);
  return node;
}

// Картка лягає серединою під курсор — так само, як токен і вставлена копія.
function centeredAt(node, area) {
  node.x -= node.width / 2 / area.width * 100;
  node.y -= node.height / 2 / area.height * 100;
  return node;
}

function scaleSizes(node, factor) {
  node.width *= factor;
  node.height *= factor;
  node.children.forEach((child) => scaleSizes(child, factor));
}

function openEntityPicker(type = null, { token = false } = {}) {
  if (!layout) return;
  insertPoint ??= defaultInsertPoint();
  // Токен шукає і в бестіарії, і серед гравців.
  pickerTypes = token ? new Set(TOKEN_ENTITY_TYPES) : type ? new Set([type]) : null;
  pickerMakesToken = token;
  pickerSelection = 0;
  pickerTitle.textContent = token ? "Токен істоти чи гравця" : ENTITY_KINDS[type]?.pickerTitle ?? "Картка з репозиторію";
  entitySearch.placeholder = token ? "Назва або slug істоти чи гравця…" : ENTITY_KINDS[type]?.searchPlaceholder ?? "Назва, slug або тип…";
  entitySearch.value = "";
  renderEntityResults();
  entityPicker.showModal();
  requestAnimationFrame(() => entitySearch.focus());
}

// Спільний список «Картка» показує лише те, під що немає власної кнопки:
// локації, NPC та істот ДМ бере кнопками «Локація», «NPC» і «Статблок».
function filteredEntities() {
  return entities
    .filter((entity) => (pickerTypes ? pickerTypes.has(entity.type) : !ENTITY_KINDS[entity.type]) && matchesEntity(entity, entitySearch.value))
    .slice(0, 100);
}

function renderEntityResults() {
  const matches = filteredEntities();
  pickerSelection = clamp(pickerSelection, 0, Math.max(0, matches.length - 1));
  if (!matches.length) {
    entityResults.innerHTML = '<div class="entity-picker-empty">Нічого не знайдено</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  matches.forEach((entity, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `entity-result${index === pickerSelection ? " active" : ""}`;
    if (entity.portrait) {
      const image = document.createElement("img");
      image.alt = "";
      showMedia(image, entity.portrait);
      button.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "entity-result-placeholder";
      placeholder.textContent = entity.name.slice(0, 1).toLocaleUpperCase("uk");
      button.append(placeholder);
    }
    const label = document.createElement("span");
    const name = document.createElement("strong");
    const slug = document.createElement("small");
    name.textContent = entity.name;
    slug.textContent = entity.slug;
    label.append(name, slug);
    const type = document.createElement("em");
    type.textContent = entity.type;
    button.append(label, type);
    button.addEventListener("mouseenter", () => {
      pickerSelection = index;
      entityResults.querySelectorAll(".entity-result").forEach((row, rowIndex) => row.classList.toggle("active", rowIndex === index));
    });
    button.addEventListener("click", () => addEntity(entity));
    fragment.append(button);
  });
  entityResults.replaceChildren(fragment);
  entityResults.querySelector(".active")?.scrollIntoView({ block: "nearest" });
}

function entityNode(entity, left, top, rect, size = entityKind(entity)?.size ?? ENTITY_CARD_TYPES[entity?.type]?.size ?? ENTITY_CARD) {
  const node = {
    id: crypto.randomUUID(), type: "entity", entity: entity.slug,
    x: (left - rect.x) / rect.width * 100,
    y: (top - rect.y) / rect.height * 100,
    width: size.width, height: size.height, locked: false, children: [],
  };
  // Свіжа істота виходить на полотно цілою.
  const maximum = entityKind(entity)?.variant === "statblock" ? maxHitPoints(entity.meta) : null;
  if (maximum) node.hp = maximum;
  return node;
}

// Список карток усередині бере сама локація — рядки «- NPC:» і «- Предмети:»
// у її секції звʼязків, у цьому порядку. Посилання на неіндексовані типи
// (наприклад players/) на полотно не кладемо, але про них повідомляємо.
function containerNode(entity, kind, point, rect) {
  // Мітки рядків («NPC», «Предмети») задає кампанія: entities.locationMembers.
  const slugs = [...new Set(boardConfig.entities.locationMembers.flatMap((label) => entity.links[label] ?? []))];
  const members = slugs.map((slug) => entitiesBySlug.get(slug)).filter(Boolean);
  const missing = slugs.filter((slug) => !entitiesBySlug.has(slug));
  if (missing.length) showToast(`Немає в індексі карток: ${missing.join(", ")}`);
  // NPC і предмети мають однаковий розмір картки, тож сітка одна.
  const grid = containerGrid(members.length, {
    cell: NPC_CARD,
    gap: CONTAINER_GAP,
    padding: CONTAINER_PADDING,
    minimum: FRAME_SIZE,
    header: locationHeaderHeight,
  });
  const node = entityNode(entity, point.x - grid.width / 2, point.y - grid.height / 2, rect, grid);
  const inside = { x: 0, y: 0, width: grid.width, height: grid.height };
  node.children = members.map((member, index) => entityNode(member, grid.cells[index].x, grid.cells[index].y, inside));
  return node;
}

function addEntity(entity) {
  if (pickerMakesToken) return addToken(entity);
  const point = insertPoint ?? defaultInsertPoint();
  const { parent, rect } = nearestPointParent(layout, point, RENDERED);
  const kind = entityKind(entity);
  const node = kind?.variant === "frame" ? containerNode(entity, kind, point, rect) : centeredAt(entityNode(entity, point.x, point.y, rect), rect);
  enlargeForZoom(node, point, rect);
  executeCommand(kind?.command ?? "Додати картку", () => {
    (parent ? parent.children : layout.children).push(node);
    setSelection([node.id]);
  });
  entityPicker.close();
}

// Токен стає центром під курсор: це фішка, яку ставлять на клітинку карти.
// Розмір — завжди з еталонної клітинки дошки, від зуму не залежить.
function addToken(entity) {
  const point = insertPoint ?? defaultInsertPoint();
  const { parent, rect } = nearestPointParent(layout, point, RENDERED);
  const side = tokenSide(entity, boardConfig.grid.cell);
  const node = {
    id: crypto.randomUUID(), type: "token", entity: entity.slug,
    x: (point.x - side / 2 - rect.x) / rect.width * 100,
    y: (point.y - side / 2 - rect.y) / rect.height * 100,
    width: side, height: side, locked: false, children: [],
  };
  writeTokenColor(node, initialTokenColor(entity));
  executeCommand("Додати токен", () => {
    (parent ? parent.children : layout.children).push(node);
    snapToParent(node);
    setSelection([node.id]);
  });
  entityPicker.close();
}

function setTokenColor(node, color) {
  if (node?.type !== "token" || node.locked || tokenColor(node) === color) return;
  executeCommand("Змінити колір токена", () => writeTokenColor(node, color));
}

function setMusicHint(text) {
  musicHint.textContent = text;
}

function openMusicDialog() {
  if (!layout) return;
  insertPoint ??= defaultInsertPoint();
  clearTimeout(musicLookupTimer);
  musicLookup += 1;
  musicTitleEdited = false;
  musicUrlInput.value = "";
  musicTitleInput.value = "";
  musicStartInput.value = "";
  setMusicHint("Встав лінк на ролік — назву канва спитає в ютуба.");
  musicDialog.showModal();
  requestAnimationFrame(() => musicUrlInput.focus());
}

// Назву питаємо в ютуба (oEmbed) один раз — на додаванні. Далі вона лежить
// у розкладці, тож картка малюється й без мережі.
async function lookupMusicTitle(url) {
  const request = ++musicLookup;
  setMusicHint("Питаю назву в ютуба…");
  try {
    const response = await fetch(oEmbedUrl(url), { cache: "no-store" });
    if (!response.ok) throw new Error(`ютуб відповів ${response.status}`);
    const { title } = await response.json();
    if (request !== musicLookup) return;
    if (!musicTitleEdited) musicTitleInput.value = musicTitle(title, url);
    setMusicHint("Назва з ютуба — її можна замінити своєю.");
  } catch (error) {
    if (request !== musicLookup) return;
    setMusicHint(`Не вдалося взяти назву з ютуба (${error.message}). Впиши її вручну.`);
  }
}

function onMusicUrlInput() {
  clearTimeout(musicLookupTimer);
  musicLookup += 1;
  const url = canonicalYouTubeUrl(musicUrlInput.value);
  if (!url) {
    setMusicHint(musicUrlInput.value.trim() ? "Це не схоже на лінк ютуба." : "Встав лінк на ролік — назву канва спитає в ютуба.");
    return;
  }
  musicLookupTimer = setTimeout(() => lookupMusicTitle(url), MUSIC_LOOKUP_DELAY);
}

function addMusic() {
  const url = canonicalYouTubeUrl(musicUrlInput.value);
  if (!url) {
    setMusicHint("Потрібен лінк на ролік ютуба.");
    musicUrlInput.focus();
    return;
  }
  const start = parseMusicStart(musicStartInput.value);
  if (start === null) {
    setMusicHint("Старт — ціле число секунд від 0, або лиши поле порожнім.");
    musicStartInput.focus();
    return;
  }
  clearTimeout(musicLookupTimer);
  musicLookup += 1;
  const point = insertPoint ?? defaultInsertPoint();
  const { parent, rect } = nearestPointParent(layout, point, RENDERED);
  const node = {
    id: crypto.randomUUID(), type: "music", url, title: musicTitle(musicTitleInput.value, url),
    x: (point.x - rect.x) / rect.width * 100,
    y: (point.y - rect.y) / rect.height * 100,
    width: MUSIC_CARD.width, height: MUSIC_CARD.height, locked: false, children: [],
    ...(start ? { start } : {}),
  };
  centeredAt(node, rect);
  enlargeForZoom(node, point, rect);
  executeCommand("Додати музику", () => {
    (parent ? parent.children : layout.children).push(node);
    setSelection([node.id]);
  });
  musicDialog.close();
}

// Попап «i» ходить за [[посиланнями]], як браузер: кнопка «назад» повертає до
// картки, з якої прийшли. Відкриття з полотна починає шлях заново.
let detailsTrail = [];
let detailsDocument = null;
let linkPreviewTimer = null;
const linkPreview = document.createElement("div");
linkPreview.className = "link-preview";
linkPreview.hidden = true;
entityDetails.append(linkPreview);

const BACKLINK_GROUPS = [
  ["npc", "NPC"], ["player", "Гравці"], ["location", "Локації"], ["faction", "Фракції"], ["item", "Предмети"],
  ["encounter", "Сутички"], ["creature", "Статблоки"], ["world", "Світ"], ["session", "Сесії"], ["note", "Нотатки дошки"],
];
const BACKLINK_LINES = 3;

function linkedDocument(slug) {
  return entitiesBySlug.get(slug) ?? referencesBySlug.get(slug) ?? null;
}

function resetDetailsTrail() {
  detailsTrail = [];
  detailsDocument = null;
  hideLinkPreview();
}

// Посилання, яке є куди відкрити, стає живим; на саму картку — лише
// підсвіченим; на неіснуючу — приглушеним.
function markDetailsLinks(root, selfSlug = null) {
  for (const link of root.querySelectorAll(".md-link[data-slug]")) {
    const slug = link.dataset.slug;
    if (slug === selfSlug) link.classList.add("md-link-self");
    else if (linkedDocument(slug)) {
      link.classList.add("md-link-live");
      link.tabIndex = 0;
      link.setAttribute("role", "link");
    } else {
      link.classList.add("md-link-missing");
      link.title = `[[${slug}]] — такої картки в кампанії немає`;
    }
  }
}

function followDetailsLink(target) {
  if (!target) return;
  showEntityDetails(target, { trail: detailsDocument ? [...detailsTrail, detailsDocument] : [] });
}

function detailsBack() {
  const previous = detailsTrail.at(-1);
  if (previous) showEntityDetails(previous, { trail: detailsTrail.slice(0, -1) });
}

function noteDocuments() {
  return [...notesByRef.values()].map((note) => ({
    slug: null,
    type: "note",
    name: note.text.split("\n").find((line) => line.trim())?.replace(/^[#>\-*\s]+/, "").slice(0, 60) || "Нотатка",
    body: note.text,
    reference: note.reference,
  }));
}

function openNoteOnBoard(reference) {
  const node = collectNodes(layout.children, (candidate) => candidate.type === "note" && candidate.note === reference)[0];
  if (!node) return;
  entityDetails.close();
  centerNode(node.id);
  showSelection();
}

function backlinksSection(entity) {
  const found = backlinks(entity.slug, [...entities, ...referencesBySlug.values(), ...noteDocuments()]);
  const section = document.createElement("section");
  section.className = "entity-backlinks";
  const heading = document.createElement("h2");
  heading.textContent = "Згадують";
  const count = document.createElement("span");
  count.className = "entity-backlinks-count";
  count.textContent = String(found.length);
  heading.append(count);
  section.append(heading);
  if (!found.length) {
    const empty = document.createElement("p");
    empty.className = "entity-backlinks-empty";
    empty.textContent = "Жодна картка, сесія чи нотатка на неї не посилається.";
    section.append(empty);
    return section;
  }
  const known = new Map(BACKLINK_GROUPS);
  const order = (type) => (known.has(type) ? BACKLINK_GROUPS.findIndex(([key]) => key === type) : BACKLINK_GROUPS.length);
  const types = [...new Set(found.map((entry) => entry.document.type))]
    .sort((first, second) => order(first) - order(second) || first.localeCompare(second));
  for (const type of types) {
    const group = document.createElement("h3");
    group.textContent = known.get(type) ?? type;
    const list = document.createElement("ul");
    for (const { document: source, lines } of found.filter((entry) => entry.document.type === type)) {
      const item = document.createElement("li");
      const name = document.createElement("button");
      name.type = "button";
      name.className = "entity-backlink-name";
      name.textContent = source.name;
      name.title = source.type === "note" ? "Показати нотатку на дошці" : source.path;
      name.addEventListener("click", () => (source.type === "note" ? openNoteOnBoard(source.reference) : followDetailsLink(source)));
      item.append(name);
      for (const line of lines.slice(0, BACKLINK_LINES)) {
        const context = document.createElement("div");
        context.className = "entity-backlink-line";
        context.innerHTML = renderInline(line);
        item.append(context);
      }
      if (lines.length > BACKLINK_LINES) {
        const more = document.createElement("div");
        more.className = "entity-backlink-more";
        more.textContent = `і ще ${lines.length - BACKLINK_LINES}`;
        item.append(more);
      }
      list.append(item);
    }
    section.append(group, list);
  }
  return section;
}

// Превʼю картки під посиланням: портрет, назва й «На дошці» (для статблока —
// AC, HP і CR), а без такої секції — початок тексту.
function previewExcerpt(body) {
  return body.split("\n")
    .filter((line) => line.trim() && !/^\s*#{1,6}\s/.test(line) && !/^\s*!\[/.test(line))
    .slice(0, 6).join("\n");
}

function showLinkPreview(link) {
  const target = linkedDocument(link.dataset.slug);
  if (!target || !link.isConnected) return;
  linkPreview.replaceChildren();
  if (target.portrait) {
    const image = document.createElement("img");
    image.className = "link-preview-portrait";
    image.alt = "";
    setDirectImageSource(image, target.portrait);
    linkPreview.append(image);
  }
  const title = document.createElement("div");
  title.className = "link-preview-title";
  title.textContent = target.name;
  const meta = document.createElement("div");
  meta.className = "entity-details-meta";
  meta.textContent = target.type === "creature"
    ? `${target.type} · AC ${target.meta?.ac ?? "—"} · HP ${target.meta?.hp ?? "—"} · CR ${target.meta?.cr ?? "—"}`
    : target.type;
  const text = document.createElement("div");
  text.className = "entity-details-markdown link-preview-text";
  text.innerHTML = renderMarkdown(target.summary || previewExcerpt(target.body));
  linkPreview.append(title, meta, text);
  linkPreview.hidden = false;
  const anchor = link.getBoundingClientRect();
  const size = linkPreview.getBoundingClientRect();
  const margin = 12;
  const below = anchor.bottom + 8;
  const top = below + size.height <= window.innerHeight - margin ? below : anchor.top - size.height - 8;
  linkPreview.style.left = `${clamp(anchor.left, margin, window.innerWidth - size.width - margin)}px`;
  linkPreview.style.top = `${clamp(top, margin, window.innerHeight - size.height - margin)}px`;
}

function hideLinkPreview() {
  clearTimeout(linkPreviewTimer);
  linkPreviewTimer = null;
  linkPreview.hidden = true;
}

function showEntityDetails(entity, { trail = [] } = {}) {
  hideLinkPreview();
  detailsTrail = trail;
  detailsDocument = entity;
  entityDetailsContent.replaceChildren();
  const previous = trail.at(-1);
  if (previous) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "entity-details-back";
    back.title = "Назад (Alt+←)";
    back.append(iconElement("chevron_left"), document.createTextNode(previous.name));
    back.addEventListener("click", detailsBack);
    entityDetailsContent.append(back);
  }
  if (entity.portrait) {
    const image = document.createElement("img");
    image.className = "entity-details-portrait";
    image.alt = "";
    setDirectImageSource(image, entity.portrait);
    entityDetailsContent.append(image);
  }
  const title = document.createElement("h1");
  title.textContent = entity.name;
  const meta = document.createElement("div");
  meta.className = "entity-details-meta";
  meta.textContent = entity.type;
  const path = document.createElement("div");
  path.className = "entity-details-path";
  path.textContent = entity.path;
  const body = document.createElement("div");
  body.className = "entity-details-markdown";
  body.innerHTML = renderMarkdown(entity.body);
  entityDetailsContent.append(title, meta, path, body, backlinksSection(entity));
  markDetailsLinks(entityDetailsContent, entity.slug);
  if (!entityDetails.open) entityDetails.showModal();
  entityDetailsContent.parentElement.scrollTop = 0;
}

// Панель «Партія»: живі листи з D&D Beyond через посередника з конфігу.
// Опитування йде лише поки панель відкрита, а вкладка видима.
function setupParty() {
  stopParty();
  const config = boardConfig?.party;
  togglePartyButton.hidden = !config?.proxy;
  if (config?.proxy) {
    partyMonitor = createPartyMonitor({
      proxy: config.proxy,
      interval: config.interval,
      members: partyMembers(entities, config.idField),
      onChange: renderParty,
    });
  }
  setPartyOpen(Boolean(partyMonitor) && readStorage(PARTY_KEY) === "true", false);
}

function stopParty() {
  partyMonitor?.stop();
  partyMonitor = null;
  clearTimeout(partyRenderTimer);
  clearInterval(partyAgeTimer);
  partyRenderTimer = null;
  partyAgeTimer = null;
  partyList.replaceChildren();
  partyAge.textContent = "";
  partyGold.textContent = "";
}

function syncPartyPolling() {
  if (!partyMonitor) return;
  const active = partyOpen && document.visibilityState !== "hidden";
  if (active && !partyMonitor.running) {
    partyMonitor.start().catch((error) => showToast(error.message));
    clearInterval(partyAgeTimer);
    partyAgeTimer = setInterval(() => renderPartyAge(), 5000);
  } else if (!active && partyMonitor.running) {
    partyMonitor.stop();
    clearInterval(partyAgeTimer);
    partyAgeTimer = null;
  }
}

function renderPartyAge(now = Date.now()) {
  if (!partyMonitor) return;
  const times = [...partyMonitor.entries.values()].map((entry) => entry.fetchedAt).filter((time) => time !== null);
  partyAge.textContent = times.length ? ageLabel(Math.max(...times), now) : "";
}

function renderParty() {
  if (!partyMonitor) return;
  const now = Date.now();
  const { members, entries } = partyMonitor;
  if (members.length) {
    partyList.innerHTML = members.map((member) => partyCardMarkup(member, entries.get(member.slug), now)).join("");
  } else {
    const hint = document.createElement("div");
    hint.className = "layer-empty";
    hint.textContent = `Немає гравців з полем «${boardConfig.party.idField}» у фронтматері картки.`;
    partyList.replaceChildren(hint);
  }
  renderPartyAge(now);
  partyGold.textContent = partyGoldLabel(entries.values());
  const openSlug = entityDetails.open ? entityDetailsContent.querySelector(".party-details")?.dataset.slug : null;
  const openMember = members.find((member) => member.slug === openSlug);
  if (openMember) entityDetailsContent.innerHTML = partyDetailsMarkup(openMember, entries.get(openMember.slug), now);
  // Підсвічений шматок смуги HP згасає сам, але вузол треба прибрати.
  clearTimeout(partyRenderTimer);
  partyRenderTimer = null;
  const until = Math.min(...[...entries.values()].map((entry) => entry.ghost?.until ?? Infinity));
  if (Number.isFinite(until)) partyRenderTimer = setTimeout(renderParty, Math.max(0, until - now) + 50);
}

function showPartyDetails(slug) {
  const member = partyMonitor?.members.find((entry) => entry.slug === slug);
  if (!member) return;
  resetDetailsTrail();
  entityDetailsContent.innerHTML = partyDetailsMarkup(member, partyMonitor.entries.get(slug), Date.now());
  if (!entityDetails.open) entityDetails.showModal();
  entityDetailsContent.parentElement.scrollTop = 0;
}

function showImageDetails(node) {
  resetDetailsTrail();
  entityDetailsContent.replaceChildren();
  const image = document.createElement("img");
  image.className = "entity-details-portrait";
  image.alt = nodeLabel(node);
  setDirectImageSource(image, node.image);
  const title = document.createElement("h1");
  title.textContent = nodeLabel(node).replace(/\.[^.]+$/, "");
  const meta = document.createElement("div");
  meta.className = "entity-details-meta";
  meta.textContent = isBattleMap(node) ? "Бойова карта" : isMapNode(node) ? "Карта" : "Ілюстрація";
  const path = document.createElement("div");
  path.className = "entity-details-path";
  path.textContent = node.image;
  const facts = document.createElement("dl");
  facts.className = "image-details-facts";
  const addFact = (term, value) => {
    const key = document.createElement("dt");
    const description = document.createElement("dd");
    key.textContent = term;
    description.textContent = value;
    facts.append(key, description);
    return description;
  };
  const sourceSize = addFact("Роздільність", "Завантаження…");
  if (isBattleMap(node)) {
    addFact("Сітка", `${node.grid.columns} × ${node.grid.rows} клітинок`);
    addFact("Прилипання токенів", node.snap === false ? "Вимкнене" : "Увімкнене");
  }
  addFact("Розмір на полотні", `${Math.round(node.width)} × ${Math.round(node.height)} px`);
  addFact("Стан", node.locked ? "Заблоковано" : "Розблоковано");
  image.addEventListener("load", () => { sourceSize.textContent = `${image.naturalWidth} × ${image.naturalHeight} px`; }, { once: true });
  image.addEventListener("error", () => { sourceSize.textContent = "Не вдалося визначити"; }, { once: true });
  entityDetailsContent.append(image, title, meta, path, facts);
  if (!entityDetails.open) entityDetails.showModal();
  entityDetailsContent.parentElement.scrollTop = 0;
}

function showNoteDetails(node) {
  const note = notesByRef.get(node.note);
  resetDetailsTrail();
  entityDetailsContent.replaceChildren();
  const title = document.createElement("h1");
  title.textContent = nodeLabel(node);
  const meta = document.createElement("div");
  meta.className = "entity-details-meta";
  meta.textContent = "Нотатка";
  const path = document.createElement("div");
  path.className = "entity-details-path";
  path.textContent = node.note;
  const body = document.createElement("div");
  body.className = "entity-details-markdown";
  body.innerHTML = note ? renderMarkdown(note.text) : "<p>Текст нотатки не знайдено.</p>";
  entityDetailsContent.append(title, meta, path, body);
  markDetailsLinks(body);
  if (!entityDetails.open) entityDetails.showModal();
  entityDetailsContent.parentElement.scrollTop = 0;
}

function showMusicDetails(node) {
  resetDetailsTrail();
  entityDetailsContent.replaceChildren();
  const title = document.createElement("h1");
  title.textContent = nodeLabel(node);
  const meta = document.createElement("div");
  meta.className = "entity-details-meta";
  meta.textContent = "Музика · YouTube";
  const path = document.createElement("div");
  path.className = "entity-details-path";
  path.textContent = node.url;
  const body = document.createElement("div");
  body.className = "entity-details-markdown";
  const link = document.createElement("a");
  link.href = playbackUrl(node.url, node.start) ?? node.url;
  link.target = "_blank";
  link.textContent = `${musicStartLabel(node)} — відкрити трек`;
  body.append(link);
  entityDetailsContent.append(title, meta, path, body);
  if (!entityDetails.open) entityDetails.showModal();
  entityDetailsContent.parentElement.scrollTop = 0;
}

function closeContextMenu() {
  nodeContextMenu.hidden = true;
  contextMenuNodeId = null;
  contextMenuPoint = null;
  contextMenuCreature = null;
}

// Команди над істотою стосуються того рядка лічильника, по якому клацнули:
// без рядка перейменовувати й прибирати нема кого.
function contextMenuCreatures(node) {
  const maximum = nodeVariant(node) === "statblock" ? maxHitPoints(nodeEntity(node)?.meta) : null;
  return maximum ? creatureList(node) : null;
}

// Без портрета на місці схованого опису лишилась би порожня картка.
function canToggleSummary(node) {
  if (node?.type === "note") return true;
  return Boolean(node) && nodeVariant(node) === "npc" && Boolean(nodeEntity(node)?.portrait);
}

// Нотатка ховає текст під розмиття, як спойлер; NPC — опис.
function summaryToggleFlag(node) {
  return node.type === "note" ? "hideText" : "hideSummary";
}

function summaryToggleLabel(node) {
  const hidden = node[summaryToggleFlag(node)] === true;
  return `${hidden ? "Показати" : "Сховати"} ${node.type === "note" ? "текст" : "опис"}`;
}

// Схований опис NPC віддає портрету всю картку, схований текст нотатки
// розмивається. Показаний — стан за замовчуванням, тож прапорець у вузлі живе
// лише поки щось сховано.
function toggleSummary(node) {
  if (!canToggleSummary(node)) return;
  const flag = summaryToggleFlag(node);
  const hiding = node[flag] !== true;
  executeCommand(summaryToggleLabel(node), () => {
    if (hiding) node[flag] = true;
    else delete node[flag];
  });
}

function shortcutHint(keys) {
  const hint = document.createElement("kbd");
  hint.textContent = keys;
  return hint;
}

function contextMenuItem(action) {
  return nodeContextMenu.querySelector(`[data-context-action="${action}"]`);
}

// Розділювач має сенс лише між двома видимими командами: на порожньому
// полотні від меню лишається сама «Вставити».
function trimContextMenuRules() {
  let visibleAbove = false;
  let rule = null;
  for (const item of nodeContextMenu.children) {
    if (item.tagName === "HR") { item.hidden = true; rule = item; continue; }
    if (item.hidden) continue;
    if (visibleAbove && rule) rule.hidden = false;
    visibleAbove = true;
    rule = null;
  }
}

// Без вузла (клік по порожньому полотну чи по рамці) меню зводиться до
// вставки: решта команд нема до чого застосувати.
function openContextMenu(node, clientX, clientY) {
  contextMenuNodeId = node?.id ?? null;
  contextMenuPoint = { clientX, clientY, world: screenToWorld(clientX, clientY) };
  for (const action of ["copy", "lock", "delete"]) contextMenuItem(action).hidden = !node;
  contextMenuItem("copy-image").hidden = !imageCopyKind(node);
  contextMenuItem("add-scene").hidden = !isLocationNode(node);
  contextMenuItem("rename").hidden = !["scene", "music"].includes(node?.type);
  for (const action of ["rotate-right", "rotate-left"]) contextMenuItem(action).hidden = node?.type !== "image";
  for (const action of ["toggle-snap", "fit-battle-map"]) contextMenuItem(action).hidden = !isBattleMap(node);
  if (isBattleMap(node)) {
    const snapToggle = contextMenuItem("toggle-snap");
    snapToggle.querySelector(".context-menu-icon").replaceChildren(iconElement(node.snap === false ? "grid_on" : "crop_square"));
    snapToggle.querySelector(".context-menu-label").textContent = node.snap === false ? "Увімкнути прилипання до клітинок" : "Вимкнути прилипання до клітинок";
  }
  contextMenuItem("details").hidden = !node || node.type === "scene";
  const summaryToggle = contextMenuItem("toggle-summary");
  summaryToggle.hidden = !canToggleSummary(node);
  if (!summaryToggle.hidden) {
    summaryToggle.querySelector(".context-menu-icon").replaceChildren(iconElement(node[summaryToggleFlag(node)] ? "visibility" : "visibility_off"));
    summaryToggle.querySelector(".context-menu-label").textContent = summaryToggleLabel(node);
  }
  const creatures = node ? contextMenuCreatures(node) : null;
  const creature = creatures?.length > 1 && creatures[contextMenuCreature] ? contextMenuCreature : null;
  contextMenuItem("add-creature").hidden = !creatures;
  tokenColorsMenu.hidden = node?.type !== "token";
  if (!tokenColorsMenu.hidden) {
    const current = tokenColor(node);
    for (const swatch of tokenColorsMenu.children) {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.color === current));
      swatch.disabled = node.locked;
    }
  }
  for (const action of ["rename-creature", "remove-creature"]) {
    const item = contextMenuItem(action);
    item.hidden = creature === null;
    if (creature === null) continue;
    const name = creatureLabel(creatures[creature], creature);
    const verb = action === "rename-creature" ? "Перейменувати" : "Прибрати";
    item.querySelector(".context-menu-label").textContent = `${verb}: ${name}`;
  }
  if (node) {
    const lockButton = contextMenuItem("lock");
    lockButton.querySelector(".context-menu-icon").replaceChildren(iconElement(node.locked ? "lock_open" : "lock_filled"));
    lockButton.querySelector(".context-menu-label").replaceChildren(node.locked ? "Розблокувати" : "Заблокувати", shortcutHint("Ctrl+L"));
    contextMenuItem("details").disabled = ["entity", "token"].includes(node.type) && !linkedEntity(node);
    for (const action of ["add-scene", "toggle-summary", "rename-creature"]) {
      const button = contextMenuItem(action);
      button.disabled = false;
      button.title = "";
    }
    for (const action of ["rename", "rotate-right", "rotate-left", "toggle-snap", "fit-battle-map", "add-creature", "remove-creature"]) {
      const button = contextMenuItem(action);
      button.disabled = node.locked;
      button.title = node.locked ? "Спочатку розблокуйте елемент" : "";
    }
    const deleteButton = contextMenuItem("delete");
    deleteButton.disabled = node.locked;
    deleteButton.title = node.locked ? "Спочатку розблокуйте елемент" : "";
  }
  trimContextMenuRules();
  nodeContextMenu.hidden = false;
  nodeContextMenu.style.left = `${clientX}px`;
  nodeContextMenu.style.top = `${clientY}px`;
  const bounds = nodeContextMenu.getBoundingClientRect();
  nodeContextMenu.style.left = `${clamp(clientX, 8, innerWidth - bounds.width - 8)}px`;
  nodeContextMenu.style.top = `${clamp(clientY, 8, innerHeight - bounds.height - 8)}px`;
}

// «Як картинку» копіюється те, що справді є картинкою: зображення з полотна,
// портрет NPC без рамки картки і предмет — цілою карткою, як його видно.
function imageCopyKind(node) {
  if (node?.type === "image") return node.image ? "image" : null;
  if (node?.type !== "entity") return null;
  const entity = nodeEntity(node);
  if (!entity) return null;
  if (nodeVariant(node) === "npc") return entity.portrait ? "portrait" : null;
  return entity.type === "item" && nodeVariant(node) === "entity" ? "card" : null;
}

function copyAsImage(node) {
  const kind = imageCopyKind(node);
  if (!kind) return;
  const png = kind === "card" ? cardPng(node)
    : storage.mediaUrl(kind === "image" ? node.image : nodeEntity(node).portrait, false).then(urlToPng);
  writeImageToClipboard(png).then(
    () => showToast(kind === "portrait" ? "Портрет скопійовано" : "Картинку скопійовано"),
    (error) => { console.warn(error); showToast(`Не вдалося скопіювати картинку: ${error.message}`); },
  );
}

// Кнопка «i», замок і маркери розміру — керування дошкою, а не частина картки.
function cardPng(node) {
  const element = nodeElement(node.id);
  if (!element) return Promise.reject(new Error("картки не видно на полотні"));
  return elementToPng(element, {
    width: node.width, height: node.height,
    strip: [".node", ".resize-handle", ".node-details", ".node-lock-indicator"],
    imageSource: (image) => image.dataset.mediaPath ? storage.mediaUrl(image.dataset.mediaPath, false) : null,
  });
}

function showNodeDetails(node) {
  if (node.type === "image") showImageDetails(node);
  else if (node.type === "note") showNoteDetails(node);
  else if (node.type === "music") showMusicDetails(node);
  else {
    const entity = linkedEntity(node);
    if (entity) showEntityDetails(entity);
  }
}

function onNodePointerDown(event) {
  if (event.button !== 0) return;
  event.stopPropagation();
  commitHitPoints();
  const node = findNode(layout, event.currentTarget.dataset.id);
  if (!node || node.locked) return;
  if (event.shiftKey) return toggleSelected(node.id);
  if (!isSelected(node.id)) select(node.id);
  if (beginMove(event)) viewport.setPointerCapture(event.pointerId);
}

// Їде все виділення разом, тож кожен вузол памʼятає власний старт і розміри
// свого батька: зсув у світових пікселях спільний, а у відсотки він
// переводиться по-різному на кожному рівні вкладеності.
function beginMove(event) {
  const movers = selectedRoots().filter((node) => !node.locked).map((node) => {
    const entry = findEntry(layout, node.id);
    const { width: parentWidth, height: parentHeight } = parentRect(layout, entry.parent, RENDERED);
    return {
      node, parentWidth, parentHeight, element: nodeElement(node.id),
      originX: node.x * parentWidth / 100, originY: node.y * parentHeight / 100,
    };
  });
  if (!movers.length) return false;
  interaction = {
    type: "move", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    movers, before: cloneLayout(layout), beforeSelection: selectionIds(),
  };
  return true;
}

function onResizePointerDown(event) {
  event.stopPropagation();
  const node = findNode(layout, event.currentTarget.dataset.id);
  if (!node || node.locked) return;
  const entry = findEntry(layout, node.id);
  const { width: parentWidth, height: parentHeight } = parentRect(layout, entry.parent, RENDERED);
  interaction = {
    type: "resize", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    originX: node.x * parentWidth / 100, originY: node.y * parentHeight / 100,
    originWidth: node.width, originHeight: node.height, parentWidth, parentHeight,
    corner: event.currentTarget.dataset.corner, aspect: ["image", "token"].includes(node.type) ? node.width / node.height : null,
    // Діти тримаються за лівий верхній кут батька: памʼятаємо їхній відступ
    // у пікселях, бо відсотки від розміру пропорційно розтягувалися б.
    children: node.children.map((child) => ({
      node: child, offsetX: child.x * node.width / 100, offsetY: child.y * node.height / 100,
      originX: child.x, originY: child.y,
    })),
    // З Ctrl увесь вміст масштабується разом із батьком, тож памʼятаємо
    // вихідні розміри всіх нащадків, а не лише прямих дітей.
    descendants: descendantsOf(node).map((descendant) => ({
      node: descendant, originWidth: descendant.width, originHeight: descendant.height,
      keepAspect: ["image", "token"].includes(descendant.type),
    })),
    node, before: cloneLayout(layout), beforeSelection: selectionIds(),
  };
  viewport.setPointerCapture(event.pointerId);
}

function beginPan(event, { waitForDrag = false, gesture = null } = {}) {
  interaction = {
    type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    originX: view.x, originY: view.y, waitForDrag, dragged: !waitForDrag, gesture,
  };
  viewport.classList.add("panning");
  viewport.setPointerCapture(event.pointerId);
}

// Рамка живе в екранних координатах, щоб не тягнутися разом із масштабом,
// а вибирає за світовими — їх і памʼятаємо від початку протяжки.
function beginMarquee(event) {
  const base = event.shiftKey ? selectionIds() : [];
  if (!base.length) select(null);
  if (!layout) return;
  interaction = {
    type: "marquee", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    base,
  };
  viewport.setPointerCapture(event.pointerId);
}

function rectBetween(first, second) {
  return {
    x: Math.min(first.x, second.x), y: Math.min(first.y, second.y),
    width: Math.abs(first.x - second.x), height: Math.abs(first.y - second.y),
  };
}

function drawMarquee(rect) {
  const bounds = viewport.getBoundingClientRect();
  marquee.style.left = `${rect.x - bounds.left}px`;
  marquee.style.top = `${rect.y - bounds.top}px`;
  marquee.style.width = `${rect.width}px`;
  marquee.style.height = `${rect.height}px`;
  marquee.hidden = false;
}

// Заблоковане в рамку не потрапляє: карта-підкладка лежить під усім, і без
// цього правила кожна протяжка тягнула б за собою всю карту.
function finishMarquee(finished) {
  if (!finished.clientRect) return;
  // Рамка й фактичні DOM-межі вузлів вимірюються в одних екранних
  // координатах. Це важливо для глибоко вкладених вузлів і великого зуму:
  // повторно обчислена геометрія моделі може не збігатися з намальованою.
  const caught = [...scene.querySelectorAll(".node")].filter((element) => {
    const node = findNode(layout, element.dataset.id);
    if (!node || node.locked) return false;
    const bounds = element.getBoundingClientRect();
    return rectWithin(
      { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
      finished.clientRect,
    );
  }).map((element) => element.dataset.id);
  setSelection(outermostIds(layout, [...finished.base, ...caught]));
  showSelection();
}

function onPointerMove(event) {
  pointerClient = { x: event.clientX, y: event.clientY };
  insertPoint = screenToWorld(event.clientX, event.clientY);
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  const dx = event.clientX - interaction.startX;
  const dy = event.clientY - interaction.startY;
  if (interaction.type === "pan") {
    if (interaction.waitForDrag && !interaction.dragged) {
      if (Math.abs(dx) < MARQUEE_THRESHOLD && Math.abs(dy) < MARQUEE_THRESHOLD) return;
      interaction.dragged = true;
      if (interaction.gesture) interaction.gesture.dragged = true;
      closeContextMenu();
    }
    view.x = interaction.originX + dx;
    view.y = interaction.originY + dy;
    requestView();
    return;
  }
  if (interaction.type === "marquee") {
    // Доки протяжка коротша за поріг, це ще клік: рамка не блимає на місці.
    if (!interaction.clientRect && Math.abs(dx) < MARQUEE_THRESHOLD && Math.abs(dy) < MARQUEE_THRESHOLD) return;
    interaction.clientRect = rectBetween(
      { x: interaction.startX, y: interaction.startY },
      { x: event.clientX, y: event.clientY },
    );
    drawMarquee(interaction.clientRect);
    return;
  }
  const worldDx = dx / view.scale;
  const worldDy = dy / view.scale;
  if (interaction.type === "move") {
    // Під час drag координати навмисне можуть виходити за 0..100.
    // Інакше центр дитини ніколи не покине батьківський контейнер,
    // і геометричне переприв'язування на drop не зможе її витягнути.
    for (const mover of interaction.movers) {
      mover.node.x = (mover.originX + worldDx) / mover.parentWidth * 100;
      mover.node.y = (mover.originY + worldDy) / mover.parentHeight * 100;
      updateNodeGeometry(mover.node, mover.element);
    }
    return;
  }
  const west = interaction.corner.includes("w");
  const north = interaction.corner.includes("n");
  let width = Math.max(MIN_NODE_SIZE, interaction.originWidth + (west ? -worldDx : worldDx));
  let height = Math.max(MIN_NODE_SIZE, interaction.originHeight + (north ? -worldDy : worldDy));
  if (interaction.aspect) {
    const widthChange = Math.abs(width / interaction.originWidth - 1);
    const heightChange = Math.abs(height / interaction.originHeight - 1);
    if (widthChange >= heightChange) height = width / interaction.aspect;
    else width = height * interaction.aspect;
    if (width < MIN_NODE_SIZE) { width = MIN_NODE_SIZE; height = width / interaction.aspect; }
    if (height < MIN_NODE_SIZE) { height = MIN_NODE_SIZE; width = height * interaction.aspect; }
  }
  interaction.node.width = width;
  interaction.node.height = height;
  if (west) interaction.node.x = (interaction.originX + interaction.originWidth - width) / interaction.parentWidth * 100;
  if (north) interaction.node.y = (interaction.originY + interaction.originHeight - height) / interaction.parentHeight * 100;
  updateNodeGeometry(interaction.node);
  // Ctrl можна натиснути чи відпустити посеред протяжки: щоразу рахуємо
  // від вихідного стану, тож режими перемикаються без накопичення похибки.
  const scaleContent = event.ctrlKey || event.metaKey;
  const scaleX = width / interaction.originWidth;
  const scaleY = height / interaction.originHeight;
  for (const child of interaction.children) {
    child.node.x = scaleContent ? child.originX : child.offsetX / width * 100;
    child.node.y = scaleContent ? child.originY : child.offsetY / height * 100;
  }
  for (const descendant of interaction.descendants) {
    const uniform = Math.min(scaleX, scaleY);
    const factorX = scaleContent ? (descendant.keepAspect ? uniform : scaleX) : 1;
    const factorY = scaleContent ? (descendant.keepAspect ? uniform : scaleY) : 1;
    descendant.node.width = descendant.originWidth * factorX;
    descendant.node.height = descendant.originHeight * factorY;
    updateNodeGeometry(descendant.node);
  }
}

function descendantsOf(node) {
  return node.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

// Нотатка лежить у файлі карти-предка, тож переїзд між картами — це
// перейменування на диску. Якщо одне впало, вже перенесені вертаємо назад:
// інакше файли й розкладка розійдуться.
async function relocateNotes(pending) {
  const done = [];
  try {
    for (const { node, before, after } of pending) {
      const previousReference = node.note;
      const moved = await storage.moveNote(previousReference, after.slug, after.name);
      notesByRef.delete(previousReference);
      notesByRef.set(moved.reference, moved);
      node.note = moved.reference;
      done.push({ nodeId: node.id, beforeMap: before, afterMap: after });
    }
  } catch (error) {
    for (const move of done.reverse()) {
      const node = findNode(layout, move.nodeId);
      if (!node || !move.beforeMap) continue;
      try {
        const back = await storage.moveNote(node.note, move.beforeMap.slug, move.beforeMap.name);
        notesByRef.delete(node.note);
        notesByRef.set(back.reference, back);
        node.note = back.reference;
      } catch (rollbackError) {
        console.warn(rollbackError);
      }
    }
    throw error;
  }
  return done;
}

function cancelMove(finished) {
  layout = adoptLayout(layout, finished.before);
  setSelection(finished.beforeSelection);
  render();
}

async function endInteraction(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  const finished = interaction;
  interaction = null;
  viewport.classList.remove("panning");
  marquee.hidden = true;
  if (finished.type === "marquee") {
    // pointerup може прийти після останнього pointermove, тому беремо точну
    // кінцеву позицію відпускання, а не застарілий край намальованої рамки.
    if (finished.clientRect) finished.clientRect = rectBetween(
      { x: finished.startX, y: finished.startY },
      { x: event.clientX, y: event.clientY },
    );
    return finishMarquee(finished);
  }
  if (finished.type === "resize") return commitLiveCommand("Змінити розмір", finished.before, finished.beforeSelection);
  if (finished.type !== "move") return;

  const moved = finished.movers.map((mover) => mover.node).filter((node) => findEntry(layout, node.id));
  const placements = moved.map((node) => {
    const rect = absoluteRect(layout, node.id, RENDERED);
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const parent = node.type === "scene" ? locationAtPoint(point, node.id) : deepestContainerAt(layout, point, node.id, RENDERED);
    return { node, parent };
  });
  if (placements.some(({ node, parent }) => node.type === "scene" && !parent)) {
    cancelMove(finished);
    return showToast("Сцена має залишатися всередині локації");
  }
  for (const { node, parent } of placements) {
    reparentNode(layout, node.id, parent?.id ?? null, RENDERED);
    snapToParent(node);
  }
  const relocations = [];
  // Рамка чи сцена везе свої нотатки з собою, тож під іншою картою їм так само
  // треба переїхати у файл цієї карти, як і нотатці, яку тягнули саму.
  for (const node of collectNodes(moved, (candidate) => candidate.type === "note")) {
    const before = noteMapContext(finished.before, node.id);
    const after = noteMapContext(layout, node.id);
    if (!after) {
      cancelMove(finished);
      return showToast(moved.includes(node)
        ? "Нотатка має залишатися всередині карти"
        : "Усередині є нотатки, а вони мають залишатися всередині карти");
    }
    if (before?.slug !== after.slug) {
      relocations.push({ node, before: before && { slug: before.slug, name: before.name }, after: { slug: after.slug, name: after.name } });
    }
  }
  let noteMoves = [];
  if (relocations.length) {
    setStatus(plural(relocations.length, "Перенесення нотатки…", `Перенесення нотаток (${relocations.length})…`), "dirty");
    try {
      noteMoves = await relocateNotes(relocations);
    } catch (error) {
      cancelMove(finished);
      setStatus("Помилка перенесення нотатки", "error");
      return showToast(error.message);
    }
  }
  commitLiveCommand(plural(moved.length, "Перемістити вузол", "Перемістити вузли"), finished.before, finished.beforeSelection, noteMoves.length ? { noteMoves } : {});
}

// Лок застосовується до всього виділення: поки серед нього є хоч один
// відкритий вузол, Ctrl+L замикає все, і тільки на повністю замкненому
// виділенні відмикає назад.
function toggleLock() {
  const nodes = selectedNodes();
  if (!nodes.length) return;
  const locking = nodes.some((node) => !node.locked);
  const label = locking
    ? plural(nodes.length, "Заблокувати вузол", "Заблокувати вузли")
    : plural(nodes.length, "Розблокувати вузол", "Розблокувати вузли");
  executeCommand(label, () => { for (const node of nodes) node.locked = locking; });
}

// Повертаються лише картинки з виділення, і лише не заблоковані: так R на
// змішаному виділенні не чіпає решти вузлів.
function rotatableImages() {
  return selectedNodes().filter((node) => node.type === "image" && !node.locked);
}

function rotateSelected(steps) {
  const nodes = rotatableImages();
  if (!nodes.length) return;
  executeCommand(plural(nodes.length, "Повернути картинку", "Повернути картинки"), () => {
    for (const node of nodes) {
      rotateImageNode(node, steps * ROTATION_STEP, {
        area: parentRect(layout, findEntry(layout, node.id).parent, RENDERED),
        inset: RENDERED.inset(node),
      });
    }
  });
}

// Токени-діти бойової карти стають на її клітинки, якщо прилипання не вимкнене.
function snapTokensOf(map) {
  if (!snapsTokens(map)) return;
  for (const child of map.children) {
    if (child.type === "token" && !child.locked) Object.assign(child, snapChild(child, map, RENDERED.inset(map)));
  }
}

function snapToParent(node) {
  const parent = findEntry(layout, node.id)?.parent;
  if (node.type === "token" && snapsTokens(parent)) Object.assign(node, snapChild(node, parent, RENDERED.inset(parent)));
}

// Увімкнене знову прилипання одразу ставить токени карти на клітинки.
function toggleSnap(node) {
  if (!isBattleMap(node) || node.locked) return;
  const enabling = node.snap === false;
  executeCommand(enabling ? "Увімкнути прилипання до клітинок" : "Вимкнути прилипання до клітинок", () => {
    if (enabling) {
      delete node.snap;
      snapTokensOf(node);
    } else node.snap = false;
  });
}

function fitToStandard(node) {
  if (!isBattleMap(node) || node.locked) return;
  executeCommand("Привести до стандартного розміру", () => {
    const area = parentRect(layout, findEntry(layout, node.id).parent, RENDERED);
    if (!fitBattleMap(node, boardConfig.grid.cell, { area, inset: RENDERED.inset(node) })) return false;
    snapTokensOf(node);
  });
}

function changeZ(operation) {
  const ids = outermostIds(layout, selectionIds());
  if (!ids.length) return;
  executeCommand("Змінити z-порядок", () => ids.reduce((moved, id) => reorderNode(layout, id, operation) || moved, false));
}

function nudgeSelected(dx, dy) {
  const nodes = selectedRoots().filter((node) => !node.locked);
  if (!nodes.length) return;
  executeCommand(plural(nodes.length, "Посунути вузол", "Посунути вузли"), () => {
    for (const node of nodes) {
      const area = parentRect(layout, findEntry(layout, node.id).parent, RENDERED);
      node.x += dx / area.width * 100;
      node.y += dy / area.height * 100;
    }
  });
}

async function restoreNotes(lifecycles) {
  for (const effect of lifecycles) {
    try {
      const restored = await storage.restoreNote(effect.reference, effect.text);
      notesByRef.set(restored.reference, restored);
    } catch (error) {
      console.warn(error);
    }
  }
}

async function deleteSelected() {
  const targets = selectedRoots().filter((node) => !node.locked);
  if (!targets.length) return;
  // Контейнер іде з дошки разом із вмістом, тож і нотатки всередині нього
  // стираються з файлів — інакше лишилися б у markdown без жодного вузла.
  // Нотатку, якої у файлах і так нема («Не знайдено…»), стирати нема чого:
  // через неї видалення не мусить падати.
  const notes = collectNodes(targets, (node) => node.type === "note" && notesByRef.has(node.note));
  const lifecycles = [];
  if (notes.length) {
    setStatus(plural(notes.length, "Видалення нотатки…", `Видалення нотаток (${notes.length})…`), "dirty");
    for (const node of notes) {
      try {
        const note = await storage.deleteNote(node.note);
        notesByRef.delete(node.note);
        lifecycles.push({ kind: "delete", nodeId: node.id, reference: note.reference, text: note.text });
      } catch (error) {
        // Уже стерті файли повертаємо назад: інакше половина видалення
        // залишиться на диску без жодного вузла на дошці.
        await restoreNotes(lifecycles);
        setStatus("Помилка видалення нотатки", "error");
        return showToast(error.message);
      }
    }
  }
  const ids = targets.map((node) => node.id);
  const label = plural(ids.length, targets[0].type === "note" ? "Видалити нотатку" : "Видалити вузол", "Видалити вузли");
  executeCommand(label, () => {
    for (const id of ids) {
      const entry = findEntry(layout, id);
      if (entry) entry.children.splice(entry.index, 1);
    }
    setSelection([]);
  }, lifecycles.length ? { noteLifecycles: lifecycles } : {});
  for (const effect of lifecycles) newNoteIds.delete(effect.nodeId);
}

// Вставка кладе копію під курсор. Коли курсора над полотном не було
// (натиснули з клавіатури після діалогу), беремо середину екрана.
function cursorSpot() {
  const bounds = viewport.getBoundingClientRect();
  const inside = pointerClient
    && pointerClient.x >= bounds.left && pointerClient.x <= bounds.right
    && pointerClient.y >= bounds.top && pointerClient.y <= bounds.bottom;
  const clientX = inside ? pointerClient.x : bounds.left + bounds.width / 2;
  const clientY = inside ? pointerClient.y : bounds.top + bounds.height / 2;
  return { clientX, clientY, world: screenToWorld(clientX, clientY) };
}

function copySelection(clipboardData = null) {
  const roots = selectedRoots();
  if (!roots.length) return false;
  const payload = clipboardPayload(
    roots.map((node) => ({ node, rect: absoluteRect(layout, node.id, RENDERED) })),
    (reference) => notesByRef.get(reference)?.text,
  );
  internalClipboard = payload;
  const text = JSON.stringify(payload);
  if (clipboardData) clipboardData.setData("text/plain", text);
  else navigator.clipboard?.writeText(text).catch((error) => console.warn(error));
  return true;
}

function supportedImages(files) {
  return [...(files ?? [])].filter((file) => /^image\/(png|jpeg|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name));
}

// Скріншот у буфері приходить голим блобом — імʼя вигадуємо самі, далі його
// однаково зробить унікальним сховище.
async function clipboardImages() {
  if (!navigator.clipboard?.read) return [];
  const files = [];
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((candidate) => CLIPBOARD_IMAGE_TYPES[candidate]);
    if (type) files.push(new File([await item.getType(type)], `clipboard.${CLIPBOARD_IMAGE_TYPES[type]}`, { type }));
  }
  return files;
}

// Контекстне меню читає системний буфер саме: події paste тут немає. Браузер
// може не дати дозволу — тоді лишається власна копія.
async function pasteFromMenu(spot) {
  if (!layout) return;
  let images = [];
  let text = "";
  try {
    images = await clipboardImages();
    if (!images.length) text = await navigator.clipboard.readText();
  } catch (error) {
    console.warn(error);
  }
  if (images.length) return openDropChoice(images, spot.clientX, spot.clientY);
  await pasteNodes(parseClipboard(text) ?? internalClipboard, spot.world);
}

async function pasteNodes(payload, point) {
  if (!payload) return showToast("У буфері немає нічого, що можна покласти на полотно");
  if (payload.rejected) {
    showToast(`Не вставлено ${payload.rejected} ${pluralForm(payload.rejected, "вузол", "вузли", "вузлів")}: вони не схожі на вузли цієї канви`);
  }
  let { parent, rect } = nearestPointParent(layout, point, RENDERED);
  if (payload.items.some(({ node }) => node.type === "scene")) {
    parent = locationAtPoint(point);
    if (!parent) return showToast("Сцену можна вставити лише всередині локації");
    rect = parentRect(layout, parent, RENDERED);
  }
  let nodes = placedItems(payload, point, rect);
  const targets = noteTargets(nodes, mapContext(layout, parent?.id ?? null), (node) => isMapNode(node) ? mapDescriptor(node) : null);
  const orphans = new Set(targets.filter((target) => !target.map).map((target) => target.node));
  if (orphans.size) {
    nodes = withoutNodes(nodes, orphans);
    showToast(plural(orphans.size, "Нотатку можна вставити лише всередині карти", "Нотатки можна вставити лише всередині карти"));
    if (!nodes.length) return;
  }
  // Копія нотатки — це нова нотатка у файлі своєї карти: два вузли на одне
  // посилання зламали б і перенесення, і видалення.
  const copies = targets.filter((target) => target.map);
  const lifecycles = [];
  if (copies.length) setStatus(plural(copies.length, "Створення нотатки…", `Створення нотаток (${copies.length})…`), "dirty");
  for (const { node, map } of copies) {
    try {
      const note = await storage.createNote(map.slug, map.name, payload.notes[node.note] ?? notesByRef.get(node.note)?.text ?? "");
      notesByRef.set(note.reference, note);
      node.note = note.reference;
      lifecycles.push({ kind: "create", nodeId: node.id, reference: note.reference, text: note.text });
    } catch (error) {
      // Те, що вже лягло у файл, прибираємо: без вузлів на дошці ці нотатки
      // лишилися б сміттям у markdown.
      for (const effect of lifecycles) {
        try {
          await storage.deleteNote(effect.reference);
          notesByRef.delete(effect.reference);
        } catch (cleanupError) {
          console.warn(cleanupError);
        }
      }
      setStatus("Помилка створення нотатки", "error");
      return showToast(error.message);
    }
  }
  executeCommand(plural(nodes.length, "Вставити вузол", "Вставити вузли"), () => {
    const destination = parent ? parent.children : layout.children;
    for (const node of nodes) destination.push(node);
    setSelection(nodes.map((node) => node.id));
  }, lifecycles.length ? { noteLifecycles: lifecycles } : {});
}

function canvasBlob(bitmap, quality, maxDimension = null) {
  const scale = maxDimension ? Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  // Мініатюра зменшує в рази: з типовим згладжуванням дрібні лінії карти
  // пішли б сходинками.
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Браузер не зміг закодувати WebP")), "image/webp", quality);
  });
}

async function uploadImage(file, kind) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const isAlreadyWebP = file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp");
    const quality = kind === "map" ? 0.9 : 0.82;
    const full = isAlreadyWebP ? file : await canvasBlob(bitmap, quality);
    const media = await storage.saveMedia(full, kind, file.name);

    try {
      const thumbnail = await canvasBlob(bitmap, 0.76, 1200);
      await storage.saveThumbnail(thumbnail, media.path);
    } catch (error) {
      console.warn(error);
    }
    return { ...media, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

// Розмір картинки в пікселях без повного розкодування.
function imagePixels(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener("load", () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); }, { once: true });
    image.addEventListener("error", () => { URL.revokeObjectURL(url); reject(new Error(`Не вдалося прочитати ${file.name}`)); }, { once: true });
    image.src = url;
  });
}

// Сітка береться з назви файлу («…-33x16-grid…»); нема — питаємо ДМа.
// null — ДМ пропустив цей файл.
async function battleGridFor(file) {
  const pixels = await imagePixels(file);
  return gridFromName(file.name, pixels.width, pixels.height) ?? askBattleGrid(file.name, pixels);
}

let battleGridRequest = null;

function askBattleGrid(name, pixels) {
  battleGridFile.textContent = `${name} · ${pixels.width} × ${pixels.height} px. У назві нема розміру сітки на кшталт 33x16.`;
  battleGridColumns.value = "";
  battleGridRows.value = "";
  battleGridRows.placeholder = "";
  battleGridColumns.setCustomValidity("");
  battleGridDialog.showModal();
  requestAnimationFrame(() => battleGridColumns.focus());
  return new Promise((resolve) => {
    battleGridRequest = { pixels, resolve };
    updateBattleGridHint();
  });
}

function finishBattleGrid(grid) {
  const request = battleGridRequest;
  battleGridRequest = null;
  if (battleGridDialog.open) battleGridDialog.close();
  request?.resolve(grid);
}

function enteredBattleGrid() {
  const columns = Number(battleGridColumns.value);
  const rows = Number(battleGridRows.value || battleGridRows.placeholder);
  return isGridCount(columns) && isGridCount(rows) ? { columns, rows } : null;
}

// Висоту підказує пропорція картинки; клітинка, що вийшла не квадратною, —
// знак, що числа переплутані чи не ті.
function updateBattleGridHint() {
  const { pixels } = battleGridRequest ?? {};
  if (!pixels) return;
  const columns = Number(battleGridColumns.value);
  battleGridRows.placeholder = isGridCount(columns) ? String(Math.max(1, Math.round(columns * pixels.height / pixels.width))) : "";
  const grid = enteredBattleGrid();
  if (!grid) {
    battleGridHint.textContent = "Скільки клітинок сітки намальовано вздовж ширини й висоти картинки.";
    return;
  }
  const cellWidth = pixels.width / grid.columns;
  const cellHeight = pixels.height / grid.rows;
  const size = battleMapSize(grid, boardConfig.grid.cell);
  const square = Math.abs(cellWidth / cellHeight - 1) <= 0.03;
  battleGridHint.textContent = `Клітинка ${Math.round(cellWidth)} × ${Math.round(cellHeight)} px, на дошці карта ${size.width} × ${size.height}.`
    + (square ? "" : " Клітинка не квадратна — перевір числа.");
}

async function processDrop(kind) {
  const drop = pendingDrop;
  pendingDrop = null;
  dropChoice.hidden = true;
  if (!drop || kind === "cancel") return;
  const battle = kind === "battlemap";
  try {
    const files = [];
    for (const file of drop.files) {
      const grid = battle ? await battleGridFor(file) : null;
      if (!battle || grid) files.push({ file, grid });
    }
    if (!files.length) return;
    setStatus(`Обробка ${files.length} зображень…`, "dirty");
    const media = [];
    for (const { file, grid } of files) media.push({ ...await uploadImage(file, battle ? "map" : kind), grid });
    const parent = deepestNodeAt(layout, drop.point, { includeLocked: true, ...RENDERED });
    const area = parentRect(layout, parent, RENDERED);
    executeCommand("Додати зображення", () => {
      const destination = parent ? parent.children : layout.children;
      const created = [];
      media.forEach((item, index) => {
        const maxWidth = kind === "map" ? 900 : 480;
        const scale = Math.min(1, maxWidth / item.width);
        // Бойова карта лягає в масштабі клітинки дошки, від зуму не залежить.
        const { width, height } = item.grid ? battleMapSize(item.grid, boardConfig.grid.cell)
          : { width: Math.max(80, item.width * scale), height: Math.max(60, item.height * scale) };
        const offset = index * 28;
        const node = {
          id: crypto.randomUUID(), type: "image", image: item.path,
          ...(item.grid ? { grid: item.grid } : {}),
          x: (drop.point.x + offset - area.x) / area.width * 100,
          y: (drop.point.y + offset - area.y) / area.height * 100,
          width, height, locked: false, children: [],
        };
        if (!item.grid) enlargeForZoom(node, drop.point, area);
        destination.push(node);
        created.push(node.id);
      });
      setSelection(created);
    });
  } catch (error) {
    setStatus("Помилка імпорту", "error");
    showToast(error.message);
  }
}

function openDropChoice(files, clientX, clientY) {
  pendingDrop = { files, point: screenToWorld(clientX, clientY) };
  dropChoiceTitle.textContent = files.length === 1 ? "Що це за зображення?" : `Що це за зображення (${files.length})?`;
  dropChoice.hidden = false;
  const width = 390;
  dropChoice.style.left = `${clamp(clientX + 12, 12, innerWidth - width - 12)}px`;
  dropChoice.style.top = `${clamp(clientY + 12, 76, innerHeight - 150)}px`;
}

function zoomAt(clientX, clientY, factor) {
  const bounds = viewport.getBoundingClientRect();
  const localX = clientX - bounds.left;
  const localY = clientY - bounds.top;
  const requestedScale = view.scale * factor;
  const limits = boardScaleLimits();
  const nextScale = clamp(requestedScale, limits.minimum, limits.maximum);
  const nextView = zoomedViewAt(view, localX, localY, nextScale / view.scale);
  if (!nextView) return;
  view = nextView;
  requestView();
}

function fitAll() {
  if (!layout) return;
  const boxes = allAbsoluteRects(layout);
  if (!boxes.length) {
    view = { x: viewport.clientWidth / 2 - WORLD_SIZE / 2, y: viewport.clientHeight / 2 - WORLD_SIZE / 2, scale: 1 };
    return applyView();
  }
  const margin = 80;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  const availableWidth = Math.max(1, viewport.clientWidth - margin * 2);
  const availableHeight = Math.max(1, viewport.clientHeight - margin * 2);
  const limits = boardScaleLimits();
  view.scale = clamp(
    Math.min(availableWidth / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY)),
    limits.minimum,
    limits.maximum,
  );
  view.x = (viewport.clientWidth - (maxX - minX) * view.scale) / 2 - minX * view.scale;
  view.y = (viewport.clientHeight - (maxY - minY) * view.scale) / 2 - minY * view.scale;
  applyView();
}

// Полотно живе у власних одиницях, тому масштаб карти доводиться показати
// самому: два кліки по відрізку, довжина якого відома з карти, і далі будь-яка
// ламана переводиться в милі.
function setRouteMode(mode) {
  routeMode = mode;
  routePoints = [];
  routePointer = null;
  measureRouteButton.setAttribute("aria-pressed", String(Boolean(mode)));
  viewport.classList.toggle("measuring", Boolean(mode));
  renderRoute();
}

// Хрестик на попапі — це «дорахував»: лінійка гасне разом із маршрутом,
// інакше вона лишалася б увімкненою і далі забирала б лівий клік собі.
function closeRouteTool() {
  setRouteMode(null);
  viewport.focus();
}

function toggleRouteTool() {
  if (routeMode) return closeRouteTool();
  setRouteMode(routeScale ? "route" : "calibrate");
}

function clearRoute() {
  routePoints = [];
  routePointer = null;
  renderRoute();
  viewport.focus();
}

function addRoutePoint(point) {
  routePoints.push(point);
  if (routeMode !== "calibrate" || routePoints.length < 2) return renderRoute();
  const scale = scaleFromCalibration(routePoints[0], routePoints[1]);
  if (!scale) {
    routePoints = [];
    renderRoute();
    return showToast("Точки збіглися — постав другу далі від першої");
  }
  routeScale = scale;
  setCampaignSetting("route-scale", String(scale));
  setRouteMode("route");
  showToast("Масштаб запамʼятано. Тепер клацай точки маршруту.");
}

function worldToLocal(point) {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

function routeDots(spots) {
  return spots.map((spot, index) => {
    const last = index === spots.length - 1;
    return `<circle class="route-dot${last ? " last" : ""}" cx="${spot.x.toFixed(1)}" cy="${spot.y.toFixed(1)}" r="${last ? 5.5 : 4.5}"/>`;
  }).join("");
}

function renderRoute() {
  // Кожен кадр панорамування проходить тут, тому вимкнена лінійка має
  // коштувати одну перевірку, а не перемальовування порожнього шару.
  if (!routeMode && routeOverlay.hasAttribute("hidden") && routeHint.hidden && routePopup.hidden) return;
  const spots = routePoints.map(worldToLocal);
  const line = spots.map((spot) => `${spot.x.toFixed(1)},${spot.y.toFixed(1)}`).join(" ");
  // Незакінчене калібрування малюється пунктиром: видно, що це ще не маршрут.
  const draft = routeMode === "calibrate" ? " draft" : "";
  // `hidden` у SVG — лише властивість HTMLElement, тому шар ховається самим
  // атрибутом: присвоєння `.hidden` тут нічого б не змінило.
  routeOverlay.toggleAttribute("hidden", spots.length === 0);
  routeOverlay.innerHTML = spots.length < 2
    ? routeDots(spots)
    : `<polyline class="route-line-casing" points="${line}"/><polyline class="route-line${draft}" points="${line}"/>${routeDots(spots)}`;
  renderRouteHint();
  renderRoutePopup(spots);
}

function renderRouteHint() {
  routeHint.hidden = !routeMode;
  routeRecalibrateButton.hidden = routeMode !== "route";
  if (!routeMode) return;
  routeHintText.textContent = routeMode === "calibrate"
    ? (routePoints.length
      ? `Тепер друга точка — та, до якої від першої ${CALIBRATION_MILES} миль.`
      : `Калібрування: клацни на карті дві точки, між якими ${CALIBRATION_MILES} миль.`)
    : "Клацай точки маршруту. Esc — стерти прокладене, ще раз Esc — вийти.";
}

function renderRoutePopup(spots) {
  const miles = routeMode === "route" && routePoints.length > 1 ? routeMiles(routePoints, routeScale) : null;
  routePopup.hidden = miles === null;
  if (miles === null) return;
  routeTotal.textContent = milesLabel(miles);
  const legs = routePoints.length - 1;
  routeLegs.textContent = `${routePoints.length} ${pluralForm(routePoints.length, "точка", "точки", "точок")} · ${legs} ${pluralForm(legs, "відрізок", "відрізки", "відрізків")}`;
  routeRows.innerHTML = travelEstimates(miles, travelModes(boardConfig.travel)).map((row) => `<tr>
    <td>${row.label}${row.note ? `<small>${row.note}</small>` : ""}</td>
    <td>${row.milesPerDay}</td>
    <td>${row.duration}</td>
  </tr>`).join("");
  placeRoutePopup(spots.at(-1));
}

// Попап тримається останньої точки, але не вилазить за екран: інакше на краю
// карти половина таблиці опинялася б за вікном.
function placeRoutePopup(spot) {
  const bounds = viewport.getBoundingClientRect();
  const size = routePopup.getBoundingClientRect();
  const margin = 12;
  routePopup.style.left = `${clamp(bounds.left + spot.x + 18, margin, window.innerWidth - size.width - margin)}px`;
  routePopup.style.top = `${clamp(bounds.top + spot.y + 18, margin, window.innerHeight - size.height - margin)}px`;
}

function setStatus(text, state = "") {
  status.textContent = text;
  status.dataset.state = state;
}

function changed() {
  dirty = true;
  if (conflicted) return showConflict();
  setStatus("Є незбережені зміни", "dirty");
  if (saving) saveAgain = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY);
}

async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (conflicted) return;
  if (saving) { saveAgain = true; return; }
  saving = true;
  // Зміни, що прийдуть під час запису, знову позначать розкладку брудною.
  dirty = false;
  setStatus("Збереження…", "dirty");
  try {
    const result = await storage.saveLayout(layout, revision);
    revision = result.revision;
    if (!saveAgain) setStatus("Збережено");
  } catch (error) {
    dirty = true;
    saveAgain = false;
    if (error instanceof LayoutConflictError) showConflict();
    else {
      setStatus("Помилка збереження", "error");
      showToast(error.message);
    }
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; await save(); }
  }
}

function hasUnsavedWork() {
  return dirty || saving || pendingWrites > 0 || Boolean(hitPointEdit);
}

// Вкладку закривають або ховають — відкладене збереження робимо просто зараз,
// не чекаючи дебаунсу. Недокручені колесом HP спершу стають командою.
function flushSave() {
  if (!layout) return;
  commitHitPoints();
  if (dirty && !saving && !conflicted) save();
}

// Запис на диск асинхронний, і закриття вкладки його не чекає. Тож поки щось
// не дописано, браузер перепитує: ця пауза й дає збереженню завершитися.
function trackWrite(task) {
  pendingWrites += 1;
  return Promise.resolve().then(task).finally(() => { pendingWrites -= 1; });
}

// Нотатки й картинки пишуться у файли одразу, повз автозбереження розкладки,
// тож їхні записи рахуємо окремо.
function trackStorageWrites(target) {
  for (const method of ["createNote", "updateNote", "moveNote", "deleteNote", "restoreNote", "saveMedia"]) {
    const original = target[method].bind(target);
    target[method] = (...args) => trackWrite(() => original(...args));
  }
  return target;
}

function showConflict() {
  conflicted = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  setStatus("Конфлікт: canvas.json змінено ззовні", "error");
  conflictBar.hidden = false;
}

function resolveConflict() {
  conflicted = false;
  conflictBar.hidden = true;
}

// «Взяти з диска»: дошка перечитується наново, а незбережене на ній
// відкидається — разом з історією undo, що вела до нього.
async function reloadFromDisk() {
  resolveConflict();
  clearTimeout(hitPointEdit?.timer);
  hitPointEdit = null;
  interaction = null;
  editingNoteId = null;
  dirty = false;
  setStatus("Перечитування…", "dirty");
  try {
    await loadBoard({ title: "Перечитую дошку з диска…" });
  } catch (error) {
    showConflict();
    showToast(error.message);
  }
}

// «Перезаписати своїм»: беремо ревізію того, що зараз на диску, і пишемо
// поверх неї розкладку з дошки. Чужа правка canvas.json при цьому пропадає.
async function overwriteDisk() {
  resolveConflict();
  setStatus("Збереження…", "dirty");
  try {
    revision = await storage.currentRevision();
  } catch (error) {
    showConflict();
    return showToast(error.message);
  }
  dirty = true;
  await save();
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
}

// Лінійка забирає лівий клік собі ще на перехопленні: під курсором майже
// завжди лежить карта, тож інакше клік діставався б картці, а не маршруту.
// Панорамування правою кнопкою й пробілом лишається недоторканим.
viewport.addEventListener("pointerdown", (event) => {
  if (!routeMode || event.button !== 0 || spacePressed) return;
  if (event.target.closest?.(".hud, .canvas-actions, .connection-screen, .empty-state")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  viewport.focus();
  routePointer = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY };
}, { capture: true });
viewport.addEventListener("pointerup", (event) => {
  if (!routePointer || routePointer.id !== event.pointerId) return;
  const { clientX, clientY } = routePointer;
  routePointer = null;
  // Дрож руки не має ставити точку далі, ніж її поставили.
  if (Math.abs(event.clientX - clientX) > MARQUEE_THRESHOLD || Math.abs(event.clientY - clientY) > MARQUEE_THRESHOLD) return;
  addRoutePoint(screenToWorld(clientX, clientY));
}, { capture: true });
viewport.addEventListener("pointercancel", () => { routePointer = null; }, { capture: true });

viewport.addEventListener("pointerdown", (event) => {
  viewport.focus();
  if (event.button === 1 || (event.button === 0 && spacePressed)) {
    event.preventDefault();
    beginPan(event);
  // Заблоковані картки самі ловлять pointer-події заради контекстного меню.
  // Лівий клік по їхньому тілу водночас має поводитися як клік по полотну,
  // інакше велика заблокована карта перекриває запуск рамки виділення.
  } else if (event.button === 0 && (event.target === viewport || event.target === grid || event.target === scene || event.target.matches?.(".node.locked"))) {
    if (event.altKey) {
      const node = deepestNodeAt(layout, screenToWorld(event.clientX, event.clientY), { includeLocked: true, ...RENDERED });
      select(node?.id ?? null);
    } else beginMarquee(event);
  }
});
// Capture потрібен, бо тіла нотаток і статблоків зупиняють pointerdown для
// власного редагування. Правий drag має починатися поверх будь-якого вузла.
viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 2 || event.target.closest?.(".hud, .canvas-actions, .connection-screen, .empty-state")) return;
  viewport.focus();
  closeContextMenu();
  const nodeElement = event.target.closest?.(".node");
  rightPointerGesture = {
    pointerId: event.pointerId,
    nodeId: nodeElement?.dataset.id ?? null,
    creature: creatureRowIndex(event.target),
    dragged: false,
  };
  beginPan(event, { waitForDrag: true, gesture: rightPointerGesture });
}, { capture: true });
viewport.addEventListener("contextmenu", (event) => {
  if (!layout || event.target.closest(".hud, .canvas-actions, .connection-screen, .empty-state")) return;
  if (rightPointerGesture?.dragged) {
    event.preventDefault();
    rightPointerGesture = null;
    return closeContextMenu();
  }
  // Браузер уже врахував реальний порядок малювання і перекриття вузлів.
  // Геометричний пошук тут помилявся на вкладених/перекритих картках і міг
  // вибрати прямокутник позаду того, по якому насправді натиснули.
  const nodeElement = event.target.closest(".node");
  const nodeId = rightPointerGesture?.nodeId ?? nodeElement?.dataset.id;
  const node = nodeId ? findNode(layout, nodeId) : null;
  const creature = rightPointerGesture?.creature ?? creatureRowIndex(event.target);
  rightPointerGesture = null;
  event.preventDefault();
  event.stopPropagation();
  commitHitPoints();
  if (!node || !CONTEXT_MENU_NODE_TYPES.has(node.type)) return openContextMenu(null, event.clientX, event.clientY);
  select(node.id);
  contextMenuCreature = creature;
  openContextMenu(node, event.clientX, event.clientY);
});
viewport.addEventListener("pointermove", onPointerMove);
viewport.addEventListener("pointerup", endInteraction);
viewport.addEventListener("pointercancel", endInteraction);
viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  const delta = event.deltaY || event.deltaX;
  zoomAt(event.clientX, event.clientY, Math.exp(-delta * 0.002));
}, { passive: false });
viewport.addEventListener("dragenter", (event) => {
  if ([...event.dataTransfer.items].some((item) => item.kind === "file")) {
    event.preventDefault();
    dropOverlay.hidden = false;
  }
});
viewport.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer.items].some((item) => item.kind === "file")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});
viewport.addEventListener("dragleave", (event) => {
  if (!viewport.contains(event.relatedTarget)) dropOverlay.hidden = true;
});
viewport.addEventListener("drop", (event) => {
  event.preventDefault();
  dropOverlay.hidden = true;
  if (!layout) return;
  const files = supportedImages(event.dataTransfer.files);
  if (!files.length) return showToast("У дропі немає підтримуваних зображень");
  openDropChoice(files, event.clientX, event.clientY);
});

document.addEventListener("copy", (event) => {
  if (!layout || entityPicker.open || entityDetails.open || musicDialog.open || sceneRenameDialog.open || battleGridDialog.open) return;
  if (event.target.matches?.("input, textarea, [contenteditable=true]")) return;
  // Виділений текст статблока чи нотатки копіюється як текст — картки
  // забирає лише «порожній» Ctrl+C.
  if (!document.getSelection()?.isCollapsed) return;
  if (copySelection(event.clipboardData)) event.preventDefault();
});

document.addEventListener("paste", (event) => {
  if (!layout || !connectionScreen.hidden || entityPicker.open || entityDetails.open || musicDialog.open || sceneRenameDialog.open || battleGridDialog.open) return;
  if (event.target.matches?.("input, textarea, [contenteditable=true]")) return;
  const images = supportedImages(event.clipboardData?.files);
  const text = event.clipboardData?.getData("text/plain") ?? "";
  // Власна копія — запасний варіант лише для порожнього буфера: коли там
  // лежить чужий текст, вставляти замість нього старі картки не можна.
  const payload = parseClipboard(text) ?? (images.length || text.trim() ? null : internalClipboard);
  if (!images.length && !payload) return;
  event.preventDefault();
  const spot = cursorSpot();
  if (images.length) openDropChoice(images, spot.clientX, spot.clientY);
  else pasteNodes(payload, spot.world);
});

window.addEventListener("keydown", (event) => {
  // Поки обирають кампанію, дошка під екраном вибору клавіш не чує.
  if (!connectionScreen.hidden) return;
  if (!nodeContextMenu.hidden && event.key === "Escape") {
    event.preventDefault();
    closeContextMenu();
    viewport.focus();
    return;
  }
  if (routeMode && event.key === "Escape" && !event.target.matches?.("input, textarea, [contenteditable=true]")) {
    event.preventDefault();
    if (routePoints.length) clearRoute();
    else setRouteMode(null);
    return;
  }
  if (entityDetails.open || musicDialog.open || sceneRenameDialog.open || battleGridDialog.open) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!entityPicker.open) openEntityPicker();
    return;
  }
  if (event.target.matches("input, textarea, [contenteditable=true]")) return;
  if (!layout) return;
  const selectedNode = findNode(layout, soleSelectedId());
  const noteEditKey = event.key === "Enter"
    || event.key === "Backspace"
    || (event.key === "Delete" && !command)
    || (event.key.length === 1 && event.code !== "Space" && !command && !event.altKey);
  if (selectedNode?.type === "note" && noteEditKey) {
    event.preventDefault();
    beginNoteEdit(selectedNode, event.key === "Enter" || event.key === "Delete" ? null : event.key);
    return;
  }
  if (event.code === "Space") { spacePressed = true; event.preventDefault(); }
  else if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  else if (command && event.key.toLowerCase() === "l") { event.preventDefault(); toggleLock(); }
  else if (command && event.key === "]") { event.preventDefault(); changeZ(event.shiftKey ? "front" : "forward"); }
  else if (command && event.key === "[") { event.preventDefault(); changeZ(event.shiftKey ? "back" : "backward"); }
  else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
  else if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    nudgeSelected(event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
  } else if (event.key.toLowerCase() === "f" && !command) addFrame();
  else if (event.code === "KeyR" && !command && !event.altKey && rotatableImages().length) {
    event.preventDefault();
    rotateSelected(event.shiftKey ? -1 : 1);
  }
});
window.addEventListener("keyup", (event) => { if (event.code === "Space") spacePressed = false; });
window.addEventListener("blur", () => { spacePressed = false; });
window.addEventListener("resize", requestView);
window.addEventListener("beforeunload", (event) => {
  flushSave();
  if (!hasUnsavedWork()) return;
  event.preventDefault();
  event.returnValue = "";
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
  syncPartyPolling();
});
document.querySelector("#conflict-reload").addEventListener("click", reloadFromDisk);
document.querySelector("#conflict-overwrite").addEventListener("click", overwriteDisk);

document.querySelector("#add-frame").addEventListener("click", addFrame);
document.querySelector("#empty-add").addEventListener("click", addFrame);
document.querySelector("#add-note").addEventListener("click", () => {
  if (layout) createNoteAt(defaultInsertPoint());
});
document.querySelector("#add-music").addEventListener("click", () => {
  insertPoint = defaultInsertPoint();
  openMusicDialog();
});
document.querySelector("#fit-all").addEventListener("click", fitAll);
measureRouteButton.addEventListener("click", toggleRouteTool);
routeRecalibrateButton.addEventListener("click", () => setRouteMode("calibrate"));
document.querySelector("#route-close").addEventListener("click", closeRouteTool);
addEntityButton.addEventListener("click", () => {
  insertPoint = defaultInsertPoint();
  openEntityPicker();
});
addLocationButton.addEventListener("click", () => {
  insertPoint = defaultInsertPoint();
  openEntityPicker("location");
});
addNpcButton.addEventListener("click", () => {
  insertPoint = defaultInsertPoint();
  openEntityPicker("npc");
});
addStatblockButton.addEventListener("click", () => {
  insertPoint = defaultInsertPoint();
  openEntityPicker("creature");
});
addTokenButton.addEventListener("click", () => {
  insertPoint = defaultInsertPoint();
  openEntityPicker("creature", { token: true });
});
for (const [color, name] of TOKEN_COLORS) {
  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "token-swatch";
  swatch.dataset.contextAction = "token-color";
  swatch.dataset.color = color;
  swatch.style.setProperty("--swatch", color);
  swatch.title = name;
  swatch.setAttribute("aria-label", `Колір токена: ${name}`);
  tokenColorsMenu.append(swatch);
}
toggleLayersButton.addEventListener("click", () => setLayersOpen(!layersOpen));
togglePartyButton.addEventListener("click", () => setPartyOpen(!partyOpen));
document.querySelector("#party-refresh").addEventListener("click", () => {
  partyMonitor?.refreshNow().catch((error) => showToast(error.message));
});
partyList.addEventListener("click", (event) => {
  const card = event.target.closest(".party-card[role=button]");
  if (card) showPartyDetails(card.dataset.slug);
});
partyList.addEventListener("keydown", (event) => {
  const card = event.target.closest(".party-card[role=button]");
  if (!card || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  showPartyDetails(card.dataset.slug);
});
for (const overlay of [canvasActions, ...document.querySelectorAll(".hud")]) {
  overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
}
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
layerActions.addEventListener("click", (event) => {
  const action = event.target.closest("[data-layer-action]")?.dataset.layerAction;
  if (action) changeZ(action);
});
document.querySelector("#battle-grid-close").addEventListener("click", () => finishBattleGrid(null));
document.querySelector("#battle-grid-cancel").addEventListener("click", () => finishBattleGrid(null));
battleGridDialog.addEventListener("close", () => finishBattleGrid(null));
battleGridColumns.addEventListener("input", () => { battleGridColumns.setCustomValidity(""); updateBattleGridHint(); });
battleGridRows.addEventListener("input", updateBattleGridHint);
battleGridForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const grid = enteredBattleGrid();
  if (!grid) {
    battleGridColumns.setCustomValidity("Вкажіть цілу кількість клітинок від 1 до 500");
    return battleGridColumns.reportValidity();
  }
  finishBattleGrid(grid);
});
dropChoice.addEventListener("click", (event) => {
  const kind = event.target.closest("[data-media-kind]")?.dataset.mediaKind;
  if (kind) processDrop(kind);
});
document.querySelector("#zoom-in").addEventListener("click", () => zoomAt(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2, 1.2));
document.querySelector("#zoom-out").addEventListener("click", () => zoomAt(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2, 1 / 1.2));
toast.addEventListener("click", () => { toast.hidden = true; });
document.querySelector("#close-entity-details").addEventListener("click", () => entityDetails.close());
entityDetails.addEventListener("click", (event) => {
  if (event.target === entityDetails) entityDetails.close();
});
entityDetails.addEventListener("close", resetDetailsTrail);
entityDetails.addEventListener("keydown", (event) => {
  if ((event.altKey && event.key === "ArrowLeft") || (event.key === "Backspace" && !event.target.closest("input, textarea"))) {
    if (!detailsTrail.length) return;
    event.preventDefault();
    detailsBack();
  } else if (event.key === "Enter" && event.target.classList?.contains("md-link-live")) {
    event.preventDefault();
    followDetailsLink(linkedDocument(event.target.dataset.slug));
  }
});
entityDetailsContent.addEventListener("click", (event) => {
  const player = event.target.closest(".party-details [data-entity-slug]");
  if (player) {
    const entity = entitiesBySlug.get(player.dataset.entitySlug);
    if (entity) showEntityDetails(entity);
    return;
  }
  const link = event.target.closest(".md-link-live");
  if (link) followDetailsLink(linkedDocument(link.dataset.slug));
});
entityDetailsContent.addEventListener("pointerover", (event) => {
  const link = event.target.closest(".md-link-live");
  if (!link) return;
  clearTimeout(linkPreviewTimer);
  linkPreviewTimer = setTimeout(() => showLinkPreview(link), 250);
});
entityDetailsContent.addEventListener("pointerout", (event) => {
  const link = event.target.closest(".md-link-live");
  if (link && !link.contains(event.relatedTarget)) hideLinkPreview();
});
entityDetailsContent.parentElement.addEventListener("scroll", hideLinkPreview, { passive: true });
function closeSceneRenameDialog() {
  if (sceneRenameDialog.open) sceneRenameDialog.close();
}
document.querySelector("#scene-rename-close").addEventListener("click", closeSceneRenameDialog);
document.querySelector("#scene-rename-cancel").addEventListener("click", closeSceneRenameDialog);
sceneRenameDialog.addEventListener("click", (event) => {
  if (event.target === sceneRenameDialog) closeSceneRenameDialog();
});
sceneRenameDialog.addEventListener("close", () => {
  renamingNodeId = null;
  renamingCreature = null;
});
sceneNameInput.addEventListener("input", () => sceneNameInput.setCustomValidity(""));
sceneRenameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (renamingCreature) return submitCreatureName();
  const node = findNode(layout, renamingNodeId);
  if (!node || !["scene", "music"].includes(node.type) || node.locked) return closeSceneRenameDialog();
  const title = sceneNameInput.value.trim();
  if (!title) {
    sceneNameInput.setCustomValidity("Вкажіть назву сцени");
    return sceneNameInput.reportValidity();
  }
  const currentTitle = node.type === "scene" ? node.title : musicTitle(node.title, node.url);
  if (title !== currentTitle) {
    const label = node.type === "scene" ? "Змінити назву сцени" : "Змінити назву музики";
    executeCommand(label, () => { node.title = title; });
  }
  closeSceneRenameDialog();
});
// Підпис, що збігається з номером за замовчуванням, у вузол не записується:
// про це подбає writeCreatures.
function submitCreatureName() {
  const { nodeId, index } = renamingCreature;
  const node = findNode(layout, nodeId);
  const creatures = node ? contextMenuCreatures(node) : null;
  if (!creatures || !creatures[index]) return closeSceneRenameDialog();
  const name = sceneNameInput.value.trim();
  if (!name) {
    sceneNameInput.setCustomValidity("Вкажіть назву істоти");
    return sceneNameInput.reportValidity();
  }
  if (name !== creatureLabel(creatures[index], index)) {
    executeCommand("Перейменувати істоту", () => {
      writeCreatures(node, creatures.with(index, { ...creatures[index], name }));
    });
  }
  closeSceneRenameDialog();
}

nodeContextMenu.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-context-action]")?.dataset.contextAction;
  if (!action || event.target.closest("button")?.disabled) return;
  const node = findNode(layout, contextMenuNodeId);
  const spot = contextMenuPoint;
  const creature = contextMenuCreature;
  closeContextMenu();
  if (action === "paste") return pasteFromMenu(spot);
  if (!node) return;
  setSelection([node.id]);
  if (action === "add-scene") addScene(node, spot?.world);
  else if (action === "rename") renameNode(node);
  else if (action === "lock") toggleLock();
  else if (action === "toggle-snap") toggleSnap(node);
  else if (action === "fit-battle-map") fitToStandard(node);
  else if (action === "rotate-right") rotateSelected(1);
  else if (action === "rotate-left") rotateSelected(-1);
  else if (action === "copy") copySelection();
  else if (action === "copy-image") copyAsImage(node);
  else if (action === "delete") await deleteSelected();
  else if (action === "details") showNodeDetails(node);
  else if (action === "toggle-summary") toggleSummary(node);
  else if (action === "add-creature") addCreature(node);
  else if (action === "rename-creature") renameCreature(node, creature);
  else if (action === "remove-creature") removeCreature(node, creature);
  else if (action === "token-color") setTokenColor(node, event.target.closest("[data-color]")?.dataset.color);
});
nodeContextMenu.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  // Кнопки палітри лежать у групі, що ховається цілком, тож видимість питаємо в розкладки.
  const buttons = [...nodeContextMenu.querySelectorAll("button:not(:disabled)")].filter((button) => button.offsetParent);
  const index = buttons.indexOf(document.activeElement);
  const direction = event.key === "ArrowDown" ? 1 : -1;
  buttons[(index + direction + buttons.length) % buttons.length]?.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!nodeContextMenu.hidden && !nodeContextMenu.contains(event.target)) closeContextMenu();
});
musicUrlInput.addEventListener("input", onMusicUrlInput);
musicTitleInput.addEventListener("input", () => { musicTitleEdited = true; });
for (const input of [musicUrlInput, musicTitleInput, musicStartInput]) {
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addMusic();
  });
}
document.querySelector("#music-add").addEventListener("click", addMusic);
for (const id of ["#music-cancel", "#music-close"]) {
  document.querySelector(id).addEventListener("click", () => musicDialog.close());
}
musicDialog.addEventListener("click", (event) => {
  if (event.target === musicDialog) musicDialog.close();
});
entitySearch.addEventListener("input", () => { pickerSelection = 0; renderEntityResults(); });
entitySearch.addEventListener("keydown", (event) => {
  const matches = filteredEntities();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    pickerSelection = Math.min(matches.length - 1, pickerSelection + 1);
    renderEntityResults();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    pickerSelection = Math.max(0, pickerSelection - 1);
    renderEntityResults();
  } else if (event.key === "Enter" && matches[pickerSelection]) {
    event.preventDefault();
    addEntity(matches[pickerSelection]);
  }
});

// Відкриття кампанії триває секунди — індексуються сотні карток, — тож поки
// воно йде, дошку закриває помітний шар зі спінером: видно, що клік
// спрацював і клацати вдруге не треба.
function showLoading(title, step = "") {
  loadingTitle.textContent = title;
  loadingStep.textContent = step;
  loadingScreen.hidden = false;
}

function hideLoading() {
  loadingScreen.hidden = true;
}

// `title` — що саме відкривається, якщо це вже відомо (назва зі списку).
async function loadBoard({ title = "Відкриваю кампанію…" } = {}) {
  showLoading(title, "Читаю розкладку…");
  try {
    await readBoard();
  } finally {
    hideLoading();
  }
}

async function readBoard() {
  const state = await storage.loadBoard();
  showLoading(`Відкриваю «${state.campaign}»…`, "Індексую картки й нотатки…");
  setStatus("Індексація карток…", "dirty");
  const [{ entities: loadedEntities, references: loadedReferences }, loadedNotes] = await Promise.all([storage.loadEntities(), storage.loadNotes()]);
  // Кампанія починається з чистого аркуша: мініатюри, підібрані кеглі, позиція
  // полотна й масштаб лінійки — її власні, а не тієї, що була відкрита до неї.
  boardConfig = state.config;
  campaignStateKey = state.campaignKey;
  thumbnails = newThumbnails();
  textRatioByBox.clear();
  nodeBorders.clear();
  hpAmountByNode.clear();
  statblockScrollByNode.clear();
  scene.replaceChildren();
  lastLayersSignature = null;
  setRouteMode(null);
  routeScale = parseScale(campaignSetting("route-scale"));
  const storedView = campaignSetting("viewport");
  view = loadView(storedView);
  entities = loadedEntities;
  entitiesBySlug = new Map(entities.map((entity) => [entity.slug, entity]));
  referencesBySlug = new Map((loadedReferences ?? []).map((reference) => [reference.slug, reference]));
  notesByRef = new Map(loadedNotes.map((note) => [note.reference, note]));
  layout = state.layout;
  revision = state.revision;
  clearTimeout(saveTimer);
  saveTimer = null;
  dirty = false;
  resolveConflict();
  setSelection([]);
  undoStack = [];
  redoStack = [];
  campaignNameLabel.textContent = state.campaign;
  document.title = `${state.campaign} — дошка`;
  connectionScreen.hidden = true;
  render();
  applyView();
  if (layout.children.length && !storedView) fitAll();
  setupParty();
  setStatus("Збережено");
}

// Дошка, з якої вже пішли: сховище дивиться в іншу теку, тож від старої
// розкладки не має лишитися нічого, що могло б туди записатися.
function closeBoard() {
  clearTimeout(saveTimer);
  saveTimer = null;
  clearTimeout(hitPointEdit?.timer);
  hitPointEdit = null;
  dirty = false;
  interaction = null;
  editingNoteId = null;
  layout = null;
  setSelection([]);
  undoStack = [];
  redoStack = [];
  scene.replaceChildren();
  layerTree.replaceChildren();
  stopParty();
  togglePartyButton.hidden = true;
  setPartyOpen(false, false);
  emptyState.hidden = true;
  setRouteMode(null);
  campaignNameLabel.textContent = "Кампанію не відкрито";
  document.title = "Дошка кампанії";
  setStatus("Оберіть кампанію");
}

// Перш ніж перейти до іншої кампанії, поточна має лягти на диск: інакше її
// незбережене або пропало б, або поїхало б у чужу теку.
async function settleBoard() {
  if (conflicted) {
    showToast("Спершу виріши конфлікт canvas.json у цій кампанії");
    return false;
  }
  flushSave();
  const started = Date.now();
  while (hasUnsavedWork() && !conflicted && Date.now() - started < 10_000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (conflicted || hasUnsavedWork()) {
    showToast("Поточну кампанію не вдалося зберегти — перехід скасовано");
    return false;
  }
  return true;
}

function formatOpenedAt(openedAt) {
  if (!openedAt) return "";
  return new Date(openedAt).toLocaleDateString("uk", { day: "numeric", month: "long" });
}

// Нещодавні кампанії — одним кліком, без пошуку теки в системному вікні.
async function renderRecentCampaigns() {
  const recent = await storage.recent();
  recentCampaigns.hidden = recent.length === 0;
  openCampaignLabel.textContent = recent.length ? "Інша тека…" : "Обрати теку кампанії";
  recentCampaigns.replaceChildren(...recent.map((entry) => {
    const row = document.createElement("div");
    row.className = "recent-campaign";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "recent-open";
    open.dataset.campaign = entry.id;
    const name = document.createElement("strong");
    name.textContent = entry.name;
    const details = document.createElement("small");
    const opened = formatOpenedAt(entry.openedAt);
    details.textContent = opened ? `${entry.folder} · ${opened}` : entry.folder;
    open.append(name, details);
    open.addEventListener("click", () => connectCampaign({ id: entry.id, name: entry.name }));
    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "recent-forget";
    forget.title = `Забути «${entry.name}» (тека лишиться на диску)`;
    forget.setAttribute("aria-label", forget.title);
    forget.append(iconElement("close"));
    forget.addEventListener("click", async () => {
      await storage.forget(entry.id);
      await renderRecentCampaigns();
    });
    row.append(open, forget);
    return row;
  }));
}

async function showConnectionScreen({ hint = null } = {}) {
  // Спершу свіжий список, потім екран: інакше на мить проступив би список із
  // минулого разу в старому порядку — і клік міг би влучити не в ту кампанію.
  await renderRecentCampaigns();
  // Повернутися можна лише туди, де вже щось відкрито.
  cancelCampaignButton.hidden = !layout;
  if (hint !== null) connectionHint.textContent = hint;
  connectionScreen.hidden = false;
  // Сторінка стартує під шаром «Завантаження…». Якщо браузер забув дозвіл на
  // теку, запамʼятована кампанія сама не відкриється — і шар мусить зійти,
  // інакше він назавжди закриє список, з якого цей дозвіл дають кліком.
  hideLoading();
}

function setConnectionBusy(busy) {
  for (const button of connectionScreen.querySelectorAll("button")) button.disabled = busy;
}

// `{ id, name }` — одна з нещодавніх кампаній, без нього — системний вибір теки.
async function connectCampaign(target = {}) {
  if (layout && hasUnsavedWork()) showLoading(`Зберігаю «${campaignNameLabel.textContent}»…`, "Перед переходом до іншої кампанії");
  if (layout && !(await settleBoard())) return hideLoading();
  setConnectionBusy(true);
  const title = target.name ? `Відкриваю «${target.name}»…` : "Відкриваю кампанію…";
  // Зі списку відкриття починається одразу; системне вікно вибору теки своє,
  // тож шар зʼявляється вже після того, як теку обрали.
  if (target.id) showLoading(title, "Перевіряю доступ до теки…");
  else connectionHint.textContent = "Очікую вибір теки…";
  try {
    await storage.connect({ id: target.id ?? null });
    closeBoard();
    await loadBoard({ title });
    connectionHint.textContent = "";
  } catch (error) {
    hideLoading();
    if (error.name === "AbortError") connectionHint.textContent = "Вибір скасовано.";
    else {
      connectionHint.textContent = error.message;
      showToast(error.message);
    }
  } finally {
    setConnectionBusy(false);
    if (!connectionScreen.hidden) await showConnectionScreen();
  }
}

openCampaignButton.addEventListener("click", () => connectCampaign());
changeCampaignButton.addEventListener("click", () => showConnectionScreen({ hint: "" }));
cancelCampaignButton.addEventListener("click", () => { connectionScreen.hidden = true; });

for (const element of document.querySelectorAll("[data-icon]")) {
  element.prepend(iconElement(element.dataset.icon));
}

try {
  storage = trackStorageWrites(await createStorage());
  if (storage.kind !== "directory") {
    changeCampaignButton.disabled = true;
    changeCampaignButton.title = "Сервер відкрито на одну кампанію (--base)";
  }
  if (await storage.restore()) await loadBoard();
  else {
    await showConnectionScreen();
    setStatus("Оберіть кампанію");
  }
} catch (error) {
  await showConnectionScreen({ hint: error.message }).catch(() => {});
  setStatus("Помилка завантаження", "error");
  showToast(error.message);
}
