import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../public/frontmatter.js";

test("flat fields are read as strings, links and arrays included", () => {
  const { meta, body, hasFrontmatter } = parseFrontmatter("---\ntype: npc\nname: \"Естер: власниця\"\nhp: 11 (2d8 + 2)\nlinks: [[kardosa]]\ntags: [a, \"b # c\"]\nnote: текст # коментар\n---\n## Тіло\n");
  assert.equal(hasFrontmatter, true);
  assert.equal(meta.type, "npc");
  assert.equal(meta.name, "Естер: власниця");
  assert.equal(meta.hp, "11 (2d8 + 2)");
  assert.equal(meta.links, "[[kardosa]]");
  assert.equal(meta.tags, '[a, "b # c"]');
  assert.equal(meta.note, "текст");
  assert.equal(body, "## Тіло\n");
  assert.equal(Object.getPrototypeOf(meta), null);
});

test("single quotes, BOM and Windows line endings are handled", () => {
  const { meta } = parseFrontmatter("﻿---\r\nname: 'Ім''я'\r\n---\r\n");
  assert.equal(meta.name, "Ім'я");
});

test("text without a metadata block is all body", () => {
  assert.deepEqual(parseFrontmatter("# Лише текст"), { meta: Object.create(null), body: "# Лише текст", hasFrontmatter: false });
});

test("broken metadata is reported with file and line", () => {
  assert.throws(() => parseFrontmatter("---\nname: x\n", "a.md"), /a\.md: незакритий блок/);
  assert.throws(() => parseFrontmatter("---\nname: x\nname: y\n---\n", "a.md"), /a\.md:3: повторне поле 'name'/);
  assert.throws(() => parseFrontmatter("---\n  name: x\n---\n", "a.md"), /a\.md:2: очікується поле/);
  assert.throws(() => parseFrontmatter("---\nname: \"x\n---\n", "a.md"), /незакриті лапки/);
  assert.throws(() => parseFrontmatter("---\nname: \"x\" y\n---\n", "a.md"), /зайвий текст після лапок/);
});

// Вбудований парсер мусить читати картки так само, як парсер кампанії, з
// якого його взято: інакше та сама картка виглядала б по-різному.
test("the built-in parser reads every Crown card exactly like the campaign's own", async (context) => {
  const root = fileURLToPath(new URL("../../dnd-campaign/", import.meta.url));
  let campaign;
  try { campaign = await import(new URL("../../dnd-campaign/tools/frontmatter.mjs", import.meta.url)); }
  catch { return context.skip("теки кампанії поруч немає"); }
  const files = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if ([".git", "node_modules", ".obsidian"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".md")) files.push(path);
    }
  };
  await walk(root);
  assert.ok(files.length > 50);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.deepEqual(parseFrontmatter(source, file), campaign.parseFrontmatter(source, file), file);
  }
});
