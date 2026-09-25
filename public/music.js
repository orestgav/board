// Картка «музика»: у розкладці лежить канонічний лінк на ролік і його назва,
// а кнопка «плей» відкриває ютуб із заданої секунди (без неї — з нульової):
// інакше ютуб підхопив би трек із місця, де ДМ зупинив його минулого разу.

const HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
  "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
]);
const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]{2,64}$/;
// Позначки часу з лінка прибираються всі: t — сторінка ролика, start —
// плеєр, time_continue — «продовжити перегляд».
const TIME_PARAMETERS = ["t", "start", "time_continue"];

function parseUrl(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

export function youTubeVideoId(raw) {
  const url = parseUrl(raw);
  if (!url || !HOSTS.has(url.hostname.toLowerCase())) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const candidate = url.hostname.toLowerCase().endsWith("youtu.be") ? segments[0]
    : segments[0] === "watch" ? url.searchParams.get("v")
      : ["shorts", "embed", "live", "v"].includes(segments[0]) ? segments[1]
        : null;
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

export function youTubeListId(raw) {
  const list = parseUrl(raw)?.searchParams.get("list") ?? "";
  return LIST_ID.test(list) ? list : null;
}

// У розкладці зберігається один сталий вигляд лінка, звідки б його не
// скопіювали: youtu.be, shorts, music.youtube чи вкладка з таймкодом.
export function canonicalYouTubeUrl(raw) {
  const videoId = youTubeVideoId(raw);
  if (!videoId) return null;
  const list = youTubeListId(raw);
  return `https://www.youtube.com/watch?v=${videoId}${list ? `&list=${list}` : ""}`;
}

// Секунда старту — ціле невідʼємне число; порожнє поле означає «з початку».
export function isMusicStart(value) {
  return Number.isInteger(value) && value >= 0;
}

// Що вписали в поле вікна: undefined — поле порожнє, null — там не секунди.
export function parseMusicStart(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return undefined;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function playbackUrl(raw, start = 0) {
  const url = parseUrl(raw);
  if (!url) return null;
  const seconds = isMusicStart(start) ? start : 0;
  for (const parameter of TIME_PARAMETERS) url.searchParams.delete(parameter);
  url.searchParams.set("t", `${seconds}s`);
  url.searchParams.set("start", String(seconds));
  return url.toString();
}

// Назва приходить із ютуба, але картка має лишатися підписаною й тоді,
// коли мережа мовчала: тоді підписом стає сам ідентифікатор ролика.
export function musicTitle(title, url) {
  const trimmed = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  return trimmed || youTubeVideoId(url) || "Трек";
}

export function oEmbedUrl(url) {
  return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
}
