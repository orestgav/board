import assert from "node:assert/strict";
import test from "node:test";
import { pathParts, revisionOf, webPName } from "../public/storage.js";

test("local storage paths cannot escape the selected campaign", () => {
  assert.deepEqual(pathParts("board/canvas.json"), ["board", "canvas.json"]);
  assert.throws(() => pathParts("../secret.md"), /Небезпечний шлях/);
  assert.throws(() => pathParts("C:\\secret.md"), /Небезпечний шлях/);
});

test("dropped file names become safe WebP names", () => {
  assert.equal(webPName("Карта світу.png"), "Карта світу.webp");
  assert.equal(webPName("bad:name?.jpg"), "bad-name-.webp");
});

test("layout revisions are stable and content-sensitive", async () => {
  assert.equal(await revisionOf("same"), await revisionOf("same"));
  assert.notEqual(await revisionOf("same"), await revisionOf("other"));
});
