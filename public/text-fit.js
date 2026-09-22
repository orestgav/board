// Текст картки має влазити у відведений йому прямокутник: короткий лишається
// з базовим кеглем, довгий зменшуємо. Саме вимірювання робить сторінка, тут
// лише пошук частки кегля та ключ, яким її кешують.

// Базові кеглі — ті самі, що в .entity-summary і .note-content у стилях.
export const SUMMARY_FONT_EM = 12;
export const NOTE_FONT_EM = 13;
// Поля нотатки — той самий padding, що в .note-content. Праве ширше: воно
// звільняє місце під ручку перетягування.
const NOTE_PADDING_EM = 1.076923;
const NOTE_GUTTER_EM = 3.384615;
// Дрібніше вже не читають, тож нижче не спускаємось: текст радше обріжеться.
export const TEXT_MIN_RATIO = 0.5;
// Залишаємо трохи повітря на округлення браузером розмірів рядків і картки:
// інакше після ресайзу різниця у кілька пікселів може ввімкнути скрол.
export const TEXT_FIT_RESERVE_PX = 2;
const FIT_STEPS = 6;

export function fitsWithReserve(contentSize, viewportSize, reserve = TEXT_FIT_RESERVE_PX) {
  return contentSize <= viewportSize - reserve;
}

export function fittedFontSize(baseEm, ratio) {
  return ratio === 1 ? "" : `${(baseEm * ratio).toFixed(3)}em`;
}

// Поля задані в em самого тексту, тож із іншим кеглем вони поїхали б разом із
// ним: вужчі — і текст поліз би під ручку, ширші — і з'їли б саму нотатку.
// Ділення на частку лишає їх тієї самої ширини, що й з базовим кеглем.
export function notePadding(ratio) {
  if (ratio === 1) return "";
  const side = (NOTE_PADDING_EM / ratio).toFixed(3);
  return `${side}em ${(NOTE_GUTTER_EM / ratio).toFixed(3)}em ${side}em ${side}em`;
}

// Що з тексту впливає на кегль: довжина (скільки рядків він займе) і найдовше
// слово (слова не рвуться всередині себе, тож воно спиняє зростання вшир).
// Двом текстам з однаковою парою пасує й однаковий кегль.
export function textShape(text) {
  const longest = text.split(/\s+/).reduce((maximum, word) => Math.max(maximum, word.length), 0);
  return `${text.length}.${longest}`;
}

// Розкладка картки задана в її власних em, а кегль вузла прив'язаний до його
// розміру (nodeVisualScale), тож у em прямокутник тексту той самий на будь-якому
// зумі. Тому ключ — прямокутник в em і обриси тексту: підібрану частку можна
// брати і для іншої картки з такими ж пропорціями. Рід тексту в ключі теж:
// у підпису й нотатки різні поля та базовий кегль, тож частка в них не спільна.
export function fitBoxKey(kind, width, height, fontSize, shape) {
  return `${kind}:${Math.round(width / fontSize)}x${Math.round(height / fontSize)}:${shape}`;
}

// Найбільша частка базового кегля, за якої fits(ratio) ще справджується.
// Підпис картки більший за базовий не буває (maxRatio 1), нотатка — буває:
// вона тягнеться, доки текст не впреться в межі картки.
export function fittingRatio(fits, { steps = FIT_STEPS, minRatio = TEXT_MIN_RATIO, maxRatio = 1 } = {}) {
  if (!fits(1)) return narrowed(fits, minRatio, 1, steps);
  if (maxRatio <= 1) return 1;
  // Наскільки можна вирости, наперед невідомо, тож спершу подвоєнням шукаємо
  // кегль, який уже не влазить, — і аж тоді ділимо навпіл проміжок до нього.
  let low = 1;
  let high = maxRatio;
  for (let candidate = 2; candidate < maxRatio; candidate *= 2) {
    if (!fits(candidate)) { high = candidate; break; }
    low = candidate;
  }
  if (high === maxRatio && fits(maxRatio)) return maxRatio;
  return narrowed(fits, low, high, steps);
}

// Половинним діленням, бо кожна перевірка коштує перерахунку розкладки.
function narrowed(fits, low, high, steps) {
  for (let step = 0; step < steps; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}
