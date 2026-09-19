#!/usr/bin/env node

import { resolve } from "node:path";
import { startServer } from "./src/server.mjs";

export function parseArgs(args) {
  const options = {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 4173),
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--base") options.base = args[++index];
    else if (argument === "--host") options.host = args[++index];
    else if (argument === "--port") options.port = Number(args[++index]);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Невідомий аргумент: ${argument}`);
  }

  if (!options.help && !options.base) throw new Error("Потрібен шлях до кампанії: --base <path>");
  if (!options.help && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new Error("--port має бути цілим числом від 0 до 65535");
  }
  if (options.base) options.base = resolve(options.base);
  return options;
}

function usage() {
  return [
    "Crown Board",
    "",
    "  node canvas.mjs --base ../crown [--port 4173]",
    "",
    "Опції:",
    "  --base <path>  корінь репозиторію кампанії",
    "  --host <host>  адреса сервера (типово 127.0.0.1)",
    "  --port <port>  порт сервера (0 — вибрати вільний)",
  ].join("\n");
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const { server, url } = await startServer(options);
    console.log(`Crown Board: ${url}`);
    console.log(`Кампанія: ${options.base}`);
    const stop = () => server.close(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    console.error(`Помилка: ${error.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  await main();
}
