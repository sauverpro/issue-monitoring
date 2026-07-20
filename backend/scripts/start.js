/**
 * Production startup script — runs SQL migrations then starts the server.
 * Used by Docker / Fly.io so we don't depend on tsx (dev-only).
 */
import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("⚠ DATABASE_URL not set — skipping migrations");
    return;
  }

  console.log("Running database migrations…");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const dir = join(__dirname, "../migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      console.log(`  ✓ ${file}`);
      await client.query(sql);
    }
    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}

async function start() {
  await migrate();
  // Dynamic import so the server only boots after migrations finish
  await import("../dist/index.js");
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
