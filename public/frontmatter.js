// Вбудований парсер метаданих карток — для кампанії, що не має власного
// (поле `frontmatter` у board.config.json не задане). Формат той самий, що й у
// tools/frontmatter.mjs кампаній: плоскі поля `key: value`, не повний YAML;
// [[посилання]], inline-масиви й числа лишаються рядками. Кампанія з власним
// парсером і далі користується своїм — тоді канва й валідатор читають картки
// однаково.

function scalar(raw, fail) {
  const value = raw.trim();
  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    // У масивах тегів # усередині лапок є частиною значення.
    let innerQuote = null;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (innerQuote) {
        if (innerQuote === '"' && character === "\\") { index += 1; continue; }
        if (character === innerQuote) {
          if (character === "'" && value[index + 1] === "'") { index += 1; continue; }
          innerQuote = null;
        }
      } else if ((character === '"' || character === "'") && /[\s[,]/.test(value[index - 1] || "")) {
        innerQuote = character;
      } else if (character === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
        return value.slice(0, index).trim();
      }
    }
    return value;
  }
  let end = -1;
  for (let index = 1; index < value.length; index += 1) {
    if (quote === '"' && value[index] === "\\") { index += 1; continue; }
    if (value[index] !== quote) continue;
    if (quote === "'" && value[index + 1] === "'") { index += 1; continue; }
    end = index;
    break;
  }
  if (end < 0) fail("незакриті лапки");
  const tail = value.slice(end + 1);
  if (tail.trim() && !/^\s+#/.test(tail)) fail("зайвий текст після лапок");
  const quoted = value.slice(0, end + 1);
  if (quote === "'") return quoted.slice(1, -1).replace(/''/g, "'");
  try { return JSON.parse(quoted); }
  catch { return fail("некоректний рядок у подвійних лапках"); }
}

export function parseFrontmatter(text, file = "<text>") {
  const raw = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const meta = Object.create(null);
  if (!/^---[ \t]*\n/.test(raw)) return { meta, body: raw, hasFrontmatter: false };
  const lines = raw.split("\n");
  const end = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line));
  if (end < 0) throw new Error(`${file}: незакритий блок метаданих`);
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    const fail = (message) => { throw new Error(`${file}:${index + 1}: ${message}`); };
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = line.match(/^([a-z_]+):[ \t]*(.*)$/);
    if (!match) fail("очікується поле у форматі key: value без відступу");
    const [, key, value] = match;
    if (Object.hasOwn(meta, key)) fail(`повторне поле '${key}'`);
    meta[key] = scalar(value, fail);
  }
  return { meta, body: lines.slice(end + 1).join("\n"), hasFrontmatter: true };
}
