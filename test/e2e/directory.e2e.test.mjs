// Основний режим (GitHub Pages): канва без сервера пише прямо в теку
// кампанії через File System Access API. Системний пікер у headless не
// натиснути, тож кампанія лягає в Origin Private File System — це той самий
// FileSystemDirectoryHandle, — а її handle запамʼятовується в IndexedDB так,
// як це робить сама канва після вибору теки.
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { findChrome, launchBrowser } from "./browser.mjs";
import { FILES, MEDIA, TINY_WEBP, allNodes, findNode, layout } from "./fixture.mjs";

const chrome = findChrome();
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

// Лише статика, як на Pages: /api/health тут 404, тож канва обирає теку.
async function staticServer() {
  const server = createServer(async (request, response) => {
    const path = resolve(PUBLIC, `.${new URL(request.url, "http://x").pathname.replace(/\/$/, "/index.html")}`);
    try {
      if (!path.startsWith(PUBLIC + sep) || !(await stat(path)).isFile()) throw new Error();
      response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

describe("canvas in a browser, local folder mode", { skip: !chrome && "Chrome не знайдено" }, () => {
  let browser;
  let site;
  before(async () => {
    browser = await launchBrowser();
    site = await staticServer();
  });
  after(async () => {
    await browser?.close();
    site?.server.close();
  });

  async function open(context) {
    const page = await browser.newPage();
    context.after(async () => {
      await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry("campaign", { recursive: true }).catch(() => {});
        indexedDB.deleteDatabase("crown-board");
      }).catch(() => {});
      await page.close();
    });
    await page.goto(site.url);
    await page.waitFor(() => !document.querySelector("#connection-screen").hidden, { message: "нема екрана вибору теки" });
    const files = { ...FILES, "board/canvas.json": `${JSON.stringify(layout(), null, 2)}\n` };
    const media = Object.fromEntries(MEDIA.map((path) => [path, TINY_WEBP.toString("base64")]));
    await page.evaluate(async (texts, images) => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("campaign", { create: true });
      const put = async (path, contents) => {
        const parts = path.split("/");
        const name = parts.pop();
        let directory = root;
        for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
        const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
        await writable.write(contents);
        await writable.close();
      };
      for (const [path, text] of Object.entries(texts)) await put(path, text);
      for (const [path, base64] of Object.entries(images)) await put(path, Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      await new Promise((done, fail) => {
        const request = indexedDB.open("crown-board", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("handles");
        request.onerror = () => fail(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("handles", "readwrite");
          transaction.objectStore("handles").put(root, "campaign");
          transaction.oncomplete = () => { request.result.close(); done(); };
        };
      });
    }, files, media);
    await page.reload();
    await page.waitFor(() => document.querySelector("#save-status").textContent === "Збережено"
      && document.querySelectorAll(".node").length > 0, { message: "тека не відкрилась" });
    const read = (path) => page.evaluate(async (target) => {
      let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("campaign");
      const parts = target.split("/");
      const name = parts.pop();
      for (const part of parts) directory = await directory.getDirectoryHandle(part);
      return (await (await directory.getFileHandle(name)).getFile()).text();
    }, path);
    const write = (path, text) => page.evaluate(async (target, contents) => {
      let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("campaign");
      const parts = target.split("/");
      const name = parts.pop();
      for (const part of parts) directory = await directory.getDirectoryHandle(part);
      const writable = await (await directory.getFileHandle(name)).createWritable();
      await writable.write(contents);
      await writable.close();
    }, path, text);
    return { page, read, write, canvas: async () => JSON.parse(await read("board/canvas.json")) };
  }

  async function typeInto(page, selector, text) {
    await page.click(selector);
    await page.press("Ctrl+a");
    await page.type(text);
  }

  test("the remembered folder opens with cards indexed by the campaign's own parser", async (context) => {
    const { page } = await open(context);
    assert.equal(await page.evaluate(() => document.querySelector("#campaign-name").textContent), "campaign");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".node").length), 7);
    // Назва «Стражник» є лише у фронтматері картки: її прочитав парсер кампанії,
    // імпортований із теки як модуль.
    assert.equal(await page.evaluate(() => document.querySelector('.node[data-id="guard-1"] .node-title').textContent), "Стражник");
    assert.equal(await page.evaluate(() => document.querySelector('.node[data-id="note-in-frame"] .note-content').textContent), "Нотатка в рамці");
    assert.deepEqual(page.errors, []);
  });

  test("layout and note edits are written straight into the folder", async (context) => {
    const { page, read, canvas } = await open(context);
    await typeInto(page, '.node[data-id="guard-1"] .hp-current', "6");
    await page.press("Enter");
    await page.until(async () => findNode(await canvas(), "guard-1").node.hp === 6, { message: "HP не записались у теку" });

    await page.click('.node[data-id="note-free"] .note-content');
    await page.waitFor(() => document.activeElement?.classList.contains("note-editor"));
    await page.type(" у теці");
    await page.press("Ctrl+Enter");
    await page.until(async () => (await read("board/notes/map-a.md")).includes("Вільна нотатка у теці"), { message: "нотатка не записалась у теку" });

    await page.drag(await page.pointOf('.node-header[data-id="frame-1"]'), await page.pointOf('.node[data-id="map-b"]'));
    await page.until(async () => findNode(await canvas(), "note-in-frame").node.note.startsWith("map-b#"), { message: "нотатка з рамки не переїхала" });
    assert.match(await read("board/notes/map-b.md"), /Нотатка в рамці/);
    assert.equal(allNodes(await canvas(), (node) => node.type === "note").length, 2);
    assert.deepEqual(page.errors, []);
  });

  test("an outside change to canvas.json in the folder is caught as a conflict", async (context) => {
    const { page, write, canvas } = await open(context);
    const outside = await canvas();
    findNode(outside, "guard-1").node.hp = 1;
    await write("board/canvas.json", JSON.stringify(outside));
    await typeInto(page, '.node[data-id="guard-1"] .hp-current', "9");
    await page.press("Enter");
    await page.waitFor(() => !document.querySelector("#conflict-bar").hidden, { message: "конфлікт не помічено" });
    assert.equal(findNode(await canvas(), "guard-1").node.hp, 1);
    await page.click("#conflict-overwrite");
    await page.until(async () => findNode(await canvas(), "guard-1").node.hp === 9, { message: "перезапис не спрацював" });
    assert.deepEqual(page.errors, []);
  });
});
