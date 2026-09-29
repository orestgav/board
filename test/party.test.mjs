import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeCharacter } from "../public/ddb.js";
import {
  GHOST_MS,
  ageLabel,
  createPartyMonitor,
  hitPointSegments,
  nextGhost,
  partyCardMarkup,
  partyDetailsMarkup,
  partyMembers,
  shortName,
} from "../public/party.js";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/ddb-character.json", import.meta.url), "utf8"));
const MEMBER = { slug: "alrencis", name: "Алренсіс дан Ессаар Куатель Еланка", short: "Алренсіс", ddbId: "1000" };

function sheet(change = () => {}) {
  const copy = structuredClone(FIXTURE);
  change(copy.data);
  return copy;
}

function hp(current, temp = 0, max = 31) {
  return { hp: { current, max, temp } };
}

test("партія — гравці з числовим ddb_id, за коротким імʼям", () => {
  const entities = [
    { type: "player", slug: "yaropolk", name: "Ярополк з роду Гедиміновичів", meta: { ddb_id: 152380324 } },
    { type: "player", slug: "alrencis", name: "Алренсіс дан Ессаар", meta: { ddb_id: "153354937" } },
    { type: "player", slug: "rene", name: "Рене Фалькро", meta: {} },
    { type: "player", slug: "bad", name: "Хтось", meta: { ddb_id: "abc" } },
    { type: "npc", slug: "koriel", name: "Коріель", meta: { ddb_id: 1 } },
  ];
  assert.deepEqual(partyMembers(entities).map((member) => [member.slug, member.short, member.ddbId]), [
    ["alrencis", "Алренсіс", "153354937"],
    ["yaropolk", "Ярополк", "152380324"],
  ]);
  assert.equal(partyMembers(entities, "dndbeyond").length, 0);
  assert.equal(shortName("  Медіз Горгон "), "Медіз");
});

test("привид: втрата — відрізок між новою й старою сумою HP і тимчасових", () => {
  const ghost = nextGhost(hp(28, 5), hp(20, 0), null, 1000);
  assert.deepEqual(ghost, { kind: "damage", from: 20, to: 33, since: 1000, until: 1000 + GHOST_MS });
});

test("привид: лікування, зливання змін одного знаку, заміна при зміні знаку", () => {
  const heal = nextGhost(hp(10), hp(18), null, 0);
  assert.deepEqual([heal.kind, heal.from, heal.to], ["heal", 10, 18]);
  const first = nextGhost(hp(30), hp(25), null, 0);
  const second = nextGhost(hp(25), hp(15), first, 5000);
  assert.deepEqual([second.kind, second.from, second.to, second.until], ["damage", 15, 30, 5000 + GHOST_MS]);
  const turned = nextGhost(hp(15), hp(20), second, 6000);
  assert.deepEqual([turned.kind, turned.from, turned.to], ["heal", 15, 20]);
});

test("привид: без змін живе до кінця строку, потім зникає", () => {
  const ghost = nextGhost(hp(30), hp(25), null, 0);
  assert.equal(nextGhost(hp(25), hp(25), ghost, GHOST_MS - 1), ghost);
  assert.equal(nextGhost(hp(25), hp(25), ghost, GHOST_MS), null);
  assert.equal(nextGhost(null, hp(25), null, 0), null);
});

test("смуга: поточні, тимчасові окремим відрізком, привид на своєму місці", () => {
  const ghost = { kind: "damage", from: 20, to: 30, since: 0, until: GHOST_MS };
  const segments = hitPointSegments({ current: 20, max: 30, temp: 10 }, ghost, 3000);
  assert.deepEqual(segments.map((entry) => [entry.kind, Math.round(entry.left), Math.round(entry.width)]), [
    ["current healthy", 0, 50],
    ["temp", 50, 25],
    ["ghost damage", 50, 25],
  ]);
  assert.equal(segments[2].elapsed, 3000);
  assert.equal(hitPointSegments({ current: 7, max: 30, temp: 0 }, ghost, GHOST_MS).length, 1);
  assert.equal(hitPointSegments({ current: 7, max: 30, temp: 0 }, null, 0)[0].kind, "current critical");
  assert.deepEqual(hitPointSegments({ current: 0, max: 30, temp: 0 }, null, 0), []);
});

