// Вкладка на телевізорі. Сцену веде дошка: вона шле стан і самі картинки
// (у цієї вкладки нема доступу до теки кампанії), а тут їх лише малюють.
// Перетягування мишею — запасний спосіб підвинути карту; зсув іде на дошку,
// і вона ж розсилає новий стан.
import { CALIBRATION_INCHES, CAST_CHANNEL, itemFrame } from "./cast.js";

const stage = document.querySelector("#stage");
const calibration = document.querySelector("#calibration");
const hint = document.querySelector("#hint");
const fullscreenButton = document.querySelector("#fullscreen");
const channel = new BroadcastChannel(CAST_CHANNEL);

let state = null;
let ppi = 40;
const urls = new Map(); // path → object URL
const images = new Map(); // item id → <img>
let drag = null;

channel.addEventListener("message", ({ data }) => {
  if (data?.type === "ping") return announce();
  if (data?.type !== "state") return;
  state = data.state;
  ppi = data.ppi;
  syncUrls(data.images ?? {});
  render();
});

function screenSize() {
  return { width: innerWidth, height: innerHeight };
}

function announce() {
  channel.postMessage({ type: "hello", screen: screenSize() });
}

// Та сама картинка приходить із кожним станом — новий URL лише для нового файлу.
function syncUrls(blobs) {
  for (const [path, url] of urls) {
    if (blobs[path]) continue;
    URL.revokeObjectURL(url);
    urls.delete(path);
  }
  for (const [path, blob] of Object.entries(blobs)) {
    if (!urls.has(path) && blob instanceof Blob) urls.set(path, URL.createObjectURL(blob));
  }
}

function render() {
  hint.hidden = state !== null;
  const items = state?.items ?? [];
  const alive = new Set(items.map((item) => item.id));
  for (const [id, image] of images) {
    if (alive.has(id)) continue;
    image.remove();
    images.delete(id);
  }
  for (const item of items) {
    let image = images.get(item.id);
    if (!image) {
      image = document.createElement("img");
      image.alt = "";
      image.draggable = false;
      image.dataset.id = item.id;
      image.addEventListener("load", () => place(image));
      image.addEventListener("pointerdown", startDrag);
      images.set(item.id, image);
    }
    stage.append(image); // порядок у DOM — порядок шарів
    const url = urls.get(item.path);
    if (url && image.getAttribute("src") !== url) image.src = url;
    place(image);
  }
  stage.classList.toggle("blackout", state?.blackout === true);
  renderCalibration();
}

function place(image) {
  const item = state?.items.find((candidate) => candidate.id === image.dataset.id);
  if (!item || !image.naturalWidth) return;
  const frame = itemFrame(item, { ppi, screen: screenSize(), image: { width: image.naturalWidth, height: image.naturalHeight } });
  image.style.width = `${frame.width}px`;
  image.style.height = `${frame.height}px`;
  image.style.left = `${frame.centerX - frame.width / 2}px`;
  image.style.top = `${frame.centerY - frame.height / 2}px`;
  image.style.transform = `rotate(${frame.rotation}deg)`;
}

function renderCalibration() {
  calibration.hidden = state?.calibrating !== true;
  if (calibration.hidden) return;
  const side = CALIBRATION_INCHES * ppi;
  calibration.style.width = `${side}px`;
  calibration.style.height = `${side}px`;
  calibration.style.backgroundSize = `${ppi}px ${ppi}px`;
  const centimeters = (CALIBRATION_INCHES * 2.54).toLocaleString("uk-UA", { maximumFractionDigits: 2 });
  calibration.querySelector("span").textContent = `Сторона квадрата — ${CALIBRATION_INCHES}″ (${centimeters} см), клітинка — 1″`;
}

function startDrag(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  const image = event.currentTarget;
  image.setPointerCapture(event.pointerId);
  image.classList.add("dragging");
  drag = { image, id: image.dataset.id, x: event.clientX, y: event.clientY };
}

addEventListener("pointermove", (event) => {
  wake();
  if (!drag) return;
  const dx = (event.clientX - drag.x) / ppi;
  const dy = (event.clientY - drag.y) / ppi;
  drag.x = event.clientX;
  drag.y = event.clientY;
  channel.postMessage({ type: "move", id: drag.id, dx, dy });
});
addEventListener("pointerup", endDrag);
addEventListener("pointercancel", endDrag);
function endDrag() {
  drag?.image.classList.remove("dragging");
  drag = null;
}

addEventListener("resize", () => {
  for (const image of images.values()) place(image);
  renderCalibration();
  channel.postMessage({ type: "screen", screen: screenSize() });
});

// Курсор і кнопка ховаються, щойно миша завмерла: гравці бачать лише картинку.
let idleTimer = null;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), 2000);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
fullscreenButton.addEventListener("click", toggleFullscreen);
addEventListener("dblclick", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement ? "Вийти з повного екрана" : "На весь екран";
});

// Телевізор не має гаснути посеред бою.
let wakeLock = null;
async function keepAwake() {
  if (document.visibilityState !== "visible" || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch {}
}
document.addEventListener("visibilitychange", keepAwake);

addEventListener("pagehide", () => channel.postMessage({ type: "bye" }));

wake();
keepAwake();
announce();
