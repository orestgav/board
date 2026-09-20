import assert from "node:assert/strict";
import test from "node:test";
import { canonicalYouTubeUrl, musicTitle, oEmbedUrl, playbackUrl, youTubeListId, youTubeVideoId } from "../public/music.js";

test("ідентифікатор ролика читається з усіх звичних виглядів лінка", () => {
  const forms = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    "youtube.com/watch?v=dQw4w9WgXcQ",
  ];
  for (const form of forms) assert.equal(youTubeVideoId(form), "dQw4w9WgXcQ", form);
});

test("не-ютубні та побиті лінки не стають карткою", () => {
  for (const form of ["", "   ", "не лінк", "https://vimeo.com/76979871", "https://youtube.com/watch?v=short", "https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ"]) {
    assert.equal(youTubeVideoId(form), null, form);
    assert.equal(canonicalYouTubeUrl(form), null, form);
  }
});

test("канонічний лінк однаковий для всіх джерел і тягне за собою плейліст", () => {
  assert.equal(canonicalYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=90"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(
    canonicalYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890&index=3"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890",
  );
  assert.equal(youTubeListId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=../secret"), null);
});

test("кнопка «плей» завжди веде на нульову позначку часу", () => {
  const started = playbackUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=214s&start=99&time_continue=30");
  const parameters = new URL(started).searchParams;
  assert.equal(parameters.get("v"), "dQw4w9WgXcQ");
  assert.equal(parameters.get("t"), "0s");
  assert.equal(parameters.get("start"), "0");
  assert.equal(parameters.get("time_continue"), null);
  assert.equal(playbackUrl("не лінк"), null);
});

test("картка лишається підписаною навіть без назви з ютуба", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  assert.equal(musicTitle("  Тема\nтаверни  ", url), "Тема таверни");
  assert.equal(musicTitle("", url), "dQw4w9WgXcQ");
  assert.equal(musicTitle(undefined, "не лінк"), "Трек");
  assert.equal(oEmbedUrl(url), `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
});
