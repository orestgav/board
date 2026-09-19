import assert from "node:assert/strict";
import test from "node:test";
import { entityRecord, extractSection, finalizeEntities, linkedEntities, locationLinks, matchesEntity } from "../public/entities.js";

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
  assert.equal(matchesEntity(entity, "ЕСТ"), true);
  assert.equal(matchesEntity(entity, "location"), false);
});

test("entity index rejects duplicate slugs", () => {
  assert.throws(() => finalizeEntities([{ slug: "ester", name: "A" }, { slug: "ester", name: "B" }]), /Повторний slug/);
});

test("location links are read from plain references and from phrases", () => {
  assert.deepEqual(locationLinks("[[arven]]"), ["arven"]);
  assert.deepEqual(locationLinks("тракт [[lauris]] — [[arven]]"), ["lauris", "arven"]);
  assert.deepEqual(locationLinks("[[arven|Арвен]]"), ["arven"]);
  assert.deepEqual(locationLinks("не визначено"), []);
  assert.deepEqual(locationLinks(undefined), []);
});

test("entity record keeps the locations it links to", () => {
  const entity = entityRecord(
    "npcs/arven/pekar.md",
    { type: "npc", name: "Пекар", location: "[[arven]]" },
    "",
    { portraitField: "image", summarySection: "## На дошці" },
  );
  assert.deepEqual(entity.locations, ["arven"]);
});

test("members of a location are the linked cards of the asked type", () => {
  const cards = [
    { slug: "pekar", type: "npc", locations: ["arven"] },
    { slug: "barni", type: "npc", locations: ["arven"] },
    { slug: "ester", type: "npc", locations: ["garona"] },
    { slug: "zalizo", type: "location", locations: ["arven"] },
  ];
  assert.deepEqual(linkedEntities(cards, "arven", "npc").map((card) => card.slug), ["pekar", "barni"]);
  assert.deepEqual(linkedEntities(cards, "lauris", "npc"), []);
});
