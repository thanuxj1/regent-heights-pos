/**
 * Set a new password for one account, from the server's own terminal.
 *
 *   node Server/scripts/set-password.js someone@example.com
 *
 * For when nobody who could reset it from User Management can sign in — the
 * developer's own account above all, since no one ranks above it. The new
 * password is typed twice and never shown, printed or stored anywhere except as
 * the same bcrypt hash the app keeps for every account. The reset goes on the
 * activity log; the password never does.
 */
import dotenv from "dotenv";
import path from "path";
import readline from "readline";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";

// The server's own .env, whichever folder this is run from. The database module
// reads its settings as it loads, so it is imported only after they are in place.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });
const { default: pool } = await import("../config/database.js");

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

/** Who can sign in at all — for whoever is locked out and guessing. */
async function listAccounts() {
  const { rows } = await pool.query(
    `SELECT u.u_id, u.u_email, u.u_status, r.role_name, b."B_name" AS property
       FROM "User" u
       LEFT JOIN "Role" r ON r.role_id = u.role_id
       LEFT JOIN "Branch" b ON b."B_id" = u."B_id"
      ORDER BY u.role_id, u.u_id`);
  console.log(`
  ${rows.length} account${rows.length === 1 ? "" : "s"}:
`);
  for (const r of rows) {
    console.log(`    #${String(r.u_id).padStart(2)}  ${r.u_email.padEnd(24)} ${(r.role_name || "?").padEnd(15)}`
      + `${r.property || ""}${r.u_status === false ? "   DEACTIVATED" : ""}`);
  }
  console.log("");
}

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (email === "--list") {
    await listAccounts();
    return;
  }
  if (!email) {
    console.log("Usage: node scripts/set-password.js <email>");
    console.log("       node scripts/set-password.js --list      (who can sign in)");
    process.exitCode = 1;
    return;
  }

  const { rows } = await pool.query(
    `SELECT u.u_id, u.u_email, u.u_status, u."B_id" AS b_id, r.role_name
       FROM "User" u LEFT JOIN "Role" r ON r.role_id = u.role_id
      WHERE LOWER(u.u_email) = $1`,
    [email],
  );
  const user = rows[0];
  if (!user) {
    console.log(`No account with the email ${email}. Nothing was changed.`);
    await listAccounts();
    process.exitCode = 1;
    return;
  }
  console.log(`${user.u_email} — ${user.role_name || "unknown role"}`
    + (user.b_id ? `, property #${user.b_id}` : ", not tied to a property")
    + (user.u_status === false ? " (DEACTIVATED: it still cannot sign in until an administrator reactivates it)" : ""));

  if (!process.stdin.isTTY) {
    console.log("Run this in PowerShell, Command Prompt or the app's Terminal panel, "
      + "so the password can be typed without being shown. Nothing was changed.");
    process.exitCode = 1;
    return;
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
  await pool.query(`UPDATE "User" SET u_pw = $1 WHERE u_id = $2`, [hash, user.u_id]);
  await pool.query(
    `INSERT INTO "ACTIVITY_LOG"
       (u_id, actor_name, role_id, b_id, action, entity, entity_id, summary, details, ip_address)
     VALUES (NULL, 'Server console', NULL, $1, 'update', 'user', $2, $3, $4, NULL)`,
    [user.b_id ?? null, String(user.u_id),
     `Password reset from the server console for ${user.u_email}`,
     JSON.stringify({ email: user.u_email })],
  ).catch((e) => console.log(`(The password was changed, but the activity log entry failed: ${e.message})`));

  console.log(`Done. ${user.u_email} can sign in with the new password now.`);
}

main()
  .catch((e) => {
    console.error("Could not set the password:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
