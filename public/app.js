import {
  WORLD_SIZE,
  absoluteRect,
  allAbsoluteRects,
  cloneLayout,
  deepestContainerAt,
  deepestNodeAt,
  findEntry,
  findNode,
  reparentNode,
  reorderNode,
} from "./model.js";
import { createStorage } from "./storage.js";

const MIN_SCALE = 0.08;
const MAX_SCALE = 4;
const SAVE_DELAY = 450;

const viewport = document.querySelector("#viewport");
const scene = document.querySelector("#scene");
const grid = document.querySelector("#grid");
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
const storedView = localStorage.getItem("crown-board.viewport");
let view = loadView();

function loadView() {
  try {
    return { x: innerWidth / 2 - WORLD_SIZE / 2, y: innerHeight / 2 - WORLD_SIZE / 2, scale: 1, ...JSON.parse(storedView) };
  } catch {
    return { x: innerWidth / 2 - WORLD_SIZE / 2, y: innerHeight / 2 - WORLD_SIZE / 2, scale: 1 };
  }
}

function persistView() {
  localStorage.setItem("crown-board.viewport", JSON.stringify(view));
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function layoutsEqual(first, second) { return JSON.stringify(first) === JSON.stringify(second); }
function nodeLabel(node) { return node.type === "image" ? node.image.split("/").at(-1) : (node.title || "Без назви"); }

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

function applyView() {
  scene.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  grid.style.backgroundSize = `${24 * view.scale}px ${24 * view.scale}px`;
  grid.style.backgroundPosition = `${view.x}px ${view.y}px`;
  document.querySelector("#zoom-value").textContent = `${Math.round(view.scale * 100)}%`;
  persistView();
  updateImageSources();
}

function render() {
  scene.replaceChildren(...layout.children.map((node) => renderNode(node)));
  renderLayers();
  emptyState.hidden = layout.children.length !== 0;
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function updateNodeGeometry(node) {
  const element = [...scene.querySelectorAll(".node")].find((candidate) => candidate.dataset.id === node.id);
  if (!element) return;
  element.style.left = `${node.x}%`;
  element.style.top = `${node.y}%`;
  element.style.width = `${node.width}px`;
  element.style.height = `${node.height}px`;
}

function renderNode(node) {
  const element = document.createElement("article");
  element.className = `node${node.id === selectedId ? " selected" : ""}${node.locked ? " locked" : ""}`;
  element.dataset.id = node.id;
  element.style.left = `${node.x}%`;
  element.style.top = `${node.y}%`;
  element.style.width = `${node.width}px`;
  element.style.height = `${node.height}px`;
  if (node.type === "image") {
    element.classList.add("image-node");
    const image = document.createElement("img");
    image.className = "node-image";
    image.dataset.id = node.id;
    image.alt = nodeLabel(node);
    image.draggable = false;
    setImageSource(image, node, node.width * view.scale < 900);
    image.addEventListener("pointerdown", onNodePointerDown);
    element.append(image);
    const label = document.createElement("span");
    label.className = "image-label";
    label.textContent = nodeLabel(node);
    element.append(label);
  } else {
    const header = document.createElement("div");
    header.className = "node-header";
    header.dataset.id = node.id;
    header.innerHTML = `<span class="node-glyph">◇</span><span class="node-title"></span>${node.locked ? '<span class="node-lock-indicator">●</span>' : ""}`;
    header.querySelector(".node-title").textContent = nodeLabel(node);
    header.addEventListener("pointerdown", onNodePointerDown);
    element.append(header);

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
      row.innerHTML = `<span class="layer-glyph">${node.type === "image" ? "▧" : "◇"}</span><span class="layer-title"></span><button class="layer-lock" type="button"></button>`;
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
      fragment.append(row);
      appendRows(node.children, depth + 1);
    });
  };
  appendRows(layout.children);
  layerTree.replaceChildren(fragment);
  layerActions.hidden = !selectedId;
}

function select(id) {
  if (selectedId === id) return;
  selectedId = id;
  render();
}

function screenToWorld(clientX, clientY) {
  const bounds = viewport.getBoundingClientRect();
  return { x: (clientX - bounds.left - view.x) / view.scale, y: (clientY - bounds.top - view.y) / view.scale };
}

function executeCommand(label, mutate) {
  const before = cloneLayout(layout);
  const beforeSelection = selectedId;
  if (mutate() === false || layoutsEqual(before, layout)) return false;
  undoStack.push({ label, before, after: cloneLayout(layout), beforeSelection, afterSelection: selectedId });
  redoStack = [];
  render();
  changed();
  return true;
}

