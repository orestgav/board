import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/ddb-proxy.js";

const BOARD = "https://orestgav.github.io";

async function call(path, { origin = BOARD, method = "GET", env = {}, upstream } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (upstream instanceof Error) throw upstream;
    return upstream ?? new Response(JSON.stringify({ success: true, data: { id: 1 } }), { status: 200 });
  };
  try {
    const headers = origin ? { Origin: origin } : {};
    const response = await worker.fetch(new Request(`https://proxy.example${path}`, { method, headers }), env);
    return { response, calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("пересилає лист персонажа й додає CORS для дошки", async () => {
  const { response, calls } = await call("/character/153354937");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), BOARD);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { success: true, data: { id: 1 } });
  assert.equal(calls[0].url, "https://character-service.dndbeyond.com/character/v5/character/153354937");
});

test("чужі адреси й запити без Origin відхиляє, у DDB не ходить", async () => {
  for (const origin of ["https://evil.example", null]) {
    const { response, calls } = await call("/character/1", { origin });
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  }
});

test("ALLOWED_ORIGINS замінює типовий список", async () => {
  const env = { ALLOWED_ORIGINS: "https://my.board, http://127.0.0.1:9000" };
  assert.equal((await call("/character/1", { origin: "https://my.board", env })).response.status, 200);
  assert.equal((await call("/character/1", { origin: BOARD, env })).response.status, 403);
});

test("preflight, інші методи й шляхи", async () => {
  const preflight = await call("/character/1", { method: "OPTIONS" });
  assert.equal(preflight.response.status, 204);
  assert.match(preflight.response.headers.get("access-control-allow-methods"), /GET/);
  assert.equal((await call("/character/1", { method: "POST" })).response.status, 405);
  for (const path of ["/character/abc", "/character/1/extra", "/", "/character/"]) {
    const { response, calls } = await call(path);
    assert.equal(response.status, 404, path);
    assert.equal(calls.length, 0);
  }
});

test("статус DDB передає як є (приватний лист — 403), збій мережі — 502", async () => {
  const privateSheet = await call("/character/2", { upstream: new Response("{}", { status: 403 }) });
  assert.equal(privateSheet.response.status, 403);
  assert.equal(privateSheet.response.headers.get("access-control-allow-origin"), BOARD);
  const down = await call("/character/2", { upstream: new Error("offline") });
  assert.equal(down.response.status, 502);
});
