// Підпис картки має влазити у відведений йому прямокутник: короткий лишається
// з базовим кеглем, довгий зменшуємо. Саме вимірювання робить сторінка, тут
// лише пошук частки кегля та ключ, яким її кешують.

// Базовий кегль — той самий, що в .entity-summary у стилях.
export const SUMMARY_FONT_EM = 12;
// Дрібніше вже не читають, тож нижче не спускаємось: текст радше обріжеться.
export const SUMMARY_MIN_RATIO = 0.5;
const FIT_STEPS = 6;

export function summaryFontSize(ratio) {
  return ratio < 1 ? `${(SUMMARY_FONT_EM * ratio).toFixed(3)}em` : "";
}

// Розкладка картки задана в її власних em, а кегль вузла прив'язаний до його
// розміру (nodeVisualScale), тож у em прямокутник тексту той самий на будь-якому
// зумі. Тому ключ — прямокутник в em і довжина тексту: підібрану частку можна
// брати і для іншої картки з такими ж пропорціями.
export function summaryBoxKey(width, height, fontSize, length) {
  return `${Math.round(width / fontSize)}x${Math.round(height / fontSize)}:${length}`;
}

// Найбільша частка базового кегля, за якої fits(ratio) ще справджується.
// Половинним діленням, бо кожна перевірка коштує перерахунку розкладки.
export function fittingRatio(fits, { steps = FIT_STEPS, minRatio = SUMMARY_MIN_RATIO } = {}) {
  if (fits(1)) return 1;
  let low = minRatio;
  let high = 1;
  for (let step = 0; step < steps; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}
