// Нотатки лежать у репозиторії як Markdown, тож «жирний» у них — це ті самі
// дві зірочки. Тут дві дії над ними: що робить кнопка з вибраним шматком і
// як цей шматок показати вже без зірочок.
import { escapeHtml } from "./markdown.js";

const BOLD = "**";

// З усієї розмітки нотатка показує лише жирний: решта — звичайний текст, як
// його набрали. Зірочки, що не склали пару, теж лишаються на видноті.
export function noteMarkup(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// Вибране стає жирним, а вже жирне — звичайним. Віддаємо не готовий текст, а
// одну заміну — рівно те, що приймає textarea.setRangeText: так за кнопкою
// лишається звичайне скасування, а не переписане поле.
export function toggleBold(text, start, end) {
  const inside = text.slice(start, end);
  // «**слово**» виділяють і по саме слово, і разом із зірочками, тож знімати
  // їх доводиться і зсередини виділення, і з-за його країв.
  if (inside.length > BOLD.length * 2 - 1 && inside.startsWith(BOLD) && inside.endsWith(BOLD)) {
    return replacement(start, end, inside.slice(BOLD.length, -BOLD.length));
  }
  if (start >= BOLD.length
    && text.slice(start - BOLD.length, start) === BOLD
    && text.slice(end, end + BOLD.length) === BOLD) {
    return replacement(start - BOLD.length, end + BOLD.length, inside);
  }
  // Порожнє виділення — це пара зірочок із кареткою між ними: далі набирають
  // уже жирним.
  const wrapped = `${BOLD}${inside}${BOLD}`;
  return { start, end, text: wrapped, selectionStart: start + BOLD.length, selectionEnd: end + BOLD.length };
}

function replacement(start, end, text) {
  return { start, end, text, selectionStart: start, selectionEnd: start + text.length };
}
