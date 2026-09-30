import assert from "node:assert/strict";
import test from "node:test";
import {
  creatureHitPoints,
  creatureLabel,
  parseHitPoints,
  creatureList,
  maxHitPoints,
  markSpellNames,
  metaLine,
  savingThrows,
  spellSlots,
  spellTexts,
  spellTooltipMarkup,
  usedSlots,
  withUsedSlots,
  statblockMarkup,
  statblockSections,
  typeLine,
  writeCreatures,
} from "../public/statblock.js";

const ALISIA = {
  name: "Алісія Дан Торн",
  meta: {
    type: "creature", name: "Алісія Дан Торн", size: "Середній", kind: "Undead", subtype: "Vampire",
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
  assert.equal(typeLine(ALISIA.meta), "Undead (Vampire), Середній, Chaotic Evil");
  assert.equal(typeLine({ size: "Гігантський", kind: "істота пекла", subtype: "—" }), "істота пекла, Гігантський");
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
  assert.deepEqual(sections.map((section) => section.title), ["Риси", "Дії"]);
  assert.deepEqual(sections[0].paragraphs, ["**Spider Climb.** Лазить по стінах."]);
  assert.equal(statblockSections("## Тактика\n\nЛише нотатка ДМа").length, 0);
});

test("описові секції не потрапляють у статблок, а записи-здібності лишаються", () => {
  const body = [
    "## Хто це", "", "- Те, що посилає Велетень.", "",
    "## Як діє", "", "- Хапає і тікає.", "", "**Це викрадення, а не бій.** Партія може втратити людину.", "",
    "## Звʼязки", "", "- Бестіарій: [[veleten]]", "",
    "## ФАЗА 2", "", "**Blood Link.** Поглинає життєву силу.", "",
  ].join("\n");
  assert.deepEqual(statblockSections(body).map((section) => section.title), ["ФАЗА 2"]);
});

test("розмітка картки повторює статблок бестіарію", () => {
  const markup = statblockMarkup(ALISIA);
  assert.match(markup, /<em>Undead \(Vampire\), Середній, Chaotic Evil<\/em>/);
  assert.match(markup, /<strong>HP<\/strong> 110 \(13d8 \+ 52\)/);
  assert.match(markup, /<tr class="sb-save"><th>SAVE<\/th><td>—<\/td><td>\+7<\/td>/);
  assert.match(markup, /<h3>ACTIONS<\/h3><p><strong>Bite\.<\/strong> <em>Melee Weapon Attack<\/em>/);
  assert.match(markup, /<h3>TRAITS<\/h3>/);
  assert.doesNotMatch(markup, /Тактика|тіні/);
});

test("Initiative стоїть під Speed у колонці показників, а праворуч — арт істоти", () => {
  const withoutArt = statblockMarkup(ALISIA);
  assert.match(withoutArt, /<div class="sb-vitals">[\s\S]*Speed[\s\S]*Initiative[\s\S]*<\/div>/);
  assert.doesNotMatch(withoutArt, /sb-art/);
  const withArt = statblockMarkup({ ...ALISIA, portrait: "alisia.webp" });
  assert.match(withArt, /<\/div>\s*<div class="sb-art"><img alt="" draggable="false"><\/div>/);
});

test("без рятункових кидків рядок SAVE не малюється, а порожні поля дають прочерк", () => {
  const markup = statblockMarkup({ name: "Грап", meta: { hp: "27 (6d8)", str: "+4" }, body: "" });
  assert.doesNotMatch(markup, /sb-save/);
  assert.match(markup, /<strong>AC<\/strong> —/);
  assert.match(markup, /<td>\+4<\/td><td>\+0<\/td>/);
});

