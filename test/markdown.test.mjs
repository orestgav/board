import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, renderInline, renderMarkdown } from "../public/markdown.js";

test("розмітка з картки не може внести свій HTML", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(renderMarkdown("<img src=x onerror=alert(1)>"), "<p>&lt;img src=x onerror=alert(1)&gt;</p>");
});

test("рядкове форматування: жирний, курсив, код, закреслення", () => {
  assert.equal(renderInline("**Пекар** тримає *місто*"), "<strong>Пекар</strong> тримає <em>місто</em>");
  assert.equal(renderInline("`code` і ~~старе~~"), "<code>code</code> і <del>старе</del>");
  assert.equal(renderInline("`**не жирний**`"), "<code>**не жирний**</code>");
});

test("посилання кампанії стають підписами, зовнішні — лінками", () => {
  assert.equal(renderInline("живе в [[arven]]"), 'живе в <span class="md-link">arven</span>');
  assert.equal(renderInline("[[arven|Арвені]]"), '<span class="md-link">Арвені</span>');
  assert.equal(renderInline("[[arven#Влада]]"), '<span class="md-link">arven</span>');
  assert.equal(
    renderInline("[правила](https://example.com/a)"),
    '<a href="https://example.com/a" target="_blank" rel="noreferrer noopener">правила</a>',
  );
  assert.equal(renderInline("[сусід](../npcs/barni.md)"), "сусід");
  assert.equal(renderInline("![Пекар](../../_media/npcs/pekar.webp)"), "");
});

test("javascript-посилання не стає лінком", () => {
  assert.equal(renderInline("[тиць](javascript:alert(1))"), "тиць");
});

test("заголовки опускаються на рівень нижче за назву картки", () => {
  assert.equal(renderMarkdown("## Хто це"), "<h3>Хто це</h3>");
  assert.equal(renderMarkdown("# Картка"), "<h2>Картка</h2>");
});

test("списки збираються в один блок і підтримують вкладеність", () => {
  assert.equal(renderMarkdown("- перше\n- друге"), "<ul><li>перше</li><li>друге</li></ul>");
  assert.equal(renderMarkdown("1. перше\n2. друге"), "<ol><li>перше</li><li>друге</li></ol>");
  assert.equal(
    renderMarkdown("- місто\n  - район\n- порт"),
    "<ul><li>місто<ul><li>район</li></ul></li><li>порт</li></ul>",
  );
});

test("Obsidian-callout стає окремим блоком зі своїм заголовком", () => {
  assert.equal(
    renderMarkdown("> [!danger] DM-ONLY: що в листі\n> Пише про **повстання**."),
    '<div class="md-callout" data-callout="danger"><p class="md-callout-title">DM-ONLY: що в листі</p>'
    + "<p>Пише про <strong>повстання</strong>.</p></div>",
  );
  assert.equal(
    renderMarkdown("> [!note]\n> Просто нотатка."),
    '<div class="md-callout" data-callout="note"><p class="md-callout-title">note</p><p>Просто нотатка.</p></div>',
  );
});

test("звичайна цитата лишається цитатою", () => {
  assert.equal(renderMarkdown("> Три назви одного."), "<blockquote><p>Три назви одного.</p></blockquote>");
});

test("таблиця зберігає шапку й вирівнювання", () => {
  const source = "| Позиція | Ціна |\n| --- | ---: |\n| **Молот** | 249.9 |";
  assert.equal(
    renderMarkdown(source),
    "<table><thead><tr><th>Позиція</th><th style=\"text-align:right\">Ціна</th></tr></thead>"
    + "<tbody><tr><td><strong>Молот</strong></td><td style=\"text-align:right\">249.9</td></tr></tbody></table>",
  );
});

test("сусідні рядки абзацу склеюються, блоки розділяються", () => {
  assert.equal(renderMarkdown("Перший рядок\nдругий рядок"), "<p>Перший рядок другий рядок</p>");
  assert.equal(renderMarkdown("Абзац\n\n## Секція\n\n- пункт"), "<p>Абзац</p><h3>Секція</h3><ul><li>пункт</li></ul>");
  assert.equal(renderMarkdown("---"), "<hr>");
  assert.equal(renderMarkdown(""), "");
});
