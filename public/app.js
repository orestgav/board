import {
  WORLD_SIZE,
  absoluteRect,
  allAbsoluteRects,
  cloneLayout,
  containerGrid,
  deepestContainerAt,
  deepestNodeAt,
  findEntry,
  findNode,
  nearestAncestor,
  nearestPointParent,
  reparentNode,
  reorderNode,
} from "./model.js";
import { createStorage } from "./storage.js";
import { linkedEntities, matchesEntity } from "./entities.js";
import { mapSlugFromPath } from "./notes.js";
import { centeredViewOnRect, frameHeaderHeight, maximumScaleForNodes, minimumScaleForNodes, nodeVisualScale, rebasedView, zoomedViewAt } from "./view.js";

const MIN_NODE_SIZE = Number.EPSILON;
const MIN_LARGEST_NODE_PIXELS = 32;
const MAX_ZOOM_VIEWPORT_PADDING = 32;
const SAVE_DELAY = 450;
const ENTITY_CARD = { width: 320, height: 190 };
const FRAME_SIZE = { width: 360, height: 230 };
const CONTAINER_GAP = 24;
const CONTAINER_PADDING = 28;

// Типи карток із власним виглядом і власною кнопкою на полотні. Решта типів
// поки малюється спільною карткою й додається кнопкою «Картка».
const ENTITY_KINDS = {
  location: {
    glyph: "⬡",
    variant: "frame",
    members: "npc",
    command: "Додати локацію",
    pickerTitle: "Локація з репозиторію",
    searchPlaceholder: "Назва або slug локації…",
  },
};

const viewport = document.querySelector("#viewport");
const scene = document.querySelector("#scene");
const grid = document.querySelector("#grid");
const workspace = document.querySelector(".workspace");
const toggleLayersButton = document.querySelector("#toggle-layers");
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
const addEntityButton = document.querySelector("#add-entity");
const addLocationButton = document.querySelector("#add-location");
const entityPicker = document.querySelector("#entity-picker");
const entitySearch = document.querySelector("#entity-search");
const entityResults = document.querySelector("#entity-results");
const pickerTitle = document.querySelector("#entity-picker-title");
const entityDetails = document.querySelector("#entity-details");
const entityDetailsContent = document.querySelector("#entity-details-content");

let storage;
let layout;
let revision;
let selectedId = null;
let saveTimer = null;
let saving = false;
let saveAgain = false;
let interaction = null;
let spacePressed = false;
let undoStack = [];
let redoStack = [];
let pendingDrop = null;
let entities = [];
let entitiesBySlug = new Map();
let notesByRef = new Map();
let boardConfig = null;
let editingNoteId = null;
let historyBusy = false;
const newNoteIds = new Set();
let pendingNoteInput = null;
let pickerSelection = 0;
let pickerType = null;
let insertPoint = null;
let renderOrigin = { x: 0, y: 0 };
let layersOpen = localStorage.getItem("crown-board.layers-open") === "true";
const storedView = localStorage.getItem("crown-board.viewport");
let view = loadView();

function setLayersOpen(open, persist = true) {
  layersOpen = open;
  workspace.classList.toggle("layers-open", open);
  toggleLayersButton.textContent = open ? "←" : "☰";
  toggleLayersButton.title = open ? "Закрити шари" : "Відкрити шари";
  toggleLayersButton.setAttribute("aria-label", toggleLayersButton.title);
  toggleLayersButton.setAttribute("aria-expanded", String(open));
  if (persist) localStorage.setItem("crown-board.layers-open", String(open));
}

setLayersOpen(layersOpen, false);

function loadView() {
  try {
    const loaded = { x: innerWidth / 2 - WORLD_SIZE / 2, y: innerHeight / 2 - WORLD_SIZE / 2, scale: 1, ...JSON.parse(storedView) };
    if (!Number.isFinite(loaded.x) || !Number.isFinite(loaded.y) || !Number.isFinite(loaded.scale) || loaded.scale <= 0) throw new Error("Invalid viewport");
    return loaded;
  } catch {
    return { x: innerWidth / 2 - WORLD_SIZE / 2, y: innerHeight / 2 - WORLD_SIZE / 2, scale: 1 };
  }
}

