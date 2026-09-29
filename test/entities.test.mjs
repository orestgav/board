import assert from "node:assert/strict";
import test from "node:test";
import { backlinks, entityRecord, extractSection, finalizeEntities, indexDocuments, indexedTypes, matchesEntity, mentionLines, sectionLinks, wikiLinks } from "../public/entities.js";
import { parseFrontmatter } from "../public/frontmatter.js";

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

test("token types are indexed even when the campaign config leaves them out", () => {
  assert.deepEqual([...indexedTypes({ types: ["npc"] })].sort(), ["creature", "npc", "player"]);
});

test("документи поза індексом карток ідуть у довідкові, нотатки дошки — ні", () => {
  const config = {
    entities: { types: ["npc"], portraitField: "image", summarySection: "## На дошці" },
    notes: { type: "board" },
  };
  const { entities, references } = indexDocuments([
    { path: "sessions/session-010.md", source: "---\ntype: session\nname: Сесія 10\n---\nЗустріли [[ester]]." },
    { path: "sessions/session-002.md", source: "---\ntype: session\n---\nТекст." },
    { path: "npcs/ester.md", source: "---\ntype: npc\nname: Естер\n---\n## На дошці\nСоюзниця." },
    { path: "board/notes/map-a.md", source: "---\ntype: board\n---\n[[ester]]" },
    { path: "README.md", source: "# Без метаданих" },
  ], parseFrontmatter, config);
  assert.deepEqual(entities.map(({ slug }) => slug), ["ester"]);
  assert.deepEqual(references.map(({ slug, name, type }) => [slug, name, type]), [
    ["session-002", "session-002", "session"],
    ["session-010", "Сесія 10", "session"],
  ]);
});

test("рядки-згадки чистяться від розмітки блоку й знаходять slug без огляду на регістр", () => {
  const body = [
    "# [[ester]] у заголовку",
    "- NPC: [[Ester|Естер]], [[bob]]",
    "> [!note] Про [[ester#Минуле]]",
    "| Хто | Де |",
    "| --- | --- |",
    "| [[ester]] | [[port]] |",
    "Тут лише [[bob]].",
    "**Жирний** початок про [[ester]]",
    "- **Кок** на [[ester]]",
  ].join("\n");
  assert.deepEqual(mentionLines(body, "ester"), [
    "[[ester]] у заголовку",
    "NPC: [[Ester|Естер]], [[bob]]",
    "[!note] Про [[ester#Минуле]]",
    "[[ester]] · [[port]]",
    "**Жирний** початок про [[ester]]",
    "**Кок** на [[ester]]",
  ]);
});

const brackets = (text) => [(text.match(/\[\[/g) ?? []).length, (text.match(/\]\]/g) ?? []).length];

test("довгий абзац обрізається навколо згадки, не ріжучи посилань", () => {
  const after = " далі".repeat(60);
  const line = `${"Слово ".repeat(40)}[[lauris|Лаурісу]] і [[ester]]${after} [[bob]]`;
  const [excerpt] = mentionLines(line, "ester");
  assert.match(excerpt, /^… /);
  assert.match(excerpt, / …$/);
  assert.ok(excerpt.includes("[[ester]]"));
  assert.ok(excerpt.length < line.length);
  const [opened, closed] = brackets(excerpt);
  assert.equal(opened, closed);
  // Межа вікна падає всередину довгого посилання — воно береться цілим.
  const edge = `${"а".repeat(80)} [[lauris|дуже довгий підпис посилання]] ${"б ".repeat(20)}[[ester]]${after}`;
  const [cut] = mentionLines(edge, "ester");
  assert.ok(cut.includes("[[lauris|дуже довгий підпис посилання]]"));
  const [cutOpened, cutClosed] = brackets(cut);
  assert.equal(cutOpened, cutClosed);
});

test("backlinks збирають кожне джерело один раз і пропускають саму картку", () => {
  const documents = [
    { slug: "ester", body: "Я [[ester]]." },
    { slug: "port", body: "- NPC: [[ester]]\n- Ще раз [[ester]]" },
    { slug: "bob", body: "Знає [[port]]." },
    { slug: null, type: "note", body: "Нотатка про [[ester]]" },
  ];
  const found = backlinks("ester", documents);
  assert.deepEqual(found.map(({ document, lines }) => [document.slug, lines.length]), [["port", 2], [null, 1]]);
});

test("вікно посеред **жирного** закриває його зірочки", () => {
  const line = `${"слово ".repeat(30)}**Кок на [[rosinant]], разом із чоловіком** ${"далі ".repeat(60)}**ще жирне ${"слово ".repeat(30)}кінець**`;
  const [excerpt] = mentionLines(line, "rosinant");
  assert.equal((excerpt.match(/\*\*/g) ?? []).length % 2, 0);
  const [inside] = mentionLines(`**${"довге ".repeat(40)}про [[rosinant]] ${"і ще ".repeat(60)}**`, "rosinant");
  assert.match(inside, /^… \*\*/);
  assert.match(inside, /\*\* …$/);
});

test("рядок таблиці з [[посиланням|підписом]] лишається цілим", () => {
  assert.deepEqual(mentionLines("| **[[bremmel-hammer|Молот]]** | 249.9 | Прибиває. |", "bremmel-hammer"), [
    "**[[bremmel-hammer|Молот]]** · 249.9 · Прибиває.",
  ]);
});
