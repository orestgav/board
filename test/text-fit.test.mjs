import assert from "node:assert/strict";
import test from "node:test";
import { NOTE_FONT_EM, SUMMARY_FONT_EM, TEXT_FIT_RESERVE_RATIO, TEXT_MIN_RATIO, fitBoxKey, fittedFontSize, fittingRatio, notePadding, reservedFitRatio, textShape } from "../public/text-fit.js";

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

test("нотатка росте, поки текст влазить у картку", () => {
  const ratio = fittingRatio(fitsUpTo(3), { maxRatio: 8 });
  assert.equal(ratio <= 3, true);
  // Проміжок [2; 4] за шість кроків звужується до 1/32.
  assert.equal(ratio > 3 - 1 / 32, true);
});

test("рости вище за межу картки нема куди", () => {
  // Текст влазить і більшим, але вище стелі один рядок уже не поміщається.
  assert.equal(fittingRatio(fitsUpTo(10), { maxRatio: 4 }), 4);
});

test("зростання шукають подвоєнням, а не перебором до стелі", () => {
  const calls = [];
  fittingRatio(fitsUpTo(2.5, calls), { maxRatio: 64 });
  assert.deepEqual(calls.slice(0, 3), [1, 2, 4]);
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

test("підібраний граничний кегль отримує малий запас від мікроскролу", () => {
  assert.equal(TEXT_FIT_RESERVE_RATIO, 0.99);
  assert.equal(reservedFitRatio(2), 1.98);
  assert.equal(reservedFitRatio(0.8), 0.792);
  assert.equal(reservedFitRatio(TEXT_MIN_RATIO), TEXT_MIN_RATIO);
  // Базовий кегль короткого тексту без потреби не зменшуємо.
  assert.equal(reservedFitRatio(1), 1);
});

test("базовий кегль лишається за стилями, зменшений — в em вузла", () => {
  assert.equal(fittedFontSize(SUMMARY_FONT_EM, 1), "");
  assert.equal(fittedFontSize(SUMMARY_FONT_EM, 0.5), "6.000em");
  // У нотатки свій базовий кегль, тож та сама частка дає інший розмір.
  assert.equal(fittedFontSize(NOTE_FONT_EM, 0.5), "6.500em");
});

// Ручка перетягування не міняє розміру разом із текстом, тож і поля — ні.
test("поля нотатки лишаються ті самі за будь-якого кегля", () => {
  assert.equal(notePadding(1), "");
  assert.equal(notePadding(0.5), "2.154em 6.769em 2.154em 2.154em");
  assert.equal(notePadding(2), "0.538em 1.692em 0.538em 0.538em");
});

test("обриси тексту — це його довжина й найдовше слово", () => {
  assert.equal(textShape("ключ у трактирника"), "18.11");
  // Тексти однакової довжини, але з різним найдовшим словом, не рівня одне
  // одному: широке слово спиняє зростання раніше.
  assert.notEqual(textShape("ключ у трактирника"), textShape("трактирниковіключ."));
  assert.equal(textShape(""), "0.0");
});

test("переноси рядків рахуються як пробіли", () => {
  assert.equal(textShape("ключ\nу трактирника"), textShape("ключ у трактирника"));
});

// Головна причина, чому підібране значення можна кешувати й переносити.
test("той самий прямокутник у em дає той самий ключ на будь-якому зумі", () => {
  assert.equal(fitBoxKey("summary", 400, 210, 1, "300.9"), fitBoxKey("summary", 1200, 630, 3, "300.9"));
  assert.equal(fitBoxKey("summary", 400, 210, 1, "300.9"), "summary:400x210:300.9");
});

test("інші пропорції картки, інші обриси тексту або інший його рід — інший ключ", () => {
  assert.notEqual(fitBoxKey("summary", 400, 210, 1, "300.9"), fitBoxKey("summary", 400, 300, 1, "300.9"));
  assert.notEqual(fitBoxKey("summary", 400, 210, 1, "300.9"), fitBoxKey("summary", 400, 210, 1, "301.9"));
  // Підпис і нотатка міряються в різних полях, тож частку між ними не переносимо.
  assert.notEqual(fitBoxKey("summary", 400, 210, 1, "300.9"), fitBoxKey("note", 400, 210, 1, "300.9"));
});
