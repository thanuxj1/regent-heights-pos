// tests/lib.mjs
//
// Shared harness for the QA suite. Each tNN-*.mjs file runs as its own
// `node` process (so `node reset.mjs && for f in t*.mjs; do node $f; done`
// works, and so does running one file alone while debugging) — so the
// tenant this bootstraps is persisted to a small state file under
// tests/.state/, not kept in memory, letting every file share the same
// disposable "ZZQA"-prefixed tenant without re-creating it.
//
// Run order: `node run-all.mjs` does reset -> bootstrap -> every t*.mjs in
// order -> teardown, and prints one combined summary at the end.

import "dotenv/config";
import pg from "pg";
import jwt from "jsonwebtoken";
import fsPromises from "node:fs/promises";

const { Pool } = pg;

export const BASE = process.env.QA_BASE_URL || "http://localhost:5000/api";
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STATE_DIR = new URL("./.state/", import.meta.url);
const STATE_FILE = new URL("./.state/ctx.json", import.meta.url);
const RESULTS_DIR = new URL("./.results/", import.meta.url);

const ROLES = { BRANCH_ADMIN: 1, ADMIN: 2, CASHIER: 3, SUPER_ADMIN: 6, WAITER: 8, KITCHEN_STAFF: 9 };

function sign(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "4h" });
}

function newStamp() {
  return `ZZQA_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function makeTenant(runStamp, label) {
  const comName = `${runStamp}_${label}_Co`;
  const com = await pool.query(
    `INSERT INTO "Company" (com_name, c_status, c_email) VALUES ($1, TRUE, $2) RETURNING com_id`,
    [comName, `${runStamp}_${label}@example.test`],
  );
  const com_id = com.rows[0].com_id;

  const br = await pool.query(
    `INSERT INTO "Branch" ("B_name", "B_email", "B_conNo", "B_address", com_id, "B_status")
     VALUES ($1, $2, $3, 'Nowhere', $4, TRUE) RETURNING "B_id"`,
    [`${runStamp}_${label}_Branch`, `${runStamp}_${label}_branch@example.test`, `${runStamp}_${label}`, com_id],
  );
  const b_id = br.rows[0]["B_id"];

  const mkUser = async (role, roleId) => {
    const email = `${runStamp}_${label}_${role}@example.test`.toLowerCase();
    const r = await pool.query(
      `INSERT INTO "User" (u_fname, u_lname, u_email, u_pw, role_id, u_status, "B_id", com_id)
       VALUES ($1, $2, $3, 'x', $4, TRUE, $5, $6) RETURNING u_id`,
      [runStamp, role, email, roleId, b_id, com_id],
    );
    const u_id = r.rows[0].u_id;
    const token = sign({ u_id, role_id: roleId, u_email: email, b_id, com_id });
    return { u_id, role_id: roleId, email, token };
  };

  const owner   = await mkUser("owner", ROLES.BRANCH_ADMIN);
  const cashier = await mkUser("cashier", ROLES.CASHIER);
  const waiter  = await mkUser("waiter", ROLES.WAITER);
  const kitchen = await mkUser("kitchen", ROLES.KITCHEN_STAFF);

  return { com_id, b_id, owner, cashier, waiter, kitchen };
}

/** Two disposable tenants (A, B — B exists so cross-tenant isolation can be
 * tested: a token from B must never see or touch A's rows). Bootstraps once
 * and persists to tests/.state/ctx.json; every later call in every process
 * just reads that file, so all tNN-*.mjs files share the same tenant. */
export async function ctx() {
  try {
    const raw = await fsPromises.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    const runStamp = newStamp();
    const A = await makeTenant(runStamp, "A");
    const B = await makeTenant(runStamp, "B");
    const data = { A, B, stamp: runStamp };
    await fsPromises.mkdir(STATE_DIR, { recursive: true });
    await fsPromises.writeFile(STATE_FILE, JSON.stringify(data, null, 2));
    return data;
  }
}

export async function api(token, method, path, body, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ── Assertions ────────────────────────────────────────────────────────────
const results = [];
let currentSection = "";

export function section(name) {
  currentSection = name;
}

export async function t(desc, fn) {
  const label = `${currentSection} > ${desc}`;
  try {
    await fn();
    results.push({ label, ok: true });
  } catch (err) {
    results.push({ label, ok: false, error: err.message || String(err) });
  }
}

export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || "eq failed"}: expected ${e}, got ${a}`);
}

export function ok(cond, msg) {
  if (!cond) throw new Error(msg || "expected truthy value");
}

export function status(res, expected, msg) {
  if (res.status !== expected) {
    throw new Error(`${msg || "status mismatch"}: expected ${expected}, got ${res.status} — ${JSON.stringify(res.data).slice(0, 300)}`);
  }
}

export function num(v) { return Number(v); }

