// Кілька кампаній в одній дошці (режим теки): список нещодавніх, перемикання
// одним кліком, своя позиція полотна й свій масштаб лінійки в кожної, своя
// таблиця подорожей із board.config.json.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { findChrome, launchBrowser } from "./browser.mjs";
import { CONFIG, FILES, MEDIA, TINY_WEBP, findNode, layout } from "./fixture.mjs";
import { staticSite } from "./static-site.mjs";

const chrome = findChrome();

const ROSINANT = { id: "rosinant", label: "Росінант", milesPerHour: 4, milesPerDay: 96, hoursPerDay: 24, note: "швидкість галери" };

const CROWN = {
  id: "crown-id",
  folder: "crown",
  openedAt: 2,
  texts: {
    ...FILES,
    "board.config.json": JSON.stringify({ ...CONFIG, id: "crown", name: "Crown", travel: { hide: ["sailing-ship", "longship", "galley"], extra: [ROSINANT] } }),
    "board/canvas.json": JSON.stringify(layout()),
  },
  media: MEDIA,
};

// Нова кампанія з мінімальним конфігом: без власного парсера й без портретів.
const NORTH = {
  id: "north-id",
  folder: "north",
  openedAt: 1,
  texts: {
    "board.config.json": JSON.stringify({ boardConfigVersion: 1, name: "Північ" }),
    "npcs/yarl.md": "---\ntype: npc\nname: Ярл\n---\n\n## На дошці\nВолодар півночі.\n",
    "board/canvas.json": JSON.stringify({ formatVersion: 1, children: [
      { id: "north-frame", type: "frame", title: "Північна рамка", x: 20, y: 20, width: 400, height: 300, locked: false, children: [] },
    ] }),
  },
  media: [],
};

