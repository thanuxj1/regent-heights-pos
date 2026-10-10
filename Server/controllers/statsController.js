import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";

// A Branch Admin sees only their own branch's figures; an Admin (company-wide,
// no branch of its own) sees every branch of their own company; only a Super
// Admin sees across companies. Scoped by the token's own com_id/b_id, never
// by anything the caller could pass in — these are cross-company financials.
// A Branch Admin's condition, an Admin's (or false for a Super Admin, who
// sees across every company), and the one param either needs — scoped by the
// token's own com_id/b_id, never by anything the caller could pass in, since
// this is cross-company financial data.
function scopeCondition(req, branchAlias = "b") {
  const { role_id, com_id, b_id } = req.user;
  if (role_id === ROLES.BRANCH_ADMIN && b_id != null) {
    return { cond: `${branchAlias}."B_id" = $1`, param: b_id };
  }
  if (role_id !== ROLES.SUPER_ADMIN && com_id != null) {
    return { cond: `${branchAlias}."com_id" = $1`, param: com_id };
  }
  return { cond: null, param: null };
}

export async function getOverview(req, res, next) {
  try {
    const { cond, param } = scopeCondition(req, "br");
    const params = cond ? [param] : [];

    const tb = await pool.query(
      `SELECT COUNT(*)::int AS total_branches FROM "Branch" br ${cond ? `WHERE ${cond}` : ""}`,
      params,
    );
    const totalBranches = tb.rows[0]?.total_branches ?? 0;

    const rev = await pool.query(
      `SELECT COALESCE(SUM(o."or_totalCostWtax"),0)::numeric(12,2) AS total_revenue
         FROM "ORDER" o JOIN "Branch" br ON br."B_id" = o.b_id
        WHERE o.or_status = 'completed'
          AND NOT (o.payment_method = 'credit' AND o.cod_settlement_id IS NULL)
          ${cond ? `AND ${cond}` : ""}`,
      params,
    );
    const totalRevenue = Number(rev.rows[0]?.total_revenue ?? 0);

    const to = await pool.query(
      `SELECT COUNT(*)::int AS total_orders FROM "ORDER" o JOIN "Branch" br ON br."B_id" = o.b_id ${cond ? `WHERE ${cond}` : ""}`,
      params,
    );
    const totalOrders = to.rows[0]?.total_orders ?? 0;

    res.json({ totalBranches, totalRevenue, totalOrders });
  } catch (err) {
    next(err);
  }
}

export async function getBranchStats(req, res, next) {
  try {
    const { cond, param } = scopeCondition(req, "b");
    const params = cond ? [param] : [];
    const result = await pool.query(
      `SELECT
         b."B_id",
         b."B_name",
         COALESCE(ord.income,   0)::numeric(12,2) AS income,
         COALESCE(ord.orders,   0)::bigint         AS orders,
         COALESCE(exp.expenses, 0)::numeric(12,2) AS expenses
       FROM "Branch" b
       LEFT JOIN (
         SELECT b_id,
                SUM("or_totalCostWtax") AS income,
                COUNT(or_id)            AS orders
           FROM "ORDER"
          WHERE or_status = 'completed'
            AND NOT (payment_method = 'credit' AND cod_settlement_id IS NULL)
          GROUP BY b_id
       ) ord ON ord.b_id = b."B_id"
       LEFT JOIN (
         SELECT po.b_id,
                SUM(pi.price) AS expenses
           FROM purchase_order po
           JOIN purchase_item pi ON pi.po_id = po.po_id
          WHERE po.status = 'received'
          GROUP BY po.b_id
       ) exp ON exp.b_id = b."B_id"
       ${cond ? `WHERE ${cond}` : ""}
       ORDER BY income DESC`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