export async function finish(file) {
  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;
  console.log(`\n${file}: ${passed}/${results.length} passed`);
  for (const r of failed) console.log(`  FAIL ${r.label}\n       ${r.error}`);
  const summary = { file, passed, failed: failed.length, total: results.length, results };
  await fsPromises.mkdir(RESULTS_DIR, { recursive: true });
  await fsPromises.writeFile(
    new URL(`./.results/${file}.json`, import.meta.url),
    JSON.stringify(summary, null, 2),
  );
  await pool.end();
  process.exitCode = failed.length > 0 ? 1 : 0;
  return summary;
}

/** Deletes only rows tagged with this run's own stamp/branch/company ids.
 * Safe even if a suite failed partway through. Removes the state file too,
 * so the next `ctx()` call bootstraps a fresh tenant. */
export async function cleanup() {
  let data;
  try {
    data = JSON.parse(await fsPromises.readFile(STATE_FILE, "utf8"));
  } catch {
    return; // nothing was ever bootstrapped
  }
  const { A, B, stamp: runStamp } = data;
  const bIds = [A?.b_id, B?.b_id].filter(Boolean);
  const comIds = [A?.com_id, B?.com_id].filter(Boolean);
  if (!bIds.length) return;

  let anyFailure = false;
  const q = (sql, params) => pool.query(sql, params).catch((e) => {
    anyFailure = true;
    console.warn(`cleanup step failed (continuing): ${e.message}`);
  });

  await q(`DELETE FROM "FOLIO_ITEM" WHERE folio_id IN (SELECT folio_id FROM "FOLIO" f JOIN "BOOKING" bk ON bk.booking_id=f.booking_id WHERE bk.b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "BOOKING_PAYMENT" WHERE booking_id IN (SELECT booking_id FROM "BOOKING" WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "BOOKING_ROOM" WHERE booking_id IN (SELECT booking_id FROM "BOOKING" WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "FOLIO" WHERE booking_id IN (SELECT booking_id FROM "BOOKING" WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "BOOKING" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "GUEST" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "ROOM" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "ROOM_TYPE" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "ORDER_ITEM" WHERE order_id IN (SELECT or_id FROM "ORDER" WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "ORDER" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "Branch_Product" WHERE "B_id" = ANY($1)`, [bIds]);
  await q(`DELETE FROM "Product" WHERE "Com_id" = ANY($1)`, [comIds]);
  await q(`DELETE FROM "category" WHERE cat_name LIKE $1`, [`${runStamp}%`]);
  await q(`DELETE FROM supplier_payment WHERE po_id IN (SELECT po_id FROM purchase_order WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM purchase_item WHERE po_id IN (SELECT po_id FROM purchase_order WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM purchase_order WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "SUPPLIER" WHERE "Com_id" = ANY($1)`, [comIds]);
  await q(`DELETE FROM "Waste" WHERE rm_id IN (SELECT rm_id FROM "Raw_Material" WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "Raw_Material" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "CASH_MOVEMENT" WHERE session_id IN (SELECT session_id FROM "CASH_SESSION" WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "CASH_SESSION" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "DRAWER_PIN" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "TABLE_ASSIGNMENT" WHERE table_id IN (SELECT table_id FROM "TABLES" WHERE branch_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "RESERVATION" WHERE branch_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "TABLES" WHERE branch_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "COMMISSION_RECORD" WHERE agent_id IN (SELECT agent_id FROM "COMMISSION_AGENT" WHERE b_id = ANY($1))`, [bIds]);
  await q(`DELETE FROM "COMMISSION_AGENT" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "DELIVERY_COD_SETTLEMENT" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "DELIVERY_PARTNER" WHERE com_id = ANY($1)`, [comIds]);
  await q(`DELETE FROM "USER_CAPABILITY" WHERE u_id IN (SELECT u_id FROM "User" WHERE "B_id" = ANY($1))`, [bIds]);
  await q(`DELETE FROM "USER_DEFAULT_OVERRIDE" WHERE u_id IN (SELECT u_id FROM "User" WHERE "B_id" = ANY($1))`, [bIds]);
  await q(`DELETE FROM "EXPENSE" WHERE b_id = ANY($1)`, [bIds]);
  await q(`DELETE FROM "User" WHERE "B_id" = ANY($1)`, [bIds]);
  await q(`DELETE FROM "Branch" WHERE "B_id" = ANY($1)`, [bIds]);
  await q(`DELETE FROM "Company" WHERE com_id = ANY($1)`, [comIds]);

  // Only forget this tenant once every delete actually ran — a DB blink
  // mid-cleanup (e.g. this file running with the wrong cwd, so dotenv never
  // found .env and every query failed with ECONNREFUSED) used to delete the
  // state file regardless, orphaning the tenant's rows with nothing left
  // pointing to them for the next cleanup to find. Now a failed cleanup
  // keeps the pointer so the next run's reset can retry the same rows.
  if (anyFailure) {
    console.warn("cleanup left the state file in place — at least one delete failed, so the next reset will retry this same tenant.");
    return;
  }
  await fsPromises.rm(STATE_FILE, { force: true });
}
