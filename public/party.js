// Панель «Партія»: живі листи гравців з D&D Beyond. Тут усе, що не торкається
// DOM дошки: хто в партії, опитування посередника, «привид» зміни HP і
// розмітка компактної картки та попапа. app.js лише вставляє HTML і кнопки.
import { RESET_LABELS, normalizeCharacter } from "./ddb.js";
import { escapeHtml } from "./markdown.js";

// Скільки живе підсвічений шматок смуги HP після зміни.
export const GHOST_MS = 15000;
const REQUEST_TIMEOUT = 10000;
const MAX_PIPS = 8;

// Гравці з ID листа у фронтматері (`ddb_id: 153354937`).
export function partyMembers(entities, idField = "ddb_id") {
  return entities
    .filter((entity) => entity.type === "player")
    .map((entity) => ({ entity, ddbId: String(entity.meta?.[idField] ?? "").trim() }))
    .filter(({ ddbId }) => /^\d{1,12}$/.test(ddbId))
    .map(({ entity, ddbId }) => ({
      slug: entity.slug,
      name: entity.name,
      short: shortName(entity.name),
      ddbId,
    }))
    .sort((a, b) => a.short.localeCompare(b.short, "uk"));
}

// На вузькій картці — лише перше слово: «Алренсіс дан Ессаар…» → «Алренсіс».
export function shortName(name) {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

function effectiveHitPoints(state) {
  return state.hp.current + state.hp.temp;
}

// Новий «привид» після опитування. Смуга — це поточні HP, а за ними тимчасові,
// тож втрачене чи здобуте завжди лежить одним відрізком між старою й новою
// сумою. Кілька змін одного знаку за 15 с зливаються в один відрізок.
export function nextGhost(previous, next, ghost, now) {
  const live = ghost && now < ghost.until ? ghost : null;
  if (!previous || !next) return live;
  const before = effectiveHitPoints(previous);
  const after = effectiveHitPoints(next);
  if (before === after) return live;
  const kind = after < before ? "damage" : "heal";
  let from = Math.min(before, after);
  let to = Math.max(before, after);
  if (live && live.kind === kind) {
    if (kind === "damage") to = Math.max(to, live.to);
    else from = Math.min(from, live.from);
  }
  return { kind, from, to, since: now, until: now + GHOST_MS };
}

// Відрізки смуги у відсотках. Шкала — макс. HP плюс тимчасові, щоб
// тимчасові не вилазили за край; привид втрати може на мить розширити її.
export function hitPointSegments(hp, ghost, now) {
  const live = ghost && now < ghost.until ? ghost : null;
  const scale = Math.max(1, hp.max + hp.temp, live?.to ?? 0);
  const percent = (value) => Math.max(0, Math.min(100, (value / scale) * 100));
  const segment = (kind, from, to) => ({ kind, left: percent(from), width: percent(to) - percent(from) });
  const ratio = hp.max ? hp.current / hp.max : 0;
  const health = ratio > 0.5 ? "healthy" : ratio > 0.25 ? "wounded" : "critical";
  const segments = [segment(`current ${health}`, 0, hp.current)];
  if (hp.temp > 0) segments.push(segment("temp", hp.current, hp.current + hp.temp));
  if (live) segments.push({ ...segment(`ghost ${live.kind}`, live.from, live.to), elapsed: now - live.since });
  return segments.filter((entry) => entry.width > 0);
}

function pips(used, max) {
  if (max > MAX_PIPS) return `<span class="party-count">${max - used}/${max}</span>`;
  const left = max - used;
  return `<span class="party-pips">${"<i class=\"on\"></i>".repeat(left)}${"<i></i>".repeat(used)}</span>`;
}

function hitPointBar(hp, ghost, now) {
  const segments = hitPointSegments(hp, ghost, now).map((entry) => {
    const delay = entry.elapsed === undefined ? "" : `;animation-delay:-${entry.elapsed}ms`;
    return `<i class="party-hp-${entry.kind.replace(" ", " party-hp-")}" style="left:${entry.left.toFixed(2)}%;width:${entry.width.toFixed(2)}%${delay}"></i>`;
  }).join("");
  const temp = hp.temp ? ` <b>+${hp.temp}</b>` : "";
  const title = `${hp.current} з ${hp.max} HP${hp.temp ? `, тимчасових ${hp.temp}` : ""}`;
  return `<div class="party-hp" title="${title}">${segments}<span class="party-hp-text">${hp.current}/${hp.max}${temp}</span></div>`;
}

function resetLabel(reset) {
  return RESET_LABELS[reset] ?? "";
}

function cardResources(state) {
  return state.resources.filter((entry) => !entry.source.startsWith("spell:"));
}

export function ageLabel(fetchedAt, now) {
  if (fetchedAt === null || fetchedAt === undefined) return "ще не оновлено";
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (seconds < 5) return "щойно";
  if (seconds < 60) return `${seconds} с тому`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} хв тому`;
  return `${Math.round(minutes / 60)} год тому`;
}

const ERROR_LABELS = {
  private: "Лист приватний: гравець має відкрити його (Public)",
  missing: "Лист не знайдено: перевір ddb_id",
  network: "Немає звʼязку з посередником",
  format: "D&D Beyond віддав щось незрозуміле",
};

function errorLine(entry, now) {
  if (!entry.error) return "";
  const age = entry.state ? ` · дані ${ageLabel(entry.fetchedAt, now)}` : "";
  return `<div class="party-error">${escapeHtml(ERROR_LABELS[entry.error] ?? entry.error)}${age}</div>`;
}

function statusBadges(state) {
  const badges = [];
  if (state.hp.current === 0 && !state.deathSaves.stable) {
    const saves = `<span class="party-saves"><span class="ok">${"●".repeat(state.deathSaves.success)}${"○".repeat(3 - state.deathSaves.success)}</span>`
      + `<span class="bad">${"●".repeat(state.deathSaves.fail)}${"○".repeat(3 - state.deathSaves.fail)}</span></span>`;
    badges.push(`<span class="party-badge death" title="Рятунки від смерті: успіхи / провали">☠ ${saves}</span>`);
  } else if (state.hp.current === 0) {
    badges.push("<span class=\"party-badge death\">Стабілізований</span>");
  }
  for (const condition of state.conditions) badges.push(`<span class="party-badge condition">${escapeHtml(condition.label)}</span>`);
  if (state.exhaustion) badges.push(`<span class="party-badge condition">Виснаження ${state.exhaustion}</span>`);
  return badges;
}

function loadBadge(inventory) {
  const level = inventory.load > 100 ? "over" : inventory.load >= 80 ? "heavy" : "light";
  return `<span class="party-load ${level}" title="Вага: ${inventory.weight} з ${inventory.capacity} lb">⚖ ${inventory.load}%</span>`;
}

export function partyCardMarkup(member, entry = {}, now = Date.now()) {
  const state = entry.state;
  const name = `<span class="party-name" title="${escapeHtml(member.name)}">${escapeHtml(member.short)}</span>`;
  if (!state) {
    const waiting = entry.error ? errorLine(entry, now) : "<div class=\"party-waiting\">Завантаження…</div>";
    return `<article class="party-card empty" data-slug="${escapeHtml(member.slug)}"><header>${name}</header>${waiting}</article>`;
  }
  const inspiration = state.inspiration ? "<span class=\"party-inspiration\" title=\"Натхнення\">★</span>" : "";
  const slots = state.slots.map((slot) => `<span class="party-slot" title="Комірки ${slot.level}-го рівня: ${slot.max - slot.used} з ${slot.max}"><small>${slot.level}</small>${pips(slot.used, slot.max)}</span>`);
  if (state.pact) {
    slots.push(`<span class="party-slot pact" title="Комірки пакту ${state.pact.level}-го рівня: ${state.pact.max - state.pact.used} з ${state.pact.max}"><small>П${state.pact.level}</small>${pips(state.pact.used, state.pact.max)}</span>`);
  }
  const resources = cardResources(state).map((resource) => {
    const reset = resetLabel(resource.reset);
    return `<span class="party-resource" title="${escapeHtml(resource.name)}: ${resource.max - resource.used} з ${resource.max}${reset ? ` (${reset})` : ""}">`
      + `<span>${escapeHtml(resource.name)}</span>${pips(resource.used, resource.max)}</span>`;
  });
  const footer = [...statusBadges(state), loadBadge(state.inventory)];
  const stale = entry.error ? " stale" : "";
  return `<article class="party-card${stale}" data-slug="${escapeHtml(member.slug)}" tabindex="0" role="button" aria-label="${escapeHtml(member.name)}: подробиці">`
    + `<header>${name}${inspiration}<span class="party-ac" title="Клас броні">AC ${state.ac}</span></header>`
    + hitPointBar(state.hp, entry.ghost, now)
    + (slots.length ? `<div class="party-slots">${slots.join("")}</div>` : "")
    + (resources.length ? `<div class="party-resources">${resources.join("")}</div>` : "")
    + `<footer>${footer.join("")}</footer>`
    + errorLine(entry, now)
    + "</article>";
}

const ABILITY_LABELS = [["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"]];
const SPELL_SOURCES = { class: "", race: "вид", feat: "фіт", item: "предмет", background: "передісторія" };

function signed(value) {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function detailsResources(state) {
  const rows = state.resources.map((resource) => {
    const reset = resetLabel(resource.reset);
    const free = resource.source.startsWith("spell:") ? " <small>без комірки</small>" : "";
    return `<tr><th>${escapeHtml(resource.name)}${free}</th><td>${pips(resource.used, resource.max)}</td><td>${resource.max - resource.used} / ${resource.max}</td><td>${reset}</td></tr>`;
  });
  for (const dice of state.hitDice) {
    if (!dice.max) continue;
    rows.push(`<tr><th>Кості хітів d${dice.die} <small>${escapeHtml(dice.className)}</small></th><td>${pips(dice.used, dice.max)}</td><td>${dice.max - dice.used} / ${dice.max}</td><td>${resetLabel(2)}</td></tr>`);
  }
  return rows.length ? `<table class="party-table">${rows.join("")}</table>` : "<p class=\"party-muted\">Немає</p>";
}

function detailsInventory(state) {
  const items = state.inventory.items;
  const containers = new Map(items.filter((item) => item.isContainer).map((item) => [item.id, item.name]));
  const groups = new Map([["Вдягнене", []], ["При собі", []]]);
  for (const item of items) {
    let group;
    if (item.type === "custom") group = "Власні предмети";
    else if (item.container) group = containers.get(item.container) ?? "У контейнері";
    else group = item.equipped ? "Вдягнене" : "При собі";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  const sections = [...groups].filter(([, list]) => list.length).map(([title, list]) => {
    const weight = Math.round(list.reduce((sum, item) => sum + item.weight, 0) * 10) / 10;
    const rows = list.map((item) => {
      const marks = [item.magic ? "<span class=\"party-mark magic\" title=\"Магічний\">✦</span>" : "",
        item.attuned ? "<span class=\"party-mark\" title=\"Налаштований\">⟡</span>" : ""].join("");
      return `<tr><th>${escapeHtml(item.name)}${marks}</th><td>${item.quantity > 1 ? `×${item.quantity}` : ""}</td><td>${item.weight ? `${item.weight} lb` : "—"}</td></tr>`;
    }).join("");
    return `<h3>${escapeHtml(title)} <small>${weight} lb</small></h3><table class="party-table party-items">${rows}</table>`;
  });
  const { weight, capacity, load } = state.inventory;
  const level = load > 100 ? "over" : load >= 80 ? "heavy" : "light";
  return `<div class="party-weight ${level}"><div><i style="width:${Math.min(100, load)}%"></i></div>`
    + `<span>${weight} / ${capacity} lb · ${load}%</span></div>${sections.join("")}`;
}

function detailsSpells(state) {
  if (!state.spells.length) return "<p class=\"party-muted\">Немає</p>";
  const byLevel = new Map();
  for (const spell of state.spells) {
    if (!byLevel.has(spell.level)) byLevel.set(spell.level, []);
    byLevel.get(spell.level).push(spell);
  }
  return [...byLevel].map(([level, spells]) => {
    const list = spells.map((spell) => {
      const source = SPELL_SOURCES[spell.source] ? ` <small>${SPELL_SOURCES[spell.source]}</small>` : "";
      return `<li class="${spell.prepared ? "" : "unprepared"}">${escapeHtml(spell.name)}${source}</li>`;
    }).join("");
    return `<h3>${level === 0 ? "Замовляння" : `${level}-й рівень`}</h3><ul class="party-spells">${list}</ul>`;
  }).join("");
}

export function partyDetailsMarkup(member, entry = {}, now = Date.now()) {
  const state = entry.state;
  const heading = `<h1>${escapeHtml(member.name)}</h1>`;
  const sheet = `https://www.dndbeyond.com/characters/${encodeURIComponent(member.ddbId)}`;
  const open = `<div class="party-details" data-slug="${escapeHtml(member.slug)}">`;
  if (!state) return `${open}${heading}${errorLine(entry, now) || "<p class=\"party-muted\">Завантаження…</p>"}</div>`;
  const classes = state.classes.map((cls) => `${cls.name}${cls.subclass ? ` (${cls.subclass})` : ""} ${cls.level}`).join(" / ");
  const abilities = ABILITY_LABELS.map(([key, label]) => {
    const score = state.abilities[key];
    return `<div><small>${label}</small><b>${signed(Math.floor((score - 10) / 2))}</b><span>${score}</span></div>`;
  }).join("");
  const dcs = state.spellSaveDC.map((entry) => `DC ${entry.dc} <small>${escapeHtml(entry.className)}</small>`).join(" · ");
  const slots = [...state.slots.map((slot) => `<span class="party-slot"><small>${slot.level}</small>${pips(slot.used, slot.max)}</span>`),
    ...(state.pact ? [`<span class="party-slot pact"><small>П${state.pact.level}</small>${pips(state.pact.used, state.pact.max)}</span>`] : [])];
  const money = ["pp", "gp", "ep", "sp", "cp"].filter((key) => state.currencies[key])
    .map((key) => `${state.currencies[key]} ${{ pp: "пм", gp: "зм", ep: "ем", sp: "см", cp: "мм" }[key]}`).join(" · ") || "—";
  const badges = statusBadges(state);
  return open
    + `<div class="party-details-links"><button type="button" data-entity-slug="${escapeHtml(member.slug)}">Картка в репозиторії</button>`
    + `<a href="${sheet}" target="_blank" rel="noopener">D&amp;D Beyond ↗</a></div>`
    + heading
    + `<div class="entity-details-meta">${escapeHtml(classes)} · рівень ${state.level}</div>`
    + `<div class="entity-details-path">Оновлено ${ageLabel(entry.fetchedAt, now)}${entry.error ? ` · ${escapeHtml(ERROR_LABELS[entry.error] ?? entry.error)}` : ""}</div>`
    + `<div class="party-details-hp">${hitPointBar(state.hp, entry.ghost, now)}</div>`
    + (badges.length ? `<div class="party-details-badges">${badges.join("")}</div>` : "")
    + "<dl class=\"party-facts\">"
    + `<div><dt>AC</dt><dd>${state.ac}</dd></div>`
    + `<div><dt>Вправність</dt><dd>+${state.proficiencyBonus}</dd></div>`
    + `<div><dt>Пасивна Уважність</dt><dd>${state.passives.perception}</dd></div>`
    + `<div><dt>Пасивна Проникливість</dt><dd>${state.passives.insight}</dd></div>`
    + `<div><dt>Пасивне Розслідування</dt><dd>${state.passives.investigation}</dd></div>`
    + `<div><dt>Натхнення</dt><dd>${state.inspiration ? "★ є" : "немає"}</dd></div>`
    + (dcs ? `<div class="wide"><dt>Складність заклинань</dt><dd>${dcs}</dd></div>` : "")
    + `<div class="wide"><dt>Гроші</dt><dd>${money}</dd></div>`
    + "</dl>"
    + `<div class="party-abilities">${abilities}</div>`
    + (slots.length ? `<h2>Комірки</h2><div class="party-slots">${slots.join("")}</div>` : "")
    + `<h2>Ресурси</h2>${detailsResources(state)}`
    + `<h2>Інвентар</h2>${detailsInventory(state)}`
    + `<h2>Заклинання</h2>${detailsSpells(state)}`
    + (state.feats.length ? `<h2>Фіти</h2><p class="party-muted">${state.feats.map(escapeHtml).join(" · ")}</p>` : "")
    + "</div>";
}

