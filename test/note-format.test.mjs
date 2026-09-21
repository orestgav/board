import assert from "node:assert/strict";
import test from "node:test";
import { noteMarkup, toggleBold } from "../public/note-format.js";

// Заміну зручніше читати як готовий текст, тож у перевірках її одразу й кладемо.
function applied(text, start, end) {
  const change = toggleBold(text, start, end);
  const next = text.slice(0, change.start) + change.text + text.slice(change.end);
  return { text: next, selected: next.slice(change.selectionStart, change.selectionEnd) };
}

test("вибране береться в зірочки, а вибір лишається на тому самому слові", () => {
  const { text, selected } = applied("ключ у трактирника", 0, 4);
  assert.equal(text, "**ключ** у трактирника");
  assert.equal(selected, "ключ");
});

test("вибір разом із зірочками знімає їх", () => {
  const { text, selected } = applied("**ключ** у трактирника", 0, 8);
  assert.equal(text, "ключ у трактирника");
  assert.equal(selected, "ключ");
});

test("вибір по саме слово знімає зірочки з-за країв", () => {
  const { text, selected } = applied("**ключ** у трактирника", 2, 6);
  assert.equal(text, "ключ у трактирника");
  assert.equal(selected, "ключ");
});

test("жирним стає лише вибране, а не сусіднє жирне слово", () => {
  const { text } = applied("**ключ** у трактирника", 11, 22);
  assert.equal(text, "**ключ** у **трактирника**");
});

test("порожній вибір лишає каретку між зірочками", () => {
  const change = toggleBold("ключ ", 5, 5);
  assert.equal(change.text, "****");
  assert.equal(change.selectionStart, 7);
  assert.equal(change.selectionEnd, 7);
});

// Пара зірочок сама собою ще не жирний текст: знімати з неї нічого, тож
// вибір із самих зірочок їх лише додає.
test("самі зірочки без тексту всередині не вважаються жирним", () => {
  const { text } = applied("**", 0, 2);
  assert.equal(text, "******");
});

test("нотатка показує жирний, а решту лишає як набрали", () => {
  assert.equal(noteMarkup("**ключ** у трактирника"), "<strong>ключ</strong> у трактирника");
  // Одна зірочка пари не складає — лишається символом.
  assert.equal(noteMarkup("3 * 4"), "3 * 4");
  // Заголовки, списки й посилання в нотатці лишаються текстом.
  assert.equal(noteMarkup("# не заголовок"), "# не заголовок");
});

test("розмітку з тексту нотатки не пускаємо у вивід", () => {
  assert.equal(noteMarkup("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(noteMarkup("**<b>ключ</b>**"), "<strong>&lt;b&gt;ключ&lt;/b&gt;</strong>");
});
