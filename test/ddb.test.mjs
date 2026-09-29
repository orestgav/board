import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { characterData, limitedUseMax, normalizeCharacter, proficiencyBonus } from "../public/ddb.js";

// Знеособлений реальний лист: Rogue 2 / Bard 2, High Elf, Sage (5e 2024).
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/ddb-character.json", import.meta.url), "utf8"));

function fixture(change = () => {}) {
  const copy = structuredClone(FIXTURE);
  change(copy.data);
  return copy;
}

function caster(name, level, { divisor = 1, rounding = 1, slots = [], ability = 6, starting = false } = {}) {
  return {
    id: level * 100 + name.length,
    level,
    isStartingClass: starting,
    hitDiceUsed: 0,
    definition: {
      name, canCastSpells: true, spellCastingAbilityId: ability, hitDice: 8,
      spellRules: { multiClassSpellSlotDivisor: divisor, multiClassSpellSlotRounding: rounding, levelSpellSlots: slots },
    },
    subclassDefinition: null,
    classFeatures: [],
  };
}

test("характеристики: база плюс бонуси фітів і передісторії", () => {
  const state = normalizeCharacter(FIXTURE);
  assert.deepEqual(state.abilities, { str: 8, dex: 16, con: 14, int: 12, wis: 12, cha: 14 });
  assert.equal(state.level, 4);
  assert.equal(state.proficiencyBonus, 2);
});

test("HP: база + CON за рівень мінус зняті, тимчасові окремо", () => {
  assert.deepEqual(normalizeCharacter(FIXTURE).hp, { current: 28, max: 31, temp: 0 });
  const hurt = normalizeCharacter(fixture((data) => {
    data.removedHitPoints = 40;
    data.temporaryHitPoints = 5;
  }));
  assert.deepEqual(hurt.hp, { current: 0, max: 31, temp: 5 });
  const overridden = normalizeCharacter(fixture((data) => {
    data.overrideHitPoints = 50;
    data.bonusHitPoints = 2;
  }));
  assert.equal(overridden.hp.max, 52);
});

test("AC: легка броня + DEX; власне перевизначення гравця має пріоритет", () => {
  assert.equal(normalizeCharacter(FIXTURE).ac, 15);
  const overridden = normalizeCharacter(fixture((data) => {
    data.characterValues.push({ typeId: 1, value: 19, valueId: null, contextId: null });
  }));
  assert.equal(overridden.ac, 19);
});

test("AC: без броні — Unarmored Defense, щит додає зверху", () => {
  const state = normalizeCharacter(fixture((data) => {
    for (const item of data.inventory) if (item.definition.filterType === "Armor") item.equipped = false;
    data.modifiers.feat.push({ type: "set", subType: "unarmored-armor-class", statId: 3, value: null });
    data.inventory.push({
      id: 1, quantity: 1, equipped: true, containerEntityId: data.id,
      definition: { name: "Shield", filterType: "Armor", armorTypeId: 4, armorClass: 2, weight: 6, canEquip: true },
    });
  }));
  // 10 + DEX 3 + CON 2 + щит 2
  assert.equal(state.ac, 17);
});

test("пасивки: вправність виду, експертиза, Jack of All Trades", () => {
  assert.deepEqual(normalizeCharacter(FIXTURE).passives, { perception: 13, insight: 15, investigation: 12 });
});

test("мультиклас: ознаки не стартового класу з availableToMulticlass=false не діють", () => {
  const state = normalizeCharacter(fixture((data) => {
    const bard = data.classes.find((cls) => !cls.isStartingClass);
    const feature = bard.classFeatures.find((entry) => entry.definition.requiredLevel <= bard.level);
    data.modifiers.class.push({ type: "bonus", subType: "armor-class", value: 5, componentId: feature.definition.id,
      availableToMulticlass: false });
  }));
  assert.equal(state.ac, 15);
});

test("ознаки вищого рівня класу не діють, навіть якщо DDB їх віддав", () => {
  const state = normalizeCharacter(fixture((data) => {
    const rogue = data.classes.find((cls) => cls.isStartingClass);
    const future = rogue.classFeatures.find((entry) => entry.definition.requiredLevel > rogue.level);
    data.modifiers.class.push({ type: "bonus", subType: "armor-class", value: 5, componentId: future.definition.id });
  }));
  assert.equal(state.ac, 15);
});

test("комірки: один заклинач бере свою таблицю, Rogue без підкласу не рахується", () => {
  const state = normalizeCharacter(fixture((data) => {
    data.spellSlots = [{ level: 1, used: 2, available: 0 }];
  }));
  assert.deepEqual(state.slots, [{ level: 1, max: 3, used: 2 }]);
  assert.equal(state.pact, null);
  assert.deepEqual(state.spellSaveDC, [{ className: "Bard", ability: "cha", dc: 12 }]);
});

