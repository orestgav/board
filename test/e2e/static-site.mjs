// Лише статика public/, як на GitHub Pages: /api/health тут 404, тож канва
// працює в режимі теки.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

export async function staticSite() {
  const server = createServer(async (request, response) => {
    const path = resolve(PUBLIC, `.${new URL(request.url, "http://x").pathname.replace(/\/$/, "/index.html")}`);
    try {
      if (!path.startsWith(PUBLIC + sep) || !(await stat(path)).isFile()) throw new Error();
      response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
