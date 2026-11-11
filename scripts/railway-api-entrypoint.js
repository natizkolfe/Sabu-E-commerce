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

function seedDemoKidsImages() {
  // Soft pastel demo cards for seeded kids catalog (writes under MEDIA_ROOT).
  // Skipped when SEED_DEMO_KIDS_IMAGES=0. Real product uploads use products/* and are untouched.
  if (process.env.SEED_DEMO_KIDS_IMAGES === "0") {
    console.log("[railway-api] Skipping demo kids image seed (SEED_DEMO_KIDS_IMAGES=0).");
    return;
  }
  const script = path.join(root, "scripts", "seed_kids_catalog_images.js");
  console.log("[railway-api] Seeding pastel demo/kids catalog images…");
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.warn(
      "[railway-api] Demo kids image seed failed (non-fatal):",
      result.status,
    );
  } else {
    console.log("[railway-api] Demo kids images ready.");
  }
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
seedDemoKidsImages();
startApi();
