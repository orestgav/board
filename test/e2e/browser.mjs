// Справжній Chrome у headless-режимі через DevTools Protocol, без залежностей:
// лише child_process і вбудований у Node WebSocket. Канва — це DOM, pointer-
// події й файли, тож перевіряти її по-справжньому можна тільки в браузері.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function findChrome() {
  if (process.env.CROWN_E2E === "0") return null;
  return CANDIDATES.find((path) => path && existsSync(path)) ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(path, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { return await readFile(path, "utf8"); } catch {}
    await sleep(50);
  }
  throw new Error(`Chrome не відкрив DevTools за ${timeout} мс`);
}

export async function launchBrowser() {
  const executable = findChrome();
  if (!executable) throw new Error("Chrome не знайдено");
  const profile = await mkdtemp(join(tmpdir(), "crown-board-chrome-"));
  const child = spawn(executable, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--window-size=1600,1000",
    ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    "about:blank",
  ], { stdio: "ignore" });
  const [port] = (await waitForFile(join(profile, "DevToolsActivePort"))).split("\n");
  const endpoint = `http://127.0.0.1:${port}`;
  return {
    endpoint,
    async newPage() {
      const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json();
      const page = new Page(target, endpoint);
      await page.open();
      return page;
    },
    async close() {
      child.kill();
      await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", resolve)));
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    },
  };
}

const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const KEYS = {
  Delete: { code: "Delete", keyCode: 46 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Enter: { code: "Enter", keyCode: 13 },
  Escape: { code: "Escape", keyCode: 27 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
};

export class Page {
  constructor(target, endpoint) {
    this.target = target;
    this.endpoint = endpoint;
    this.nextId = 0;
    this.pending = new Map();
    this.errors = [];
    this.dialogs = [];
    this.listeners = new Set();
  }

  async open() {
    this.socket = new WebSocket(this.target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
        else resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        this.errors.push(details.exception?.description ?? details.text);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
      }
      if (message.method === "Page.javascriptDialogOpening") this.dialogs.push(message.params.type);
      for (const listener of this.listeners) listener(message);
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    await this.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== method) return;
        this.listeners.delete(listener);
        resolve(message.params);
      };
      this.listeners.add(listener);
    });
  }

  async goto(url) {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
  }

  async reload() {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.reload");
    await loaded;
  }

  // Функція виконується на сторінці; аргументи їдуть туди як JSON.
  async evaluate(fn, ...args) {
    const expression = typeof fn === "function" ? `(${fn})(...${JSON.stringify(args)})` : fn;
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async waitFor(fn, { timeout = 10_000, message = "умова не справдилася" } = {}, ...args) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeout) {
      last = await this.evaluate(fn, ...args).catch((error) => error);
      if (last && !(last instanceof Error)) return last;
      await sleep(60);
    }
    throw new Error(`${message} за ${timeout} мс${last instanceof Error ? `: ${last.message}` : ""}`);
  }

  async until(check, { timeout = 10_000, message = "умова не справдилася" } = {}) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeout) {
      try {
        last = await check();
        if (last) return last;
      } catch (error) { last = error; }
      await sleep(60);
    }
    throw new Error(`${message} за ${timeout} мс${last instanceof Error ? `: ${last.message}` : ""}`);
  }

  // Середина елемента, яка справді належить йому, а не сусіду, що лежить згори.
  async pointOf(selector) {
    const point = await this.evaluate((css) => {
      const element = document.querySelector(css);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const tries = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.25], [0.5, 0.75], [0.1, 0.1]];
      for (const [fx, fy] of tries) {
        const x = box.left + box.width * fx;
        const y = box.top + box.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === element || element.contains(hit))) return { x, y };
      }
      return null;
    }, selector);
    if (!point) throw new Error(`Не видно елемента ${selector}`);
    return point;
  }

  async mouse(type, x, y, { button = "left", buttons = 0, modifiers = 0, clickCount = 1 } = {}) {
    await this.send("Input.dispatchMouseEvent", { type, x, y, button, buttons, modifiers, clickCount });
  }

  async click(selector, { button = "left", modifiers = 0 } = {}) {
    const { x, y } = await this.pointOf(selector);
    const mask = { left: 1, right: 2, middle: 4 }[button];
    await this.mouse("mouseMoved", x, y);
    await this.mouse("mousePressed", x, y, { button, buttons: mask, modifiers });
    await this.mouse("mouseReleased", x, y, { button, modifiers });
    return { x, y };
  }

  async clickAt({ x, y }, { button = "left" } = {}) {
    const mask = { left: 1, right: 2, middle: 4 }[button];
    await this.mouse("mouseMoved", x, y);
    await this.mouse("mousePressed", x, y, { button, buttons: mask });
    await this.mouse("mouseReleased", x, y, { button });
  }

  async doubleClick(selector) {
    const { x, y } = await this.pointOf(selector);
    await this.mouse("mousePressed", x, y, { buttons: 1, clickCount: 1 });
    await this.mouse("mouseReleased", x, y, { clickCount: 1 });
    await this.mouse("mousePressed", x, y, { buttons: 1, clickCount: 2 });
    await this.mouse("mouseReleased", x, y, { clickCount: 2 });
  }

  async drag(from, to, { steps = 12 } = {}) {
    await this.mouse("mouseMoved", from.x, from.y);
    await this.mouse("mousePressed", from.x, from.y, { buttons: 1 });
    for (let step = 1; step <= steps; step += 1) {
      await this.mouse("mouseMoved", from.x + (to.x - from.x) * step / steps, from.y + (to.y - from.y) * step / steps, { buttons: 1 });
    }
    await this.mouse("mouseReleased", to.x, to.y);
  }

  async wheel(x, y, deltaY) {
    await this.mouse("mouseMoved", x, y);
    await this.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
  }

  // `combo` — «Delete», «Ctrl+Z», «Ctrl+Shift+Z», «f».
  async press(combo) {
    const parts = combo.split("+");
    const key = parts.pop();
    const modifiers = parts.reduce((mask, name) => mask | MODIFIERS[name.toLowerCase()], 0);
    const named = KEYS[key];
    const letter = key.length === 1 ? key : null;
    const params = {
      key: letter && modifiers & MODIFIERS.shift ? letter.toUpperCase() : key,
      code: named?.code ?? (letter ? `Key${letter.toUpperCase()}` : key),
      windowsVirtualKeyCode: named?.keyCode ?? (letter ? letter.toUpperCase().charCodeAt(0) : 0),
      modifiers,
    };
    if (letter && !(modifiers & (MODIFIERS.ctrl | MODIFIERS.meta))) params.text = letter;
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...params });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
  }

  async type(text) {
    await this.send("Input.insertText", { text });
  }

  async close() {
    await fetch(`${this.endpoint}/json/close/${this.target.id}`).catch(() => {});
    this.socket.close();
  }
}
