/**
 * Railway API entrypoint (Option C):
 * 1) Apply SQL migrations against private DATABASE_URL
 * 2) Start the NestJS API
 *
 * Keep this file at repo root so the Docker image always has migrate + start together.
 */
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");

function runMigrate() {
  console.log("[railway-api] Running database migrations…");
  const result = spawnSync(
    process.execPath,
    [path.join(root, "packages", "db", "scripts", "migrate.js")],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    console.error("[railway-api] Migrations failed — refusing to start API.");
    process.exit(result.status ?? 1);
  }
  console.log("[railway-api] Migrations OK.");
}

function startApi() {
  const mainJs = path.join(root, "apps", "api", "dist", "main.js");
  console.log(`[railway-api] Starting API: ${mainJs}`);
  const child = spawn(process.execPath, [mainJs], {
    cwd: path.join(root, "apps", "api"),
    env: process.env,
    stdio: "inherit",
  });

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGINT", () => forward("SIGINT"));

  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}

runMigrate();
startApi();
