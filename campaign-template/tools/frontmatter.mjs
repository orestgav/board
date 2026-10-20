// Спільний парсер плоских метаданих кампанії, не повний YAML.
// Зберігає [[посилання]], inline-масиви й числа як рядки.
const FLAGS = new Set(['secret', 'public', 'pc_known', 'image_known', 'image_padding']);

function scalar(raw, fail) {
  const value = raw.trim();
  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    // У масивах тегів # усередині лапок є частиною значення.
    let innerQuote = null;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (innerQuote) {
        if (innerQuote === '"' && ch === '\\') { i++; continue; }
        if (ch === innerQuote) {
          if (ch === "'" && value[i + 1] === "'") { i++; continue; }
          innerQuote = null;
        }
      } else if ((ch === '"' || ch === "'") && /[\s\[,]/.test(value[i - 1] || '')) {
        innerQuote = ch;
      } else if (ch === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
        return value.slice(0, i).trim();
      }
    }
    return value;
  }
  let end = -1;
  for (let i = 1; i < value.length; i++) {
    if (quote === '"' && value[i] === '\\') { i++; continue; }
    if (value[i] !== quote) continue;
    if (quote === "'" && value[i + 1] === "'") { i++; continue; }
    end = i;
    break;
  }
  if (end < 0) fail('незакриті лапки');
  const tail = value.slice(end + 1);
  if (tail.trim() && !/^\s+#/.test(tail)) fail('зайвий текст після лапок');
  const quoted = value.slice(0, end + 1);
  if (quote === "'") return quoted.slice(1, -1).replace(/''/g, "'");
  try { return JSON.parse(quoted); }
  catch { fail('некоректний рядок у подвійних лапках'); }
}

export function parseFrontmatter(text, file = '<text>') {
  const raw = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const meta = Object.create(null);
  if (!/^---[ \t]*\n/.test(raw)) return { meta, body: raw, hasFrontmatter: false };
  const lines = raw.split('\n');
  const end = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line));
  if (end < 0) throw new Error(`${file}: незакритий блок метаданих`);
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const fail = (message) => { throw new Error(`${file}:${i + 1}: ${message}`); };
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = line.match(/^([a-z_]+):[ \t]*(.*)$/);
    if (!m) fail('очікується поле у форматі key: value без відступу');
    const [, key, value] = m;
    if (Object.hasOwn(meta, key)) fail(`повторне поле '${key}'`);
    const parsed = scalar(value, fail);
    if (FLAGS.has(key) && parsed !== 'true' && parsed !== 'false') {
      fail(`поле '${key}': дозволено лише true або false`);
    }
    meta[key] = parsed;
  }
  return { meta, body: lines.slice(end + 1).join('\n'), hasFrontmatter: true };
}

export function isPrivate(meta) {
  return meta.secret === 'true' || meta.public === 'false' || meta.pc_known === 'false';
}
