/**
 * Make a Super Admin from the server's own terminal.
 *
 *   node Server/scripts/create-super-admin.js --list
 *   node Server/scripts/create-super-admin.js owner@example.com "Jane" "Perera"
 *   node Server/scripts/create-super-admin.js existing@example.com --promote
 *
 * The way back in when nobody can sign in.
 *
 * Only a Super Admin can reset a Super Admin: an Administrator is scoped to
 * their own property and the Super Admin belongs to none, so it is invisible to
 * them, and nobody may act on a role above their own. With a single Super Admin
 * account, losing its password locks the whole platform — every company, every
 * property. This is the only door left, and it needs the server's own database
 * credentials to open, so it is no weaker than the database itself.
 *
 * Two of these accounts is the real fix: either can reset the other from User
 * Management, with no terminal and no developer. Make the second one today, not
 * on the morning you need it.
 *
 * The password is typed twice and never shown, printed or stored anywhere
 * except as the same bcrypt hash every account has. The act goes on the
 * activity log; the password never does.
 */
import dotenv from "dotenv";
import path from "path";
import readline from "readline";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });
const { default: pool } = await import("../config/database.js");

const SUPER_ADMIN = 6;

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // Suppress the echo of what is typed, not the prompt asking for it. Writing
    // the prompt first and then blanking every write took the prompt with it:
    // readline redraws the line when the question starts, so the screen went
    // blank and the script looked like it had hung.
    rl._writeToOutput = (chunk) => { if (!muted) rl.output.write(chunk); };
    rl.question(prompt, (answer) => {
      rl.close();
      console.log("");
      resolve(answer);
    });
    muted = true;
  });
}

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function listSuperAdmins() {
  const { rows } = await pool.query(
    `SELECT u_id, u_email, TRIM(COALESCE(u_fname,'') || ' ' || COALESCE(u_lname,'')) AS name, u_status
       FROM "User" WHERE role_id = $1 ORDER BY u_id`, [SUPER_ADMIN]);
  if (!rows.length) {
    console.log("\n  There is no Super Admin account at all. Nobody can administer the platform.\n");
    return rows;
  }
  console.log(`\n  ${rows.length} Super Admin account${rows.length === 1 ? "" : "s"}:\n`);
  for (const r of rows) {
    console.log(`    #${r.u_id}  ${r.u_email}${r.name ? `  (${r.name})` : ""}`
      + (r.u_status === false ? "   DEACTIVATED — cannot sign in" : ""));
  }
  if (rows.filter((r) => r.u_status !== false).length < 2) {
    console.log("\n  Only one account can sign in as Super Admin. If its password is lost,"
      + "\n  this script is the only way back. A second one is the safer arrangement.");
  }
  console.log("");
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list") || args.length === 0) {
    await listSuperAdmins();
    if (args.length === 0) {
      console.log("  Usage: node scripts/create-super-admin.js <email> [First] [Last]");
      console.log("         node scripts/create-super-admin.js <email> --promote\n");
    }
    return;
  }

  const email = String(args[0] || "").trim().toLowerCase();
  const promote = args.includes("--promote");
  const names = args.slice(1).filter((a) => !a.startsWith("--"));

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log(`"${args[0]}" does not look like an email address. Nothing was changed.`);
    process.exitCode = 1;
    return;
  }

  const { rows } = await pool.query(
    `SELECT u.u_id, u.u_email, u.role_id, u.u_status, r.role_name
       FROM "User" u LEFT JOIN "Role" r ON r.role_id = u.role_id
      WHERE LOWER(u.u_email) = $1`, [email]);
  const existing = rows[0];

  if (existing && Number(existing.role_id) === SUPER_ADMIN) {
    console.log(`${existing.u_email} is already a Super Admin.`
      + `\nTo give it a new password:  node scripts/set-password.js ${existing.u_email}`);
    return;
  }
  if (existing && !promote) {
    console.log(`${existing.u_email} already exists as ${existing.role_name || "another role"}.`
      + `\nTo make that same account a Super Admin, run it again with --promote.`
      + `\nNothing was changed.`);
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY) {
    console.log("Run this in PowerShell, Command Prompt or the app's Terminal panel, "
      + "so the password can be typed without being shown. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  // Promoting an account takes it away from its property: a Super Admin belongs
  // to no company, and the screens it lands on expect that.
  if (existing && promote) {
    console.log(`\n  ${existing.u_email} is ${existing.role_name || "another role"} today.`);
    console.log("  Making it a Super Admin gives it every company and every property,");
    console.log("  and takes it off the property it belongs to now.");
    const yes = await ask("  Type the email again to confirm: ");
    if (yes.trim().toLowerCase() !== email) {
      console.log("  That did not match. Nothing was changed.");
      process.exitCode = 1;
      return;
    }
  }

  const first = await askHidden("New password (at least 8 characters, not shown): ");
  if (first.length < 8) {
    console.log("Too short. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  const second = await askHidden("Type it again: ");
  if (first !== second) {
    console.log("The two did not match. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  const hash = await bcrypt.hash(first, await bcrypt.genSalt(10));

  const client = await pool.connect();
  let uid;
  try {
    await client.query("BEGIN");
    if (existing) {
      uid = existing.u_id;
      await client.query(
        `UPDATE "User" SET role_id = $1, "B_id" = NULL, com_id = NULL,
                           u_status = TRUE, u_pw = $2 WHERE u_id = $3`,
        [SUPER_ADMIN, hash, uid]);
    } else {
      const ins = await client.query(
        `INSERT INTO "User" (u_fname, u_lname, u_email, u_pw, role_id, u_status, "B_id", com_id)
         VALUES ($1, $2, $3, $4, $5, TRUE, NULL, NULL) RETURNING u_id`,
        [names[0] || "Super", names[1] || "Admin", email, hash, SUPER_ADMIN]);
      uid = ins.rows[0].u_id;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await pool.query(
    `INSERT INTO "ACTIVITY_LOG"
       (u_id, actor_name, role_id, b_id, action, entity, entity_id, summary, details, ip_address)
     VALUES (NULL, 'Server console', NULL, NULL, $1, 'user', $2, $3, $4, NULL)`,
    [existing ? "update" : "create", String(uid),
     existing
       ? `Promoted ${email} to Super Admin from the server console`
       : `Created the Super Admin account ${email} from the server console`,
     JSON.stringify({ email })],
  ).catch((e) => console.log(`(The account was saved, but the activity log entry failed: ${e.message})`));

  console.log(`\nDone. ${email} can sign in as Super Admin now.`);
  await listSuperAdmins();
}

main()
  .catch((e) => {
    console.error("Could not do it:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