test("комірки: мультиклас за загальною таблицею, половинний заклинач округлюється за правилом класу", () => {
  const state = normalizeCharacter(fixture((data) => {
    data.classes = [
      caster("Wizard", 3, { ability: 4, starting: true }),
      caster("Paladin", 3, { divisor: 2, rounding: 2, ability: 6 }),
    ];
  }));
  // 3 + ceil(3/2) = 5 → 4/3/2
  assert.deepEqual(state.slots.map((slot) => slot.max), [4, 3, 2]);
});

test("комірки: warlock окремо як pact magic", () => {
  const pactRow = [[0, 0, 0, 0, 0], [1, 0, 0, 0, 0], [2, 0, 0, 0, 0], [0, 2, 0, 0, 0]];
  const state = normalizeCharacter(fixture((data) => {
    data.classes = [caster("Warlock", 3, { slots: pactRow, starting: true })];
    data.pactMagic = [{ level: 2, used: 1, available: 0 }];
  }));
  assert.deepEqual(state.slots, []);
  assert.deepEqual(state.pact, { level: 2, max: 2, used: 1 });
});

test("ресурси: класові, безкоштовні заклинання; сувої не ресурс", () => {
  const state = normalizeCharacter(FIXTURE);
  assert.deepEqual(state.resources.map((entry) => [entry.name, entry.used, entry.max, entry.reset]), [
    ["Bardic Inspiration", 0, 2, 2],
    ["Detect Magic", 0, 1, 2],
    ["Witch Bolt", 0, 1, 2],
  ]);
});

test("limitedUseMax: модифікатор (не менше 1), бонус вправності, оператори", () => {
  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 8, cha: 16 };
  assert.equal(limitedUseMax({ maxUses: 0, statModifierUsesId: 6 }, scores, 2), 3);
  assert.equal(limitedUseMax({ maxUses: 0, statModifierUsesId: 5 }, scores, 2), 1);
  assert.equal(limitedUseMax({ maxUses: 0, useProficiencyBonus: true }, scores, 3), 3);
  assert.equal(limitedUseMax({ maxUses: 2, useProficiencyBonus: true, proficiencyBonusOperator: 2 }, scores, 3), 6);
  assert.equal(limitedUseMax({ maxUses: 1, statModifierUsesId: 6, operator: 1 }, scores, 2), 4);
  assert.equal(limitedUseMax({ maxUses: -1 }, scores, 2), 0);
});

test("вага: власні ваги гравця, вміст контейнерів, монети за налаштуванням", () => {
  const state = normalizeCharacter(FIXTURE);
  assert.equal(state.inventory.weight, 116);
  assert.equal(state.inventory.capacity, 120);
  assert.equal(state.inventory.load, 97);
  const withCoins = normalizeCharacter(fixture((data) => {
    data.preferences.ignoreCoinWeight = false;
    data.currencies = { cp: 0, sp: 0, gp: 100, ep: 0, pp: 0 };
  }));
  assert.equal(withCoins.inventory.weight, 118);
});

test("вага: Bag of Holding обнуляє вміст, партійний схрон не рахується", () => {
  const state = normalizeCharacter(fixture((data) => {
    data.inventory = [
      { id: 10, quantity: 1, containerEntityId: data.id, definition: { name: "Bag of Holding", weight: 15, isContainer: true, weightMultiplier: 0 } },
      { id: 11, quantity: 2, containerEntityId: 10, definition: { name: "Anvil", weight: 50 } },
      { id: 12, quantity: 1, containerEntityId: 999999, definition: { name: "Party Crate", weight: 80 } },
    ];
    data.customItems = [{ id: 1, name: "Скриня", weight: 3, quantity: 2 }];
  }));
  assert.equal(state.inventory.weight, 21);
  assert.deepEqual(state.inventory.items.map((item) => item.name), ["Bag of Holding", "Anvil", "Скриня"]);
});

test("інвентар: назви, які гравець дав предметам", () => {
  const names = normalizeCharacter(FIXTURE).inventory.items.map((item) => item.name);
  assert.ok(names.includes("Scroll Satchel"));
  assert.ok(names.includes("Spell Scroll (Level 1) - Faerie Fire"));
});

test("стани, виснаження, рятунки від смерті, натхнення", () => {
  const state = normalizeCharacter(fixture((data) => {
    data.conditions = [{ id: 11, level: null }, { id: 4, level: 2 }];
    data.deathSaves = { failCount: 1, successCount: 2, isStabilized: false };
    data.inspiration = false;
  }));
  assert.deepEqual(state.conditions, [{ id: 11, label: "Отруєний" }]);
  assert.equal(state.exhaustion, 2);
  assert.deepEqual(state.deathSaves, { fail: 1, success: 2, stable: false });
  assert.equal(state.inspiration, false);
});

test("characterData приймає і відповідь сервісу, і розгорнутий data; інше відкидає", () => {
  assert.equal(characterData(FIXTURE).id, 1000);
  assert.equal(characterData(FIXTURE.data).id, 1000);
  assert.throws(() => characterData({ success: false, message: "Private" }), /не лист персонажа/);
});

test("бонус вправності за рівнем", () => {
  assert.deepEqual([1, 4, 5, 9, 13, 17, 20].map(proficiencyBonus), [2, 2, 3, 4, 5, 6, 6]);
});
