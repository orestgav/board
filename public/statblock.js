// Статблок істоти: та сама розкладка, що була на сторінці bestiary/index.html.
// Цифри беруться з метаданих картки, дії та риси — з її тіла. Вихід — рядок
// HTML без шапки й лічильника HP: їх канва малює сама, бо вони інтерактивні.
import { escapeHtml, renderInline } from "./markdown.js";

export const ABILITIES = [
  ["str", "STR"], ["dex", "DEX"], ["con", "CON"],
  ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"],
];

// Секції нотаток ДМа на картці не показуємо: вони є в попапі кнопки «i».
const DM_SECTIONS = new Set(["Тактика", "Де використовувати", "Що знають гравці"]);
const SECTION_TITLES = {
  "Дії": "ACTIONS", "Риси": "TRAITS", "Бонусні дії": "BONUS ACTIONS",
  "Реакції": "REACTIONS", "Легендарні дії": "LEGENDARY ACTIONS", "Закляття": "SPELLS",
};
const SECTION_ORDER = ["Дії", "Риси", "Бонусні дії", "Реакції", "Легендарні дії", "Закляття"];
const SAVE = /^([A-Za-zА-Яа-я]{3})\s*([+\-−]?\d+)/;

function filled(value) {
  return value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "—";
}

// «110 (13d8 + 52)» -> 110. Без числа лічильник HP не має сенсу, тож null.
export function maxHitPoints(meta) {
  const match = String(meta?.hp ?? "").match(/\d+/);
  const value = match ? Number(match[0]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

// «DEX +7, CON +7» -> клітинки рядка SAVE у порядку ABILITIES.
export function savingThrows(raw) {
  const cells = ABILITIES.map(() => "—");
  if (!filled(raw)) return cells;
  for (const chunk of String(raw).split(",")) {
    const match = chunk.trim().match(SAVE);
    if (!match) continue;
    const index = ABILITIES.findIndex(([, label]) => label === match[1].toUpperCase());
    if (index >= 0) cells[index] = match[2];
  }
  return cells;
}

export function typeLine(meta) {
  const kind = [meta.size, meta.kind, filled(meta.subtype) ? `(${meta.subtype})` : ""].filter(filled).join(" ");
  return [kind, meta.alignment].filter(filled).join(", ");
}

// Рядок під таблицею характеристик: спорядження, навички, чуття, мови, CR.
export function metaLine(meta) {
  const lines = [`<strong>Gear</strong> ${escapeHtml(filled(meta.gear) ? meta.gear : "—")}`];
  for (const [field, label] of [["skills", "Skills"], ["senses", "Senses"], ["languages", "Languages"]]) {
    if (filled(meta[field])) lines.push(`<strong>${label}</strong> ${escapeHtml(meta[field])}`);
  }
  const inside = [filled(meta.xp) ? `XP ${meta.xp}` : null, filled(meta.pb) ? `PB ${meta.pb}` : null].filter(Boolean).join("; ");
  lines.push(`<strong>CR</strong> ${escapeHtml(filled(meta.cr) ? meta.cr : "—")}${inside ? ` (${inside})` : ""}`);
  return lines.join("<br>");
}

// Секції тіла картки в порядку статблока; службові коментарі відкидаються.
export function statblockSections(body) {
  const sections = [];
  for (const part of String(body ?? "").replace(/\r\n/g, "\n").split(/^## /m).slice(1)) {
    const newline = part.indexOf("\n");
    const title = part.slice(0, newline < 0 ? part.length : newline).trim();
    if (DM_SECTIONS.has(title)) continue;
    const paragraphs = (newline < 0 ? "" : part.slice(newline + 1)).trim()
      .split(/\n\s*\n/).map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph && !paragraph.startsWith("<!--"));
    if (paragraphs.length) sections.push({ title, paragraphs });
  }
  const rank = (title) => (SECTION_ORDER.indexOf(title) < 0 ? SECTION_ORDER.length : SECTION_ORDER.indexOf(title));
  return sections.sort((first, second) => rank(first.title) - rank(second.title));
}

export function statblockMarkup(entity) {
  const meta = entity.meta ?? {};
  const saves = savingThrows(meta.saves);
  const line = typeLine(meta);
  const abilities = ABILITIES.map(([field]) => `<td>${escapeHtml(filled(meta[field]) ? meta[field] : "+0")}</td>`).join("");
  const sections = statblockSections(entity.body).map((section) => `<h3>${escapeHtml(SECTION_TITLES[section.title] ?? section.title.toLocaleUpperCase("uk"))}</h3>`
    + section.paragraphs.map((paragraph) => `<p>${renderInline(paragraph)}</p>`).join("")).join("");

  return `${line ? `<p class="sb-sub"><em>${escapeHtml(line)}</em></p>` : ""}
    <div class="sb-top">
      <div class="sb-vitals">
        <p><strong>AC</strong> ${escapeHtml(filled(meta.ac) ? meta.ac : "—")}</p>
        <p><strong>HP</strong> ${escapeHtml(filled(meta.hp) ? meta.hp : "—")}</p>
        <p><strong>Speed</strong> ${escapeHtml(filled(meta.speed) ? meta.speed : "—")}</p>
      </div>
      <p class="sb-init"><strong>Initiative</strong> ${escapeHtml(filled(meta.initiative) ? meta.initiative : "+0")}</p>
    </div>
    <table class="sb-abil">
      <thead><tr><th></th>${ABILITIES.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead>
      <tbody>
        <tr><th>MOD</th>${abilities}</tr>
        ${saves.some((value) => value !== "—") ? `<tr class="sb-save"><th>SAVE</th>${saves.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>` : ""}
      </tbody>
    </table>
    <p class="sb-meta">${metaLine(meta)}</p>
    <hr>${sections}`;
}
