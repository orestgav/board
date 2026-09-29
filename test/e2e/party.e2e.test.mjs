// Панель «Партія» в справжньому Chrome: кампанія з двома гравцями, замість
// Cloudflare Worker — локальний посередник, що віддає знеособлений лист
// (другий гравець — приватний, 403). Без Chrome тести пропускаються.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { startServer } from "../../src/server.mjs";
import { findChrome, launchBrowser } from "./browser.mjs";
import { CONFIG, createCampaign } from "./fixture.mjs";

const chrome = findChrome();
const SHEET = JSON.parse(readFileSync(new URL("../fixtures/ddb-character.json", import.meta.url), "utf8"));

async function fakeProxy() {
  const state = { removed: 3, temp: 0, requests: 0 };
  const server = createServer((request, response) => {
    state.requests += 1;
    const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
    const id = request.url.match(/^\/character\/(\d+)$/)?.[1];
    if (id !== "1000") {
      response.writeHead(id ? 403 : 404, headers).end("{}");
      return;
    }
    const sheet = structuredClone(SHEET);
    sheet.data.removedHitPoints = state.removed;
    sheet.data.temporaryHitPoints = state.temp;
    response.writeHead(200, headers).end(JSON.stringify(sheet));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

describe("party panel in a browser", { skip: !chrome && "Chrome не знайдено" }, () => {
  let browser;
  before(async () => { browser = await launchBrowser(); });
  after(async () => { await browser?.close(); });

  async function open(context) {
    const proxy = await fakeProxy();
    const campaign = await createCampaign();
    const config = {
      ...CONFIG,
      entities: { ...CONFIG.entities, types: [...CONFIG.entities.types, "player"] },
      party: { proxy: proxy.url, interval: 60 },
    };
    await writeFile(join(campaign.base, "board.config.json"), JSON.stringify(config));
    await writeFile(join(campaign.base, "world_data/players/alrencis.md"), "---\ntype: player\nname: Алренсіс дан Ессаар\nddb_id: 1000\n---\n\nБард.\n")
      .catch(async () => {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(campaign.base, "world_data/players"), { recursive: true });
        await writeFile(join(campaign.base, "world_data/players/alrencis.md"), "---\ntype: player\nname: Алренсіс дан Ессаар\nddb_id: 1000\n---\n\nБард.\n");
      });
    await writeFile(join(campaign.base, "world_data/players/rene.md"), "---\ntype: player\nname: Рене Фалькро\nddb_id: 2\n---\n");
    const running = await startServer({ base: campaign.base, port: 0 });
    const page = await browser.newPage();
    context.after(async () => {
      await page.close();
      await new Promise((resolve) => running.server.close(resolve));
      await proxy.close();
      await campaign.remove();
    });
    await page.goto(running.url);
    await page.evaluate(() => localStorage.removeItem("board.party-open"));
    await page.reload();
    await page.waitFor(() => document.querySelector("#save-status").textContent === "Збережено", { message: "дошка не завантажилась" });
    return { page, proxy };
  }

  // Панель і ліва група HUD виїжджають за .18 с; клік посеред руху пролітає повз.
  async function togglePanel(page, button, open) {
    await page.click(button);
    await page.waitFor((className, expected) => {
      const panel = document.querySelector(className);
      const settled = getComputedStyle(panel).transform === (expected ? "matrix(1, 0, 0, 1, 0, 0)" : `matrix(1, 0, 0, 1, ${-panel.offsetWidth}, 0)`);
      const hud = document.querySelector(".hud-left");
      return settled && getComputedStyle(hud).left === `${hud.offsetLeft}px`
        && !document.getAnimations().some((animation) => animation.transitionProperty);
    }, { message: `${button} не доїхала` }, button === "#toggle-party" ? ".party" : ".layers", open);
  }

  test("панель відкривається кнопкою, показує живий лист і приватний", async (context) => {
    const { page, proxy } = await open(context);
    assert.equal(await page.evaluate(() => document.querySelector("#toggle-party").hidden), false);
    assert.equal(proxy.state.requests, 0, "поки панель закрита, посередника не смикаємо");
    await togglePanel(page, "#toggle-party", true);
    await page.waitFor(() => document.querySelector('.party-card[data-slug="alrencis"] .party-ac'), { message: "картка не зʼявилась" });
    const card = await page.evaluate(() => document.querySelector('.party-card[data-slug="alrencis"]').textContent);
    assert.match(card, /Алренсіс/);
    assert.match(card, /AC 15/);
    assert.match(card, /28\/31/);
    assert.match(card, /52%/);
    assert.match(await page.evaluate(() => document.querySelector('.party-card[data-slug="rene"]').textContent), /Лист приватний/);
    assert.equal(await page.evaluate(() => document.querySelector(".workspace").classList.contains("party-open")), true);
    // Шари й партія ділять місце: відкриваєш шари — партія ховається.
    await togglePanel(page, "#toggle-layers", true);
    assert.equal(await page.evaluate(() => document.querySelector(".workspace").classList.contains("party-open")), false);
    await togglePanel(page, "#toggle-party", true);
    assert.equal(await page.evaluate(() => document.querySelector(".workspace").classList.contains("layers-open")), false);
    assert.deepEqual(page.errors, []);
  });

  test("втрата HP підсвічує відрізок смуги, тимчасові — окремим кольором", async (context) => {
    const { page, proxy } = await open(context);
    await togglePanel(page, "#toggle-party", true);
    await page.waitFor(() => document.querySelector('.party-card[data-slug="alrencis"] .party-ac'));
    proxy.state.removed = 13;
    proxy.state.temp = 4;
    await page.click("#party-refresh");
    await page.waitFor(() => document.querySelector('.party-card[data-slug="alrencis"] .party-hp-ghost.party-hp-damage'), { message: "привид не зʼявився" });
    const text = await page.evaluate(() => document.querySelector('.party-card[data-slug="alrencis"] .party-hp-text').textContent);
    assert.equal(text, "18/31 +4");
    assert.ok(await page.evaluate(() => document.querySelector('.party-card[data-slug="alrencis"] .party-hp-temp')));
    const colors = await page.evaluate(() => ["current", "temp", "ghost"].map((kind) =>
      getComputedStyle(document.querySelector(`.party-card[data-slug="alrencis"] .party-hp-${kind}`)).backgroundColor));
    assert.equal(new Set(colors).size, 3);
    if (process.env.CROWN_PARTY_SCREENSHOT) {
      const { data } = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 360, height: 420, scale: 2 } });
      await writeFile(process.env.CROWN_PARTY_SCREENSHOT, Buffer.from(data, "base64"));
    }
    assert.deepEqual(page.errors, []);
  });

  test("клік по картці — попап з інвентарем, що оновлюється наживо", async (context) => {
    const { page, proxy } = await open(context);
    await togglePanel(page, "#toggle-party", true);
    await page.waitFor(() => document.querySelector('.party-card[data-slug="alrencis"] .party-ac'));
    await page.click('.party-card[data-slug="alrencis"]');
    await page.waitFor(() => document.querySelector("#entity-details").open && document.querySelector(".party-details"));
    const details = await page.evaluate(() => document.querySelector(".party-details").textContent);
    assert.match(details, /62 \/ 120 lb · 52%/);
    assert.match(details, /Scroll Satchel/);
    assert.match(details, /Detect Magic/);
    proxy.state.removed = 20;
    await page.evaluate(() => document.querySelector("#party-refresh").click());
    await page.waitFor(() => document.querySelector(".party-details .party-hp-text")?.textContent === "11/31", { message: "попап не оновився" });
    if (process.env.CROWN_PARTY_DETAILS_SCREENSHOT) {
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.CROWN_PARTY_DETAILS_SCREENSHOT, Buffer.from(data, "base64"));
    }
    await page.click('.party-details [data-entity-slug="alrencis"]');
    await page.waitFor(() => document.querySelector("#entity-details-content h1")?.textContent === "Алренсіс дан Ессаар"
      && !document.querySelector(".party-details"), { message: "картка гравця не відкрилась" });
    assert.deepEqual(page.errors, []);
  });
});
