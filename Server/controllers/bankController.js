import pool from "../config/database.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";
import { hotelToday } from "../utils/hotelTime.js";
import { moneyField, textField, dateField, oneOf, invalid } from "../utils/validate.js";

// The bank book (migration 080). Money into and out of the bank account —
// movements of money counted elsewhere, so none of it touches profit.

const MAX_AMOUNT = 9999999999.99; // what NUMERIC(12,2) holds
const TYPES = ["debit", "credit"];
const METHODS = ["cheque_withdrawal", "bank_transfer"];
const TRANSFERS = ["online_payment", "supplier_payment"];
/** Credit categories every property has; it adds its own in BANK_CATEGORY. */
export const BUILTIN_BANK_CATEGORIES = ["Sales cash deposit", "MD cash deposit"];

const isBuiltin = (name) => BUILTIN_BANK_CATEGORIES.some((c) => c.toLowerCase() === String(name).trim().toLowerCase());

/** The category as stored: a built-in one, or one of this property's own. Null when neither. */
async function resolveCategory(b_id, raw) {
  const name = String(raw ?? "").trim();
  if (!name) return null;
  const builtin = BUILTIN_BANK_CATEGORIES.find((c) => c.toLowerCase() === name.toLowerCase());
  if (builtin) return builtin;
  if (!b_id) return null;
  const { rows } = await pool.query(
    `SELECT name FROM "BANK_CATEGORY" WHERE b_id = $1 AND lower(name) = lower($2)`, [b_id, name]);
  return rows[0]?.name ?? null;
}

/**
 * Check a whole entry and return the columns to store. Fields that do not
 * belong to the chosen kind are cleared, not kept: a debit switched to a
 * credit loses its cheque number.
 */
async function cleanEntry(b_id, body) {
  const type = oneOf(body.bt_type, "Type", TYPES);
  if (!type) invalid("Choose Debit (money out) or Credit (money in).");
  const amount = moneyField(body.bt_amount, "Amount", { min: 0.01, max: MAX_AMOUNT });
  if (!(amount > 0)) invalid("Enter the amount.");
  const date = dateField(body.bt_date, "Date") || hotelToday();
  const note = textField(body.bt_note, "Note", 500);

  const row = { bt_type: type, bt_amount: amount, bt_date: date, bt_note: note,
    bt_method: null, bt_transfer: null, bt_cheque_no: null, bt_category: null };

  if (type === "debit") {
    row.bt_method = oneOf(body.bt_method, "Debit by", METHODS);
    if (!row.bt_method) invalid("Choose Cheque withdrawal or Bank transfer.");
    if (row.bt_method === "cheque_withdrawal") {
      row.bt_cheque_no = textField(body.bt_cheque_no, "Cheque number", 30);
      if (!row.bt_cheque_no) invalid("Enter the cheque number.");
    } else {
      row.bt_transfer = oneOf(body.bt_transfer, "Transfer for", TRANSFERS);
      if (!row.bt_transfer) invalid("Choose Online payment or Supplier payment.");
    }
  } else {
    row.bt_category = await resolveCategory(b_id, body.bt_category);
    if (!row.bt_category) invalid("Choose what the money paid in was.");
  }
  return row;
}

const describe = (r) => r.bt_type === "credit"
  ? `${r.bt_category} credit of ${r.bt_amount}`
  : r.bt_method === "cheque_withdrawal"
    ? `cheque ${r.bt_cheque_no} withdrawal of ${r.bt_amount}`
    : `${String(r.bt_transfer).replace("_", " ")} transfer of ${r.bt_amount}`;

/** GET /api/bank?type=&category=&from=&to= — newest first. */
export async function getBankTransactions(req, res, next) {
  try {
    const { type, category, from, to } = req.query;
    const params = [];
    const clauses = [];
    const scope = branchClause(req, "t.b_id", params);
    if (scope) clauses.push(scope);
    if (TYPES.includes(type)) { params.push(type); clauses.push(`t.bt_type = $${params.length}`); }
    if (category) { params.push(category); clauses.push(`t.bt_category = $${params.length}`); }
    if (from) { params.push(dateField(from, "From")); clauses.push(`t.bt_date >= $${params.length}`); }
    if (to)   { params.push(dateField(to, "To"));     clauses.push(`t.bt_date <= $${params.length}`); }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT t.*, u.u_fname || ' ' || u.u_lname AS created_by_name
         FROM "BANK_TRANSACTION" t
         LEFT JOIN "User" u ON u.u_id = t.created_by
        ${where}
        ORDER BY t.bt_date DESC, t.created_at DESC`, params);
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createBankTransaction(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    const r = await cleanEntry(b_id, req.body || {});
    const { rows } = await pool.query(
      `INSERT INTO "BANK_TRANSACTION"
         (b_id, bt_date, bt_type, bt_method, bt_transfer, bt_cheque_no, bt_category, bt_amount, bt_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b_id || null, r.bt_date, r.bt_type, r.bt_method, r.bt_transfer, r.bt_cheque_no, r.bt_category,
       r.bt_amount, r.bt_note, req.user?.u_id || null]);
    logActivity(req, { action: "create", entity: "bank_transaction", entity_id: rows[0].bt_id, b_id: rows[0].b_id,
      summary: `Recorded bank ${describe(rows[0])}` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateBankTransaction(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "BANK_TRANSACTION", idColumn: "bt_id", id });
    const { rows: [was] } = await pool.query(`SELECT * FROM "BANK_TRANSACTION" WHERE bt_id = $1`, [id]);
    if (!was) { res.status(404); return next(new Error("Bank entry not found")); }
    const r = await cleanEntry(was.b_id, req.body || {});
    const { rows } = await pool.query(
      `UPDATE "BANK_TRANSACTION"
          SET bt_date = $2, bt_type = $3, bt_method = $4, bt_transfer = $5, bt_cheque_no = $6,
              bt_category = $7, bt_amount = $8, bt_note = $9
        WHERE bt_id = $1 RETURNING *`,
      [id, r.bt_date, r.bt_type, r.bt_method, r.bt_transfer, r.bt_cheque_no, r.bt_category, r.bt_amount, r.bt_note]);
    logActivity(req, { action: "update", entity: "bank_transaction", entity_id: id, b_id: was.b_id,
      summary: `Changed bank ${describe(was)} to ${describe(rows[0])}` });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteBankTransaction(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "BANK_TRANSACTION", idColumn: "bt_id", id });
    const { rows: [gone] } = await pool.query(
      `DELETE FROM "BANK_TRANSACTION" WHERE bt_id = $1 RETURNING *`, [id]);
    if (!gone) { res.status(404); return next(new Error("Bank entry not found")); }
    logActivity(req, { action: "delete", entity: "bank_transaction", entity_id: id, b_id: gone.b_id,
      summary: `Deleted bank ${describe(gone)}`, details: gone });
    res.status(204).send();
  } catch (err) { next(err); }
}

