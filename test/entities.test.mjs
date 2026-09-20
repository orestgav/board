import assert from "node:assert/strict";
import test from "node:test";
import { entityRecord, extractSection, finalizeEntities, matchesEntity, sectionLinks, wikiLinks } from "../public/entities.js";

test("board summary stops at the next heading of the same level", () => {
  const body = "# Картка\n\n## На дошці\n- Перша теза\n- Друга теза\n\n### Деталь\nТекст\n\n## Секрети\nНі";
  assert.equal(extractSection(body, "## На дошці"), "- Перша теза\n- Друга теза\n\n### Деталь\nТекст");
  assert.equal(extractSection(body, "## Відсутня"), "");
});

test("entity record resolves portrait and supports picker search", () => {
  const entity = entityRecord(
    "npcs/traveling/ester.md",
    { type: "npc", name: "Естер", image: "ester.webp" },
    "## На дошці\nНебезпечна союзниця.",
    { portraitField: "image", summarySection: "## На дошці" },
    new Map([["ester.webp", "_media/npcs/ester.webp"]]),
  );
  assert.equal(entity.slug, "ester");
  assert.equal(entity.portrait, "_media/npcs/ester.webp");
  assert.equal(entity.summary, "Небезпечна союзниця.");
  assert.equal(entity.meta.image, "ester.webp");
  assert.equal(matchesEntity(entity, "ЕСТ"), true);
  assert.equal(matchesEntity(entity, "location"), false);
});

test("entity index rejects duplicate slugs", () => {
  assert.throws(() => finalizeEntities([{ slug: "ester", name: "A" }, { slug: "ester", name: "B" }]), /Повторний slug/);
});

test("посилання беруться і з чистого значення, і з фрази", () => {
  assert.deepEqual(wikiLinks("[[arven]]"), ["arven"]);
  assert.deepEqual(wikiLinks("тракт [[lauris]] — [[arven]]"), ["lauris", "arven"]);
  assert.deepEqual(wikiLinks("[[arven|Арвен]]"), ["arven"]);
  assert.deepEqual(wikiLinks("[[arven#Влада]]"), ["arven"]);
  assert.deepEqual(wikiLinks("не визначено"), []);
  assert.deepEqual(wikiLinks(undefined), []);
});

const ЗВЯЗКИ = [
  "## Коротко",
  "",
  "- Місто в [[kingdom-garona]].",
  "",
  "## Звʼязки",
  "",
  "- Країна: [[kingdom-garona]]",
  "- Фракції: [[rebels]], [[astur-empire]]",
  "- NPC (ще): [[father-dominic]], [[fiia]]",
  "- NPC: [[king-lionel-iv]], [[fiia]]",
  "- Порожньо:",
  "- Просто речення без мітки.",
].join("\n");

test("секція звʼязків читається мітками рядків", () => {
  const links = sectionLinks(ЗВЯЗКИ, "## Зв'язки");
  assert.deepEqual(links.npc, ["father-dominic", "fiia", "king-lionel-iv"]);
  assert.deepEqual(links.країна, ["kingdom-garona"]);
  assert.deepEqual(links.фракції, ["rebels", "astur-empire"]);
  assert.equal(links.порожньо, undefined);
  assert.equal(Object.keys(links).length, 3);
});

test("вид апострофа в заголовку не має значення", () => {
  assert.deepEqual(sectionLinks(ЗВЯЗКИ, "## Зв'язки").npc.length, 3);
  assert.deepEqual(sectionLinks(ЗВЯЗКИ.replace("Звʼязки", "Зв’язки")).npc.length, 3);
  assert.deepEqual(sectionLinks(ЗВЯЗКИ, "## Локації"), {});
});

test("сусідня секція з тією ж назвою-префіксом не підхоплюється", () => {
  const body = "## Звʼязки з Лантаро\n\n- NPC: [[bob]]\n\n## Звʼязки\n\n- NPC: [[keira]]";
  assert.deepEqual(sectionLinks(body).npc, ["keira"]);
});

test("картка тримає звʼязки зі свого тіла", () => {
  const entity = entityRecord(
    "locations/kingdom-garona/dunmere.md",
    { type: "location", name: "Данмер" },
    ЗВЯЗКИ,
    { portraitField: "image", summarySection: "## На дошці" },
  );
  assert.deepEqual(entity.links.npc, ["father-dominic", "fiia", "king-lionel-iv"]);
});
