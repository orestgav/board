// Лист персонажа D&D Beyond (character-service v5) → компактний стан для
// панелі «Партія». Ендпоінт неофіційний і віддає сирі дані: базові
// характеристики, модифікатори, «використано» без «максимуму». Усе похідне
// (макс. HP, AC, комірки, ресурси, вага) рахуємо тут, за тими ж правилами,
// що й ddb-importer. Модуль без залежностей: працює і в браузері, і в Node.

export const DDB_CHARACTER_URL = "https://character-service.dndbeyond.com/character/v5/character/";

const ABILITIES = [
  { id: 1, key: "str", long: "strength" },
  { id: 2, key: "dex", long: "dexterity" },
  { id: 3, key: "con", long: "constitution" },
  { id: 4, key: "int", long: "intelligence" },
  { id: 5, key: "wis", long: "wisdom" },
  { id: 6, key: "cha", long: "charisma" },
];

// valueId — ключ навички в characterValues (власні перевизначення гравця).
const PASSIVE_SKILLS = [
  { key: "perception", ability: "wis", valueId: 14 },
  { key: "insight", ability: "wis", valueId: 12 },
  { key: "investigation", ability: "int", valueId: 8 },
];

export const CONDITION_LABELS = {
  1: "Осліплений", 2: "Зачарований", 3: "Оглухлий", 5: "Наляканий", 6: "Схоплений",
  7: "Недієздатний", 8: "Невидимий", 9: "Паралізований", 10: "Скам'янілий", 11: "Отруєний",
  12: "Лежить ниць", 13: "Знерухомлений", 14: "Приголомшений", 15: "Непритомний", 16: "Хворий",
};
const EXHAUSTION = 4;

export const RESET_LABELS = { 1: "короткий відпочинок", 2: "довгий відпочинок", 3: "світанок", 4: "інше" };

// characterValues.typeId, які нам потрібні.
const VALUE = {
  acOverride: 1, acMagic: 2, acMisc: 3,
  itemName: 8, itemWeight: 22,
  skillBonus: 24, skillMiscBonus: 25, skillProficiency: 26,
};
// typeId 26: 1 — без вправності, 2 — половина, 3 — вправність, 4 — експертиза.
const CUSTOM_PROFICIENCY = { 1: 0, 2: 0.5, 3: 1, 4: 2 };