function errorKind(status) {
  if (status === 403 || status === 401) return "private";
  if (status === 404) return "missing";
  return "network";
}

// Опитувач: кожні `interval` секунд тягне всіх гравців паралельно. Попередній
// стан лишається при помилці (картка показує «дані N хв тому»).
export function createPartyMonitor({
  proxy, interval, members, onChange,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
}) {
  const entries = new Map(members.map((member) => [member.slug, { state: null, error: null, fetchedAt: null, ghost: null }]));
  let timer = null;
  let running = false;
  let inflight = null;

  async function load(member) {
    const entry = entries.get(member.slug);
    let error = null;
    let state = null;
    try {
      const response = await fetchImpl(`${proxy}/character/${member.ddbId}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      if (!response.ok) error = errorKind(response.status);
      else {
        try { state = normalizeCharacter(await response.json()); }
        catch { error = "format"; }
      }
    } catch {
      error = "network";
    }
    const time = now();
    if (state) {
      entry.ghost = nextGhost(entry.state, state, entry.ghost, time);
      entry.state = state;
      entry.fetchedAt = time;
      entry.error = null;
    } else {
      entry.error = error;
    }
  }

  async function refresh() {
    if (inflight) return inflight;
    inflight = Promise.all(members.map(load)).finally(() => { inflight = null; });
    await inflight;
    onChange?.();
  }

  function schedule() {
    clearTimer(timer);
    if (!running) return;
    timer = setTimer(async () => {
      await refresh();
      schedule();
    }, interval * 1000);
  }

  return {
    entries,
    members,
    get running() { return running; },
    async start() {
      if (running) return;
      running = true;
      await refresh();
      schedule();
    },
    stop() {
      running = false;
      clearTimer(timer);
      timer = null;
    },
    async refreshNow() {
      await refresh();
      schedule();
    },
  };
}
