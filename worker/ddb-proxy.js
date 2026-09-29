// Cloudflare Worker: посередник між дошкою і D&D Beyond. DDB не віддає
// CORS-заголовків, тож браузер сам лист персонажа не прочитає. Worker лише
// пересилає GET /character/<id> на character-service і додає CORS для
// дозволених адрес дошки. Нічого не зберігає й не бачить приватних листів:
// сервіс віддає тільки публічні.
//
// Змінна середовища ALLOWED_ORIGINS (необовʼязкова) — адреси через кому.

const DDB_CHARACTER_URL = "https://character-service.dndbeyond.com/character/v5/character/";
const DEFAULT_ORIGINS = ["https://orestgav.github.io", "http://127.0.0.1:4173", "http://localhost:4173"];
const CHARACTER_PATH = /^\/character\/(\d{1,12})$/;

function allowedOrigins(env) {
  const configured = String(env?.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_ORIGINS;
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function reply(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!origin || !allowedOrigins(env).includes(origin)) return reply(403, { error: "origin" });
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return reply(405, { error: "method" }, cors);
    const match = CHARACTER_PATH.exec(new URL(request.url).pathname);
    if (!match) return reply(404, { error: "path" }, cors);
    let upstream;
    try {
      upstream = await fetch(`${DDB_CHARACTER_URL}${match[1]}`, {
        headers: { accept: "application/json", "user-agent": "crown-board-ddb-proxy" },
      });
    } catch {
      return reply(502, { error: "upstream" }, cors);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors },
    });
  },
};
