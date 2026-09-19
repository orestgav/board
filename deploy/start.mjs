import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { startServer } from "../src/server.mjs";

const repository = process.env.BOARD_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const authPassword = process.env.BOARD_AUTH_PASSWORD;
const branch = process.env.BOARD_BRANCH || "main";
const dataRoot = resolve(process.env.BOARD_DATA_DIR || "/data");
const campaignRoot = join(dataRoot, "campaign");

if (!repository) throw new Error("Потрібна змінна BOARD_REPOSITORY, наприклад orestgav/crown");
if (!token) throw new Error("Потрібна змінна GITHUB_TOKEN");
if (!authPassword) throw new Error("Потрібна змінна BOARD_AUTH_PASSWORD");

const credential = Buffer.from(`x-access-token:${token}`).toString("base64");
const gitEnvironment = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: `Authorization: Basic ${credential}`,
};

function git(args, { cwd = campaignRoot, accepted = [0] } = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn("git", args, { cwd, env: gitEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (accepted.includes(code)) resolveCommand({ code, stdout, stderr });
      else reject(new Error(`git ${args[0]} завершився з кодом ${code}: ${stderr || stdout}`));
    });
  });
}

await mkdir(dataRoot, { recursive: true });
try {
  await access(join(campaignRoot, ".git"));
  await git(["pull", "--ff-only", "origin", branch]);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await git(["clone", "--branch", branch, `https://github.com/${repository}.git`, campaignRoot], { cwd: dataRoot });
}

await git(["lfs", "install", "--local"]);
await git(["config", "user.name", process.env.BOARD_GIT_USER_NAME || "Crown Board"]);
await git(["config", "user.email", process.env.BOARD_GIT_USER_EMAIL || "crown-board@users.noreply.github.com"]);

async function beforeMutation() {
  await git(["pull", "--ff-only", "origin", branch]);
}

async function afterMutation(paths, message) {
  const relativePaths = paths.map((path) => relative(campaignRoot, path));
  await git(["add", "--", ...relativePaths]);
  const diff = await git(["diff", "--cached", "--quiet"], { accepted: [0, 1] });
  if (diff.code === 0) return;
  await git(["commit", "-m", message]);
  await git(["push", "origin", `HEAD:${branch}`]);
}

const { url } = await startServer({
  base: campaignRoot,
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 4173),
  auth: { user: process.env.BOARD_AUTH_USER || "dm", password: authPassword },
  beforeMutation,
  afterMutation,
});

console.log(`Crown Board deployment listening on ${url}`);
