/**
 * Hand the system to a new client: clear the data, keep the people.
 *
 *   node scripts/reset-for-client.js                      -> PREVIEW: lists what would go, changes nothing
 *   node scripts/reset-for-client.js --confirm            -> does it (one transaction: all or nothing)
 *   add --super-admins-only to either to keep ONLY the super-admin logins
 *
 * DEFAULT KEEPS: every login (User), their roles and permissions, the Company, the Branch,
 *                manager PINs, hotel settings (check-in times etc.), and the app's own
 *                record of its schema.
 * DELETES:       everything else — orders, bookings, guests, customers, menu and products,
 *                rooms and tables, stock, suppliers, purchases, expenses, drawer records,
 *                delivery riders, logs.
 *
 * --super-admins-only KEEPS: super-admin users (role 6), Role, and the schema record.
 *                DELETES every other user, every company and branch, and all data.
 *
 * The preview runs the real delete inside a transaction and then rolls it back, so it
 * proves the delete would succeed without changing anything.
 *
 * Take a backup first (pg_dump) if you can — --confirm cannot be undone.
 */
import "dotenv/config";
import pool from "../config/database.js";

const SUPER_ADMIN_ROLE = 6;
const superOnly = process.argv.includes("--super-admins-only");
const confirm = process.argv.includes("--confirm");

const KEEP_WHOLE = superOnly
  ? new Set(["Role", "_migrations"])
  : new Set([
      "Company", "Branch", "Role", "User",
      "USER_CAPABILITY", "USER_DEFAULT_OVERRIDE",
      "DRAWER_PIN", "HOTEL_POLICY",
      "_migrations",
    ]);

async function main() {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  );
  const all = rows.map((r) => r.table_name);
  const wipe = all.filter((t) => !KEEP_WHOLE.has(t)); // in --super-admins-only this includes "User"

  const host = (() => { try { return new URL(process.env.DATABASE_URL).hostname; } catch { return "?"; } })();
  console.log(`Database host: ${host}`);
  console.log(`Mode: ${superOnly ? "keep only super admins" : "keep logins, company and branch"}\n`);

  const admins = (
    await pool.query(`SELECT u_id, u_email FROM "User" WHERE role_id = $1 ORDER BY u_id`, [SUPER_ADMIN_ROLE])
  ).rows;
  if (!admins.length) {
    console.log("No super-admin user exists — refusing to continue, you would be locked out.");
    process.exitCode = 1;
    return;
  }

  console.log("KEEPING:");
  if (superOnly) {
    for (const a of admins) console.log(`  super admin  #${a.u_id}  ${a.u_email}`);
  }
  for (const t of all.filter((t) => KEEP_WHOLE.has(t))) {
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
    console.log(`  ${t.padEnd(26)} ${n} rows`);
  }
  if (!superOnly) {
    const people = (await pool.query(`SELECT u_email, role_id FROM "User" ORDER BY role_id, u_id`)).rows;
    console.log("\n  Logins kept:");
    for (const p of people) console.log(`    ${String(p.u_email).padEnd(40)} role ${p.role_id}`);
  }

  console.log("\nDELETING:");
  let total = 0;
  for (const t of wipe) {
    let n = (await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
    if (superOnly && t === "User") n -= admins.length;
    total += n;
    console.log(`  ${t.padEnd(26)} ${n} rows`);
  }
  console.log(`\n${total} rows in ${wipe.length} tables.`);

  // The real delete, inside a transaction. Preview rolls it back; --confirm commits it.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (superOnly) {
      await client.query(
        `CREATE TEMP TABLE keep_admins ON COMMIT DROP AS SELECT * FROM "User" WHERE role_id = $1`,
        [SUPER_ADMIN_ROLE],
      );
      // User, Company and Branch point at each other, so they have to go together.
      await client.query(`TRUNCATE ${wipe.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
      await client.query(`INSERT INTO "User" SELECT * FROM keep_admins`);
      await client.query(
        `SELECT setval(pg_get_serial_sequence('"User"', 'u_id'), (SELECT MAX(u_id) FROM "User"))`,
      );
      const left = (await client.query(`SELECT COUNT(*)::int AS n FROM "User"`)).rows[0].n;
      if (left !== admins.length) throw new Error(`expected ${admins.length} users after reset, found ${left}`);
    } else {
      // No CASCADE: if a table being kept points at one being deleted, Postgres refuses and
      // nothing is touched, instead of silently emptying the kept table too.
      await client.query(`TRUNCATE ${wipe.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`);
      const users = (await client.query(`SELECT COUNT(*)::int AS n FROM "User"`)).rows[0].n;
      if (!users) throw new Error("no users left after the reset — refusing");
    }

    if (confirm) {
      await client.query("COMMIT");
      console.log("\nDone. Everything below the KEEPING list has been deleted.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nPREVIEW — the delete would succeed, and nothing was changed.");
      console.log("Run again with --confirm to delete.");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\nFAILED — nothing was deleted:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