const MULTICLASS_SLOTS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0], [4, 3, 0, 0, 0, 0, 0, 0, 0], [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0], [4, 3, 3, 1, 0, 0, 0, 0, 0], [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0], [4, 3, 3, 3, 2, 0, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0], [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0], [4, 3, 3, 3, 2, 1, 1, 1, 0], [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const PACT_CLASSES = new Set(["Warlock"]);

// Розмір (race.sizeId) → множник вантажопідйомності.
const SIZE_CAPACITY = { 2: 0.5, 3: 1, 4: 1, 5: 2, 6: 4, 7: 8 };
const COINS_PER_POUND = 50;

// Відповідь сервісу: { success, data } або вже розгорнутий data.
export function characterData(payload) {
  const data = payload?.data && typeof payload.data === "object" && "stats" in payload.data ? payload.data : payload;
  if (!data || !Array.isArray(data.stats) || !Array.isArray(data.classes)) {
    throw new Error("Це не лист персонажа D&D Beyond");
  }
  return data;
}

export function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level) {
  return Math.ceil(Math.max(1, level) / 4) + 1;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function characterValue(data, typeId, valueId) {
  return (data.characterValues ?? []).find((entry) =>
    entry.typeId === typeId && (valueId === undefined || String(entry.valueId) === String(valueId)));
}

function totalLevel(data) {
  return data.classes.reduce((sum, cls) => sum + number(cls.level), 0);
}

// Ознаки класу, що вже діють на поточному рівні. DDB віддає в classFeatures
// усі ознаки до 20-го рівня, тому фільтр за requiredLevel обовʼязковий.
function classFeatureIndex(data) {
  const index = new Map();
  for (const cls of data.classes) {
    for (const feature of cls.classFeatures ?? []) {
      const definition = feature.definition ?? {};
      index.set(definition.id, { cls, feature, active: number(definition.requiredLevel) <= number(cls.level) });
    }
  }
  return index;
}

function activeItem(item) {
  const definition = item.definition ?? {};
  return (!definition.canEquip && !definition.canAttune && !definition.isConsumable)
    || (item.isAttuned && item.equipped)
    || (item.isAttuned && !definition.canEquip)
    || (!definition.canAttune && item.equipped);
}

// Модифікатори, що діють зараз: класові (без ознак вищого рівня й без тих, що
// не переходять у мультиклас), вид, передісторія, фіти, активні предмети.
function activeModifiers(data, features) {
  const groups = data.modifiers ?? {};
  const classMods = (groups.class ?? []).filter((modifier) => {
    const entry = features.get(modifier.componentId);
    if (!entry) return true;
    if (!entry.active) return false;
    return !(modifier.availableToMulticlass === false && !entry.cls.isStartingClass);
  });
  const itemMods = (data.inventory ?? [])
    .filter(activeItem)
    .flatMap((item) => item.definition?.grantedModifiers ?? []);
  return [...classMods, ...(groups.race ?? []), ...(groups.background ?? []), ...(groups.feat ?? []), ...itemMods,
    ...(groups.condition ?? [])];
}

function bonusSum(modifiers, type, subType) {
  return modifiers
    .filter((modifier) => modifier.type === type && modifier.subType === subType)
    .reduce((sum, modifier) => sum + number(modifier.value ?? modifier.fixedValue), 0);
}

function abilityScores(data, modifiers) {
  const scores = {};
  for (const ability of ABILITIES) {
    const base = number(data.stats.find((stat) => stat.id === ability.id)?.value);
    const bonus = bonusSum(modifiers, "bonus", `${ability.long}-score`);
    const extra = number(data.bonusStats?.find((stat) => stat.id === ability.id)?.value);
    const override = number(data.overrideStats?.find((stat) => stat.id === ability.id)?.value);
    const setTo = modifiers
      .filter((modifier) => modifier.type === "set" && modifier.subType === `${ability.long}-score`)
      .reduce((max, modifier) => Math.max(max, number(modifier.value)), 0);
    const calculated = Math.max(base + bonus + extra, setTo);
    scores[ability.key] = override || calculated;
  }
  return scores;
}

function hitPoints(data, modifiers, features, level, conMod) {
  const perLevel = modifiers
    .filter((modifier) => modifier.type === "bonus" && modifier.subType === "hit-points-per-level")
    .reduce((sum, modifier) => {
      const cls = features.get(modifier.componentId)?.cls;
      return sum + number(modifier.value) * (cls ? number(cls.level) : level);
    }, 0);
  const flat = modifiers
    .filter((modifier) => modifier.type === "bonus" && modifier.subType === "hit-points" && !modifier.dice)
    .reduce((sum, modifier) => sum + number(modifier.value ?? modifier.fixedValue), 0);
  const override = number(data.overrideHitPoints);
  const max = (override || number(data.baseHitPoints) + conMod * level + perLevel + flat) + number(data.bonusHitPoints);
  const current = Math.max(0, max - number(data.removedHitPoints));
  return { current, max, temp: number(data.temporaryHitPoints) };
}

function armorClass(data, modifiers, scores) {
  const override = characterValue(data, VALUE.acOverride);
  if (override && number(override.value)) return number(override.value);
  const dex = abilityModifier(scores.dex);
  const equipped = (data.inventory ?? []).filter((item) => item.equipped && item.definition?.filterType === "Armor");
  const shields = equipped.filter((item) => item.definition.armorTypeId === 4);
  const armor = equipped.filter((item) => item.definition.armorTypeId !== 4);
  let base;
  if (armor.length) {
    base = Math.max(...armor.map((item) => {
      const value = number(item.definition.armorClass);
      if (item.definition.armorTypeId === 1) return value + dex;
      if (item.definition.armorTypeId === 2) return value + Math.min(dex, 2);
      return value;
    }));
    base += bonusSum(modifiers, "bonus", "armored-armor-class");
  } else {
    // Unarmored Defense: 10 + DEX + модифікатор іншої характеристики (statId).
    const unarmored = modifiers
      .filter((modifier) => modifier.type === "set" && modifier.subType === "unarmored-armor-class")
      .map((modifier) => {
        const ability = ABILITIES.find((entry) => entry.id === modifier.statId);
        return ability ? abilityModifier(scores[ability.key]) : number(modifier.value);
      });
    base = 10 + dex + Math.max(0, ...unarmored) + bonusSum(modifiers, "bonus", "unarmored-armor-class");
  }
  const shield = shields.reduce((sum, item) => Math.max(sum, number(item.definition.armorClass)), 0);
  const custom = (data.characterValues ?? [])
    .filter((entry) => (entry.typeId === VALUE.acMagic || entry.typeId === VALUE.acMisc) && !entry.contextId)
    .reduce((sum, entry) => sum + number(entry.value), 0);
  return base + shield + bonusSum(modifiers, "bonus", "armor-class") + custom;
}

function skillProficiency(modifiers, data, skill) {
  const custom = characterValue(data, VALUE.skillProficiency, skill.valueId);
  if (custom && CUSTOM_PROFICIENCY[custom.value] !== undefined) return CUSTOM_PROFICIENCY[custom.value];
  const matches = modifiers.filter((modifier) => modifier.subType === skill.key).map((modifier) => modifier.type);
  if (matches.includes("expertise")) return 2;
  if (matches.includes("proficiency")) return 1;
  const half = modifiers.some((modifier) =>
    modifier.type === "half-proficiency" && ["ability-checks", skill.key].includes(modifier.subType));
  return half ? 0.5 : 0;
}

function passives(data, modifiers, scores, pb) {
  const result = {};
  for (const skill of PASSIVE_SKILLS) {
    const proficiency = skillProficiency(modifiers, data, skill);
    const custom = (data.characterValues ?? [])
      .filter((entry) => (entry.typeId === VALUE.skillBonus || entry.typeId === VALUE.skillMiscBonus)
        && String(entry.valueId) === String(skill.valueId))
      .reduce((sum, entry) => sum + number(entry.value), 0);
    result[skill.key] = 10 + abilityModifier(scores[skill.ability]) + Math.floor(pb * proficiency)
      + bonusSum(modifiers, "bonus", skill.key) + bonusSum(modifiers, "bonus", `passive-${skill.key}`) + custom;
  }
  return result;
}

function casterClasses(data) {
  return data.classes.filter((cls) => cls.definition?.canCastSpells || cls.subclassDefinition?.canCastSpells);
}

function spellSaveDCs(data, modifiers, scores, pb) {
  const bonus = bonusSum(modifiers, "bonus", "spell-save-dc");
  return casterClasses(data).flatMap((cls) => {
    const abilityId = cls.definition?.spellCastingAbilityId ?? cls.subclassDefinition?.spellCastingAbilityId;
    const ability = ABILITIES.find((entry) => entry.id === abilityId);
    if (!ability) return [];
    return [{ className: cls.definition.name, ability: ability.key, dc: 8 + pb + abilityModifier(scores[ability.key]) + bonus }];
  });
}

function casterLevel(cls) {
  const rules = cls.definition?.spellRules ?? {};
  const divisor = number(rules.multiClassSpellSlotDivisor);
  if (!divisor) return 0;
  const exact = number(cls.level) / divisor;
  return rules.multiClassSpellSlotRounding === 2 ? Math.ceil(exact) : Math.floor(exact);
}

function usedSlots(list, level) {
  return (list ?? []).filter((slot) => slot.level === level).reduce((sum, slot) => sum + number(slot.used), 0);
}

function spellSlots(data) {
  const casters = casterClasses(data);
  const regular = casters.filter((cls) => !PACT_CLASSES.has(cls.definition.name));
  let table;
  if (regular.length === 1) table = regular[0].definition.spellRules?.levelSpellSlots?.[regular[0].level] ?? [];
  else table = MULTICLASS_SLOTS[Math.min(20, regular.reduce((sum, cls) => sum + casterLevel(cls), 0))];
  const slots = [];
  table.forEach((max, index) => {
    if (max > 0) slots.push({ level: index + 1, max, used: Math.min(max, usedSlots(data.spellSlots, index + 1)) });
  });
  let pact = null;
  const warlock = casters.find((cls) => PACT_CLASSES.has(cls.definition.name));
  if (warlock) {
    const row = warlock.definition.spellRules?.levelSpellSlots?.[warlock.level] ?? [];
    const max = Math.max(0, ...row);
    if (max > 0) {
      const level = row.indexOf(max) + 1;
      pact = { level, max, used: Math.min(max, usedSlots(data.pactMagic, level)) };
    }
  }
  return { slots, pact };
}

// Максимум limitedUse: maxUses, до якого додається (або множиться)
// модифікатор характеристики й бонус вправності. Лише модифікатор — не менше 1.
export function limitedUseMax(limitedUse, scores, pb) {
  if (!limitedUse) return 0;
  let max = number(limitedUse.maxUses) > 0 ? number(limitedUse.maxUses) : 0;
  const ability = ABILITIES.find((entry) => entry.id === limitedUse.statModifierUsesId);
  if (ability) {
    const mod = abilityModifier(scores[ability.key]);
    if (!max) max = Math.max(1, mod);
    else max = limitedUse.operator === 2 ? max * mod : max + mod;
  }
  if (limitedUse.useProficiencyBonus) {
    if (!max) max = pb;
    else max = limitedUse.proficiencyBonusOperator === 2 ? max * pb : max + pb;
  }
  return Math.max(0, max);
}

function resource(name, limitedUse, max, source) {
  return {
    name,
    max,
    used: Math.min(max, number(limitedUse.numberUsed)),
    reset: limitedUse.resetType ?? null,
    source,
  };
}

function resources(data, scores, pb, features) {
  const result = [];
  const seen = new Set();
  const add = (entry) => {
    const key = `${entry.source}:${entry.name}`;
    if (entry.max <= 0 || seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  };
  for (const [group, actions] of Object.entries(data.actions ?? {})) {
    for (const action of actions ?? []) {
      if (!action?.limitedUse) continue;
      const feature = features.get(action.componentId);
      if (feature && !feature.active) continue;
      add(resource(action.name, action.limitedUse, limitedUseMax(action.limitedUse, scores, pb), group));
    }
  }
  // Безкоштовні заклинання від виду, фітів, предметів: «раз на довгий відпочинок».
  for (const [group, spells] of Object.entries(data.spells ?? {})) {
    for (const spell of spells ?? []) {
      if (!spell?.limitedUse || !spell.definition?.name) continue;
      add(resource(spell.definition.name, spell.limitedUse, limitedUseMax(spell.limitedUse, scores, pb), `spell:${group}`));
    }
  }
  // Заряди предметів (жезли, персні). Сувої й зілля — витратні, це не ресурс.
  for (const item of data.inventory ?? []) {
    if (!item.limitedUse || item.definition?.isConsumable || typeof item.limitedUse.resetType === "string") continue;
    const max = limitedUseMax(item.limitedUse, scores, pb);
    add({ ...resource(itemName(data, item), item.limitedUse, max, "item"), used: Math.min(max, number(item.limitedUse.numberUsed ?? item.chargesUsed)) });
  }
  return result;
}

function hitDice(data) {
  return data.classes.map((cls) => ({
    className: cls.definition?.name ?? "",
    die: number(cls.definition?.hitDice),
    max: number(cls.level),
    used: Math.min(number(cls.level), number(cls.hitDiceUsed)),
  }));
}

function itemName(data, item) {
  const custom = characterValue(data, VALUE.itemName, item.id);
  return (custom?.value && String(custom.value).trim()) || item.definition?.name || "";
}

function itemUnitWeight(data, item) {
  const custom = characterValue(data, VALUE.itemWeight, item.id);
  if (custom && custom.value !== null && custom.value !== "") return number(custom.value);
  const definition = item.definition ?? {};
  return number(definition.weight) / Math.max(1, number(definition.bundleSize) || 1);
}

// Інвентар на персонажі. Предмет лежить або прямо на ньому (containerEntityId
// = id персонажа), або в контейнері, який сам на ньому. Вагу вмісту множимо на
// weightMultiplier контейнера (Bag of Holding — 0). Партійний схрон не рахуємо.
function inventory(data, scores, modifiers) {
  const items = data.inventory ?? [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const carrier = (item, depth = 0) => {
    if (item.containerEntityId === data.id) return { carried: true, multiplier: 1 };
    // «Контейнер», який сам не контейнер (лишки розпакованого стартового
    // набору, прив'язані до обладунку), DDB не показує й не рахує — ми теж.
    const container = byId.get(item.containerEntityId);
    if (!container?.definition?.isContainer || depth > 8) return { carried: false, multiplier: 0 };
    const parent = carrier(container, depth + 1);
    const own = container.definition?.weightMultiplier;
    return { carried: parent.carried, multiplier: parent.multiplier * (own === undefined || own === null ? 1 : number(own)) };
  };
  const list = [];
  let weight = 0;
  for (const item of items) {
    const place = carrier(item);
    if (!place.carried) continue;
    const quantity = number(item.quantity) || 1;
    const unit = itemUnitWeight(data, item);
    const total = unit * quantity * place.multiplier;
    weight += total;
    list.push({
      id: item.id,
      name: itemName(data, item),
      quantity,
      weight: round(total),
      equipped: Boolean(item.equipped),
      attuned: Boolean(item.isAttuned),
      magic: Boolean(item.definition?.magic),
      container: item.containerEntityId === data.id ? null : item.containerEntityId,
      isContainer: Boolean(item.definition?.isContainer),
      type: item.definition?.filterType ?? item.definition?.type ?? "",
    });
  }
  for (const item of data.customItems ?? []) {
    const quantity = number(item.quantity) || 1;
    const total = number(item.weight) * quantity;
    weight += total;
    list.push({
      id: `custom-${item.id}`, name: item.name ?? "", quantity, weight: round(total),
      equipped: false, attuned: false, magic: false, container: null, isContainer: false, type: "custom",
    });
  }
  const coins = Object.values(data.currencies ?? {}).reduce((sum, value) => sum + number(value), 0);
  if (!data.preferences?.ignoreCoinWeight) weight += coins / COINS_PER_POUND;
  const size = SIZE_CAPACITY[data.race?.sizeId] ?? 1;
  const multiplier = 1 + modifiers.filter((modifier) => modifier.subType === "carrying-capacity").length;
  const capacity = scores.str * 15 * size * multiplier;
  return { items: list, weight: round(weight), capacity, load: capacity ? Math.round(weight / capacity * 100) : 0 };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function conditions(data) {
  const list = [];
  let exhaustion = 0;
  for (const condition of data.conditions ?? []) {
    if (condition.id === EXHAUSTION) exhaustion = number(condition.level);
    else list.push({ id: condition.id, label: CONDITION_LABELS[condition.id] ?? `Стан ${condition.id}` });
  }
  return { list, exhaustion };
}

function spellsList(data) {
  const result = [];
  const push = (spell, source, className) => {
    const definition = spell?.definition;
    if (!definition?.name) return;
    result.push({
      name: definition.name,
      level: number(definition.level),
      prepared: Boolean(spell.prepared || spell.alwaysPrepared || definition.level === 0),
      source,
      className,
    });
  };
  const classNames = new Map(data.classes.map((cls) => [cls.id, cls.definition?.name ?? ""]));
  for (const entry of data.classSpells ?? []) {
    for (const spell of entry.spells ?? []) push(spell, "class", classNames.get(entry.characterClassId) ?? "");
  }
  for (const [group, spells] of Object.entries(data.spells ?? {})) {
    for (const spell of spells ?? []) push(spell, group, "");
  }
  const unique = new Map();
  for (const spell of result) {
    const key = `${spell.name}|${spell.source}`;
    if (!unique.has(key)) unique.set(key, spell);
  }
  return [...unique.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

// Головна функція: сирий лист → стан, який малює панель і пишуть знімки.
export function normalizeCharacter(payload) {
  const data = characterData(payload);
  const features = classFeatureIndex(data);
  const modifiers = activeModifiers(data, features);
  const level = totalLevel(data);
  const pb = proficiencyBonus(level);
  const scores = abilityScores(data, modifiers);
  const { slots, pact } = spellSlots(data);
  return {
    id: data.id,
    name: data.name ?? "",
    avatar: data.decorations?.avatarUrl ?? null,
    level,
    classes: data.classes.map((cls) => ({
      name: cls.definition?.name ?? "",
      subclass: cls.subclassDefinition?.name ?? null,
      level: number(cls.level),
    })),
    abilities: scores,
    proficiencyBonus: pb,
    hp: hitPoints(data, modifiers, features, level, abilityModifier(scores.con)),
    ac: armorClass(data, modifiers, scores),
    passives: passives(data, modifiers, scores, pb),
    spellSaveDC: spellSaveDCs(data, modifiers, scores, pb),
    slots,
    pact,
    resources: resources(data, scores, pb, features),
    hitDice: hitDice(data),
    inspiration: Boolean(data.inspiration),
    ...conditionsState(data),
    deathSaves: {
      fail: number(data.deathSaves?.failCount),
      success: number(data.deathSaves?.successCount),
      stable: Boolean(data.deathSaves?.isStabilized),
    },
    currencies: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...pick(data.currencies, ["pp", "gp", "ep", "sp", "cp"]) },
    xp: number(data.currentXp),
    inventory: inventory(data, scores, modifiers),
    spells: spellsList(data),
    feats: (data.feats ?? []).map((feat) => feat.definition?.name).filter(Boolean),
    modified: data.dateModified ?? null,
  };
}

function conditionsState(data) {
  const { list, exhaustion } = conditions(data);
  return { conditions: list, exhaustion };
}

function pick(source, keys) {
  const result = {};
  for (const key of keys) if (source && key in source) result[key] = number(source[key]);
  return result;
}
