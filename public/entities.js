export function extractSection(body, heading) {
  const normalized = body.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const target = heading.trim();
  const start = lines.findIndex((line) => line.trim() === target);
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

export function entityRecord(path, meta, body, config, mediaByName = new Map()) {
  const slug = path.split("/").at(-1).replace(/\.md$/i, "");
  const portraitName = meta[config.portraitField];
  return {
    slug,
    path,
    type: meta.type,
    name: meta.name || slug,
    portrait: portraitName ? (mediaByName.get(portraitName.toLocaleLowerCase("uk")) ?? null) : null,
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
