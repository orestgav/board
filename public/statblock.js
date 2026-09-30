// Статблок істоти: та сама розкладка, що була на сторінці bestiary/index.html.
// Цифри беруться з метаданих картки, дії та риси — з її тіла. Вихід — рядок
// HTML без шапки й лічильника HP: їх канва малює сама, бо вони інтерактивні.
import { escapeHtml, renderInline } from "./markdown.js";

export const ABILITIES = [
  ["str", "STR"], ["dex", "DEX"], ["con", "CON"],
  ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"],
];

// Секції нотаток ДМа на картці не показуємо: вони є в попапі кнопки «i».
// Кампанія може назвати їх інакше — `entities.statblockHiddenSections`.
export const DEFAULT_HIDDEN_SECTIONS = ["Тактика", "Де використовувати", "Що знають гравці"];
const SECTION_TITLES = {
  "Дії": "ACTIONS", "Риси": "TRAITS", "Бонусні дії": "BONUS ACTIONS",
  "Реакції": "REACTIONS", "Легендарні дії": "LEGENDARY ACTIONS", "Закляття": "SPELLS",
};
const SECTION_ORDER = ["Риси", "Дії", "Бонусні дії", "Реакції", "Легендарні дії", "Закляття"];
const STAT_ENTRY = /^\*\*[^*\n]+\.\*\*/;
// Повні тексти заклять живуть у тій самій картці, окремою секцією з
// підсекціями «### Англійська назва». На аркуші її не видно: дошка показує
// текст підказкою, коли курсор над назвою закляття в секції «Закляття».
export const SPELL_SECTION = "Закляття";
export const SPELL_TEXTS_SECTION = "Тексти заклять";
// «**1 рівень (4/день).**», «**2-й рівень (3 комірки).**» — комірки рівня;
// «**1/день кожне.** a, b» — окремий лічильник на кожне закляття (2024).
const SLOT_LEVEL = /^\*\*(\d)(?:-?й)?\s+рів[\p{L}]*\s*\((\d+)\s*(?:\/\s*день|комір[\p{L}]*)\)\.\*\*/u;
const PER_DAY = /^\*\*(\d+)\s*\/\s*день(\s+кожн[\p{L}]*)?\.\*\*\s*(.*)$/su;
const SAVE = /^([A-Za-zА-Яа-я]{3})\s*([+\-−]?\d+)/;

// Ключове в рисах і діях, яке ДМ шукає очима посеред бою: характеристика
// рятунку з його СЛ, бонус до влучання, кістки шкоди з типом і стани.
const LETTER = "\\p{L}";
const WORD_START = `(?<![${LETTER}\\d])`;
const WORD_END = `(?![${LETTER}])`;
const ABILITY = "(?:Сил[иа]|Спритн[а-яі]*|Статур[иа]|Витривал[а-яі]*|Інтелект[уа]?|Мудр[а-яі]*|Харизм[иа]"
  + "|STR|DEX|CON|INT|WIS|CHA|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)";
const DC = "(?:DC|СЛ|СК)\\s*\\d+";
const DAMAGE_TYPE = "(?:колюч|рубл|рубаюч|дробил|вогнян|холод|кислот|отрутн|психічн|некротичн|промен|випромін|сяйв|громов"
  + "|блискав|електр|силов|piercing|slashing|bludgeoning|fire|cold|acid|poison|psychic|necrotic|radiant|thunder|lightning|force)[\\p{L}]*";
const ROLL = "\\d+\\s*[кd]\\s*\\d+(?:\\s*[+−-]\\s*\\d+)?";
const DICE = `(?:\\d+\\s*)?(?:\\(${ROLL}\\)|${ROLL})`;
const APOSTROPHE = "(?:'|’|&#39;)";
const CONDITION = "(?:схоплен|зачарован|наляка|переляка|осліплен|оглух|паралізован|скам" + APOSTROPHE + "ян|отруєн|знерухомлен"
  + "|недієздатн|невидим|непритомн|приголомшен|оглушен|виснажен)[\\p{L}]*|лежить ниць|збит[\\p{L}]* з ніг"
  + "|(?:grappled|restrained|prone|charmed|frightened|blinded|deafened|paralyzed|petrified|poisoned|stunned|incapacitated"
  + "|invisible|unconscious|exhaustion)";
