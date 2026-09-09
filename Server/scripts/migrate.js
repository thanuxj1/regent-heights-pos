/**
 * Migration runner.
 *   node scripts/migrate.js            → apply every pending migration
 *   node scripts/migrate.js 003_hotel  → apply one file by name prefix
 *
 * Applied files are recorded in "_migrations" so re-running is safe.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/database.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  const only = process.argv[2];

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "_migrations" (
      name        VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT name FROM "_migrations"');
  const done = new Set(rows.map((r) => r.name));

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (only ? f.startsWith(only) : true))
    .sort();

  if (!files.length) {
    console.log("No migration files found.");
    return;
  }

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) {
      console.log(`• skip    ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query('INSERT INTO "_migrations" (name) VALUES ($1)', [file]);
      await client.query("COMMIT");
      console.log(`✓ applied ${file}`);
      applied++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`✗ FAILED  ${file}`);
      console.error(`  ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(applied ? `\nDone — ${applied} migration(s) applied.` : "\nNothing to do, schema is up to date.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