// ─── Credit categories ───────────────────────────────────────────────────────

const categoryName = (v) => {
  const name = textField(v, "Name", 40);
  if (!name || name.length < 2) invalid("Give the category a name (2 to 40 characters).");
  if (isBuiltin(name)) invalid(`"${name}" is already one of the standard categories.`);
  return name;
};

/** GET /api/bank/categories — built-in and the property's own, with how many entries each holds. */
export async function listBankCategories(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    const [own, used] = await Promise.all([
      pool.query(`SELECT * FROM "BANK_CATEGORY" WHERE b_id = $1 ORDER BY lower(name)`, [b_id]),
      pool.query(`SELECT bt_category, COUNT(*)::int AS n FROM "BANK_TRANSACTION"
                   WHERE b_id = $1 AND bt_category IS NOT NULL GROUP BY 1`, [b_id]),
    ]);
    const usedBy = Object.fromEntries(used.rows.map((u) => [u.bt_category, u.n]));
    res.json({
      builtin: BUILTIN_BANK_CATEGORIES,
      custom: own.rows.map((c) => ({ ...c, used: usedBy[c.name] || 0 })),
      used: usedBy,
    });
  } catch (err) { next(err); }
}

export async function createBankCategory(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.body?.b_id);
    if (!b_id) invalid("Choose the property first.");
    const name = categoryName(req.body?.name);
    const clash = await pool.query(
      `SELECT 1 FROM "BANK_CATEGORY" WHERE b_id = $1 AND lower(name) = lower($2)`, [b_id, name]);
    if (clash.rows.length) { res.status(409); return next(new Error(`There is already a category called "${name}".`)); }
    const { rows } = await pool.query(
      `INSERT INTO "BANK_CATEGORY" (b_id, name, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [b_id, name, req.user?.u_id ?? null]);
    logActivity(req, { action: "create", entity: "bank_category", entity_id: rows[0].cat_id, b_id,
      summary: `Added the bank credit category "${name}"` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

/** A rename carries the entries filed under it along. */
export async function updateBankCategory(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "BANK_CATEGORY", idColumn: "cat_id", id });
    const { rows: [was] } = await client.query(`SELECT * FROM "BANK_CATEGORY" WHERE cat_id = $1`, [id]);
    if (!was) { res.status(404); throw new Error("Category not found"); }
    const name = categoryName(req.body?.name);
    if (name.toLowerCase() !== was.name.toLowerCase()) {
      const clash = await client.query(
        `SELECT 1 FROM "BANK_CATEGORY" WHERE b_id = $1 AND lower(name) = lower($2) AND cat_id <> $3`, [was.b_id, name, id]);
      if (clash.rows.length) { res.status(409); throw new Error(`There is already a category called "${name}".`); }
    }
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE "BANK_CATEGORY" SET name = $2 WHERE cat_id = $1 RETURNING *`, [id, name]);
    const moved = name === was.name ? 0 : (await client.query(
      `UPDATE "BANK_TRANSACTION" SET bt_category = $3 WHERE b_id = $1 AND bt_category = $2`,
      [was.b_id, was.name, name])).rowCount;
    await client.query("COMMIT");
    logActivity(req, { action: "update", entity: "bank_category", entity_id: id, b_id: was.b_id,
      summary: `Renamed the bank credit category "${was.name}" to "${name}"` + (moved ? `; ${moved} entr${moved === 1 ? "y" : "ies"} moved with it` : "") });
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

/** Only once no entry is filed under it. */
export async function deleteBankCategory(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "BANK_CATEGORY", idColumn: "cat_id", id });
    const { rows: [c] } = await pool.query(`SELECT * FROM "BANK_CATEGORY" WHERE cat_id = $1`, [id]);
    if (!c) { res.status(404); return next(new Error("Category not found")); }
    const { rows: [u] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "BANK_TRANSACTION" WHERE b_id = $1 AND bt_category = $2`, [c.b_id, c.name]);
    if (u.n > 0) {
      res.status(409);
      return next(new Error(`${u.n} entr${u.n === 1 ? "y is" : "ies are"} filed under "${c.name}". Move them to another category first, or rename it instead.`));
    }
    await pool.query(`DELETE FROM "BANK_CATEGORY" WHERE cat_id = $1`, [id]);
    logActivity(req, { action: "delete", entity: "bank_category", entity_id: id, b_id: c.b_id,
      summary: `Removed the bank credit category "${c.name}"` });
    res.status(204).send();
  } catch (err) { next(err); }
}
