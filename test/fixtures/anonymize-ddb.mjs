// Робить з реального листа D&D Beyond знеособлену фікстуру для test/ddb.test.mjs:
// лишає тільки поля, які читає public/ddb.js, і прибирає імена, аватар,
// кампанію, нотатки та назви власних і homebrew-предметів.
//
//   node test/fixtures/anonymize-ddb.mjs <сирий.json> <фікстура.json>
import { readFile, writeFile } from "node:fs/promises";

const FIXTURE_ID = 1000;

function pick(source, keys) {
  if (!source || typeof source !== "object") return source ?? null;
  const result = {};
  for (const key of keys) if (key in source) result[key] = source[key];
  return result;
}

const MODIFIER_KEYS = ["type", "subType", "value", "fixedValue", "statId", "componentId", "availableToMulticlass", "dice"];
const LIMITED_USE_KEYS = ["statModifierUsesId", "resetType", "numberUsed", "maxUses", "operator", "useProficiencyBonus",
  "proficiencyBonusOperator"];

export function anonymize(payload) {
  const data = payload.data ?? payload;
  const homebrew = new Map();
  const alias = (name, prefix) => {
    if (!homebrew.has(name)) homebrew.set(name, `${prefix} ${homebrew.size + 1}`);
    return homebrew.get(name);
  };
  const remapContainer = (id) => (id === data.id ? FIXTURE_ID : id);
  const limitedUse = (value) => (value ? pick(value, LIMITED_USE_KEYS) : null);
  const spell = (entry) => ({
    ...pick(entry, ["prepared", "alwaysPrepared"]),
    limitedUse: limitedUse(entry.limitedUse),
    definition: entry.definition ? pick(entry.definition, ["name", "level"]) : null,
  });
  return {
    data: {
      id: FIXTURE_ID,
      name: "Тестовий персонаж",
      ...pick(data, ["stats", "bonusStats", "overrideStats", "baseHitPoints", "bonusHitPoints", "overrideHitPoints",
        "removedHitPoints", "temporaryHitPoints", "inspiration", "conditions", "deathSaves", "spellSlots", "pactMagic",
        "currencies", "currentXp", "dateModified"]),
      preferences: pick(data.preferences, ["ignoreCoinWeight"]),
      race: pick(data.race, ["sizeId"]),
      classes: data.classes.map((cls) => ({
        ...pick(cls, ["id", "level", "isStartingClass", "hitDiceUsed"]),
        definition: {
          ...pick(cls.definition, ["name", "canCastSpells", "spellCastingAbilityId", "hitDice"]),
          spellRules: pick(cls.definition.spellRules, ["multiClassSpellSlotDivisor", "multiClassSpellSlotRounding", "levelSpellSlots"]),
        },
        subclassDefinition: cls.subclassDefinition
          ? pick(cls.subclassDefinition, ["name", "canCastSpells", "spellCastingAbilityId"]) : null,
        classFeatures: cls.classFeatures.map((feature) => ({ definition: pick(feature.definition, ["id", "name", "requiredLevel"]) })),
      })),
      modifiers: Object.fromEntries(Object.entries(data.modifiers).map(([group, list]) =>
        [group, list.map((modifier) => pick(modifier, MODIFIER_KEYS))])),
      characterValues: data.characterValues.map((entry) => pick(entry, ["typeId", "value", "valueId", "contextId"])),
      inventory: data.inventory.map((item) => ({
        ...pick(item, ["id", "quantity", "equipped", "isAttuned", "chargesUsed"]),
        containerEntityId: remapContainer(item.containerEntityId),
        limitedUse: item.limitedUse ? { ...limitedUse(item.limitedUse), resetType: item.limitedUse.resetType } : null,
        definition: {
          ...pick(item.definition, ["weight", "bundleSize", "weightMultiplier", "isContainer", "filterType", "type",
            "armorClass", "armorTypeId", "canEquip", "canAttune", "isConsumable", "magic"]),
          name: item.definition.isHomebrew ? alias(item.definition.name, "Homebrew item") : item.definition.name,
          grantedModifiers: (item.definition.grantedModifiers ?? []).map((modifier) => pick(modifier, MODIFIER_KEYS)),
        },
      })),
      customItems: data.customItems.map((item, index) => ({ id: index + 1, name: `Власний предмет ${index + 1}`,
        weight: item.weight, quantity: item.quantity })),
      actions: Object.fromEntries(Object.entries(data.actions).map(([group, list]) =>
        [group, (list ?? []).map((action) => ({ ...pick(action, ["name", "componentId"]), limitedUse: limitedUse(action.limitedUse) }))])),
      spells: Object.fromEntries(Object.entries(data.spells).map(([group, list]) => [group, (list ?? []).map(spell)])),
      classSpells: data.classSpells.map((entry) => ({ characterClassId: entry.characterClassId, spells: entry.spells.map(spell) })),
      feats: data.feats.map((feat) => ({
        definition: { name: feat.definition.isHomebrew ? alias(feat.definition.name, "Homebrew feat") : feat.definition.name },
      })),
    },
  };
}

if (import.meta.url === new URL(process.argv[1], "file:").href || process.argv[1]?.endsWith("anonymize-ddb.mjs")) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) {
    console.error("node test/fixtures/anonymize-ddb.mjs <сирий.json> <фікстура.json>");
    process.exit(1);
  }
  const fixture = anonymize(JSON.parse(await readFile(source, "utf8")));
  await writeFile(target, `${JSON.stringify(fixture, null, 1)}\n`);
  console.log(`${target}: ${fixture.data.inventory.length} предметів`);
}
