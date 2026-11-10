/**
 * Applies packages/db/migrations/*.sql in order against DATABASE_URL / PG*.
 * Usage: node migrate.js [--reset]
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const migrationsDir = path.join(__dirname, "..", "migrations");

function loadEnv() {
  const rootEnv = path.join(__dirname, "..", "..", "..", ".env");
  if (!fs.existsSync(rootEnv)) return;
  for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  loadEnv();
  const reset = process.argv.includes("--reset");
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.PGUSER || "sabu"}:${process.env.PGPASSWORD || "sabu"}@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "sabu"}`,
  });

  await client.connect();

  if (reset) {
    console.log("Resetting public app schemas...");
    await client.query(`
      DROP SCHEMA IF EXISTS audit CASCADE;
      DROP SCHEMA IF EXISTS finance CASCADE;
      DROP SCHEMA IF EXISTS notify CASCADE;
      DROP SCHEMA IF EXISTS delivery CASCADE;
      DROP SCHEMA IF EXISTS payments CASCADE;
      DROP SCHEMA IF EXISTS logistics CASCADE;
      DROP SCHEMA IF EXISTS procurement CASCADE;
      DROP SCHEMA IF EXISTS sales CASCADE;
      DROP SCHEMA IF EXISTS inventory CASCADE;
      DROP SCHEMA IF EXISTS pricing CASCADE;
      DROP SCHEMA IF EXISTS catalog CASCADE;
      DROP SCHEMA IF EXISTS crm CASCADE;
      DROP SCHEMA IF EXISTS iam CASCADE;
      DROP SCHEMA IF EXISTS core CASCADE;
      DROP TABLE IF EXISTS public.schema_migrations;
    `);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = file;
    const { rows } = await client.query(
      "SELECT 1 FROM public.schema_migrations WHERE id = $1",
      [id],
    );
    if (rows.length) {
      console.log(`skip  ${id}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`apply ${id}`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO public.schema_migrations (id) VALUES ($1)",
        [id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`FAILED ${id}`);
      throw err;
    }
  }

  await client.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
