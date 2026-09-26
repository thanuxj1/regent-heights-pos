import pool from "../config/database.js";
import { branchClause, writeBranchId } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";
import { isValidDeliveryPartner } from "./orderController.js";

/*
 * Cash-on-delivery owed to the hotel by third-party delivery partners
 * (PickMe, Uber Eats, foodpanda). When a customer pays the rider cash, the
 * partner holds that money until they settle up in a batch later. This is
 * the mirror of Supplier Ledger — money owed TO the hotel instead of BY it —
 * and follows the same rule that ledger's own history learned the hard way:
 * a settlement must always tie to the specific orders it covers, never a
 * bare balance reduction, or it becomes invisible everywhere except the one
 * screen that recorded it.
 */

const SETTLEMENT_METHODS = ["cash", "bank_transfer", "online", "other"];
const MAX_AMOUNT = 9999999.99;

function parsePositiveDecimal(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error(`${fieldName} must be a positive number`), { status: 400 });
  }
  return Math.round(n * 100) / 100;
}

// ─── GET /api/delivery-cod/outstanding ─────────────────────────────
// Every unsettled COD delivery order, plus the running total per partner.
export async function getOutstandingCod(req, res, next) {
  try {
    const params = [];
    const scope = branchClause(req, "b_id", params);
    const where = [
      `or_type = 'delivery'`,
      `payment_method = 'cod'`,
      `cod_settlement_id IS NULL`,
      `or_status <> 'cancelled'`,
      ...(scope ? [scope] : []),
    ].join(" AND ");

    const { rows: orders } = await pool.query(
      `SELECT or_id, delivery_partner, or_date, "or_totalCostWtax" AS amount, b_id
         FROM "ORDER"
        WHERE ${where}
        ORDER BY or_date DESC`,
      params,
    );

    const byPartner = new Map();
    for (const o of orders) {
      const key = o.delivery_partner || "other";
      const entry = byPartner.get(key) || { delivery_partner: key, count: 0, total: 0 };
      entry.count += 1;
      entry.total += Number(o.amount || 0);
      byPartner.set(key, entry);
    }

    res.json({
      orders,
      byPartner: [...byPartner.values()].map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/delivery-cod/history ──────────────────────────────────
// Settlements recorded so far, most recent first, with how many orders and
// how much each one covered.
export async function getCodHistory(req, res, next) {
  try {
    const params = [];
    const scope = branchClause(req, "s.b_id", params);
    const where = scope ? `WHERE ${scope}` : "";

    const { rows } = await pool.query(
      `SELECT s.settlement_id, s.delivery_partner, s.amount, s.settled_date,
              s.method, s.note, s.created_at,
              COUNT(o.or_id) AS order_count,
              NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS recorded_by
         FROM "DELIVERY_COD_SETTLEMENT" s
         LEFT JOIN "ORDER" o ON o.cod_settlement_id = s.settlement_id
         LEFT JOIN "User" u ON u.u_id = s.created_by
         ${where}
        GROUP BY s.settlement_id, u.u_fname, u.u_lname
        ORDER BY s.created_at DESC`,
      params,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/delivery-cod/settle ──────────────────────────────────
// Records a settlement and marks every order it covers as settled, in one
// transaction — the same shape as createSupplierPayment's order-locking.
export async function createCodSettlement(req, res, next) {
  const client = await pool.connect();
  try {
    const { delivery_partner, amount, method, settled_date, note, order_ids } = req.body || {};

    if (!(await isValidDeliveryPartner(req.user?.com_id, delivery_partner, { requireActive: false }))) {
      res.status(400);
      throw new Error(`delivery_partner is not a known, active partner: ${delivery_partner}`);
    }
    const parsedAmount = parsePositiveDecimal(amount, "amount");
    if (parsedAmount > MAX_AMOUNT) {
      res.status(400);
      throw new Error(`amount cannot exceed ${MAX_AMOUNT.toLocaleString()}`);
    }
    if (!SETTLEMENT_METHODS.includes(method)) {
      res.status(400);
      throw new Error(`method must be one of: ${SETTLEMENT_METHODS.join(", ")}`);
    }
    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      res.status(400);
      throw new Error("order_ids must be a non-empty array — a settlement must cover specific orders");
    }
    const ids = order_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length !== order_ids.length) {
      res.status(400);
      throw new Error("order_ids must all be positive integers");
    }

    const b_id = writeBranchId(req, req.body?.b_id);
    if (!b_id) {
      res.status(400);
      throw new Error("b_id is required");
    }

    await client.query("BEGIN");

    // Lock the orders so two settlements recorded at the same moment cannot
    // both claim the same outstanding order.
    const scopedParams = [ids];
    const scope = branchClause(req, "b_id", scopedParams);
    const orders = await client.query(
      `SELECT or_id, delivery_partner, payment_method, cod_settlement_id
         FROM "ORDER"
        WHERE or_id = ANY($1::int[]) ${scope ? `AND ${scope}` : ""}
        FOR UPDATE`,
      scopedParams,
    );

    if (orders.rows.length !== ids.length) {
      res.status(404);
      throw new Error("One or more orders were not found");
    }
    const bad = orders.rows.find(
      (o) => o.delivery_partner !== delivery_partner || o.payment_method !== "cod" || o.cod_settlement_id != null,
    );
    if (bad) {
      res.status(409);
      throw new Error(
        `Order #${bad.or_id} is not an outstanding COD order for ${delivery_partner} — it may already be settled.`,
      );
    }

    const settlement = await client.query(
      `INSERT INTO "DELIVERY_COD_SETTLEMENT" (b_id, delivery_partner, amount, settled_date, method, note, created_by)
       VALUES ($1, $2, $3, COALESCE($4::DATE, CURRENT_DATE), $5, $6, $7)
       RETURNING settlement_id, b_id, delivery_partner, amount, settled_date, method, note, created_at`,
      [b_id, delivery_partner, parsedAmount, settled_date || null, method, note?.trim() || null, req.user?.u_id ?? null],
    );

    await client.query(
      `UPDATE "ORDER" SET cod_settlement_id = $1 WHERE or_id = ANY($2::int[])`,
      [settlement.rows[0].settlement_id, ids],
    );

    await client.query("COMMIT");

    logActivity(req, {
      action: "payment",
      entity: "delivery_cod_settlement",
      entity_id: settlement.rows[0].settlement_id,
      b_id,
      summary: `Settled ${parsedAmount.toFixed(2)} (${method}) from ${delivery_partner} covering ${ids.length} order(s)`,
      details: { delivery_partner, amount: parsedAmount, method, order_ids: ids },
    });

    res.status(201).json({ ...settlement.rows[0], order_ids: ids });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}
