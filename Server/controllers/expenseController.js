import pool from "../config/database.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";

export const EXPENSE_CATEGORIES = [
  "utilities", "salary", "raw_materials", "commission",
  "maintenance", "marketing", "delivery", "food_packets", "other"
];

export async function getExpenses(req, res, next) {
  try {
    const { category, from, to } = req.query;
    const params = [];
    const clauses = [];

    const scope = branchClause(req, "b_id", params);
    if (scope) clauses.push(scope);
    if (category) { params.push(category);     clauses.push(`exp_category = $${params.length}`); }
    if (from)     { params.push(from);         clauses.push(`exp_date >= $${params.length}`); }
    if (to)       { params.push(to);           clauses.push(`exp_date <= $${params.length}`); }

    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    const { rows } = await pool.query(
      `SELECT e.*, u.u_fname || ' ' || u.u_lname AS created_by_name
       FROM "EXPENSE" e
       LEFT JOIN "User" u ON u.u_id = e.created_by
       ${where}
       ORDER BY e.exp_date DESC, e.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getExpenseSummary(req, res, next) {
  try {
    const { year } = req.query;
    const params = [];
    const clauses = [];

    const scope = branchClause(req, "b_id", params);
    if (scope) clauses.push(scope);
    if (year) { params.push(Number(year)); clauses.push(`EXTRACT(YEAR FROM exp_date) = $${params.length}`); }

    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    // Monthly totals
    const monthly = await pool.query(
      `SELECT to_char(exp_date,'YYYY-MM') AS month,
              SUM(exp_amount) AS total,
              exp_category
       FROM "EXPENSE"
       ${where}
       GROUP BY month, exp_category
       ORDER BY month DESC`,
      params
    );

    // Category totals
    const byCategory = await pool.query(
      `SELECT exp_category, SUM(exp_amount) AS total
       FROM "EXPENSE"
       ${where}
       GROUP BY exp_category
       ORDER BY total DESC`,
      params
    );

    // Revenue from orders (same branch + year filter)
    const revParams = [];
    const revClauses = [];
    if (b_id) { revParams.push(Number(b_id)); revClauses.push(`b_id = $${revParams.length}`); }
    if (year) { revParams.push(Number(year)); revClauses.push(`EXTRACT(YEAR FROM or_date::date) = $${revParams.length}`); }
    revClauses.push(`or_status NOT IN ('cancelled')`);
    const revWhere = "WHERE " + revClauses.join(" AND ");

    const revenue = await pool.query(
      `SELECT COALESCE(SUM("or_totalCostWtax"), 0) AS total_revenue
       FROM "ORDER"
       ${revWhere}`,
      revParams
    );

    // Commission outstanding
    const commParams = b_id ? [Number(b_id)] : [];
    const commWhere = b_id ? `WHERE a.b_id = $1` : "";
    const commissions = await pool.query(
      `SELECT COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status='pending'), 0) AS pending,
              COALESCE(SUM(r.commission_amount), 0) AS total
       FROM "COMMISSION_RECORD" r
       JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
       ${commWhere}`,
      commParams
    );

    res.json({
      monthly: monthly.rows,
      byCategory: byCategory.rows,
      totalExpenses: byCategory.rows.reduce((s, r) => s + Number(r.total), 0),
      totalRevenue: Number(revenue.rows[0]?.total_revenue || 0),
      commissionPending: Number(commissions.rows[0]?.pending || 0),
      commissionTotal: Number(commissions.rows[0]?.total || 0),
    });
  } catch (err) { next(err); }
}

export async function createExpense(req, res, next) {
  try {
    const { exp_category, exp_amount, exp_description, exp_date } = req.body;
    const b_id = writeBranchId(req);
    if (!exp_category || !exp_amount) {
      res.status(400); return next(new Error("exp_category and exp_amount are required"));
    }
    const { rows } = await pool.query(
      `INSERT INTO "EXPENSE" (b_id, exp_category, exp_amount, exp_description, exp_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b_id||null, exp_category, Number(exp_amount), exp_description||null, exp_date||new Date().toISOString().split("T")[0], req.user?.u_id||null]
    );
    logActivity(req, { action: "create", entity: "expense", entity_id: rows[0].exp_id, b_id: rows[0].b_id,
      summary: `Recorded ${rows[0].exp_category} expense of ${rows[0].exp_amount}` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateExpense(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "EXPENSE", idColumn: "exp_id", id });
    const { exp_category, exp_amount, exp_description, exp_date } = req.body;
    const { rows } = await pool.query(
      `UPDATE "EXPENSE"
       SET exp_category    = COALESCE($1, exp_category),
           exp_amount      = COALESCE($2, exp_amount),
           exp_description = COALESCE($3, exp_description),
           exp_date        = COALESCE($4, exp_date)
       WHERE exp_id = $5 RETURNING *`,
      [exp_category||null, exp_amount||null, exp_description||null, exp_date||null, id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Expense not found")); }
    logActivity(req, { action: "update", entity: "expense", entity_id: id, b_id: rows[0].b_id,
      summary: `Updated ${rows[0].exp_category} expense to ${rows[0].exp_amount}` });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteExpense(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "EXPENSE", idColumn: "exp_id", id });
    // Read it before deleting so the log line can name what went.
    const doomed = await pool.query(
      'SELECT b_id, exp_category, exp_amount, exp_description FROM "EXPENSE" WHERE exp_id = $1', [id]
    );
    const { rowCount } = await pool.query('DELETE FROM "EXPENSE" WHERE exp_id = $1', [id]);
    if (!rowCount) { res.status(404); return next(new Error("Expense not found")); }

    const gone = doomed.rows[0];
    logActivity(req, {
      action: "delete", entity: "expense", entity_id: id, b_id: gone?.b_id,
      summary: gone
        ? `Deleted ${gone.exp_category} expense of ${gone.exp_amount}`
        : `Deleted expense #${id}`,
      details: gone || null,
    });
    res.status(204).send();
  } catch (err) { next(err); }
}
