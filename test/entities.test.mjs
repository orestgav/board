import assert from "node:assert/strict";
import test from "node:test";
import { entityRecord, extractSection, finalizeEntities, matchesEntity } from "../public/entities.js";

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
