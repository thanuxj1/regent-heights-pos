import pool from "../config/database.js";
import { branchClause } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";

/*
 * Credit sales: food given to someone the house knows, who pays later. Like
 * cash on delivery it is not money in the drawer, and it is counted as revenue
 * only on the day it is paid. A payment always ties to the specific orders it
 * covers (the same rule as a COD settlement), and is written to the same
 * settlement table with kind = 'credit', so every report that already reads
 * settlements counts it.
 */

const PAY_METHODS = ["cash", "card", "bank_transfer", "online", "other"];

const customerKey = (name, phone) => `${String(name || "").trim().toLowerCase()}|${String(phone || "").trim()}`;

// ─── GET /api/credit/outstanding ─────────────────────────────────
// Every unpaid credit sale, and the running total per customer.
export async function getOutstandingCredit(req, res, next) {
  try {
    const params = [];
    const scope = branchClause(req, "o.b_id", params);
    const { rows: orders } = await pool.query(
      `SELECT o.or_id, o.or_date, o.or_time, o.or_type, o.credit_customer, o.credit_phone,
              COALESCE(o."or_totalCostWtax", o.or_totalcost, 0) AS amount, o.b_id,
              NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS sold_by
         FROM "ORDER" o
         LEFT JOIN "User" u ON u.u_id = o.u_id
        WHERE o.payment_method = 'credit' AND o.cod_settlement_id IS NULL AND o.or_status <> 'cancelled'
          ${scope ? `AND ${scope}` : ""}
        ORDER BY o.or_date DESC, o.or_id DESC`,
      params,
    );

    const byCustomer = new Map();
    for (const o of orders) {
      const key = customerKey(o.credit_customer, o.credit_phone);
      const entry = byCustomer.get(key) || {
        key, customer: o.credit_customer || "Unknown", phone: o.credit_phone || null, count: 0, total: 0, oldest: o.or_date,
      };
      entry.count += 1;
      entry.total = +(entry.total + Number(o.amount || 0)).toFixed(2);
      if (o.or_date < entry.oldest) entry.oldest = o.or_date;
      byCustomer.set(key, entry);
    }

    res.json({
      orders,
      by_customer: [...byCustomer.values()].sort((a, b) => b.total - a.total),
      total: +orders.reduce((s, o) => s + Number(o.amount || 0), 0).toFixed(2),
    });
  } catch (err) { next(err); }
}

// ─── GET /api/credit/history ─────────────────────────────────────
export async function getCreditHistory(req, res, next) {
  try {
    const params = [];
    const scope = branchClause(req, "s.b_id", params);
    const { rows } = await pool.query(
      `SELECT s.settlement_id, s.customer_name, s.amount, s.settled_date, s.method, s.note, s.created_at,
              COUNT(o.or_id)::int AS order_count,
              STRING_AGG('#' || o.or_id, ', ' ORDER BY o.or_id) AS orders,
              NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS recorded_by
         FROM "DELIVERY_COD_SETTLEMENT" s
         LEFT JOIN "ORDER" o ON o.cod_settlement_id = s.settlement_id
         LEFT JOIN "User" u ON u.u_id = s.created_by
        WHERE s.kind = 'credit' ${scope ? `AND ${scope}` : ""}
        GROUP BY s.settlement_id, u.u_fname, u.u_lname
        ORDER BY s.created_at DESC
        LIMIT 200`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// ─── POST /api/credit/settle ─────────────────────────────────────
// { order_ids: [..], method, settled_date?, note? } — the customer pays for
// these orders in full. The amount is what the orders add up to, never typed.
export async function settleCredit(req, res, next) {
  const client = await pool.connect();
  try {
    const { order_ids, method, settled_date, note } = req.body || {};
    const ids = [...new Set((Array.isArray(order_ids) ? order_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) { res.status(400); throw new Error("Choose the orders being paid for."); }
    if (!PAY_METHODS.includes(method)) { res.status(400); throw new Error("Choose how they paid: cash, card or bank transfer."); }
    if (settled_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(settled_date))) { res.status(400); throw new Error("Payment date must be a date."); }

    await client.query("BEGIN");
    const params = [ids];
    const scope = branchClause(req, "b_id", params);
    const { rows: orders } = await client.query(
      `SELECT or_id, b_id, payment_method, cod_settlement_id, or_status, credit_customer, credit_phone,
              COALESCE("or_totalCostWtax", or_totalcost, 0) AS amount
         FROM "ORDER" WHERE or_id = ANY($1::int[]) ${scope ? `AND ${scope}` : ""}
         FOR UPDATE`,
      params,
    );
    if (orders.length !== ids.length) { res.status(404); throw new Error("One or more of those orders were not found."); }
    const bad = orders.find((o) => o.payment_method !== "credit" || o.cod_settlement_id != null || o.or_status === "cancelled");
    if (bad) { res.status(409); throw new Error(`Order #${bad.or_id} is not an unpaid credit sale — it may already be paid.`); }
    const who = new Set(orders.map((o) => customerKey(o.credit_customer, o.credit_phone)));
    if (who.size > 1) { res.status(400); throw new Error("Record one customer's payment at a time."); }
    const branches = new Set(orders.map((o) => o.b_id));
    if (branches.size > 1) { res.status(400); throw new Error("Those orders belong to different branches."); }

    const b_id = orders[0].b_id;
    const amount = +orders.reduce((s, o) => s + Number(o.amount), 0).toFixed(2);

    const settlement = await client.query(
      `INSERT INTO "DELIVERY_COD_SETTLEMENT"
         (b_id, kind, customer_name, delivery_partner, amount, settled_date, method, note, created_by)
       VALUES ($1, 'credit', $2, NULL, $3, COALESCE($4::DATE, CURRENT_DATE), $5, $6, $7)
       RETURNING settlement_id, b_id, kind, customer_name, amount, settled_date, method, note, created_at`,
      [b_id, orders[0].credit_customer, amount, settled_date || null, method,
       String(note ?? "").trim().slice(0, 255) || null, req.user?.u_id ?? null],
    );
    await client.query(
      `UPDATE "ORDER" SET cod_settlement_id = $1 WHERE or_id = ANY($2::int[])`,
      [settlement.rows[0].settlement_id, ids],
    );
    await client.query("COMMIT");

    logActivity(req, {
      action: "payment", entity: "credit_settlement", entity_id: settlement.rows[0].settlement_id, b_id,
      summary: `${orders[0].credit_customer} paid ${amount.toFixed(2)} (${method}) for credit order(s) ${ids.map((i) => "#" + i).join(", ")}`,
      details: { amount, method, order_ids: ids },
    });
    res.status(201).json({ ...settlement.rows[0], order_ids: ids });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}
