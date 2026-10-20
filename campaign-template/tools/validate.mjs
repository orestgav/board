#!/usr/bin/env node
// Валідатор бази знань кампанії. Без залежностей.
// Запуск: node tools/validate.mjs
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, isPrivate } from './frontmatter.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', '.github', '.obsidian', 'node_modules', 'tools', '_templates']);
const ENTITY_TYPES = new Set(['player', 'npc', 'location', 'world', 'faction', 'session', 'creature', 'item', 'encounter']);
const ALL_TYPES = new Set([...ENTITY_TYPES, 'ai-context', 'board']);
// Типи, які виводяться на публічний сайт (tools/build-public.mjs)
const SITE_TYPES = new Set(['npc', 'location', 'faction', 'world', 'item']);
const PUBLIC_SECTION = '## Публічна довідка';

const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Прибираємо код-блоки та інлайн-код, щоб плейсхолдери в документації
// не рахувалися за справжні посилання.
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

const allFiles = walk(ROOT);
const files = allFiles.filter((f) => f.endsWith('.md'));
const attachments = new Set(allFiles.filter((f) => !f.endsWith('.md')).map((f) => basename(f)));
const byBasename = new Map();
const boardNoteReferences = new Set();

// --- медіа ---
// Картинки живуть у _media/. Поля `image:` і `map:` вказують тільки імʼя файлу,
// тому імена мають бути унікальні по всій теці — інакше незрозуміло, який файл обрано.
const MEDIA = join(ROOT, '_media');
const mediaFiles = allFiles.filter((f) => f.startsWith(MEDIA + sep) && basename(f) !== '.gitkeep');
const mediaByName = new Map();
for (const f of mediaFiles) {
  const b = basename(f);
  if (!mediaByName.has(b)) mediaByName.set(b, []);
  mediaByName.get(b).push(relative(ROOT, f).split(sep).join('/'));
}
for (const [name, paths] of mediaByName) {
  if (paths.length > 1) errors.push(`дубль медіафайлу '${name}': ${paths.join(', ')}`);
}
// Формат медіа — тільки WebP.
for (const [name, paths] of mediaByName) {
  if (/\.(?:png|jpe?g|gif|avif)$/i.test(name)) {
    warnings.push(`${paths[0]}: не WebP — сконвертуй у .webp (див. ai-context/SCHEMA.md)`);
  }
}

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const base = basename(file, '.md');
  const raw = readFileSync(file, 'utf8');

  if (!byBasename.has(base)) byBasename.set(base, []);
  byBasename.get(base).push(rel);

  // --- YAML frontmatter ---
  let parsed;
  try { parsed = parseFrontmatter(raw, rel); }
  catch (error) { errors.push(error.message); continue; }
  if (!parsed.hasFrontmatter) continue; // README/SCHEMA/AI_INSTRUCTIONS — не сутності
  const { meta } = parsed;
  const type = meta.type;

  if (!type) {
    errors.push(`${rel}: у YAML немає поля 'type'`);
  } else if (!ALL_TYPES.has(type)) {
    errors.push(`${rel}: невідомий type: '${type}' (див. ai-context/SCHEMA.md)`);
  }

  if (type === 'board') {
    if (!rel.startsWith('board/notes/')) errors.push(`${rel}: type 'board' дозволений лише у board/notes/`);
    if (!base.startsWith('map-')) errors.push(`${rel}: файл нотаток дошки мусить починатися з 'map-'`);
    const anchors = [...raw.matchAll(/^<!-- note (n\d+) -->[ \t]*$/gm)].map((match) => match[1]);
    const duplicateAnchors = anchors.filter((anchor, index) => anchors.indexOf(anchor) !== index);
    if (duplicateAnchors.length) errors.push(`${rel}: повторні якорі нотаток: ${[...new Set(duplicateAnchors)].join(', ')}`);
    for (const line of raw.split(/\r?\n/).filter((value) => value.startsWith('<!-- note '))) {
      if (!/^<!-- note n\d+ -->[ \t]*$/.test(line)) errors.push(`${rel}: некоректний якір нотатки '${line}'`);
    }
    for (const anchor of anchors) boardNoteReferences.add(`${base}#${anchor}`);
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(base)) {
    errors.push(`${rel}: імʼя файлу не в kebab-case`);
  }

  // Картка, яку побачать гравці, має мати текст для них. Прапорці, що виводять
  // сутність із сайту, знімають цю вимогу — там довідці нема куди йти.
  const offSite = isPrivate(meta);
  if (SITE_TYPES.has(type) && !offSite && !raw.includes(PUBLIC_SECTION)) {
    warnings.push(`${rel}: немає секції '${PUBLIC_SECTION}' (картка йде на сайт)`);
  }

  // --- внутрішні посилання ---
  for (const m of stripCode(raw).matchAll(/\[\[([^\]|#]+)/g)) {
    const target = m[1].trim();
    if (!target) continue;
    // Вкладення (![[map.png]]) резолвимо серед не-.md файлів, сутності — серед .md
    const ok = target.includes('.')
      ? attachments.has(target)
      : files.some((f) => basename(f, '.md') === target);
    if (!ok) errors.push(`${rel}: биті посилання [[${target}]]`);
  }

  // --- картинки ---
  // Медіаполя в YAML містять лише імʼя файлу (шукається за іменем і не
  // ламається при переїзді картки). `map:` призначене тільки для локацій,
  // а сам файл карти має лежати у _media/maps/.
  for (const field of ['image', 'map', 'initiative_token']) {
    const value = meta[field];
    if (!value) continue;
    if (value.includes('/')) {
      errors.push(`${rel}: ${field}: '${value}' — треба лише імʼя файлу, без шляху`);
      continue;
    }
    if (!mediaByName.has(value)) {
      errors.push(`${rel}: ${field}: '${value}' — такого файлу в _media/ немає`);
      continue;
    }
    if (field === 'map') {
      if (type !== 'location') errors.push(`${rel}: map: дозволене лише для type: location`);
      const mediaPath = mediaByName.get(value)[0];
      if (!mediaPath.startsWith('_media/maps/')) errors.push(`${rel}: map: '${value}' має лежати в _media/maps/`);
    }
    if (field === 'initiative_token') {
      if (type !== 'creature') errors.push(`${rel}: initiative_token: дозволене лише для type: creature`);
      const mediaPath = mediaByName.get(value)[0];
      if (!mediaPath.startsWith('_media/initiative-tokens/')) errors.push(`${rel}: initiative_token: '${value}' має лежати в _media/initiative-tokens/`);
    }
  }

  if (type === 'item' && !['true', 'false'].includes(String(meta.attunement ?? '').trim())) {
    errors.push(`${rel}: attunement: '${meta.attunement ?? ''}' — обовʼязкове, лише true або false`);
  }

  const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
  if (meta.rarity && !RARITIES.includes(String(meta.rarity).trim())) {
    errors.push(`${rel}: rarity: '${meta.rarity}' — лише ${RARITIES.join(' / ')} або порожньо`);
  }

  // Ціна предмета — завжди число в золотих: 1 см = 0.1, 1 мм = 0.01.
  if (meta.price && !/^\d+(\.\d+)?$/.test(String(meta.price).trim())) {
    errors.push(`${rel}: price: '${meta.price}' — має бути число в золотих (напр. 29.9 або 0.1)`);
  }

  // Розмітка карт лежить централізовано в map-data/ та використовує
  // нормалізовані координати, незалежні від роздільності зображення.
  const mapDataName = meta.map_data;
  if (mapDataName) {
    if (type !== 'location') errors.push(`${rel}: map_data: дозволене лише для type: location`);
    if (mapDataName.includes('/') || mapDataName.includes('\\') || !mapDataName.endsWith('.json')) {
      errors.push(`${rel}: map_data: '${mapDataName}' — треба лише імʼя JSON-файлу з map-data/`);
    } else {
      const mapDataPath = join(ROOT, 'map-data', mapDataName);
      if (!existsSync(mapDataPath)) {
        errors.push(`${rel}: map_data: '${mapDataName}' — такого файлу в map-data/ немає`);
      } else {
        try {
          const data = JSON.parse(readFileSync(mapDataPath, 'utf8'));
          if (data.map !== meta.map) errors.push(`${rel}: map_data.map має збігатися з полем map: картки`);
          if (data.coordinateSystem !== 'percent-from-top-left') {
            errors.push(`${rel}: map_data.coordinateSystem має бути 'percent-from-top-left'`);
          }
          const ids = new Set();
          const validCoordinate = (value) => typeof value === 'number' && value >= 0 && value <= 100;
          for (const area of Array.isArray(data.areas) ? data.areas : []) {
            if (!area.id || ids.has(area.id)) errors.push(`${rel}: map_data містить порожній або повторний id '${area.id || ''}'`);
            ids.add(area.id);
            if (!Array.isArray(area.points) || area.points.length < 3 || area.points.some((point) =>
              !Array.isArray(point) || point.length !== 2 || !validCoordinate(point[0]) || !validCoordinate(point[1]))) {
              errors.push(`${rel}: map_data area '${area.id || '?'}' має некоректний полігон`);
            }
          }
          for (const landmark of Array.isArray(data.landmarks) ? data.landmarks : []) {
            if (!landmark.id || ids.has(landmark.id)) errors.push(`${rel}: map_data містить порожній або повторний id '${landmark.id || ''}'`);
            ids.add(landmark.id);
            if (!validCoordinate(landmark.x) || !validCoordinate(landmark.y)) {
              errors.push(`${rel}: map_data landmark '${landmark.id || '?'}' має некоректні координати`);
            }
          }
        } catch (error) {
          errors.push(`${rel}: не вдалося прочитати map_data '${mapDataName}': ${error.message}`);
        }
      }
    }
  }

  // Вставки ![опис](шлях) — відносний шлях має вести на справжній файл.
  for (const m of stripCode(raw).matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
    const src = m[1];
    if (/^(https?:|data:)/.test(src)) continue;
    if (!existsSync(join(dirname(file), decodeURI(src)))) {
      errors.push(`${rel}: бита картинка (${src})`);
    }
  }
}

// Obsidian резолвить [[link]] без шляху — однакові імена ламають граф.
for (const [base, paths] of byBasename) {
  if (paths.length > 1) errors.push(`дубль імені '${base}.md': ${paths.join(', ')}`);
}

// Розкладка зберігає лише посилання на текстові блоки. Кожне з них мусить
// вести на наявний службовий якір у board/notes/*.md.
const canvasPath = join(ROOT, 'board', 'canvas.json');
if (existsSync(canvasPath)) {
  try {
    const canvas = JSON.parse(readFileSync(canvasPath, 'utf8'));
    const visitBoardNode = (node) => {
      if (node?.type === 'note') {
        if (typeof node.note !== 'string' || !/^map-[a-z0-9]+(?:-[a-z0-9]+)*#n\d+$/.test(node.note)) {
          errors.push(`board/canvas.json: некоректне посилання нотатки '${node?.note}'`);
        } else if (!boardNoteReferences.has(node.note)) {
          errors.push(`board/canvas.json: не знайдено якір нотатки '${node.note}'`);
        }
      }
      if (Array.isArray(node?.children)) node.children.forEach(visitBoardNode);
    };
    if (!Array.isArray(canvas.children)) errors.push('board/canvas.json: children має бути масивом');
    else canvas.children.forEach(visitBoardNode);
  } catch (error) {
    errors.push(`board/canvas.json: не вдалося прочитати: ${error.message}`);
  }
}

for (const w of warnings) console.log(`  warn  ${w}`);
for (const e of errors) console.log(`  ERROR ${e}`);
console.log(`\nПеревірено файлів: ${files.length}. Помилок: ${errors.length}, попереджень: ${warnings.length}.`);
process.exit(errors.length ? 1 : 0);