test("рятунок із СЛ, бонус до влучання, кістки шкоди й стани виділено кожен своїм кольором", () => {
  const markup = statblockMarkup({
    name: "Пригнічений",
    meta: {},
    body: [
      "## Риси",
      "",
      "**Телепатична п’явка.** Кожна істота повинна зробити рятунковий кидок Мудрості (DC 15), або отримати 10 (3к6) психічної шкоди.",
      "",
      "## Дії",
      "",
      "**Рука-гарпун.** *Рукопашна атака зброєю* +7 до влучання. Влучання: 10 (2к8 + 2) колючої шкоди, і ціль стає схопленою (СЛ вислизання 14).",
      "",
      "**Удар.** *Melee Weapon Attack* +6 to hit. Hit: 1d10+4 slashing (у формі 1d10+4). WIS Save DC 14 або Prone; ряткидок Статури СЛ 12, кидає з перевагою, атакує з перешкодою.",
    ].join("\n"),
  });
  for (const [kind, text] of [
    ["save", "Мудрості (DC 15)"], ["damage", "10 (3к6) психічної"], ["hit", "+7 до влучання"],
    ["damage", "10 (2к8 + 2) колючої"], ["condition", "схопленою"], ["save", "СЛ вислизання 14"],
    ["hit", "+6 to hit"], ["damage", "1d10+4 slashing"], ["damage", "1d10+4"], ["save", "WIS Save DC 14"],
    ["condition", "Prone"], ["save", "Статури СЛ 12"], ["edge", "перевагою"], ["edge", "з перешкодою"],
  ]) assert.ok(markup.includes(`<b class="sb-key sb-key-${kind}">${text}</b>`), text);
  assert.match(markup, /<strong>Телепатична п&#39;явка\.<\/strong>|<strong>Телепатична п’явка\.<\/strong>/);
  assert.doesNotMatch(markup, /sb-key">[^<]*\)<\/b>\)/);
});

test("текст картки екранується, а [[посилання]] лишається підписом", () => {
  const markup = statblockMarkup({
    name: "Тест",
    meta: { ac: "<b>15</b>" },
    body: "## Дії\n\n**Укус.** Тягне до [[korabel|корабля]] & кусає.",
  });
  assert.match(markup, /&lt;b&gt;15&lt;\/b&gt;/);
  assert.match(markup, /<span class="md-link" data-slug="[^"]+">корабля<\/span> &amp; кусає/);
});

test("одна істота лишається в node.hp, друга переводить вузол на масив", () => {
  const node = { id: "n1", hp: 40 };
  assert.deepEqual(creatureList(node), [{ name: "", hp: 40 }]);

  writeCreatures(node, [{ name: "", hp: 40 }, { name: "", hp: 110 }]);
  assert.equal(node.hp, undefined);
  assert.deepEqual(node.creatures, [{ hp: 40 }, { hp: 110 }]);
  assert.deepEqual(creatureList(node), [{ name: "", hp: 40 }, { name: "", hp: 110 }]);

  writeCreatures(node, [{ name: "Ватажок", hp: 40 }]);
  assert.equal(node.creatures, undefined);
  assert.equal(node.hp, 40);
  assert.deepEqual(creatureList(node), [{ name: "", hp: 40 }]);
});

test("вузол без HP лишається без поля, а не з нулем", () => {
  const node = { id: "n2" };
  assert.deepEqual(creatureList(node), [{ name: "", hp: undefined }]);
  writeCreatures(node, [{ name: "", hp: undefined }]);
  assert.equal("hp" in node, false);
});

test("безіменна істота підписана номером, а свою назву зберігає", () => {
  assert.equal(creatureLabel({ name: "" }, 0), "Істота 1");
  assert.equal(creatureLabel(undefined, 2), "Істота 3");
  assert.equal(creatureLabel({ name: "  Ватажок  " }, 1), "Ватажок");
});

test("назва, що збігається з номером, у файл не пишеться", () => {
  const node = { id: "n3" };
  writeCreatures(node, [{ name: "Істота 1", hp: 5 }, { name: "Ватажок", hp: 7 }]);
  assert.deepEqual(node.creatures, [{ hp: 5 }, { name: "Ватажок", hp: 7 }]);
  // Після видалення першої «Ватажок» лишається собою, а решта перенумеровується.
  writeCreatures(node, creatureList(node).toSpliced(0, 1));
  assert.equal(node.creatures, undefined);
  assert.equal(node.hp, 7);
});

test("поточні HP істоти не перевищують максимум, але йдуть у мінус", () => {
  assert.equal(creatureHitPoints({ hp: 12 }, 40), 12);
  assert.equal(creatureHitPoints({ hp: 99 }, 40), 40);
  assert.equal(creatureHitPoints({ hp: -8 }, 40), -8);
  assert.equal(creatureHitPoints({}, 40), 40);
  assert.equal(creatureHitPoints(undefined, 40), 40);
});

test("typed hit points accept whole numbers, negatives and the typographic minus", () => {
  assert.equal(parseHitPoints("12"), 12);
  assert.equal(parseHitPoints(" 7 "), 7);
  assert.equal(parseHitPoints("-3"), -3);
  assert.equal(parseHitPoints("−3"), -3);
  assert.equal(parseHitPoints("0"), 0);
  assert.equal(parseHitPoints(""), null);
  assert.equal(parseHitPoints("d"), null);
  assert.equal(parseHitPoints("1.5"), null);
  assert.equal(parseHitPoints("12abc"), null);
});

test("a campaign names its own DM-only statblock sections", () => {
  const body = "## Дії\n**Удар.** +3.\n\n## Тактика\n**Тікає.** Коли поранений.\n\n## Секрет ДМа\n**Прихована.** Є.\n";
  assert.deepEqual(statblockSections(body).map((section) => section.title), ["Дії", "Секрет ДМа"]);
  assert.deepEqual(statblockSections(body, ["Секрет ДМа"]).map((section) => section.title), ["Дії", "Тактика"]);
  assert.doesNotMatch(statblockMarkup({ meta: {}, body }, { hiddenSections: ["Секрет ДМа"] }), /Прихована/);
  assert.match(statblockMarkup({ meta: { xp: "<b>50</b>" }, body: "" }), /XP &lt;b&gt;50&lt;\/b&gt;/);
});

const CLERIC = [
  "## Дії",
  "",
  "**Булава.** +4 до влучання.",
  "",
  "## Закляття",
  "",
  "**Канітри (за бажанням).** sacred flame, guidance.",
  "",
  "**1 рівень (4/день).** bless, healing word",
  "",
  "**3 рівень (2 комірки).** spirit guardians, mass healing word.",
  "",
  "**1/день кожне.** Dimension Door, Fireball.",
  "",
  "## Тексти заклять",
  "",
  "### Healing Word",
  "",
  "*1 рівень, огородження · Бонусна дія*",
  "",
  "Відновлює 2к4 хітів.",
  "",
  "### Mass Healing Word",
  "*3 рівень, огородження*",
  "",
  "До шести істот відновлюють 2к4 хітів.",
  "",
  "<!-- SRD 5.2 -->",
  "",
  "## Тактика",
  "",
  "Лікує Healing Word.",
].join("\n");

test("тексти заклять беруться з підсекцій за англійською назвою", () => {
  const spells = spellTexts(CLERIC);
  assert.deepEqual([...spells.keys()], ["healing word", "mass healing word"]);
  assert.deepEqual(spells.get("healing word").paragraphs, ["*1 рівень, огородження · Бонусна дія*", "Відновлює 2к4 хітів."]);
  assert.deepEqual(spells.get("mass healing word").paragraphs, ["*3 рівень, огородження*", "До шести істот відновлюють 2к4 хітів."]);
  assert.equal(spellTexts("## Дії\n\n**Удар.** +3.").size, 0);
});

test("секція текстів заклять на аркуш не потрапляє", () => {
  assert.deepEqual(statblockSections(CLERIC).map((section) => section.title), ["Дії", "Закляття"]);
  assert.doesNotMatch(statblockMarkup({ meta: {}, body: CLERIC }), /До шести істот/);
});

test("назви заклять з текстом стають мітками лише в секції «Закляття»", () => {
  const markup = statblockMarkup({ meta: {}, body: CLERIC });
  assert.match(markup, /<span class="sb-spell" data-spell="healing word">healing word<\/span>/);
  // Довша назва не розпадається на коротшу всередині.
  assert.match(markup, /<span class="sb-spell" data-spell="mass healing word">mass healing word<\/span>/);
  assert.doesNotMatch(markup, /data-spell="[^"]*">bless/);
  assert.equal(markSpellNames('<b title="healing word">x</b>', spellTexts(CLERIC)), '<b title="healing word">x</b>');
  assert.equal(markSpellNames("Healing  Word", spellTexts(CLERIC)), '<span class="sb-spell" data-spell="healing word">Healing  Word</span>');
});

test("підказка показує назву й текст закляття з підсвіткою", () => {
  const tip = spellTooltipMarkup(spellTexts(CLERIC).get("healing word"));
  assert.match(tip, /^<div class="spell-tip-title">Healing Word<\/div>/);
  assert.match(tip, /<p><em>1 рівень, огородження · Бонусна дія<\/em><\/p>/);
  assert.match(tip, /sb-key-damage">2к4/);
});

test("лічильники: комірки рівнів і закляття «N/день кожне», без канітрів", () => {
  assert.deepEqual(spellSlots(CLERIC).map(({ key, label, max }) => [key, label, max]), [
    ["1", "1 рів.", 4],
    ["3", "3 рів.", 2],
    ["день:dimension door", "Dimension Door", 1],
    ["день:fireball", "Fireball", 1],
  ]);
  assert.deepEqual(spellSlots("## Закляття\n\n**2/день.** a, b"), [{ key: "2/день", label: "2/день", title: "2/день", max: 2 }]);
  assert.deepEqual(spellSlots("## Дії\n\n**1 рівень (4/день).** bless"), []);
});

test("витрачені комірки не виходять за межі й не пишуться нулями", () => {
  const slot = { key: "1", max: 4 };
  assert.equal(usedSlots({}, slot), 0);
  assert.equal(usedSlots({ slots: { 1: 9 } }, slot), 4);
  assert.deepEqual(withUsedSlots({ hp: 5 }, slot, 2), { hp: 5, slots: { 1: 2 } });
  assert.deepEqual(withUsedSlots({ hp: 5, slots: { 1: 1 } }, slot, 0), { hp: 5 });
  assert.deepEqual(withUsedSlots({ slots: { 1: 3, 2: 1 } }, slot, 7), { slots: { 1: 4, 2: 1 } });
});

test("комірки живуть поруч із HP: у вузлі, поки істота одна, і в кожної — у загоні", () => {
  const node = { id: "n4", hp: 30 };
  writeCreatures(node, [{ name: "", hp: 30, slots: { 1: 2 } }]);
  assert.deepEqual(node, { id: "n4", hp: 30, slots: { 1: 2 } });
  assert.deepEqual(creatureList(node), [{ name: "", hp: 30, slots: { 1: 2 } }]);

  writeCreatures(node, [...creatureList(node), { name: "", hp: 30 }]);
  assert.deepEqual(node, { id: "n4", creatures: [{ hp: 30, slots: { 1: 2 } }, { hp: 30 }] });

  writeCreatures(node, creatureList(node).toSpliced(0, 1));
  assert.deepEqual(node, { id: "n4", hp: 30 });
});
