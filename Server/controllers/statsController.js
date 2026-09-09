import pool from "../config/database.js";

export async function getOverview(req, res, next) {
  try {
    const tb = await pool.query(`SELECT COUNT(*)::int AS total_branches FROM "Branch"`);
    const totalBranches = tb.rows[0]?.total_branches ?? 0;

    const rev = await pool.query(
      `SELECT COALESCE(SUM("or_totalCostWtax"),0)::numeric(12,2) AS total_revenue FROM "ORDER" WHERE or_status = 'completed'`
    );
    const totalRevenue = Number(rev.rows[0]?.total_revenue ?? 0);

    const to = await pool.query(`SELECT COUNT(*)::int AS total_orders FROM "ORDER"`);
    const totalOrders = to.rows[0]?.total_orders ?? 0;

    res.json({ totalBranches, totalRevenue, totalOrders });
  } catch (err) {
    next(err);
  }
}



export async function getBranchStats(req, res, next) {
  try {
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
       ORDER BY income DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

