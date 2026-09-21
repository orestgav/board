import assert from "node:assert/strict";
import test from "node:test";
import { NOTE_FONT_EM, SUMMARY_FONT_EM, TEXT_MIN_RATIO, fitBoxKey, fittedFontSize, fittingRatio, noteGutter } from "../public/text-fit.js";

// Замість браузера — модель: текст влазить, поки кегль не більший за межу.
function fitsUpTo(limit, calls = []) {
  return (ratio) => {
    calls.push(ratio);
    return ratio <= limit;
  };
}

test("короткий текст лишається з базовим кеглем і не міряється двічі", () => {
  const calls = [];
  assert.equal(fittingRatio(fitsUpTo(1, calls)), 1);
  assert.deepEqual(calls, [1]);
});

test("довгий текст зменшується до найбільшого кегля, що ще влазить", () => {
  const ratio = fittingRatio(fitsUpTo(0.7));
  assert.equal(ratio <= 0.7, true);
  // Шість кроків половинного ділення дають похибку не більшу за 1/64.
  assert.equal(ratio > 0.7 - 1 / 64, true);
});

test("нижче за межу читабельності не спускаємось", () => {
  assert.equal(fittingRatio(() => false), TEXT_MIN_RATIO);
  assert.equal(fittingRatio(fitsUpTo(0.1)), TEXT_MIN_RATIO);
});

test("межу й кількість кроків можна задати свої", () => {
  assert.equal(fittingRatio(() => false, { minRatio: 0.8 }), 0.8);
  // Менше кроків — грубший результат, але він так само влазить.
  assert.equal(fittingRatio(fitsUpTo(0.9), { steps: 1 }), 0.75);
});

test("базовий кегль лишається за стилями, зменшений — в em вузла", () => {
  assert.equal(fittedFontSize(SUMMARY_FONT_EM, 1), "");
  assert.equal(fittedFontSize(SUMMARY_FONT_EM, 0.5), "6.000em");
  // У нотатки свій базовий кегль, тож та сама частка дає інший розмір.
  assert.equal(fittedFontSize(NOTE_FONT_EM, 0.5), "6.500em");
});

// Ручка перетягування не зменшується разом із текстом, тож і поле під неї — ні.
test("поле під ручку лишається тієї самої ширини попри дрібніший кегль", () => {
  assert.equal(noteGutter(1), "");
  assert.equal(noteGutter(0.5), "6.769em");
});

// Головна причина, чому підібране значення можна кешувати й переносити.
test("той самий прямокутник у em дає той самий ключ на будь-якому зумі", () => {
  assert.equal(fitBoxKey("summary", 400, 210, 1, 300), fitBoxKey("summary", 1200, 630, 3, 300));
  assert.equal(fitBoxKey("summary", 400, 210, 1, 300), "summary:400x210:300");
});

test("інші пропорції картки, інша довжина тексту або інший його рід — інший ключ", () => {
  assert.notEqual(fitBoxKey("summary", 400, 210, 1, 300), fitBoxKey("summary", 400, 300, 1, 300));
  assert.notEqual(fitBoxKey("summary", 400, 210, 1, 300), fitBoxKey("summary", 400, 210, 1, 301));
  // Підпис і нотатка міряються в різних полях, тож частку між ними не переносимо.
  assert.notEqual(fitBoxKey("summary", 400, 210, 1, 300), fitBoxKey("note", 400, 210, 1, 300));
});
