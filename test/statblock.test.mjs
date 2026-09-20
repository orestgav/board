import assert from "node:assert/strict";
import test from "node:test";
import { maxHitPoints, metaLine, savingThrows, statblockMarkup, statblockSections, typeLine } from "../public/statblock.js";

const ALISIA = {
  name: "Алісія Дан Торн",
  meta: {
    type: "creature", name: "Алісія Дан Торн", size: "Medium", kind: "Undead", subtype: "Vampire",
    alignment: "Chaotic Evil", ac: "15 (швидкість і спритність)", hp: "110 (13d8 + 52)",
    speed: "40 фт, Climb 40 фт", initiative: "+7", str: "+3", dex: "+4", con: "+4", int: "+2", wis: "+2", cha: "+3",
    saves: "DEX +7, CON +7, WIS +5, CHA +4", skills: "Perception +5", senses: "Darkvision 120 ft.",
    languages: "Common", cr: "5", xp: "1800", pb: "+3", gear: "—",
  },
  body: [
    "## Риси",
    "",
    "**Spider Climb.** Лазить по стінах.",
    "",
    "## Дії",
    "",
    "**Bite.** *Melee Weapon Attack* +7 до атаки.",
    "",
    "## Тактика",
    "",
    "Тримається [[alisia]] в тіні.",
    "",
    "<!-- імпортовано -->",
  ].join("\n"),
};

test("поточні HP беруться з максимуму в метаданих", () => {
  assert.equal(maxHitPoints({ hp: "110 (13d8 + 52)" }), 110);
  assert.equal(maxHitPoints({ hp: "45 (8к8)" }), 45);
  assert.equal(maxHitPoints({ hp: "" }), null);
  assert.equal(maxHitPoints({}), null);
  assert.equal(maxHitPoints(undefined), null);
});

test("рятункові кидки розкладаються по клітинках характеристик", () => {
  assert.deepEqual(savingThrows("DEX +7, CON +7, WIS +5, CHA +4"), ["—", "+7", "+7", "—", "+5", "+4"]);
  assert.deepEqual(savingThrows("STR −1"), ["−1", "—", "—", "—", "—", "—"]);
  assert.deepEqual(savingThrows("—"), ["—", "—", "—", "—", "—", "—"]);
  assert.deepEqual(savingThrows(undefined), ["—", "—", "—", "—", "—", "—"]);
});

test("рядок типу збирається лише з заповнених полів", () => {
  assert.equal(typeLine(ALISIA.meta), "Medium Undead (Vampire), Chaotic Evil");
  assert.equal(typeLine({ size: "Gargantuan", kind: "істота пекла", subtype: "—" }), "Gargantuan істота пекла");
  assert.equal(typeLine({}), "");
});

test("мета-рядок завжди має Gear і CR, решта — за наявності", () => {
  const line = metaLine(ALISIA.meta);
  assert.match(line, /<strong>Gear<\/strong> —/);
  assert.match(line, /<strong>CR<\/strong> 5 \(XP 1800; PB \+3\)/);
  assert.doesNotMatch(metaLine({}), /Skills/);
  assert.match(metaLine({}), /<strong>CR<\/strong> —/);
});

test("секції йдуть у порядку статблока, без нотаток ДМа й коментарів", () => {
  const sections = statblockSections(ALISIA.body);
  assert.deepEqual(sections.map((section) => section.title), ["Дії", "Риси"]);
  assert.deepEqual(sections[0].paragraphs, ["**Bite.** *Melee Weapon Attack* +7 до атаки."]);
  assert.equal(statblockSections("## Тактика\n\nЛише нотатка ДМа").length, 0);
});

test("розмітка картки повторює статблок бестіарію", () => {
  const markup = statblockMarkup(ALISIA);
  assert.match(markup, /<em>Medium Undead \(Vampire\), Chaotic Evil<\/em>/);
  assert.match(markup, /<strong>HP<\/strong> 110 \(13d8 \+ 52\)/);
  assert.match(markup, /<tr class="sb-save"><th>SAVE<\/th><td>—<\/td><td>\+7<\/td>/);
  assert.match(markup, /<h3>ACTIONS<\/h3><p><strong>Bite\.<\/strong> <em>Melee Weapon Attack<\/em>/);
  assert.match(markup, /<h3>TRAITS<\/h3>/);
  assert.doesNotMatch(markup, /Тактика|тіні/);
});

test("без рятункових кидків рядок SAVE не малюється, а порожні поля дають прочерк", () => {
  const markup = statblockMarkup({ name: "Грап", meta: { hp: "27 (6d8)", str: "+4" }, body: "" });
  assert.doesNotMatch(markup, /sb-save/);
  assert.match(markup, /<strong>AC<\/strong> —/);
  assert.match(markup, /<td>\+4<\/td><td>\+0<\/td>/);
});

test("текст картки екранується, а [[посилання]] лишається підписом", () => {
  const markup = statblockMarkup({
    name: "Тест",
    meta: { ac: "<b>15</b>" },
    body: "## Дії\n\n**Укус.** Тягне до [[korabel|корабля]] & кусає.",
  });
  assert.match(markup, /&lt;b&gt;15&lt;\/b&gt;/);
  assert.match(markup, /<span class="md-link">корабля<\/span> &amp; кусає/);
});
