const NOTE_MARKER = /^<!-- note (n\d+) -->[ \t]*$/;
const UKRAINIAN = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ж: "zh", з: "z", и: "y", і: "i", ї: "yi",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh",
  ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "yu", я: "ya", ъ: "", ы: "y", э: "e",
};

export function mapSlugFromPath(path) {
  const stem = path.split("/").at(-1).replace(/\.[^.]+$/, "");
  const transliterated = [...stem.normalize("NFC").toLocaleLowerCase("uk")].map((character) => UKRAINIAN[character] ?? character).join("");
  const slug = transliterated.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let hash = 0;
  for (const character of stem) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  if (!slug) return `image-${hash.toString(36)}`;
  const commonSeparators = stem.toLocaleLowerCase("uk").replace(/[ _]+/g, "-");
  const alreadySafe = commonSeparators === slug;
  return alreadySafe ? slug : `${slug}-${hash.toString(36).slice(0, 6)}`;
}

function validateNoteText(text) {
  if (typeof text !== "string") throw new Error("Текст нотатки має бути рядком");
  if (/^<!-- note n\d+ -->[ \t]*$/m.test(text)) throw new Error("Текст нотатки містить зарезервований службовий якір");
  return text.trim();
}

export function noteFileSlug(mapSlug, config) {
  return `${config.prefix}${mapSlug}`;
}

export function splitNoteReference(reference) {
  const match = typeof reference === "string" && reference.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)#(n\d+)$/);
  if (!match) throw new Error(`Некоректне посилання на нотатку: ${reference}`);
  return { fileSlug: match[1], anchor: match[2] };
}

export function parseNoteBlocks(source, fileSlug) {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const markers = [];
  lines.forEach((line, index) => {
    const match = line.match(NOTE_MARKER);
    if (match) markers.push({ anchor: match[1], index });
  });
  const anchors = markers.map(({ anchor }) => anchor);
  const duplicate = anchors.find((anchor, index) => anchors.indexOf(anchor) !== index);
  if (duplicate) throw new Error(`Повторний якір нотатки: ${duplicate}`);
  return markers.map((marker, index) => {
    const end = markers[index + 1]?.index ?? lines.length;
    const text = lines.slice(marker.index + 1, end).join("\n").trim();
    return { reference: `${fileSlug}#${marker.anchor}`, anchor: marker.anchor, text };
  });
}

export function nextNoteAnchor(source) {
  const ids = parseNoteBlocks(source, "notes").map(({ anchor }) => Number(anchor.slice(1)));
  return `n${Math.max(0, ...ids) + 1}`;
}

export function newNoteDocument(type, name) {
  return `---\ntype: ${type}\nname: ${JSON.stringify(name)}\n---\n`;
}

export function appendNoteBlock(source, anchor, text) {
  const content = validateNoteText(text);
  const base = source.replace(/\s*$/, "");
  return `${base}\n\n<!-- note ${anchor} -->\n${content}\n`;
}

export function updateNoteBlock(source, anchor, text) {
  const content = validateNoteText(text);
  const normalized = source.replace(/\r\n/g, "\n");
  parseNoteBlocks(normalized, "notes");
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) => line.match(NOTE_MARKER)?.[1] === anchor);
  if (start < 0) throw new Error(`Не знайдено якір нотатки ${anchor}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (NOTE_MARKER.test(lines[index])) { end = index; break; }
  }
  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  return `${[...before, content, "", ...after].join("\n").replace(/\s*$/, "")}\n`;
}

export function removeNoteBlock(source, anchor) {
  const normalized = source.replace(/\r\n/g, "\n");
  parseNoteBlocks(normalized, "notes");
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) => line.match(NOTE_MARKER)?.[1] === anchor);
  if (start < 0) throw new Error(`Не знайдено якір нотатки ${anchor}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (NOTE_MARKER.test(lines[index])) { end = index; break; }
  }
  let removeStart = start;
  while (removeStart > 0 && !lines[removeStart - 1].trim()) removeStart -= 1;
  lines.splice(removeStart, end - removeStart);
  return `${lines.join("\n").replace(/\s*$/, "")}\n`;
}
