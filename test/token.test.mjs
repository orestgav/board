import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TOKEN_COLOR, TOKEN_COLORS, tokenColor, tokenInitial, tokenInk, writeTokenColor } from "../public/token.js";

test("token palette offers twenty distinct colors with red first", () => {
  assert.equal(TOKEN_COLORS.length, 20);
  assert.equal(new Set(TOKEN_COLORS.map(([color]) => color)).size, 20);
  assert.equal(DEFAULT_TOKEN_COLOR, "#c0392b");
});

test("token color is stored only when it differs from the default", () => {
  const node = {};
  writeTokenColor(node, "#2c55b3");
  assert.equal(node.color, "#2c55b3");
  writeTokenColor(node, DEFAULT_TOKEN_COLOR);
  assert.equal("color" in node, false);
  assert.equal(tokenColor({ color: "not-a-color" }), DEFAULT_TOKEN_COLOR);
});

test("token initial takes the first letter of the name", () => {
  assert.equal(tokenInitial("вовк-перевертень"), "В");
  assert.equal(tokenInitial("  «Тінь»"), "Т");
  assert.equal(tokenInitial(""), "?");
});

test("token ink contrasts with the ring color", () => {
  assert.equal(tokenInk("#ece6da"), "#1d1a17");
  assert.equal(tokenInk("#24336e"), "#fff8eb");
});
