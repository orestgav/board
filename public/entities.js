import { tableCells } from "./markdown.js";
import { TOKEN_ENTITY_TYPES } from "./token.js";

export function extractSection(body, heading) {
  const normalized = body.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const target = heading.trim();
  const start = lines.findIndex((line) => sameHeading(line, target));
  if (start < 0) return "";
  const level = target.match(/^#+/)?.[0].length ?? 2;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

// Посилання з довільного тексту: як чистого (`[[arven]]`), так і фрази
// («тракт [[lauris]] — [[arven]]»).
export function wikiLinks(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(WIKILINK)].map((match) => match[1].trim()).filter(Boolean);
}

const APOSTROPHES = /[\u02bc\u2019']/g;
const LINK_LINE = /^\s*[-*]\s+([^:[\]]{1,40}):\s*(.+)$/;
const DEFAULT_LINKS_SECTION = "## Зв'язки";

function sameHeading(line, heading) {
  return line.trim().replace(APOSTROPHES, "'").toLocaleLowerCase("uk")
    === heading.trim().replace(APOSTROPHES, "'").toLocaleLowerCase("uk");
}

// «NPC», «NPC (ще)» і «npc» — одна мітка.
export function linkLabel(text) {
  return text.replace(APOSTROPHES, "'").replace(/\s*\(.*\)\s*$/, "").trim().toLocaleLowerCase("uk");
}

// Секція звʼязків картки: мітка рядка → перелічені в ньому картки.
// «- NPC: [[pekar]], [[barni]]» дає { npc: ["pekar", "barni"] }.
export function sectionLinks(body, section = DEFAULT_LINKS_SECTION) {
  const result = {};
  for (const line of extractSection(body, section).split("\n")) {
    const match = line.match(LINK_LINE);
    if (!match) continue;
    const links = wikiLinks(match[2]);
    if (!links.length) continue;
    const label = linkLabel(match[1]);
    result[label] = [...new Set([...(result[label] ?? []), ...links])];
  }
  return result;
}

export function entityRecord(path, meta, body, config, mediaByName = new Map()) {
  const slug = path.split("/").at(-1).replace(/\.md$/i, "");
  const portraitName = meta[config.portraitField];
  return {
    slug,
    path,
    type: meta.type,
    name: meta.name || slug,
    portrait: portraitName ? (mediaByName.get(portraitName.toLocaleLowerCase("uk")) ?? null) : null,
    links: sectionLinks(body, config.linksSection),
    summary: extractSection(body, config.summarySection),
    body: body.trim(),
    // Решта метаданих потрібна карткам, що малюють самі цифри — наприклад
    // статблоку істоти. Парсер віддає об'єкт без прототипу, тож копіюємо.
    meta: { ...meta },
  };
}

export function matchesEntity(entity, query) {
  const needle = query.trim().toLocaleLowerCase("uk");
  if (!needle) return true;
  return [entity.name, entity.slug, entity.type, entity.path]
    .some((value) => value?.toLocaleLowerCase("uk").includes(needle));
}

// Типи, які йдуть в індекс. Картки для кнопки «Токен» (істоти й гравці) там
// завжди, навіть якщо `entities.types` у конфігу кампанії їх не перелічує.
export function indexedTypes(entitiesConfig) {
  return new Set([...entitiesConfig.types, ...TOKEN_ENTITY_TYPES]);
}

// Документ із типом, якого немає в індексі карток (сесія, службовий файл):
// на полотно його не кладуть, але попап відкриває його за [[посиланням]], а
// згадки з нього йдуть у backlinks. Нотатки дошки сюди не входять — вони
// приходять окремо й живуть разом із полотном.
export function referenceRecord(path, meta, body) {
  const slug = path.split("/").at(-1).replace(/\.md$/i, "");
  return { slug, path, type: meta.type, name: meta.name || slug, portrait: null, body: body.trim() };
}

// Усі markdown-документи кампанії → картки дошки й довідкові тексти.
export function indexDocuments(documents, parseFrontmatter, config, mediaByName = new Map()) {
  const types = indexedTypes(config.entities);
  const entities = [];
  const references = [];
  for (const { path, source } of documents) {
    const { meta, body } = parseFrontmatter(source, path);
    if (types.has(meta.type)) entities.push(entityRecord(path, meta, body, config.entities, mediaByName));
    else if (meta.type && meta.type !== config.notes?.type) references.push(referenceRecord(path, meta, body));
  }
  references.sort((first, second) => first.path.localeCompare(second.path, "uk", { numeric: true }));
  return { entities: finalizeEntities(entities), references };
}

// Маркер списку чи заголовка — лише з пробілом після: «**Жирний**» на
// початку рядка маркером не є.
const MENTION_PREFIX = /^\s*(?:(?:[-*+]|\d+\.|#{1,6})\s+|>\s*)*/;
const MENTION_BEFORE = 90;
const MENTION_AFTER = 150;

function sameSlug(link, target) {
  return link.toLocaleLowerCase("uk") === target;
}

// Довгий абзац обрізається навколо першої згадки. Межа не ріже [[посилання]]
// навпіл і стає на пробіл, щоб не лишати півслова.
function mentionWindow(line, target) {
  if (line.length <= MENTION_BEFORE + MENTION_AFTER) return line;
  const first = [...line.matchAll(WIKILINK)].find((match) => sameSlug(match[1].trim(), target));
  if (!first) return line;
  let start = Math.max(0, first.index - MENTION_BEFORE);
  let end = Math.min(line.length, first.index + first[0].length + MENTION_AFTER);
  const openBefore = line.lastIndexOf("[[", start);
  if (openBefore >= 0 && line.indexOf("]]", openBefore) >= start) start = openBefore;
  else if (start > 0) start = line.indexOf(" ", start) + 1 || start;
  const openAtEnd = line.lastIndexOf("[[", end - 1);
  const closeAtEnd = openAtEnd >= 0 ? line.indexOf("]]", openAtEnd) : -1;
  if (closeAtEnd + 2 > end) end = closeAtEnd + 2;
  else if (end < line.length && line.lastIndexOf(" ", end) > start) end = line.lastIndexOf(" ", end);
  // Вікно, що почалося чи скінчилося посеред **жирного**, дописує йому
  // бракуючі зірочки — інакше вони вилізли б у текст.
  const insideBold = (index) => (line.slice(0, index).match(/\*\*/g) ?? []).length % 2 === 1;
  const excerpt = `${insideBold(start) ? "**" : ""}${line.slice(start, end).trim()}${insideBold(end) ? "**" : ""}`;
  return `${start > 0 ? "… " : ""}${excerpt}${end < line.length ? " …" : ""}`;
}

// Рядки тексту, що посилаються на slug, без маркерів списку, заголовка й
// цитати; рядок таблиці читається клітинками через «·».
export function mentionLines(body, slug) {
  const target = slug.toLocaleLowerCase("uk");
  return String(body ?? "").replace(/\r\n/g, "\n").split("\n")
    .filter((line) => wikiLinks(line).some((link) => sameSlug(link, target)))
    .map((line) => {
      const trimmed = line.trim();
      const text = trimmed.startsWith("|")
        ? tableCells(trimmed).filter(Boolean).join(" · ")
        : line.replace(MENTION_PREFIX, "").trim();
      return mentionWindow(text, target);
    });
}

// Хто згадує картку: кожне джерело один раз, зі своїми рядками-контекстами.
// Власні згадки картки не рахуються.
export function backlinks(slug, documents) {
  return documents.flatMap((document) => {
    if (document.slug === slug) return [];
    const lines = mentionLines(document.body, slug);
    return lines.length ? [{ document, lines }] : [];
  });
}

export function finalizeEntities(entities) {
  const slugs = new Set();
  for (const entity of entities) {
    if (slugs.has(entity.slug)) throw new Error(`Повторний slug картки: ${entity.slug}`);
    slugs.add(entity.slug);
  }
  return entities.sort((first, second) => first.name.localeCompare(second.name, "uk"));
}
