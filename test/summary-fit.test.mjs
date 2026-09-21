import assert from "node:assert/strict";
import test from "node:test";
import { SUMMARY_MIN_RATIO, fittingRatio, summaryBoxKey, summaryFontSize } from "../public/summary-fit.js";

// Замість браузера — модель: текст влазить, поки кегль не більший за межу.
function fitsUpTo(limit, calls = []) {
  return (ratio) => {
    calls.push(ratio);
    return ratio <= limit;
  };
}

test("короткий підпис лишається з базовим кеглем і не міряється двічі", () => {
  const calls = [];
  assert.equal(fittingRatio(fitsUpTo(1, calls)), 1);
  assert.deepEqual(calls, [1]);
});

test("довгий підпис зменшується до найбільшого кегля, що ще влазить", () => {
  const ratio = fittingRatio(fitsUpTo(0.7));
  assert.equal(ratio <= 0.7, true);
  // Шість кроків половинного ділення дають похибку не більшу за 1/64.
  assert.equal(ratio > 0.7 - 1 / 64, true);
});

test("нижче за межу читабельності не спускаємось", () => {
  assert.equal(fittingRatio(() => false), SUMMARY_MIN_RATIO);
  assert.equal(fittingRatio(fitsUpTo(0.1)), SUMMARY_MIN_RATIO);
});

test("межу й кількість кроків можна задати свої", () => {
  assert.equal(fittingRatio(() => false, { minRatio: 0.8 }), 0.8);
  // Менше кроків — грубший результат, але він так само влазить.
  assert.equal(fittingRatio(fitsUpTo(0.9), { steps: 1 }), 0.75);
});

test("базовий кегль лишається за стилями, зменшений — в em вузла", () => {
  assert.equal(summaryFontSize(1), "");
  assert.equal(summaryFontSize(0.5), "6.000em");
});

// Головна причина, чому підібране значення можна кешувати й переносити.
test("той самий прямокутник у em дає той самий ключ на будь-якому зумі", () => {
  assert.equal(summaryBoxKey(400, 210, 1, 300), summaryBoxKey(1200, 630, 3, 300));
  assert.equal(summaryBoxKey(400, 210, 1, 300), "400x210:300");
});

test("інші пропорції картки або інша довжина тексту — інший ключ", () => {
  assert.notEqual(summaryBoxKey(400, 210, 1, 300), summaryBoxKey(400, 300, 1, 300));
  assert.notEqual(summaryBoxKey(400, 210, 1, 300), summaryBoxKey(400, 210, 1, 301));
});