const EDGE = "переваг[\\p{L}]*|(?:з|має|мають|отримує|дає)\\s+перешкод[\\p{L}]*|advantage|disadvantage";
// Кожен тип має свій колір (клас sb-key-<тип>), щоб око розрізняло їх одразу.
const KEY_KINDS = {
  save: [
    // «Мудрості (DC 15)», «Сили або Спритності СЛ 13», «WIS Save DC 14», «Constitution Saving Throw: DC 14».
    `${ABILITY}(?:\\s+або\\s+${ABILITY})?(?:\\s+(?:Saving Throw|save)\\s*:?)?\\s*(?:\\(\\s*${DC}\\s*\\)|(?:зі\\s+)?${DC})`,
    // Характеристика рятунку без СЛ: «рятунковий кидок Статури проти…».
    `(?<=(?:рятунков[\\p{L}]*\\s+кид[\\p{L}]*|ряткид[\\p{L}]*|кид[\\p{L}]*\\s+рятунку)\\s+)${ABILITY}`,
    // Решта складностей: «СЛ вислизання 14», «Escape DC 14».
    `СЛ\\s+вислизання\\s+\\d+|(?:escape\\s+)?${DC}`,
  ],
  hit: [`[+−-]\\d+\\s+(?:до\\s+(?:влучання|атаки)|to hit)`],
  damage: [`${DICE}(?:\\s+${DAMAGE_TYPE})?`],
  condition: [CONDITION],
  edge: [EDGE],
};
const KEY_TERMS = new RegExp(Object.entries(KEY_KINDS)
  .map(([kind, patterns]) => `${WORD_START}(?<${kind}>${patterns.map((pattern) => `(?:${pattern})`).join("|")})${WORD_END}`)
  .join("|"), "giu");

// Працює по готовому HTML абзацу: теги й сутності не чіпає, обгортає лише текст.
export function highlightKeyTerms(html) {
  return String(html ?? "").split(/(<[^>]*>)/).map((part) => (part.startsWith("<")
    ? part
    : part.replace(KEY_TERMS, (...args) => {
      const kind = Object.keys(KEY_KINDS).find((name) => args.at(-1)[name] !== undefined);
      return `<b class="sb-key sb-key-${kind}">${args[0]}</b>`;
    }))).join("");
}

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

// Розмір стоїть окремо від типу: у полі він завжди в одній формі
// («Середній», «Гігантський»), тож перед типом іншого роду не узгоджувався б.
export function typeLine(meta) {
  const kind = [meta.kind, filled(meta.subtype) ? `(${meta.subtype})` : ""].filter(filled).join(" ");
  return [kind, meta.size, meta.alignment].filter(filled).join(", ");
}

// Рядок під таблицею характеристик: спорядження, навички, чуття, мови, CR.
export function metaLine(meta) {
  const lines = [`<strong>Gear</strong> ${escapeHtml(filled(meta.gear) ? meta.gear : "—")}`];
  for (const [field, label] of [["skills", "Skills"], ["senses", "Senses"], ["languages", "Languages"]]) {
    if (filled(meta[field])) lines.push(`<strong>${label}</strong> ${escapeHtml(meta[field])}`);
  }
  const inside = [filled(meta.xp) ? `XP ${meta.xp}` : null, filled(meta.pb) ? `PB ${meta.pb}` : null].filter(Boolean).join("; ");
  lines.push(`<strong>CR</strong> ${escapeHtml(filled(meta.cr) ? meta.cr : "—")}${inside ? ` (${escapeHtml(inside)})` : ""}`);
  return lines.join("<br>");
}

// Секція «## Назва» як заголовок і абзаци без службових коментарів.
function bodySections(body) {
  return String(body ?? "").replace(/\r\n/g, "\n").split(/^## /m).slice(1).map((part) => {
    const newline = part.indexOf("\n");
    const title = part.slice(0, newline < 0 ? part.length : newline).trim();
    const paragraphs = (newline < 0 ? "" : part.slice(newline + 1)).trim()
      .split(/\n\s*\n/).map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph && !paragraph.startsWith("<!--"));
    return { title, paragraphs };
  });
}

