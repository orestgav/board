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
function linkLabel(text) {
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
  };
}

export function matchesEntity(entity, query) {
  const needle = query.trim().toLocaleLowerCase("uk");
  if (!needle) return true;
  return [entity.name, entity.slug, entity.type, entity.path]
    .some((value) => value?.toLocaleLowerCase("uk").includes(needle));
}

export function finalizeEntities(entities) {
  const slugs = new Set();
  for (const entity of entities) {
    if (slugs.has(entity.slug)) throw new Error(`Повторний slug картки: ${entity.slug}`);
    slugs.add(entity.slug);
  }
  return entities.sort((first, second) => first.name.localeCompare(second.name, "uk"));
}
