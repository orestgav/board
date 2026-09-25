import assert from "node:assert/strict";
import test from "node:test";
import { createThumbnails, wantsFullImage } from "../public/thumbnails.js";

const fakes = (overrides = {}) => {
  const calls = { shrink: [], saved: [] };
  const thumbnails = createThumbnails({
    readCached: async () => null,
    saveCached: async (path, blob) => { calls.saved.push([path, blob]); },
    readOriginal: async (path) => `original:${path}`,
    shrink: async (original, size) => { calls.shrink.push([original, size]); return `${original}@${size}`; },
    toUrl: (blob) => `url:${blob}`,
    ...overrides,
  });
  return { thumbnails, calls };
};

test("the original is wanted once the image is nearly as wide as its thumbnail", () => {
  assert.equal(wantsFullImage(899, 1200), false);
  assert.equal(wantsFullImage(900, 1200), true);
});

test("a thumbnail is shrunk once per path and size", async () => {
  const { thumbnails, calls } = fakes();
  const [first, second] = await Promise.all([thumbnails.url("a.webp", 512), thumbnails.url("a.webp", 512)]);
  assert.equal(first, "url:original:a.webp@512");
  assert.equal(second, first);
  await thumbnails.url("a.webp", 1200);
  assert.deepEqual(calls.shrink, [["original:a.webp", 512], ["original:a.webp", 1200]]);
});

test("originals are shrunk one at a time", async () => {
  let running = 0;
  let peak = 0;
  const { thumbnails } = fakes({
    shrink: async (original) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return original;
    },
  });
  await Promise.all(["a", "b", "c"].map((path) => thumbnails.url(path, 512)));
  assert.equal(peak, 1);
});

test("a persisted thumbnail comes from the cache or is saved there", async () => {
  const cached = fakes({ readCached: async (path) => (path === "hit.webp" ? "cached" : null) });
  assert.equal(await cached.thumbnails.url("hit.webp", 1200, { persist: true }), "url:cached");
  assert.deepEqual(cached.calls.shrink, []);

  assert.equal(await cached.thumbnails.url("miss.webp", 1200, { persist: true }), "url:original:miss.webp@1200");
  assert.deepEqual(cached.calls.saved, [["miss.webp", "original:miss.webp@1200"]]);

  await cached.thumbnails.url("portrait.webp", 512);
  assert.equal(cached.calls.saved.length, 1);
});

test("a failed thumbnail is retried on the next request and does not stall the queue", async () => {
  let attempts = 0;
  const { thumbnails } = fakes({
    readOriginal: async (path) => {
      if (path === "broken.webp" && (attempts += 1) === 1) throw new Error("read failed");
      return path;
    },
  });
  await assert.rejects(thumbnails.url("broken.webp", 512), /read failed/);
  assert.equal(await thumbnails.url("fine.webp", 512), "url:fine.webp@512");
  assert.equal(await thumbnails.url("broken.webp", 512), "url:broken.webp@512");
});
