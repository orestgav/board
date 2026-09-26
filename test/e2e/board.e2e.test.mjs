// Канва в справжньому Chrome поверх локального сервера й тестової кампанії:
// перевіряється те, що живе в app.js, — жести, історія, нотатки у файлах,
// збереження. Без Chrome на машині тести пропускаються (CROWN_E2E=0 — теж).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "../../src/server.mjs";
import { findChrome, launchBrowser } from "./browser.mjs";
import { allNodes, createCampaign, findNode } from "./fixture.mjs";

const chrome = findChrome();
// Порожнє полотно ліворуч від карти світу: fitAll лишає там поле.
const EMPTY = { x: 30, y: 500 };

describe("canvas in a browser, local server mode", { skip: !chrome && "Chrome не знайдено" }, () => {
  let browser;
  before(async () => { browser = await launchBrowser(); });
  after(async () => { await browser?.close(); });

  async function open(context) {
    const campaign = await createCampaign();
    const running = await startServer({ base: campaign.base, port: 0 });
    const page = await browser.newPage();
    context.after(async () => {
      await page.close();
      await new Promise((resolve) => running.server.close(resolve));
      await campaign.remove();
    });
    await page.goto(running.url);
    await page.waitFor(() => document.querySelector("#save-status").textContent === "Збережено"
      && document.querySelectorAll(".node").length > 0, { message: "дошка не завантажилась" });
    return { page, campaign, url: running.url };
  }

  const status = (page) => page.evaluate(() => document.querySelector("#save-status").textContent);
  const toast = (page) => page.evaluate(() => (document.querySelector("#toast").hidden ? "" : document.querySelector("#toast").textContent));
  const saved = (page) => page.waitFor(() => document.querySelector("#save-status").textContent === "Збережено", { message: "дошка не зберіглась" });

  async function typeInto(page, selector, text) {
    await page.click(selector);
    await page.press("Ctrl+a");
    await page.type(text);
  }

  test("the board opens with every node of the campaign and no errors", async (context) => {
    const { page } = await open(context);
    assert.equal(await page.evaluate(() => document.querySelectorAll(".node").length), 7);
    assert.match(await page.evaluate(() => document.querySelector("#campaign-name").textContent), /crown-board-e2e-/);
    assert.equal(await page.evaluate(() => document.querySelector('.node[data-id="note-free"] .note-content').textContent), "Вільна нотатка");
    assert.equal(await page.evaluate(() => document.querySelector('.node[data-id="guard-1"] .node-title').textContent), "Стражник");
    assert.equal(await page.evaluate(() => document.querySelector("#connection-screen").hidden), true);
    assert.deepEqual(page.errors, []);
  });

  test("a frame added with F is saved, undone and redone", async (context) => {
    const { page, campaign } = await open(context);
    const frames = async () => allNodes(await campaign.canvas(), (node) => node.type === "frame").length;
    await page.clickAt(EMPTY);
    await page.press("f");
    await page.until(async () => (await frames()) === 2, { message: "рамка не зберіглась" });
    await page.click("#undo");
    await page.until(async () => (await frames()) === 1, { message: "undo не спрацював" });
    await page.click("#redo");
    await page.until(async () => (await frames()) === 2, { message: "redo не спрацював" });
    assert.deepEqual(page.errors, []);
  });

  test("hit points are typed by hand, hit, healed and never exceed the maximum", async (context) => {
    const { page, campaign } = await open(context);
    const hp = async () => findNode(await campaign.canvas(), "guard-1").node.hp;
    await typeInto(page, '.node[data-id="guard-1"] .hp-current', "7");
    await page.press("Enter");
    await page.until(async () => (await hp()) === 7, { message: "вписане HP не зберіглось" });

    await typeInto(page, '.node[data-id="guard-1"] .hp-current', "abc");
    await page.press("Enter");
    assert.equal(await page.evaluate(() => document.querySelector('.node[data-id="guard-1"] .hp-current').value), "7");

    await typeInto(page, '.node[data-id="guard-1"] .hp-amount', "3");
    await page.click('.node[data-id="guard-1"] .hp-button.damage');
    await page.until(async () => (await hp()) === 4, { message: "удар не зняв HP" });
    assert.equal(await page.evaluate(() => document.querySelector('.node[data-id="guard-1"] .hp-amount').value), "0");

    await typeInto(page, '.node[data-id="guard-1"] .hp-amount', "100");
    await page.click('.node[data-id="guard-1"] .hp-button.heal');
    await page.until(async () => (await hp()) === 11, { message: "лікування не впиралося в максимум" });

    const { x, y } = await page.pointOf('.node[data-id="guard-1"] .hp-current');
    await page.wheel(x, y, 100);
    await page.until(async () => (await hp()) === 10, { message: "колесо не зняло HP" });
    assert.deepEqual(page.errors, []);
  });

  test("a note is edited in place and its markdown block is rewritten", async (context) => {
    const { page, campaign } = await open(context);
    await page.click('.node[data-id="note-free"] .note-content');
    await page.waitFor(() => document.activeElement?.classList.contains("note-editor"));
    await page.type(" — оновлено");
    await page.press("Ctrl+Enter");
    await page.until(async () => (await campaign.notes("map-a"))?.includes("Вільна нотатка — оновлено"), { message: "текст не записався" });
    assert.match(await campaign.notes("map-a"), /Нотатка в рамці/);
    assert.deepEqual(page.errors, []);
  });

  test("a new note lands in the file of the map under it; Esc on an empty one takes it back", async (context) => {
    const { page, campaign } = await open(context);
    await page.click("#add-note");
    await page.waitFor(() => document.activeElement?.classList.contains("note-editor"));
    await page.type("Засідка");
    await page.press("Ctrl+Enter");
    await page.until(async () => (await campaign.notes("map-world"))?.includes("Засідка"), { message: "нотатка не створилась" });
    await page.until(async () => {
      const note = allNodes(await campaign.canvas(), (node) => node.note === "map-world#n1")[0];
      return note && findNode(await campaign.canvas(), note.id).parent.id === "world";
    }, { message: "вузол нотатки не зберігся" });

    await page.click("#add-note");
    await page.waitFor(() => document.activeElement?.classList.contains("note-editor"));
    await page.until(async () => (await campaign.notes("map-world"))?.includes("<!-- note n2 -->"));
    await page.press("Escape");
    await page.until(async () => !(await campaign.notes("map-world")).includes("<!-- note n2 -->"), { message: "Esc не прибрав порожню нотатку" });
    assert.deepEqual(page.errors, []);
  });

  test("dragging a note onto another map moves its block there, undo brings it back", async (context) => {
    const { page, campaign } = await open(context);
    await page.drag(await page.pointOf('.note-drag-handle[data-id="note-free"]'), await page.pointOf('.node[data-id="map-b"]'));
    await page.until(async () => findNode(await campaign.canvas(), "note-free").parent.id === "map-b", { message: "нотатка не переїхала" });
    assert.equal(findNode(await campaign.canvas(), "note-free").node.note, "map-b#n1");
    assert.match(await campaign.notes("map-b"), /Вільна нотатка/);
    assert.doesNotMatch(await campaign.notes("map-a"), /Вільна нотатка/);

    await page.press("Ctrl+z");
    await page.until(async () => findNode(await campaign.canvas(), "note-free").parent.id === "map-a", { message: "undo не повернув нотатку" });
    const back = findNode(await campaign.canvas(), "note-free").node.note;
    assert.match(back, /^map-a#n\d+$/);
    assert.match(await campaign.notes("map-a"), /Вільна нотатка/);
    assert.doesNotMatch(await campaign.notes("map-b"), /Вільна нотатка/);
    assert.deepEqual(page.errors, []);
  });

  test("a frame carries its notes to another map, and cannot leave the maps behind", async (context) => {
    const { page, campaign } = await open(context);
    await page.drag(await page.pointOf('.node-header[data-id="frame-1"]'), await page.pointOf('.node[data-id="map-b"]'));
    await page.until(async () => findNode(await campaign.canvas(), "frame-1").parent.id === "map-b", { message: "рамка не переїхала" });
    await page.until(async () => findNode(await campaign.canvas(), "note-in-frame").node.note.startsWith("map-b#"), { message: "нотатка з рамки лишилась у старому файлі" });
    assert.match(await campaign.notes("map-b"), /Нотатка в рамці/);
    assert.doesNotMatch(await campaign.notes("map-a"), /Нотатка в рамці/);

    // Поза картою світу нотатці нема файла — перенесення скасовується.
    await page.drag(await page.pointOf('.node-header[data-id="frame-1"]'), { x: 20, y: 500 });
    await page.until(async () => (await toast(page)).includes("мають залишатися всередині карти"), { message: "нема попередження" });
    assert.equal(findNode(await campaign.canvas(), "frame-1").parent.id, "map-b");
    assert.deepEqual(page.errors, []);
  });

  test("deleting a frame deletes the notes inside it, undo restores them", async (context) => {
    const { page, campaign } = await open(context);
    await page.click('.node-header[data-id="frame-1"]');
    await page.press("Delete");
    await page.until(async () => !findNode(await campaign.canvas(), "frame-1"), { message: "рамка не видалилась" });
    assert.doesNotMatch(await campaign.notes("map-a"), /Нотатка в рамці/);
    assert.match(await campaign.notes("map-a"), /Вільна нотатка/);

    await page.press("Ctrl+z");
    await page.until(async () => findNode(await campaign.canvas(), "note-in-frame"), { message: "undo не повернув рамку" });
    assert.match(await campaign.notes("map-a"), /<!-- note n1 -->\nНотатка в рамці/);
    assert.equal(await page.evaluate(() => document.querySelector('.node[data-id="note-in-frame"] .note-content').textContent), "Нотатка в рамці");
    assert.deepEqual(page.errors, []);
  });

  test("a locked node is neither moved nor deleted", async (context) => {
    const { page, campaign } = await open(context);
    await page.click('.node-header[data-id="guard-1"]');
    await page.press("Ctrl+l");
    await page.until(async () => findNode(await campaign.canvas(), "guard-1").node.locked === true, { message: "лок не зберігся" });
    await page.press("Delete");
    await page.press("ArrowRight");
    await saved(page);
    const guard = findNode(await campaign.canvas(), "guard-1").node;
    assert.equal(guard.x, 66);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.node[data-id="guard-1"]'))), true);
    assert.deepEqual(page.errors, []);
  });

  test("arrow keys nudge the selection and z-order keys restack it", async (context) => {
    const { page, campaign } = await open(context);
    await page.click('.node-header[data-id="frame-1"]');
    await page.press("Shift+ArrowRight");
    await page.until(async () => findNode(await campaign.canvas(), "frame-1").node.x === 5 + 10 / 1200 * 100, { message: "нудж не спрацював" });
    await page.press("Ctrl+Shift+[");
    await page.until(async () => findNode(await campaign.canvas(), "map-a").node.children[0].id === "frame-1");
    await page.press("Ctrl+Shift+]");
    await page.until(async () => findNode(await campaign.canvas(), "map-a").node.children.at(-1).id === "frame-1", { message: "z-порядок не змінився" });
    assert.deepEqual(page.errors, []);
  });

  test("Ctrl+K and the location button put repository cards on the board", async (context) => {
    const { page, campaign } = await open(context);
    await page.clickAt(EMPTY);
    await page.press("Ctrl+k");
    await page.waitFor(() => document.querySelector("#entity-picker").open);
    await page.type("Лампа");
    await page.waitFor(() => document.querySelectorAll(".entity-result").length === 1);
    await page.press("Enter");
    await page.until(async () => allNodes(await campaign.canvas(), (node) => node.entity === "lamp").length === 1, { message: "картка не лягла" });

    await page.click("#add-location");
    await page.waitFor(() => document.querySelector("#entity-picker").open);
    await page.type("Порт");
    await page.press("Enter");
    await page.until(async () => {
      const port = allNodes(await campaign.canvas(), (node) => node.entity === "port")[0];
      return port && port.children.map((child) => child.entity).join() === "ester,lamp";
    }, { message: "локація не принесла NPC і предмет" });
    assert.deepEqual(page.errors, []);
  });

  test("the context menu adds a creature to a statblock and copies a note into another map", async (context) => {
    const { page, campaign } = await open(context);
    await page.click('.node-header[data-id="guard-1"]', { button: "right" });
    await page.waitFor(() => !document.querySelector("#node-context-menu").hidden, { message: "меню не відкрилось" });
    await page.click('[data-context-action="add-creature"]');
    await page.until(async () => findNode(await campaign.canvas(), "guard-1").node.creatures?.length === 2, { message: "істота не додалась" });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.node[data-id="guard-1"] .statblock-hp').length), 2);

    await page.click('.note-drag-handle[data-id="note-free"]', { button: "right" });
    await page.waitFor(() => !document.querySelector("#node-context-menu").hidden);
    await page.click('[data-context-action="copy"]');
    await page.click('.node[data-id="map-b"]', { button: "right" });
    await page.waitFor(() => !document.querySelector("#node-context-menu").hidden);
    await page.click('[data-context-action="paste"]');
    await page.until(async () => (await campaign.notes("map-b"))?.includes("Вільна нотатка"), { message: "копія нотатки не створилась" });
    assert.match(await campaign.notes("map-a"), /Вільна нотатка/);
    const copies = await page.until(async () => {
      const found = allNodes(await campaign.canvas(), (node) => node.type === "note" && node.note.startsWith("map-b#"));
      return found.length ? found : null;
    }, { message: "вузол копії не зберігся" });
    assert.equal(copies.length, 1);
    assert.notEqual(copies[0].id, "note-free");
    assert.deepEqual(page.errors, []);
  });

  test("an outside change to canvas.json stops autosave and offers both ways out", async (context) => {
    const { page, campaign } = await open(context);
    const setHp = async (value) => {
      await typeInto(page, '.node[data-id="guard-1"] .hp-current', String(value));
      await page.press("Enter");
    };
    await campaign.writeCanvas(`${JSON.stringify(await campaign.canvas())}\n`);
    await setHp(9);
    await page.waitFor(() => !document.querySelector("#conflict-bar").hidden, { message: "панель конфлікту не зʼявилась" });
    assert.match(await status(page), /Конфлікт/);
    await setHp(8);
    assert.equal(findNode(await campaign.canvas(), "guard-1").node.hp, 11);
    assert.equal(await toast(page), "");

    await page.click("#conflict-overwrite");
    await page.until(async () => findNode(await campaign.canvas(), "guard-1").node.hp === 8, { message: "перезапис не записав дошку" });
    assert.equal(await page.evaluate(() => document.querySelector("#conflict-bar").hidden), true);

    const outside = await campaign.canvas();
    findNode(outside, "guard-1").node.hp = 2;
    await campaign.writeCanvas(`${JSON.stringify(outside, null, 2)}\n`);
    await setHp(5);
    await page.waitFor(() => !document.querySelector("#conflict-bar").hidden);
    await page.click("#conflict-reload");
    await saved(page);
    assert.equal(await page.evaluate(() => document.querySelector('.node[data-id="guard-1"] .hp-current').value), "2");
    assert.equal(findNode(await campaign.canvas(), "guard-1").node.hp, 2);
    assert.deepEqual(page.errors, []);
  });

  test("leaving with unsaved changes asks first and saves without waiting", async (context) => {
    const { page, campaign } = await open(context);
    await typeInto(page, '.node[data-id="guard-1"] .hp-current', "3");
    await page.press("Enter");
    const asked = page.once("Page.javascriptDialogOpening");
    await page.evaluate(() => { setTimeout(() => { location.href = "about:blank"; }); });
    assert.equal((await asked).type, "beforeunload");
    await page.send("Page.handleJavaScriptDialog", { accept: false });
    await page.until(async () => findNode(await campaign.canvas(), "guard-1").node.hp === 3, { message: "збереження не відбулося" });
    await saved(page);

    // Без незбереженого — жодних питань.
    await page.evaluate(() => { setTimeout(() => { location.href = "about:blank"; }); });
    await page.until(async () => (await page.evaluate(() => location.href)) === "about:blank", { message: "сторінка не пішла" });
    assert.deepEqual(page.dialogs, ["beforeunload"]);
  });
});
