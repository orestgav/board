// Маленька кампанія для браузерних тестів: карта світу, на ній дві карти
// (A і B), на карті A — рамка з нотаткою, вільна нотатка й статблок.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Найменший справжній WebP (1×1): браузер його розпакує, сервер пропустить.
export const TINY_WEBP = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "base64");

const FRONTMATTER = `export function parseFrontmatter(source) {
  const match = source.replace(/\\r\\n/g, "\\n").match(/^---\\n([\\s\\S]*?)\\n---\\n?([\\s\\S]*)$/);
  const meta = Object.create(null);
  if (!match) return { meta, body: source };
  for (const line of match[1].split("\\n")) {
    const pair = line.match(/^([\\w-]+):\\s*(.*)$/);
    if (pair) meta[pair[1]] = pair[2].replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: match[2] };
}
`;

export const CONFIG = {
  boardConfigVersion: 1,
  frontmatter: "tools/frontmatter.mjs",
  layout: "board/canvas.json",
  notes: { dir: "board/notes", prefix: "map-", type: "board" },
  media: { dir: "board/media", entityDir: "_media", cacheDir: "board/cache", format: "webp" },
  entities: {
    skipDirs: [".git", "tools", "_templates"],
    types: ["npc", "location", "item", "creature"],
    summarySection: "## На дошці",
    linksSection: "## Звʼязки",
    portraitField: "image",
  },
};

const node = (fields) => ({ locked: false, children: [], ...fields });

export function layout() {
  return {
    formatVersion: 1,
    children: [node({
      id: "world", type: "image", image: "board/media/maps/world.webp", x: 10, y: 10, width: 3000, height: 2000, locked: true,
      children: [
        node({
          id: "map-a", type: "image", image: "board/media/maps/a.webp", x: 5, y: 20, width: 1200, height: 800, locked: true,
          children: [
            node({
              id: "frame-1", type: "frame", title: "Рамка", x: 5, y: 10, width: 300, height: 220,
              children: [node({ id: "note-in-frame", type: "note", note: "map-a#n1", x: 10, y: 35, width: 240, height: 120 })],
            }),
            node({ id: "note-free", type: "note", note: "map-a#n2", x: 40, y: 10, width: 240, height: 140 }),
            node({ id: "guard-1", type: "entity", entity: "guard", hp: 11, x: 66, y: 5, width: 360, height: 520 }),
          ],
        }),
        node({ id: "map-b", type: "image", image: "board/media/maps/b.webp", x: 55, y: 20, width: 1200, height: 800, locked: true }),
      ],
    })],
  };
}

export const FILES = {
  "board.config.json": JSON.stringify(CONFIG, null, 2),
  "tools/frontmatter.mjs": FRONTMATTER,
  "board/notes/map-a.md": "---\ntype: board\nname: \"a (нотатки дошки)\"\n---\n\n<!-- note n1 -->\nНотатка в рамці\n\n<!-- note n2 -->\nВільна нотатка\n",
  "world_data/npcs/ester.md": "---\ntype: npc\nname: Естер\nimage: ester.webp\n---\n\n## На дошці\nВласниця обмінного дому.\n",
  "world_data/locations/port.md": "---\ntype: location\nname: Порт\n---\n\n## Звʼязки\n- NPC: [[ester]]\n- Предмети: [[lamp]]\n",
  "world_data/items/lamp.md": "---\ntype: item\nname: Лампа\nprice: 5 gp\n---\n\n## На дошці\nСвітить у темряві.\n",
  "world_data/bestiary/guard.md": "---\ntype: creature\nname: Стражник\nhp: 11 (2d8 + 2)\nac: 16\n---\n\n## Дії\n**Спис.** +3 до влучання.\n\nСтоїть у [[port]].\n",
  "world_data/sessions/session-001.md": "---\ntype: session\nname: Сесія 1\n---\n\n- Партія зайшла в [[port]] і не знайшла [[nobody]].\n",
};

export const MEDIA = ["board/media/maps/world.webp", "board/media/maps/a.webp", "board/media/maps/b.webp", "_media/npcs/ester.webp"];

export async function createCampaign() {
  const base = await mkdtemp(join(tmpdir(), "crown-board-e2e-"));
  const write = async (path, contents) => {
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeFile(join(base, path), contents);
  };
  for (const [path, contents] of Object.entries(FILES)) await write(path, contents);
  for (const path of MEDIA) await write(path, TINY_WEBP);
  await write("board/canvas.json", `${JSON.stringify(layout(), null, 2)}\n`);
  return {
    base,
    async canvas() { return JSON.parse(await readFile(join(base, "board/canvas.json"), "utf8")); },
    async writeCanvas(source) { await writeFile(join(base, "board/canvas.json"), source); },
    async notes(file) {
      try { return await readFile(join(base, "board/notes", `${file}.md`), "utf8"); } catch { return null; }
    },
    async noteFiles() { return (await readdir(join(base, "board/notes"))).sort(); },
    async remove() { await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); },
  };
}

export function findNode(tree, id, parent = null) {
  for (const child of tree.children) {
    if (child.id === id) return { node: child, parent };
    const found = findNode(child, id, child);
    if (found) return found;
  }
  return null;
}

export function allNodes(tree, predicate = () => true, result = []) {
  for (const child of tree.children) {
    if (predicate(child)) result.push(child);
    allNodes(child, predicate, result);
  }
  return result;
}
