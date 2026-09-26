import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { parseArgs } from "../canvas.mjs";

test("the campaign path is required and resolved to an absolute path", () => {
  assert.throws(() => parseArgs([]), /--base/);
  assert.equal(parseArgs(["--base", "../dnd-campaign"]).base, resolve("../dnd-campaign"));
});

test("host and port have safe defaults and can be overridden", () => {
  const defaults = parseArgs(["--base", "."]);
  assert.equal(defaults.host, process.env.HOST || "127.0.0.1");
  assert.equal(defaults.port, Number(process.env.PORT || 4173));
  const custom = parseArgs(["--base", ".", "--host", "0.0.0.0", "--port", "0"]);
  assert.equal(custom.host, "0.0.0.0");
  assert.equal(custom.port, 0);
});

test("a broken port or an unknown flag is refused", () => {
  assert.throws(() => parseArgs(["--base", ".", "--port", "abc"]), /--port/);
  assert.throws(() => parseArgs(["--base", ".", "--port", "70000"]), /--port/);
  assert.throws(() => parseArgs(["--base", ".", "--verbose"]), /Невідомий аргумент/);
});

test("help does not need a campaign", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});