test("картка: імʼя, AC, HP, комірки, ресурси класу, вага; безкоштовні заклинання — лише в попапі", () => {
  const state = normalizeCharacter(sheet((data) => {
    data.temporaryHitPoints = 4;
    data.spellSlots = [{ level: 1, used: 1 }];
  }));
  const html = partyCardMarkup(MEMBER, { state, fetchedAt: 0 }, 0);
  assert.match(html, /Алренсіс<\/span>/);
  assert.match(html, /AC 15/);
  assert.match(html, /28\/31 <b>\+4<\/b>/);
  assert.match(html, /party-hp-temp/);
  assert.match(html, /Комірки 1-го рівня: 2 з 3/);
  assert.match(html, /Bardic Inspiration: 2 з 2 \(довгий відпочинок\)/);
  assert.doesNotMatch(html, /Detect Magic/);
  assert.match(html, /⚖ 97%/);
  assert.match(html, /party-inspiration/);
});

test("картка: на нулі — рятунки від смерті, стани й виснаження", () => {
  const state = normalizeCharacter(sheet((data) => {
    data.removedHitPoints = 31;
    data.deathSaves = { successCount: 1, failCount: 2, isStabilized: false };
    data.conditions = [{ id: 15 }, { id: 4, level: 1 }];
  }));
  const html = partyCardMarkup(MEMBER, { state }, 0);
  assert.match(html, /☠/);
  assert.match(html, /Непритомний/);
  assert.match(html, /Виснаження 1/);
});

test("картка: помилка зі старими даними й без них", () => {
  const state = normalizeCharacter(FIXTURE);
  const stale = partyCardMarkup(MEMBER, { state, fetchedAt: 0, error: "network" }, 120000);
  assert.match(stale, /party-card stale/);
  assert.match(stale, /Немає звʼязку з посередником · дані 2 хв тому/);
  const empty = partyCardMarkup(MEMBER, { error: "private" }, 0);
  assert.match(empty, /Лист приватний/);
  assert.match(partyCardMarkup(MEMBER, {}, 0), /Завантаження/);
});

test("попап: характеристики, ресурси з безкоштовними, інвентар за контейнерами, заклинання", () => {
  const state = normalizeCharacter(FIXTURE);
  const html = partyDetailsMarkup(MEMBER, { state, fetchedAt: 0 }, 1000);
  assert.match(html, /<h1>Алренсіс дан Ессаар Куатель Еланка<\/h1>/);
  assert.match(html, /Rogue 2 \/ Bard 2 · рівень 4/);
  assert.match(html, /Пасивна Проникливість<\/dt><dd>15/);
  assert.match(html, /DC 12/);
  assert.match(html, /Detect Magic <small>без комірки<\/small>/);
  assert.match(html, /Кості хітів d8/);
  assert.match(html, /116 \/ 120 lb · 97%/);
  assert.match(html, /<h3>Scroll Satchel/);
  assert.match(html, /<h3>Замовляння<\/h3>/);
  assert.match(html, /dndbeyond\.com\/characters\/1000/);
});

test("вік даних", () => {
  assert.equal(ageLabel(null, 0), "ще не оновлено");
  assert.equal(ageLabel(0, 3000), "щойно");
  assert.equal(ageLabel(0, 42000), "42 с тому");
  assert.equal(ageLabel(0, 5 * 60000), "5 хв тому");
});

test("опитувач: тягне всіх, рахує привида, при помилці лишає старі дані", async () => {
  let clock = 0;
  let removed = 3;
  let status = 200;
  const urls = [];
  const timers = [];
  const monitor = createPartyMonitor({
    proxy: "https://proxy.example",
    interval: 15,
    members: [MEMBER],
    now: () => clock,
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: () => {},
    fetchImpl: async (url) => {
      urls.push(url);
      if (status === 0) throw new Error("offline");
      return new Response(JSON.stringify(sheet((data) => { data.removedHitPoints = removed; })), { status });
    },
  });
  await monitor.start();
  assert.deepEqual(urls, ["https://proxy.example/character/1000"]);
  assert.equal(monitor.entries.get("alrencis").state.hp.current, 28);
  assert.equal(timers.at(-1).delay, 15000);

  clock = 15000;
  removed = 13;
  await timers.at(-1).callback();
  const entry = monitor.entries.get("alrencis");
  assert.equal(entry.state.hp.current, 18);
  assert.deepEqual([entry.ghost.kind, entry.ghost.from, entry.ghost.to], ["damage", 18, 28]);

  clock = 30000;
  status = 403;
  await monitor.refreshNow();
  assert.equal(entry.error, "private");
  assert.equal(entry.state.hp.current, 18);
  assert.equal(entry.fetchedAt, 15000);

  status = 0;
  await monitor.refreshNow();
  assert.equal(entry.error, "network");

  monitor.stop();
  assert.equal(monitor.running, false);
});