describe("several campaigns in one board", { skip: !chrome && "Chrome не знайдено" }, () => {
  let browser;
  before(async () => { browser = await launchBrowser(); });
  after(async () => { await browser?.close(); });

  const name = (page) => page.evaluate(() => document.querySelector("#campaign-name").textContent);
  const setting = (page, key) => page.evaluate((storageKey) => localStorage.getItem(storageKey), key);

  async function open(context, { campaigns = [CROWN, NORTH], storage = {} } = {}) {
    // Свій сайт на окремому порту — це окремий origin, тож localStorage,
    // IndexedDB і файли OPFS у кожного тесту свої й порожні.
    const site = await staticSite();
    const page = await browser.newPage();
    context.after(async () => {
      await page.close();
      site.server.close();
    });
    // Шар відкриття живе частку секунди, тож його покази записуються ще до
    // старту дошки: кожен рядок — заголовок і крок, поки шар видно.
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__loading = [];
      document.addEventListener("DOMContentLoaded", () => {
        const screen = document.querySelector("#loading-screen");
        const record = () => {
          if (screen.hidden) return;
          const row = screen.querySelector("#loading-title").textContent + " | " + screen.querySelector("#loading-step").textContent;
          if (window.__loading.at(-1) !== row) window.__loading.push(row);
        };
        new MutationObserver(record).observe(screen, { attributes: true, childList: true, subtree: true, characterData: true });
      });
    ` });
    await page.goto(site.url);
    await page.evaluate(async (list, local) => {
      for (const [key, value] of Object.entries(local)) localStorage.setItem(key, value);
      const opfs = await navigator.storage.getDirectory();
      const entries = [];
      for (const campaign of list) {
        const root = await opfs.getDirectoryHandle(campaign.folder, { create: true });
        const put = async (path, contents) => {
          const parts = path.split("/");
          const file = parts.pop();
          let directory = root;
          for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
          const writable = await (await directory.getFileHandle(file, { create: true })).createWritable();
          await writable.write(contents);
          await writable.close();
        };
        for (const [path, text] of Object.entries(campaign.texts)) await put(path, text);
        for (const path of campaign.media) await put(path, Uint8Array.from(atob(campaign.webp), (c) => c.charCodeAt(0)));
        entries.push({ id: campaign.id, handle: root, name: campaign.folder, folder: campaign.folder, openedAt: campaign.openedAt });
      }
      await new Promise((done, fail) => {
        const request = indexedDB.open("crown-board", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("handles");
        request.onerror = () => fail(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction("handles", "readwrite");
          for (const entry of entries) transaction.objectStore("handles").put(entry, `recent:${entry.id}`);
          transaction.oncomplete = () => { request.result.close(); done(); };
        };
      });
    }, campaigns.map((campaign) => ({ ...campaign, webp: TINY_WEBP.toString("base64") })), storage);
    await page.reload();
    await page.waitFor(() => document.querySelector("#save-status").textContent === "Збережено" && document.querySelectorAll(".node").length > 0, { message: "кампанія не відкрилась" });
    return page;
  }

  // `label` — як кампанію підписано в списку: до першого відкриття це назва
  // теки, далі — назва з board.config.json, тобто `opened`.
  async function switchTo(page, label, opened = label) {
    await page.click("#change-campaign");
    await page.waitFor(() => !document.querySelector("#connection-screen").hidden && document.querySelectorAll(".recent-open").length > 0);
    const index = await page.evaluate((wanted) => [...document.querySelectorAll(".recent-open strong")].findIndex((row) => row.textContent === wanted), label);
    assert.ok(index >= 0, `у списку немає «${label}»`);
    await page.click(`.recent-campaign:nth-child(${index + 1}) .recent-open`);
    try {
      await page.waitFor((wanted) => document.querySelector("#campaign-name").textContent === wanted
        && document.querySelector("#connection-screen").hidden
        && document.querySelector("#save-status").textContent === "Збережено", { message: `не перейшли до «${opened}»` }, opened);
    } catch (error) {
      const state = await page.evaluate(() => [
        document.querySelector("#campaign-name").textContent, document.querySelector("#save-status").textContent,
        document.querySelector("#connection-hint").textContent, document.querySelector("#toast").hidden ? "" : document.querySelector("#toast").textContent,
      ].join(" | "));
      throw new Error(`${error.message}; стан: ${state}; помилки: ${page.errors.join("; ")}`);
    }
  }

  const readFile = (page, folder, path) => page.evaluate(async (root, target) => {
    let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(root);
    const parts = target.split("/");
    const file = parts.pop();
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    return (await (await directory.getFileHandle(file)).getFile()).text();
  }, folder, path);

  test("the latest campaign opens by itself and takes over the old shared view", async (context) => {
    const legacy = JSON.stringify({ x: -1234, y: -2345, scale: 0.6 });
    const page = await open(context, { storage: { "crown-board.viewport": legacy, "crown-board.layers-open": "true" } });
    assert.equal(await name(page), "Crown");
    assert.equal(await page.evaluate(() => document.title), "Crown — дошка");
    assert.equal(await setting(page, "crown-board.viewport"), null);
    assert.notEqual(await setting(page, "board.crown.viewport"), null);
    assert.equal(await page.evaluate(() => document.querySelector(".workspace").classList.contains("layers-open")), true);
    assert.deepEqual(page.errors, []);
  });

  test("opening a campaign shows what is being opened until the board is ready", async (context) => {
    const page = await open(context);
    const startup = await page.evaluate(() => window.__loading);
    assert.ok(startup.includes("Відкриваю «Crown»… | Індексую картки й нотатки…"), startup.join("; "));
    assert.equal(await page.evaluate(() => document.querySelector("#loading-screen").hidden), true);

    await page.evaluate(() => { window.__loading = []; });
    await switchTo(page, "north", "Північ");
    const switching = await page.evaluate(() => window.__loading);
    assert.equal(switching[0], "Відкриваю «north»… | Перевіряю доступ до теки…");
    assert.ok(switching.includes("Відкриваю «Північ»… | Індексую картки й нотатки…"), switching.join("; "));
    assert.equal(await page.evaluate(() => document.querySelector("#loading-screen").hidden), true);
    assert.deepEqual(page.errors, []);
  });

  test("switching campaigns keeps each one's own place on the canvas", async (context) => {
    const page = await open(context);
    await page.wheel(800, 500, -300);
    await page.until(async () => JSON.parse(await setting(page, "board.crown.viewport") ?? "{}").scale > 0, { message: "позиція не запамʼяталась" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const crownView = await setting(page, "board.crown.viewport");

    await switchTo(page, "north", "Північ");
    assert.equal(await page.evaluate(() => document.title), "Північ — дошка");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".node").length), 1);
    assert.equal(await page.evaluate(() => document.querySelector(".node-title").textContent), "Північна рамка");
    await page.until(async () => (await setting(page, "board.north.viewport")) !== null);
    assert.equal(await setting(page, "board.crown.viewport"), crownView);

    await switchTo(page, "Crown");
    assert.equal(await setting(page, "board.crown.viewport"), crownView);
    const { scale } = JSON.parse(crownView);
    // Браузер віддає масштаб округленим до пʼяти знаків.
    const shown = Number((await page.evaluate(() => document.querySelector("#scene").style.transform)).match(/scale\(([\d.]+)\)/)[1]);
    assert.ok(Math.abs(shown - scale) < 1e-4, `масштаб ${shown} замість ${scale}`);
    assert.equal(await page.evaluate(() => document.querySelectorAll(".node").length), 7);
    assert.deepEqual(page.errors, []);
  });

  test("an unsaved change is written to its own campaign before switching", async (context) => {
    const page = await open(context);
    await page.click('.node[data-id="guard-1"] .hp-current');
    await page.press("Ctrl+a");
    await page.type("4");
    await page.press("Enter");
    await switchTo(page, "north", "Північ");
    assert.equal(findNode(JSON.parse(await readFile(page, "crown", "board/canvas.json")), "guard-1").node.hp, 4);
    assert.doesNotMatch(await readFile(page, "north", "board/canvas.json"), /guard-1/);
  });

  test("the choice screen goes back to the open board, and forgets a campaign without touching its folder", async (context) => {
    const page = await open(context);
    await page.click("#change-campaign");
    await page.waitFor(() => document.querySelectorAll(".recent-open").length === 2);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".recent-open strong")].map((label) => label.textContent)), ["Crown", "north"]);
    await page.click(".recent-campaign:nth-child(2) .recent-forget");
    await page.waitFor(() => document.querySelectorAll(".recent-open").length === 1);
    assert.match(await readFile(page, "north", "board.config.json"), /Північ/);
    await page.click("#cancel-campaign");
    await page.waitFor(() => document.querySelector("#connection-screen").hidden);
    assert.equal(await name(page), "Crown");
    assert.deepEqual(page.errors, []);
  });

  test("the route table and its scale come from each campaign", async (context) => {
    const page = await open(context);
    const measure = async () => {
      await page.click("#measure-route");
      for (const x of [600, 800]) await page.clickAt({ x, y: 520 });
      await page.waitFor(() => document.querySelector("#route-hint-text").textContent.startsWith("Клацай точки"), { message: "калібрування не завершилось" });
      for (const x of [600, 700]) await page.clickAt({ x, y: 520 });
      await page.waitFor(() => !document.querySelector("#route-popup").hidden, { message: "нема таблиці маршруту" });
      const rows = await page.evaluate(() => [...document.querySelectorAll("#route-rows tr td:first-child")].map((cell) => cell.firstChild.textContent));
      await page.click("#route-close");
      return rows;
    };
    const crownRows = await measure();
    assert.ok(crownRows.includes("Росінант"));
    assert.ok(!crownRows.includes("Галера"));
    assert.notEqual(await setting(page, "board.crown.route-scale"), null);

    await switchTo(page, "north", "Північ");
    await page.click("#measure-route");
    // Масштаб Crown тут не діє: нова кампанія калібрується наново.
    assert.match(await page.evaluate(() => document.querySelector("#route-hint-text").textContent), /Калібрування/);
    await page.click("#measure-route");
    const northRows = await measure();
    assert.ok(northRows.includes("Галера"));
    assert.ok(!northRows.includes("Росінант"));
    assert.deepEqual(page.errors, []);
  });
});
