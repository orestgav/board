// Копія «як картинка»: у системний буфер іде PNG — інші програми (месенджер,
// редактор, чужа вкладка) іншого формату з буфера картинкою не беруть.

const SVG_NS = "http://www.w3.org/2000/svg";
// Картка на полотні має кілька сотень світових пікселів — у буфер кладемо
// збільшену, щоб текст лишався чітким, але не впиралися в ліміт полотна.
const CARD_SCALE = 3;
const MAX_SIDE = 4096;

// Chrome приймає в ClipboardItem обіцянку: її треба віддати одразу в обробнику
// кліку, поки жест користувача ще живий, а PNG може дорендеритися пізніше.
export function writeImageToClipboard(pngPromise) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return Promise.reject(new Error("Браузер не дає класти картинки в буфер"));
  }
  return navigator.clipboard.write([new ClipboardItem({ "image/png": pngPromise })]);
}

export async function urlToPng(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Не вдалося прочитати зображення");
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvasBlob(canvas);
}

// Картку знімаємо такою, як вона стоїть на полотні: клон її DOM разом зі
// стилями дошки кладемо в SVG foreignObject і малюємо на canvas. Картинки
// всередині SVG-зображення мусять бути data: URL — зовнішніх воно не вантажить.
// На полотні картинка буває мініатюрою, тож `imageSource` може дати для знімка
// інше, повне джерело; нема його — береться показане.
export async function elementToPng(element, { width, height, strip = [], imageSource = () => null }) {
  const clone = element.cloneNode(true);
  for (const selector of strip) clone.querySelectorAll(selector).forEach((part) => part.remove());
  clone.classList.remove("selected", "offscreen");
  Object.assign(clone.style, { left: "0", top: "0", margin: "0" });
  await Promise.all([...clone.querySelectorAll("img")].map(async (image) => {
    const source = await imageSource(image) ?? image.src;
    if (source) image.src = await urlToDataUrl(source);
  }));

  const page = getComputedStyle(document.body);
  const holder = document.createElement("div");
  holder.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  Object.assign(holder.style, {
    position: "relative", width: `${width}px`, height: `${height}px`,
    color: page.color, fontFamily: page.fontFamily, lineHeight: page.lineHeight,
  });
  holder.append(clone);

  const scale = Math.min(CARD_SCALE, MAX_SIDE / Math.max(width, height));
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", Math.round(width * scale));
  svg.setAttribute("height", Math.round(height * scale));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = boardCss();
  const object = document.createElementNS(SVG_NS, "foreignObject");
  object.setAttribute("width", width);
  object.setAttribute("height", height);
  object.append(holder);
  svg.append(style, object);

  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasBlob(canvas);
}

function boardCss() {
  return [...document.styleSheets].map((sheet) => {
    try { return [...sheet.cssRules].map((rule) => rule.cssText).join("\n"); } catch { return ""; }
  }).join("\n");
}

async function urlToDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Не вдалося зібрати PNG"))), "image/png");
  });
}