function spellKey(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

// «### Bless» і абзаци під ним -> Map «bless» -> { name, paragraphs }.
// Назва — англійська, як у списку заклять: так збіг однозначний.
export function spellTexts(body) {
  const spells = new Map();
  const section = bodySections(body).find((candidate) => candidate.title === SPELL_TEXTS_SECTION);
  let current = null;
  for (const paragraph of section?.paragraphs ?? []) {
    const heading = paragraph.match(/^###\s+(.+?)(?:\n([\s\S]*))?$/);
    if (heading) {
      current = { name: heading[1].trim(), paragraphs: [] };
      spells.set(spellKey(current.name), current);
      if (heading[2]?.trim()) current.paragraphs.push(heading[2].trim());
    } else if (current) {
      current.paragraphs.push(paragraph);
    }
  }
  return spells;
}

// Підказка закляття: назва, рядок параметрів курсивом, далі сам текст.
export function spellTooltipMarkup(spell) {
  return `<div class="spell-tip-title">${escapeHtml(spell.name)}</div>`
    + spell.paragraphs.map((paragraph) => `<p>${highlightKeyTerms(renderInline(paragraph))}</p>`).join("");
}

// Назви заклять, для яких є текст, стають мітками під підказку. Довші назви
// йдуть першими, щоб «mass healing word» не розпався на «healing word».
export function markSpellNames(html, spells) {
  if (!spells?.size) return html;
  const names = [...spells.values()].map((spell) => spell.name).sort((first, second) => second.length - first.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  const pattern = new RegExp(`(?<![\\p{L}\\d])(?:${names.join("|")})(?![\\p{L}])`, "giu");
  return String(html).split(/(<[^>]*>)/).map((part) => (part.startsWith("<")
    ? part
    : part.replace(pattern, (match) => `<span class="sb-spell" data-spell="${escapeHtml(spellKey(match))}">${match}</span>`))).join("");
}

// Лічильники заклять із секції «Закляття»: комірки кожного рівня й закляття
// «N/день». Канітри «за бажанням» лічильника не мають.
export function spellSlots(body) {
  const section = bodySections(body).find((candidate) => candidate.title === SPELL_SECTION);
  const slots = [];
  for (const paragraph of section?.paragraphs ?? []) {
    const level = paragraph.match(SLOT_LEVEL);
    if (level) {
      slots.push({ key: level[1], label: `${level[1]} рів.`, title: `Комірки ${level[1]}-го рівня`, max: Number(level[2]) });
      continue;
    }
    const perDay = paragraph.match(PER_DAY);
    if (!perDay) continue;
    const max = Number(perDay[1]);
    if (!perDay[2]) {
      slots.push({ key: `${max}/день`, label: `${max}/день`, title: `${max}/день`, max });
      continue;
    }
    for (const name of perDay[3].replace(/\.\s*$/, "").split(",").map((item) => item.trim()).filter(Boolean)) {
      slots.push({ key: `день:${spellKey(name)}`, label: name, title: `${name}: ${max}/день`, max });
    }
  }
  return slots.filter((slot) => slot.max > 0);
}

// Скільки витрачено; у файлі лише ненульові значення, решта — повний запас.
export function usedSlots(creature, slot) {
  const used = creature?.slots?.[slot.key];
  return Number.isInteger(used) ? Math.min(Math.max(used, 0), slot.max) : 0;
}

export function withUsedSlots(creature, slot, used) {
  const slots = { ...(creature?.slots ?? {}) };
  const value = Math.min(Math.max(Math.trunc(used), 0), slot.max);
  if (value) slots[slot.key] = value;
  else delete slots[slot.key];
  const next = { ...creature, slots };
  if (!Object.keys(slots).length) delete next.slots;
  return next;
}

// Секції тіла картки в порядку статблока; службові коментарі відкидаються.
export function statblockSections(body, hiddenSections = DEFAULT_HIDDEN_SECTIONS) {
  const hidden = new Set([...hiddenSections, SPELL_TEXTS_SECTION]);
  const sections = [];
  for (const { title, paragraphs } of bodySections(body)) {
    if (hidden.has(title)) continue;
    if (!paragraphs.length) continue;
    // Незнайома секція (напр. «ФАЗА 2») потрапляє в статблок, лише якщо вся
    // складається з записів «**Назва.** …»; описові нотатки в статблок не йдуть.
    if (!SECTION_ORDER.includes(title) && !paragraphs.every((paragraph) => STAT_ENTRY.test(paragraph))) continue;
    sections.push({ title, paragraphs });
  }
  const rank = (title) => (SECTION_ORDER.indexOf(title) < 0 ? SECTION_ORDER.length : SECTION_ORDER.indexOf(title));
  return sections.sort((first, second) => rank(first.title) - rank(second.title));
}

export function statblockMarkup(entity, { hiddenSections = DEFAULT_HIDDEN_SECTIONS } = {}) {
  const meta = entity.meta ?? {};
  const saves = savingThrows(meta.saves);
  const line = typeLine(meta);
  const abilities = ABILITIES.map(([field]) => `<td>${escapeHtml(filled(meta[field]) ? meta[field] : "+0")}</td>`).join("");
  const spells = spellTexts(entity.body);
  // Назви заклять шукаємо лише в їхній секції: у рисах «Aid» чи «Bless» могли б
  // трапитися як звичайні слова.
  const paragraphMarkup = (section, paragraph) => {
    const html = highlightKeyTerms(renderInline(paragraph));
    return `<p>${section.title === SPELL_SECTION ? markSpellNames(html, spells) : html}</p>`;
  };
  const sections = statblockSections(entity.body, hiddenSections).map((section) => `<h3>${escapeHtml(SECTION_TITLES[section.title] ?? section.title.toLocaleUpperCase("uk"))}</h3>`
    + section.paragraphs.map((paragraph) => paragraphMarkup(section, paragraph)).join("")).join("");

  // Підзаголовок у тій самій колонці, що й AC–Initiative: так арт праворуч
  // тягнеться на всю висоту шапки статблока.
  return `<div class="sb-top">
      <div class="sb-vitals">
        ${line ? `<p class="sb-sub"><em>${escapeHtml(line)}</em></p>` : ""}
        <p><strong>AC</strong> ${escapeHtml(filled(meta.ac) ? meta.ac : "—")}</p>
        <p><strong>HP</strong> ${escapeHtml(filled(meta.hp) ? meta.hp : "—")}</p>
        <p><strong>Speed</strong> ${escapeHtml(filled(meta.speed) ? meta.speed : "—")}</p>
        <p><strong>Initiative</strong> ${escapeHtml(filled(meta.initiative) ? meta.initiative : "+0")}</p>
      </div>
      ${entity.portrait ? `<div class="sb-art"><img alt="" draggable="false"></div>` : ""}
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

// Один статблок на полотні може тримати цілий загін однакових істот: у кожної
// власні поточні HP, а з другої — ще й назва, бо інакше їх не розрізнити.
// Поки істота одна, вузол лишається на старому node.hp: файл розкладки не
// роздувається масивом там, де рахувати нема чого.
export const CREATURE_NAME_PREFIX = "Істота";

export function creatureList(node) {
  const creatures = node?.creatures;
  const withSlots = (entry, slots) => (hasSlots({ slots }) ? { ...entry, slots } : entry);
  if (!Array.isArray(creatures) || !creatures.length) return [withSlots({ name: "", hp: node?.hp }, node?.slots)];
  return creatures.map((creature) => withSlots({
    name: typeof creature?.name === "string" ? creature.name : "",
    hp: creature?.hp,
  }, creature?.slots));
}

// Без власної назви істота підписана порядковим номером, тож після видалення
// сусіда решта перенумеровується сама.
export function creatureLabel(creature, index) {
  return String(creature?.name ?? "").trim() || `${CREATURE_NAME_PREFIX} ${index + 1}`;
}

// Вище максимуму HP не піднімаються, а вниз ідуть скільки завгодно: мінус
// показує, наскільки удар перебив істоту.
export function creatureHitPoints(creature, maximum) {
  return Number.isFinite(creature?.hp) ? Math.min(creature.hp, maximum) : maximum;
}

// Що вписали в поле HP: ціле число, можна з мінусом — і з типографським «−»,
// який підставляють деякі розкладки. Решта — не число, тож null.
export function parseHitPoints(raw) {
  const text = String(raw ?? "").trim().replace("−", "-");
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

function hasSlots(creature) {
  return Boolean(creature?.slots) && typeof creature.slots === "object" && Object.keys(creature.slots).length > 0;
}

// Назва, що збігається з номером за замовчуванням, у файл не пишеться: інакше
// після видалення сусіда «Істота 3» лишилася б другою в списку.
export function writeCreatures(node, creatures) {
  if (creatures.length > 1) {
    node.creatures = creatures.map((creature, index) => {
      const entry = {};
      const name = String(creature?.name ?? "").trim();
      if (name && name !== creatureLabel(null, index)) entry.name = name;
      if (Number.isFinite(creature?.hp)) entry.hp = creature.hp;
      if (hasSlots(creature)) entry.slots = { ...creature.slots };
      return entry;
    });
    delete node.hp;
    delete node.slots;
  } else {
    delete node.creatures;
    if (Number.isFinite(creatures[0]?.hp)) node.hp = creatures[0].hp;
    else delete node.hp;
    if (hasSlots(creatures[0])) node.slots = { ...creatures[0].slots };
    else delete node.slots;
  }
  return node;
}