function persistView() {
  localStorage.setItem("crown-board.viewport", JSON.stringify(view));
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function layoutsEqual(first, second) { return JSON.stringify(first) === JSON.stringify(second); }
function nodeLabel(node) {
  if (node.type === "image") return node.image.split("/").at(-1);
  if (node.type === "entity") return entitiesBySlug.get(node.entity)?.name ?? `[[${node.entity}]]`;
  if (node.type === "note") return notesByRef.get(node.note)?.text.split("\n").find((line) => line.trim())?.slice(0, 60) || "Нотатка";
  return node.title || "Без назви";
}

function nodeEntity(node) {
  return node.type === "entity" ? entitiesBySlug.get(node.entity) ?? null : null;
}

function entityKind(entity) {
  return ENTITY_KINDS[entity?.type] ?? null;
}

function nodeVariant(node) {
  return entityKind(nodeEntity(node))?.variant ?? node.type;
}

function plainSummary(source) {
  return source.replace(/<!--.*?-->/gs, "").replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/[*_`>#-]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

async function setDirectImageSource(image, path) {
  try { image.src = await storage.mediaUrl(path, false); } catch (error) { console.warn(error); }
}

async function setImageSource(image, node, thumbnail) {
  const key = `${thumbnail ? "thumb" : "full"}:${node.image}`;
  image.dataset.sourceKey = key;
  try {
    const url = await storage.mediaUrl(node.image, thumbnail);
    if (image.dataset.sourceKey === key) image.src = url;
  } catch (error) {
    console.warn(error);
  }
}

function updateImageSources() {
  if (!layout) return;
  document.querySelectorAll(".node-image").forEach((image) => {
    const node = findNode(layout, image.closest(".node").dataset.id);
    if (!node) return;
    const full = node.width * view.scale >= 900;
    setImageSource(image, node, !full);
  });
}

function boardScaleLimits() {
  if (!layout) return { minimum: 0, maximum: Infinity };
  const rects = allAbsoluteRects(layout);
  const minimum = minimumScaleForNodes(rects, MIN_LARGEST_NODE_PIXELS);
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

function applyView() {
  constrainViewScale();
  const rebased = rebasedView(view, viewport.clientWidth, viewport.clientHeight);
  renderOrigin = { x: rebased.originX, y: rebased.originY };
  scene.style.transform = `translate(${rebased.translateX}px, ${rebased.translateY}px) scale(${view.scale})`;
  updateRootRenderPositions();
  scene.style.setProperty("--resize-handle-size", `${13 / view.scale}px`);
  scene.style.setProperty("--resize-handle-offset", `${-6.5 / view.scale}px`);
  scene.style.setProperty("--resize-handle-border", `${2 / view.scale}px`);
  scene.style.setProperty("--resize-handle-radius", `${3 / view.scale}px`);
  const gridSize = 24 * view.scale;
  grid.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  grid.style.backgroundPosition = `${view.x % gridSize}px ${view.y % gridSize}px`;
  persistView();
  updateImageSources();
  document.querySelectorAll(".entity-node").forEach((element) => {
    const node = findNode(layout, element.dataset.id);
    if (node) element.classList.toggle("entity-far", node.width * view.scale < 180);
  });
}

function render() {
  scene.replaceChildren(...layout.children.map((node) => renderNode(node, true)));
  renderLayers();
  emptyState.hidden = layout.children.length !== 0;
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
  if (constrainViewScale()) applyView();
}

function updateNodeGeometry(node) {
  const element = [...scene.querySelectorAll(".node")].find((candidate) => candidate.dataset.id === node.id);
  if (!element) return;
  updateNodePosition(element, node);
  element.style.width = `${node.width}px`;
  element.style.height = `${node.height}px`;
  element.style.fontSize = `${nodeVisualScale(node, nodeVariant(node))}px`;
}

function updateNodePosition(element, node) {
  if (element.dataset.root === "true") {
    element.style.left = `${node.x * WORLD_SIZE / 100 - renderOrigin.x}px`;
    element.style.top = `${node.y * WORLD_SIZE / 100 - renderOrigin.y}px`;
  } else {
    element.style.left = `${node.x}%`;
    element.style.top = `${node.y}%`;
  }
}

function updateRootRenderPositions() {
  layout?.children.forEach((node) => {
    const element = [...scene.children].find((candidate) => candidate.dataset.id === node.id);
    if (element) updateNodePosition(element, node);
  });
}

function renderNode(node, isRoot = false) {
  const element = document.createElement("article");
  element.className = `node${node.id === selectedId ? " selected" : ""}${node.locked ? " locked" : ""}`;
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
    dragHandle.addEventListener("pointerdown", onNodePointerDown);
    element.append(dragHandle);
    const note = notesByRef.get(node.note);
    if (editingNoteId === node.id) {
      const indicator = document.createElement("span");
      indicator.className = "note-editing-indicator";
      indicator.textContent = "Редагування";
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
        editor.setSelectionRange(position, position);
      });
    } else {
      const content = document.createElement("div");
      content.className = "note-content";
      content.textContent = note?.text || `Не знайдено ${node.note}`;
      content.addEventListener("pointerdown", (event) => event.stopPropagation());
      content.addEventListener("click", (event) => {
        event.stopPropagation();
        if (node.locked) return;
        selectedId = node.id;
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
      missing.addEventListener("click", () => select(node.id));
      element.append(missing);
    } else if (kind?.variant === "frame") {
      // Локація — контейнер: лише шапка з назвою, без портрета й «На дошці».
      element.classList.add("location-node");
      element.append(frameHeader(node, kind.glyph));
    } else {
      element.classList.add("entity-node");
      element.classList.toggle("entity-far", node.width * view.scale < 180);
      const header = document.createElement("div");
      header.className = "node-header";
      header.dataset.id = node.id;
      header.innerHTML = '<span class="node-glyph">◇</span><span class="node-title"></span><span class="entity-type"></span>';
      header.querySelector(".node-title").textContent = entity.name;
      header.querySelector(".entity-type").textContent = entity.type;
      header.addEventListener("pointerdown", onNodePointerDown);
      element.append(header);

      const content = document.createElement("div");
      content.className = `entity-content${entity.portrait ? "" : " no-portrait"}`;
      if (entity.portrait) {
        const portrait = document.createElement("img");
        portrait.className = "entity-portrait";
        portrait.alt = "";
        portrait.draggable = false;
        setDirectImageSource(portrait, entity.portrait);
        content.append(portrait);
      }
      const summary = document.createElement("p");
      summary.className = "entity-summary";
      summary.textContent = entity.summary ? plainSummary(entity.summary) : "Немає секції «На дошці»";
      content.append(summary);
      content.addEventListener("click", (event) => {
        event.stopPropagation();
        select(node.id);
        showEntityDetails(entity);
      });
      element.append(content);
    }
  } else if (node.type === "image") {
    element.classList.add("image-node");
    const image = document.createElement("img");
    image.className = "node-image";
    image.dataset.id = node.id;
    image.alt = nodeLabel(node);
    image.draggable = false;
    setImageSource(image, node, node.width * view.scale < 900);
    image.addEventListener("pointerdown", onNodePointerDown);
    element.append(image);
  } else {
    element.append(frameHeader(node, "◇"));

    const body = document.createElement("div");
    body.className = "node-body";
    body.textContent = node.children.length ? "" : "Рамка для вмісту";
    element.append(body);
  }
  element.append(...node.children.map((child) => renderNode(child)));

  if (node.id === selectedId && !node.locked) {
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = document.createElement("span");
      handle.className = `resize-handle ${corner}`;
      handle.dataset.corner = corner;
      handle.dataset.id = node.id;
      handle.addEventListener("pointerdown", onResizePointerDown);
      element.append(handle);
    }
  }
  return element;
}

function frameHeader(node, glyph) {
  const header = document.createElement("div");
  header.className = "node-header";
  header.dataset.id = node.id;
  header.innerHTML = `<span class="node-glyph">${glyph}</span><span class="node-title"></span>${node.locked ? '<span class="node-lock-indicator">●</span>' : ""}`;
  header.querySelector(".node-title").textContent = nodeLabel(node);
  header.addEventListener("pointerdown", onNodePointerDown);
  return header;
}

function layerGlyph(node) {
  const kind = entityKind(nodeEntity(node));
  if (kind) return kind.glyph;
  return node.type === "image" ? "▧" : node.type === "entity" ? "◈" : node.type === "note" ? "✦" : "◇";
}

function renderLayers() {
  if (!layout.children.length) {
    layerTree.innerHTML = '<div class="layer-empty">Вузли з’являться тут після створення першої рамки.</div>';
    layerActions.hidden = true;
    return;
  }
  const fragment = document.createDocumentFragment();
  const appendRows = (children, depth = 0) => {
    children.forEach((node) => {
      const row = document.createElement("div");
      row.className = `layer-row${node.id === selectedId ? " selected" : ""}${node.locked ? " locked" : ""}`;
      row.style.setProperty("--depth", depth);
      row.dataset.id = node.id;
      row.innerHTML = `<span class="layer-glyph">${layerGlyph(node)}</span><span class="layer-title"></span><button class="layer-lock" type="button"></button>`;
      row.querySelector(".layer-title").textContent = nodeLabel(node);
      const lock = row.querySelector(".layer-lock");
      lock.textContent = node.locked ? "●" : "○";
      lock.title = node.locked ? "Розблокувати" : "Заблокувати";
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
      appendRows(node.children, depth + 1);
    });
  };
  appendRows(layout.children);
  layerTree.replaceChildren(fragment);
  layerActions.hidden = !selectedId;
}

function centerNode(id) {
  const rect = absoluteRect(layout, id);
  if (!rect) return;
  selectedId = id;
  view = centeredViewOnRect(view, rect, viewport.clientWidth, viewport.clientHeight);
  render();
  applyView();
}

function select(id) {
  if (selectedId === id) return;
  selectedId = id;
  render();
}

function beginNoteEdit(node, key = null) {
  if (!node || node.type !== "note" || node.locked) return false;
  selectedId = node.id;
  editingNoteId = node.id;
  pendingNoteInput = key ? { id: node.id, key } : null;
  render();
  return true;
}

function screenToWorld(clientX, clientY) {
  const bounds = viewport.getBoundingClientRect();
  return { x: (clientX - bounds.left - view.x) / view.scale, y: (clientY - bounds.top - view.y) / view.scale };
}

function executeCommand(label, mutate, metadata = {}) {
  const before = cloneLayout(layout);
  const beforeSelection = selectedId;
  if (mutate() === false || layoutsEqual(before, layout)) return false;
  undoStack.push({ label, before, after: cloneLayout(layout), beforeSelection, afterSelection: selectedId, ...metadata });
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
  undoStack.push({ label, before, after: cloneLayout(layout), beforeSelection, afterSelection: selectedId, ...metadata });
  redoStack = [];
  render();
  changed();
  return true;
}

async function applyHistory(command, direction) {
  const target = cloneLayout(direction === "undo" ? command.before : command.after);
  if (command.noteLifecycle) {
    const effect = command.noteLifecycle;
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
  if (command.noteMove) {
    const current = findNode(layout, command.noteMove.nodeId);
    const destination = direction === "undo" ? command.noteMove.beforeMap : command.noteMove.afterMap;
    if (!current || !destination) throw new Error("Не вдалося відновити контекст перенесеної нотатки");
    const previousReference = current.note;
    const moved = await storage.moveNote(previousReference, destination.slug, destination.name);
    notesByRef.delete(previousReference);
    notesByRef.set(moved.reference, moved);
    const targetNode = findNode(target, command.noteMove.nodeId);
    if (!targetNode) throw new Error("Не знайдено нотатку в історії команд");
    targetNode.note = moved.reference;
    const snapshot = direction === "undo" ? command.before : command.after;
    findNode(snapshot, command.noteMove.nodeId).note = moved.reference;
    updateNoteHistoryReference(command.noteMove.nodeId, moved.reference);
  }
  layout = target;
  selectedId = direction === "undo" ? command.beforeSelection : command.afterSelection;
}

function updateNoteHistoryReference(nodeId, reference) {
  for (const command of [...undoStack, ...redoStack]) {
    if (command.noteLifecycle?.nodeId === nodeId) command.noteLifecycle.reference = reference;
    const beforeNode = findNode(command.before, nodeId);
    const afterNode = findNode(command.after, nodeId);
    if (beforeNode?.type === "note") beforeNode.note = reference;
    if (afterNode?.type === "note") afterNode.note = reference;
  }
}

async function undo() {
  if (historyBusy) return;
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
  const command = redoStack.pop();
  if (!command) return;
  historyBusy = true;
  try {
    await applyHistory(command, "redo");
    undoStack.push(command);
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
    layout.children.push(node);
    selectedId = node.id;
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

function mapContext(tree, startId) {
  const map = nearestAncestor(tree, startId, isMapNode);
  if (!map) return null;
  const fileName = map.image.split("/").at(-1);
  return { node: map, slug: mapSlugFromPath(map.image), name: fileName.replace(/\.[^.]+$/, "") };
}

function noteMapContext(tree, noteId) {
  const entry = findEntry(tree, noteId);
  return mapContext(tree, entry?.parent?.id ?? null);
}

async function createNoteAt(point) {
  const parent = deepestNodeAt(layout, point, { includeLocked: true });
  const map = mapContext(layout, parent?.id ?? null);
  if (!map) return showToast("Нотатку можна створити лише всередині карти");
  setStatus("Створення нотатки…", "dirty");
  try {
    const note = await storage.createNote(map.slug, map.name, "");
    notesByRef.set(note.reference, note);
    const rect = parent ? absoluteRect(layout, parent.id) : { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
    const id = crypto.randomUUID();
    executeCommand("Створити нотатку", () => {
      const node = {
        id, type: "note", note: note.reference,
        x: (point.x - rect.x) / rect.width * 100,
        y: (point.y - rect.y) / rect.height * 100,
        width: 320, height: 190, locked: false, children: [],
      };
      (parent ? parent.children : layout.children).push(node);
      selectedId = id;
      editingNoteId = id;
      newNoteIds.add(id);
    }, { noteLifecycle: { kind: "create", nodeId: id, reference: note.reference, text: note.text } });
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

function openEntityPicker(type = null) {
  if (!layout) return;
  insertPoint ??= defaultInsertPoint();
  pickerType = type;
  pickerSelection = 0;
  pickerTitle.textContent = ENTITY_KINDS[type]?.pickerTitle ?? "Картка з репозиторію";
  entitySearch.placeholder = ENTITY_KINDS[type]?.searchPlaceholder ?? "Назва, slug або тип…";
  entitySearch.value = "";
  renderEntityResults();
  entityPicker.showModal();
  requestAnimationFrame(() => entitySearch.focus());
}

function filteredEntities() {
  return entities
    .filter((entity) => (!pickerType || entity.type === pickerType) && matchesEntity(entity, entitySearch.value))
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
      setDirectImageSource(image, entity.portrait);
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

function entityNode(entity, left, top, rect, size = ENTITY_CARD) {
  return {
    id: crypto.randomUUID(), type: "entity", entity: entity.slug,
    x: (left - rect.x) / rect.width * 100,
    y: (top - rect.y) / rect.height * 100,
    width: size.width, height: size.height, locked: false, children: [],
  };
}

// Локація лягає на полотно вже з картками, що вказали її у своєму полі
// location: вони розкладаються сіткою під шапкою контейнера.
function containerNode(entity, kind, point, rect) {
  const members = linkedEntities(entities, entity.slug, kind.members);
  const grid = containerGrid(members.length, {
    cell: ENTITY_CARD,
    gap: CONTAINER_GAP,
    padding: CONTAINER_PADDING,
    minimum: FRAME_SIZE,
    header: frameHeaderHeight,
  });
  const node = entityNode(entity, point.x - grid.width / 2, point.y - grid.height / 2, rect, grid);
  const inside = { x: 0, y: 0, width: grid.width, height: grid.height };
  node.children = members.map((member, index) => entityNode(member, grid.cells[index].x, grid.cells[index].y, inside));
  return node;
}

function addEntity(entity) {
  const point = insertPoint ?? defaultInsertPoint();
  const { parent, rect } = nearestPointParent(layout, point);
  const kind = entityKind(entity);
  const node = kind?.members ? containerNode(entity, kind, point, rect) : entityNode(entity, point.x, point.y, rect);
  executeCommand(kind?.command ?? "Додати картку", () => {
    (parent ? parent.children : layout.children).push(node);
    selectedId = node.id;
  });
  entityPicker.close();
}

function showEntityDetails(entity) {
  entityDetailsContent.replaceChildren();
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
  const body = document.createElement("pre");
  body.className = "entity-details-markdown";
  body.textContent = entity.body;
  entityDetailsContent.append(title, meta, path, body);
  entityDetails.hidden = false;
}

function onNodePointerDown(event) {
  if (event.button !== 0) return;
  event.stopPropagation();
  const node = findNode(layout, event.currentTarget.dataset.id);
  if (!node || node.locked) return;
  select(node.id);
  const entry = findEntry(layout, node.id);
  const parentWidth = entry.parent?.width ?? WORLD_SIZE;
  const parentHeight = entry.parent?.height ?? WORLD_SIZE;
  interaction = {
    type: "move", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    originX: node.x * parentWidth / 100, originY: node.y * parentHeight / 100,
    parentWidth, parentHeight, node, before: cloneLayout(layout), beforeSelection: selectedId,
  };
  viewport.setPointerCapture(event.pointerId);
}

function onResizePointerDown(event) {
  event.stopPropagation();
  const node = findNode(layout, event.currentTarget.dataset.id);
  if (!node || node.locked) return;
  const entry = findEntry(layout, node.id);
  const parentWidth = entry.parent?.width ?? WORLD_SIZE;
  const parentHeight = entry.parent?.height ?? WORLD_SIZE;
  interaction = {
    type: "resize", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    originX: node.x * parentWidth / 100, originY: node.y * parentHeight / 100,
    originWidth: node.width, originHeight: node.height, parentWidth, parentHeight,
    corner: event.currentTarget.dataset.corner, aspect: node.type === "image" ? node.width / node.height : null,
    node, before: cloneLayout(layout), beforeSelection: selectedId,
  };
  viewport.setPointerCapture(event.pointerId);
}

function beginPan(event) {
  interaction = { type: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
  viewport.classList.add("panning");
  viewport.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  insertPoint = screenToWorld(event.clientX, event.clientY);
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  const dx = event.clientX - interaction.startX;
  const dy = event.clientY - interaction.startY;
  if (interaction.type === "pan") {
    view.x = interaction.originX + dx;
    view.y = interaction.originY + dy;
    applyView();
    return;
  }
  const worldDx = dx / view.scale;
  const worldDy = dy / view.scale;
  if (interaction.type === "move") {
    // Під час drag координати навмисне можуть виходити за 0..100.
    // Інакше центр дитини ніколи не покине батьківський контейнер,
    // і геометричне переприв'язування на drop не зможе її витягнути.
    interaction.node.x = (interaction.originX + worldDx) / interaction.parentWidth * 100;
    interaction.node.y = (interaction.originY + worldDy) / interaction.parentHeight * 100;
  } else {
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
  }
  updateNodeGeometry(interaction.node);
}

async function endInteraction(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  const finished = interaction;
  interaction = null;
  viewport.classList.remove("panning");
  if (finished.type === "move") {
    const rect = absoluteRect(layout, finished.node.id);
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const parent = deepestContainerAt(layout, point, finished.node.id);
    reparentNode(layout, finished.node.id, parent?.id ?? null);
    let noteMove = null;
    if (finished.node.type === "note") {
      const oldMap = noteMapContext(finished.before, finished.node.id);
      const newMap = noteMapContext(layout, finished.node.id);
      if (!newMap) {
        layout = finished.before;
        selectedId = finished.beforeSelection;
        render();
        return showToast("Нотатка має залишатися всередині карти");
      }
      if (oldMap?.slug !== newMap.slug) {
        setStatus("Перенесення нотатки…", "dirty");
        try {
          const previousReference = finished.node.note;
          const moved = await storage.moveNote(previousReference, newMap.slug, newMap.name);
          notesByRef.delete(previousReference);
          notesByRef.set(moved.reference, moved);
          finished.node.note = moved.reference;
          noteMove = {
            nodeId: finished.node.id,
            beforeMap: { slug: oldMap.slug, name: oldMap.name },
            afterMap: { slug: newMap.slug, name: newMap.name },
          };
        } catch (error) {
          layout = finished.before;
          selectedId = finished.beforeSelection;
          render();
          setStatus("Помилка перенесення нотатки", "error");
          return showToast(error.message);
        }
      }
    }
    commitLiveCommand("Перемістити вузол", finished.before, finished.beforeSelection, noteMove ? { noteMove } : {});
  } else if (finished.type === "resize") {
    commitLiveCommand("Змінити розмір", finished.before, finished.beforeSelection);
  }
}

function toggleLock() {
  const node = findNode(layout, selectedId);
  if (!node) return;
  executeCommand(node.locked ? "Розблокувати вузол" : "Заблокувати вузол", () => { node.locked = !node.locked; });
}

function changeZ(operation) {
  if (!selectedId) return;
  executeCommand("Змінити z-порядок", () => reorderNode(layout, selectedId, operation));
}

function nudgeSelected(dx, dy) {
  const node = findNode(layout, selectedId);
  if (!node || node.locked) return;
  const entry = findEntry(layout, node.id);
  const parentWidth = entry.parent?.width ?? WORLD_SIZE;
  const parentHeight = entry.parent?.height ?? WORLD_SIZE;
  executeCommand("Посунути вузол", () => {
    node.x += dx / parentWidth * 100;
    node.y += dy / parentHeight * 100;
  });
}

async function deleteSelected() {
  const entry = findEntry(layout, selectedId);
  if (!entry || entry.node.locked) return;
  if (entry.node.type !== "note") {
    executeCommand("Видалити вузол", () => {
      entry.children.splice(entry.index, 1);
      selectedId = null;
    });
    return;
  }
  setStatus("Видалення нотатки…", "dirty");
  try {
    const note = await storage.deleteNote(entry.node.note);
    notesByRef.delete(entry.node.note);
    const nodeId = entry.node.id;
    executeCommand("Видалити нотатку", () => {
      const current = findEntry(layout, nodeId);
      if (!current) return false;
      current.children.splice(current.index, 1);
      selectedId = null;
    }, { noteLifecycle: { kind: "delete", nodeId, reference: note.reference, text: note.text } });
    newNoteIds.delete(nodeId);
  } catch (error) {
    setStatus("Помилка видалення нотатки", "error");
    showToast(error.message);
  }
}

function canvasBlob(bitmap, quality, maxDimension = null) {
  const scale = maxDimension ? Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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

async function processDrop(kind) {
  const drop = pendingDrop;
  pendingDrop = null;
  dropChoice.hidden = true;
  if (!drop || kind === "cancel") return;
  setStatus(`Обробка ${drop.files.length} зображень…`, "dirty");
  try {
    const media = [];
    for (const file of drop.files) media.push(await uploadImage(file, kind));
    const parent = deepestNodeAt(layout, drop.point, { includeLocked: true });
    const parentRect = parent ? absoluteRect(layout, parent.id) : { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
    executeCommand("Додати зображення", () => {
      const destination = parent ? parent.children : layout.children;
      media.forEach((item, index) => {
        const maxWidth = kind === "map" ? 900 : 480;
        const scale = Math.min(1, maxWidth / item.width);
        const width = Math.max(80, item.width * scale);
        const height = Math.max(60, item.height * scale);
        const offset = index * 28;
        const node = {
          id: crypto.randomUUID(), type: "image", image: item.path,
          x: (drop.point.x + offset - parentRect.x) / parentRect.width * 100,
          y: (drop.point.y + offset - parentRect.y) / parentRect.height * 100,
          width, height, locked: false, children: [],
        };
        destination.push(node);
        selectedId = node.id;
      });
    });
  } catch (error) {
    setStatus("Помилка імпорту", "error");
    showToast(error.message);
  }
}

function openDropChoice(files, event) {
  pendingDrop = { files, point: screenToWorld(event.clientX, event.clientY) };
  dropChoiceTitle.textContent = files.length === 1 ? "Що це за зображення?" : `Що це за зображення (${files.length})?`;
  dropChoice.hidden = false;
  const width = 390;
  dropChoice.style.left = `${clamp(event.clientX + 12, 12, innerWidth - width - 12)}px`;
  dropChoice.style.top = `${clamp(event.clientY + 12, 76, innerHeight - 150)}px`;
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
  applyView();
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

function setStatus(text, state = "") {
  status.textContent = text;
  status.dataset.state = state;
}

function changed() {
  setStatus("Є незбережені зміни", "dirty");
  if (saving) saveAgain = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY);
}

async function save() {
  clearTimeout(saveTimer);
  if (saving) { saveAgain = true; return; }
  saving = true;
  setStatus("Збереження…", "dirty");
  try {
    const result = await storage.saveLayout(layout, revision);
    revision = result.revision;
    if (!saveAgain) setStatus("Збережено");
  } catch (error) {
    saveAgain = false;
    setStatus("Помилка збереження", "error");
    showToast(error.message);
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; await save(); }
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
}

viewport.addEventListener("pointerdown", (event) => {
  viewport.focus();
  if (event.button === 1 || (event.button === 0 && spacePressed)) {
    event.preventDefault();
    beginPan(event);
  } else if (event.button === 0 && (event.target === viewport || event.target === grid || event.target === scene)) {
    if (event.altKey) {
      const node = deepestNodeAt(layout, screenToWorld(event.clientX, event.clientY), { includeLocked: true });
      select(node?.id ?? null);
    } else select(null);
  }
});
viewport.addEventListener("pointermove", onPointerMove);
viewport.addEventListener("pointerup", endInteraction);
viewport.addEventListener("pointercancel", endInteraction);
viewport.addEventListener("dblclick", (event) => {
  if (event.button !== 0 || !layout) return;
  const element = event.target instanceof Element ? event.target.closest(".node") : null;
  if (element) {
    const node = findNode(layout, element.dataset.id);
    if (!isMapNode(node)) return;
  }
  event.preventDefault();
  createNoteAt(screenToWorld(event.clientX, event.clientY));
});
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
  const files = [...event.dataTransfer.files].filter((file) => /^image\/(png|jpeg|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name));
  if (!files.length) return showToast("У дропі немає підтримуваних зображень");
  openDropChoice(files, event);
});

window.addEventListener("keydown", (event) => {
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!entityPicker.open) openEntityPicker();
    return;
  }
  if (event.target.matches("input, textarea, [contenteditable=true]")) return;
  if (!layout) return;
  const selectedNode = findNode(layout, selectedId);
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
});
window.addEventListener("keyup", (event) => { if (event.code === "Space") spacePressed = false; });
window.addEventListener("blur", () => { spacePressed = false; });
window.addEventListener("resize", applyView);

document.querySelector("#add-frame").addEventListener("click", addFrame);
document.querySelector("#empty-add").addEventListener("click", addFrame);
document.querySelector("#add-note").addEventListener("click", () => {
  if (layout) createNoteAt(defaultInsertPoint());
});
document.querySelector("#fit-all").addEventListener("click", fitAll);
addEntityButton.addEventListener("click", () => {
  insertPoint = defaultInsertPoint();
  openEntityPicker();
});
addLocationButton.addEventListener("click", () => {
  insertPoint = defaultInsertPoint();
  openEntityPicker("location");
});
toggleLayersButton.addEventListener("click", () => setLayersOpen(!layersOpen));
for (const overlay of [canvasActions, ...document.querySelectorAll(".hud")]) {
  overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
}
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
layerActions.addEventListener("click", (event) => {
  const action = event.target.closest("[data-layer-action]")?.dataset.layerAction;
  if (action) changeZ(action);
});
dropChoice.addEventListener("click", (event) => {
  const kind = event.target.closest("[data-media-kind]")?.dataset.mediaKind;
  if (kind) processDrop(kind);
});
document.querySelector("#zoom-in").addEventListener("click", () => zoomAt(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2, 1.2));
document.querySelector("#zoom-out").addEventListener("click", () => zoomAt(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2, 1 / 1.2));
toast.addEventListener("click", () => { toast.hidden = true; });
document.querySelector("#close-entity-details").addEventListener("click", () => { entityDetails.hidden = true; });
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

async function loadBoard() {
  const state = await storage.loadBoard();
  boardConfig = state.config;
  setStatus("Індексація карток…", "dirty");
  const [loadedEntities, loadedNotes] = await Promise.all([storage.loadEntities(), storage.loadNotes()]);
  entities = loadedEntities;
  entitiesBySlug = new Map(entities.map((entity) => [entity.slug, entity]));
  notesByRef = new Map(loadedNotes.map((note) => [note.reference, note]));
  layout = state.layout;
  revision = state.revision;
  selectedId = null;
  undoStack = [];
  redoStack = [];
  document.querySelector("#campaign-name").textContent = state.campaign;
  connectionScreen.hidden = true;
  render();
  applyView();
  if (layout.children.length && !storedView) fitAll();
  setStatus("Збережено");
}

async function connectCampaign(chooseNew = false) {
  openCampaignButton.disabled = true;
  connectionHint.textContent = "Очікую вибір папки…";
  try {
    await storage.connect(chooseNew);
    await loadBoard();
  } catch (error) {
    if (error.name !== "AbortError") {
      connectionHint.textContent = error.message;
      showToast(error.message);
    } else connectionHint.textContent = "Вибір скасовано.";
  } finally {
    openCampaignButton.disabled = false;
  }
}

openCampaignButton.addEventListener("click", () => connectCampaign(false));
changeCampaignButton.addEventListener("click", () => connectCampaign(true));

try {
  storage = await createStorage();
  if (storage.kind !== "directory") {
    changeCampaignButton.disabled = true;
    changeCampaignButton.title = "Кампанія";
  }
  if (await storage.restore()) await loadBoard();
  else {
    connectionScreen.hidden = false;
    setStatus("Оберіть кампанію");
  }
} catch (error) {
  connectionScreen.hidden = false;
  connectionHint.textContent = error.message;
  setStatus("Помилка завантаження", "error");
  showToast(error.message);
}