function commitLiveCommand(label, before, beforeSelection) {
  if (layoutsEqual(before, layout)) {
    render();
    return false;
  }
  undoStack.push({ label, before, after: cloneLayout(layout), beforeSelection, afterSelection: selectedId });
  redoStack = [];
  render();
  changed();
  return true;
}

function undo() {
  const command = undoStack.pop();
  if (!command) return;
  redoStack.push(command);
  layout = cloneLayout(command.before);
  selectedId = command.beforeSelection;
  render();
  changed();
}

function redo() {
  const command = redoStack.pop();
  if (!command) return;
  undoStack.push(command);
  layout = cloneLayout(command.after);
  selectedId = command.afterSelection;
  render();
  changed();
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
      x: clamp((center.x - width / 2) / WORLD_SIZE * 100, 0, 100),
      y: clamp((center.y - height / 2) / WORLD_SIZE * 100, 0, 100),
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
    let width = Math.max(80, interaction.originWidth + (west ? -worldDx : worldDx));
    let height = Math.max(60, interaction.originHeight + (north ? -worldDy : worldDy));
    if (interaction.aspect) {
      const widthChange = Math.abs(width / interaction.originWidth - 1);
      const heightChange = Math.abs(height / interaction.originHeight - 1);
      if (widthChange >= heightChange) height = width / interaction.aspect;
      else width = height * interaction.aspect;
      if (width < 80) { width = 80; height = width / interaction.aspect; }
      if (height < 60) { height = 60; width = height * interaction.aspect; }
    }
    interaction.node.width = width;
    interaction.node.height = height;
    if (west) interaction.node.x = clamp((interaction.originX + interaction.originWidth - width) / interaction.parentWidth * 100, 0, 100);
    if (north) interaction.node.y = clamp((interaction.originY + interaction.originHeight - height) / interaction.parentHeight * 100, 0, 100);
  }
  updateNodeGeometry(interaction.node);
}

function endInteraction(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  if (interaction.type === "move") {
    const rect = absoluteRect(layout, interaction.node.id);
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const parent = deepestContainerAt(layout, point, interaction.node.id);
    const reparented = reparentNode(layout, interaction.node.id, parent?.id ?? null);
    if (!reparented) {
      interaction.node.x = clamp(interaction.node.x, 0, 100);
      interaction.node.y = clamp(interaction.node.y, 0, 100);
    }
    commitLiveCommand("Перемістити вузол", interaction.before, interaction.beforeSelection);
  } else if (interaction.type === "resize") {
    commitLiveCommand("Змінити розмір", interaction.before, interaction.beforeSelection);
  }
  interaction = null;
  viewport.classList.remove("panning");
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
    node.x = clamp(node.x + dx / parentWidth * 100, 0, 100);
    node.y = clamp(node.y + dy / parentHeight * 100, 0, 100);
  });
}

function deleteSelected() {
  const entry = findEntry(layout, selectedId);
  if (!entry || entry.node.locked) return;
  executeCommand("Видалити вузол", () => {
    entry.children.splice(entry.index, 1);
    selectedId = null;
  });
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
          x: clamp((drop.point.x + offset - parentRect.x) / parentRect.width * 100, 0, 100),
          y: clamp((drop.point.y + offset - parentRect.y) / parentRect.height * 100, 0, 100),
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
  const worldX = (localX - view.x) / view.scale;
  const worldY = (localY - view.y) / view.scale;
  const nextScale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  view.x = localX - worldX * nextScale;
  view.y = localY - worldY * nextScale;
  view.scale = nextScale;
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
  view.scale = clamp(Math.min((viewport.clientWidth - margin * 2) / Math.max(1, maxX - minX), (viewport.clientHeight - margin * 2) / Math.max(1, maxY - minY)), MIN_SCALE, MAX_SCALE);
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
  if (event.target.matches("input, textarea, [contenteditable=true]")) return;
  if (!layout) return;
  const command = event.ctrlKey || event.metaKey;
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

document.querySelector("#add-frame").addEventListener("click", addFrame);
document.querySelector("#empty-add").addEventListener("click", addFrame);
document.querySelector("#fit-all").addEventListener("click", fitAll);
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
document.querySelector("#zoom-value").addEventListener("click", () => { view.scale = 1; applyView(); });
toast.addEventListener("click", () => { toast.hidden = true; });

async function loadBoard() {
  const state = await storage.loadBoard();
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

async function connectCampaign() {
  openCampaignButton.disabled = true;
  connectionHint.textContent = "Очікую вибір папки…";
  try {
    await storage.connect();
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

openCampaignButton.addEventListener("click", connectCampaign);
changeCampaignButton.addEventListener("click", connectCampaign);

try {
  storage = await createStorage();
  changeCampaignButton.hidden = storage.kind !== "directory";
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
