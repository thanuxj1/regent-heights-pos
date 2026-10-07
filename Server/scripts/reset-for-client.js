/**
 * Hand the system to a new client: delete everything except the super-admin
 * login(s) and the role definitions.
 *
 *   node scripts/reset-for-client.js             -> DRY RUN: lists what would go, changes nothing
 *   node scripts/reset-for-client.js --confirm   -> does it (one transaction: all or nothing)
 *
 * KEPT:    "User" rows with role_id = 6 (super admin), Role, _migrations
 *          (the app's record of its own schema).
 * DELETED: every other user, every company and branch, and all data — orders,
 *          bookings, guests, customers, menu, rooms, tables, stock, suppliers,
 *          expenses, drawer records, logs, settings.
 *
 * After it runs, sign in as the super admin and create the client's company,
 * branch and staff from scratch.
 *
 * Take a backup first (pg_dump) — this cannot be undone.
 */
import "dotenv/config";
import pool from "../config/database.js";

const SUPER_ADMIN_ROLE = 6;
const KEEP_WHOLE = new Set(["Role", "_migrations"]);

const confirm = process.argv.includes("--confirm");

async function main() {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  );
  const all = rows.map((r) => r.table_name);
  const wipe = all.filter((t) => !KEEP_WHOLE.has(t)); // includes "User", refilled below

  const host = (() => { try { return new URL(process.env.DATABASE_URL).hostname; } catch { return "?"; } })();
  console.log(`Database host: ${host}\n`);

  const admins = (
    await pool.query(
      `SELECT u_id, u_email FROM "User" WHERE role_id = $1 ORDER BY u_id`,
      [SUPER_ADMIN_ROLE],
    )
  ).rows;
  if (!admins.length) {
    console.log("No super-admin user exists — refusing to continue, you would be locked out.");
    process.exitCode = 1;
    return;
  }

  console.log("KEEPING:");
  for (const a of admins) console.log(`  super admin  #${a.u_id}  ${a.u_email}`);
  for (const t of KEEP_WHOLE) {
    if (!all.includes(t)) continue;
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
    console.log(`  ${t.padEnd(26)} ${n} rows`);
  }

  console.log("\nDELETING:");
  let total = 0;
  for (const t of wipe) {
    let n = (await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
    if (t === "User") n -= admins.length;
    total += n;
    console.log(`  ${t.padEnd(26)} ${n} rows`);
  }
  console.log(`\n${total} rows in ${wipe.length} tables.`);

  if (!confirm) {
    console.log("\nDRY RUN — nothing was changed. Re-run with --confirm to delete.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE TEMP TABLE keep_admins ON COMMIT DROP AS SELECT * FROM "User" WHERE role_id = $1`,
      [SUPER_ADMIN_ROLE],
    );
    // Every table in one statement (User, Company and Branch point at each other, so
    // they have to go together). Role and _migrations are not in it and nothing
    // that is deleted is pointed at by them, so CASCADE cannot reach them.
    await client.query(
      `TRUNCATE ${wipe.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
    await client.query(`INSERT INTO "User" SELECT * FROM keep_admins`);
    // RESTART IDENTITY reset the id counter to 1; move it past the kept ids so the
    // next new user does not collide with a super admin.
    await client.query(
      `SELECT setval(pg_get_serial_sequence('"User"', 'u_id'), (SELECT MAX(u_id) FROM "User"))`,
    );
    const left = (await client.query(`SELECT COUNT(*)::int AS n FROM "User"`)).rows[0].n;
    if (left !== admins.length) throw new Error(`expected ${admins.length} users after reset, found ${left}`);
    await client.query("COMMIT");
    console.log(`\nDone. ${left} super-admin login(s) kept; everything else deleted.`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("\nFAILED — nothing was deleted:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
