// Текст картки має влазити у відведений йому прямокутник: короткий лишається
// з базовим кеглем, довгий зменшуємо. Саме вимірювання робить сторінка, тут
// лише пошук частки кегля та ключ, яким її кешують.

// Базові кеглі — ті самі, що в .entity-summary і .note-content у стилях.
export const SUMMARY_FONT_EM = 12;
export const NOTE_FONT_EM = 13;
// Поле праворуч у нотатці — той самий padding-right, що в .note-content: воно
// звільняє місце під ручку перетягування, а та живе в em вузла, не тексту.
const NOTE_GUTTER_EM = 3.384615;
// Дрібніше вже не читають, тож нижче не спускаємось: текст радше обріжеться.
export const TEXT_MIN_RATIO = 0.5;
const FIT_STEPS = 6;

export function fittedFontSize(baseEm, ratio) {
  return ratio < 1 ? `${(baseEm * ratio).toFixed(3)}em` : "";
}

// Дрібніший кегль зменшив би й поле під ручку, бо воно задане в em тексту, —
// тож повертаємо йому ту саму ширину, яку воно мало з базовим кеглем.
export function noteGutter(ratio) {
  return ratio < 1 ? `${(NOTE_GUTTER_EM / ratio).toFixed(3)}em` : "";
}

// Розкладка картки задана в її власних em, а кегль вузла прив'язаний до його
// розміру (nodeVisualScale), тож у em прямокутник тексту той самий на будь-якому
// зумі. Тому ключ — прямокутник в em і довжина тексту: підібрану частку можна
// брати і для іншої картки з такими ж пропорціями. Рід тексту в ключі теж:
// у підпису й нотатки різні поля та базовий кегль, тож частка в них не спільна.
export function fitBoxKey(kind, width, height, fontSize, length) {
  return `${kind}:${Math.round(width / fontSize)}x${Math.round(height / fontSize)}:${length}`;
}

// Найбільша частка базового кегля, за якої fits(ratio) ще справджується.
// Половинним діленням, бо кожна перевірка коштує перерахунку розкладки.
export function fittingRatio(fits, { steps = FIT_STEPS, minRatio = TEXT_MIN_RATIO } = {}) {
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
