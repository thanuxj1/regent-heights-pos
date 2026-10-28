// controllers/refundController.js
//
// Money handed back to a restaurant customer after they paid: a dish sent
// back, a drink never brought, an overcharge. The sale stays as it was; the
// refund is its own record (ORDER_REFUND, migration 070), counted on the day
// the money went back. See reportController for where it comes off revenue
// and utils/cashDrawer.js for where a cash refund leaves the drawer.
//
// A void or a delete is for a sale that should never have been rung up; a
// refund is for one that happened. A room-charged order is not refunded here:
// it is taken off the guest's bill instead, which is where its money is.

import pool from "../config/database.js";
import { branchClause } from "../utils/scope.js";
import { hotelToday } from "../utils/hotelTime.js";
import { logActivity } from "../utils/activityLog.js";
import { approveMoneyBack } from "../utils/approval.js";

export const REFUND_METHODS = ["cash", "card", "bank_transfer", "online"];
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/** The order, its lines, and what has been refunded already — or a reason it cannot be. */
async function loadRefundable(db, req, id, { lock = false } = {}) {
  const { rows: [order] } = await db.query(
    `SELECT o.or_id, o.b_id, o.or_status, o.payment_method, o.or_type, o.folio_id, o.cod_settlement_id,
            o.or_date, o.delivery_charge,
            COALESCE(o."or_totalCostWtax", o.or_totalcost, 0) AS total
     FROM "ORDER" o WHERE o.or_id = $1 ${lock ? "FOR NO KEY UPDATE" : ""}`,
    [id]
  );
  const scope = branchClause(req, "b_id", []);
  if (!order || (scope && Number(order.b_id) !== Number(req.user?.b_id))) {
    return { status: 404, message: "Order not found" };
  }
  const { rows: lines } = await db.query(
    `SELECT oi."orderItem_id", oi."Bpro_id", oi.pro_quantity, oi.unit_price,
            COALESCE(oi.total_price, oi.pro_quantity * oi.unit_price) AS line_total,
            COALESCE(bp.pro_name, oi.item_name, 'Item') AS name,
            COALESCE((SELECT SUM(ri.qty) FROM "ORDER_REFUND_ITEM" ri WHERE ri."orderItem_id" = oi."orderItem_id"), 0) AS refunded_qty
     FROM "ORDER_ITEM" oi
     LEFT JOIN "Branch_Product" bp ON bp."Bpro_id" = oi."Bpro_id"
     WHERE oi.order_id = $1
     ORDER BY oi."orderItem_id"`,
    [id]
  );
  const { rows: refunds } = await db.query(
    `SELECT r.refund_id, r.amount, r.method, r.reason, r.refund_date, r.created_at,
            NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS refunded_by,
            NULLIF(TRIM(COALESCE(a.u_fname, '') || ' ' || COALESCE(a.u_lname, '')), '') AS approved_by,
            COALESCE((SELECT json_agg(json_build_object('orderItem_id', ri."orderItem_id", 'qty', ri.qty, 'amount', ri.amount))
                        FROM "ORDER_REFUND_ITEM" ri WHERE ri.refund_id = r.refund_id), '[]') AS items
     FROM "ORDER_REFUND" r
     LEFT JOIN "User" u ON u.u_id = r.refunded_by
     LEFT JOIN "User" a ON a.u_id = r.approved_by
     WHERE r.or_id = $1 ORDER BY r.created_at`,
    [id]
  );
  const total = r2(order.total);
  const refunded = r2(refunds.reduce((n, r) => n + Number(r.amount), 0));

  // Why money cannot go back on this one, if it cannot.
  let blocked = null;
  if (order.or_status === "cancelled") blocked = "This order was voided or deleted, so nothing was kept to refund.";
  else if (order.folio_id) blocked = "This order was charged to a room. Take it off the guest's bill instead.";
  else if (!order.payment_method) blocked = "This order has not been paid yet. Void it instead.";
  else if (order.payment_method === "credit" && !order.cod_settlement_id) blocked = "This credit sale has not been paid yet, so there is nothing to refund.";
  else if (order.or_type === "delivery" && order.payment_method === "cod" && !order.cod_settlement_id) blocked = "The rider has not handed this cash over yet, so there is nothing to refund.";
  else if (refunded >= total - 0.005) blocked = "This order has been refunded in full.";

  // Each line's share of the bill: a line refunded in full gives back what the
  // customer paid for it, discount, service charge and tax included. The
  // delivery charge is not any one dish's, so it is left out of the share.
  const subtotal = lines.reduce((n, l) => n + Number(l.line_total), 0);
  const ratio = subtotal > 0 ? Math.max(total - Number(order.delivery_charge || 0), 0) / subtotal : 0;

  return {
    order: { ...order, total },
    lines: lines.map((l) => ({
      orderItem_id: l.orderItem_id, name: l.name,
      qty: Number(l.pro_quantity), unit_price: Number(l.unit_price),
      refunded_qty: Number(l.refunded_qty),
      refundable_qty: Math.max(Number(l.pro_quantity) - Number(l.refunded_qty), 0),
      // What one of this item gave the house, after the bill's discount and charges.
      paid_each: r2(Number(l.unit_price) * ratio),
    })),
    refunds: refunds.map((r) => ({ ...r, amount: Number(r.amount) })),
    refunded,
    refundable: blocked ? 0 : r2(total - refunded),
    blocked,
  };
}

/** GET /api/orders/:id/refunds — what has gone back, and what still can. */
export async function getOrderRefunds(req, res, next) {
  try {
    const id = Number(req.params.id);
    const r = await loadRefundable(pool, req, id);
    if (r.status) { res.status(r.status); return next(new Error(r.message)); }
    res.json({
      or_id: id, total: r.order.total, payment_method: r.order.payment_method,
      refunded: r.refunded, refundable: r.refundable, blocked: r.blocked,
      lines: r.lines, refunds: r.refunds,
    });
  } catch (err) { next(err); }
}

/**
 * POST /api/orders/:id/refund
 * body: { amount, method, reason, pin, items?: [{ orderItem_id, qty }] }
 *
 * items says which dishes went back (Product Profit takes them off); amount is
 * what is handed over, which may differ from their price (part of a dish, the
 * delivery charge too). Never more than was paid less what has gone back.
 */
export async function createOrderRefund(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 3) { res.status(400); throw new Error("Say why the money is going back — it goes in the Activity Log."); }
    if (reason.length > 200) { res.status(400); throw new Error("That reason is too long (200 characters)."); }
    const amount = r2(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) { res.status(400); throw new Error("Enter the amount being handed back."); }
    const method = String(req.body?.method || "cash");
    if (!REFUND_METHODS.includes(method)) { res.status(400); throw new Error("Choose how the money goes back: cash, card, bank transfer or online."); }

    await client.query("BEGIN");
    const r = await loadRefundable(client, req, id, { lock: true });
    if (r.status) { res.status(r.status); throw new Error(r.message); }
    if (r.blocked) { res.status(409); throw new Error(r.blocked); }
    if (amount > r.refundable + 0.005) {
      res.status(409);
      throw new Error(`Only LKR ${r.refundable.toFixed(2)} of this order can still be refunded.`);
    }

    // Dishes handed back, each no more than is left of its line.
    const byId = new Map(r.lines.map((l) => [Number(l.orderItem_id), l]));
    const items = [];
    for (const it of Array.isArray(req.body?.items) ? req.body.items : []) {
      const qty = Number(it?.qty);
      if (!qty) continue;
      const line = byId.get(Number(it?.orderItem_id));
      if (!line) { res.status(400); throw new Error("That item is not on this order."); }
      if (!(qty > 0) || qty > line.refundable_qty + 1e-9) {
        res.status(409);
        throw new Error(`Only ${line.refundable_qty} × ${line.name} can still be refunded.`);
      }
      items.push({ line, qty, amount: r2(line.paid_each * qty) });
    }

    const ok = await approveMoneyBack(req, r.order.b_id, "give a refund");
    if (!ok.ok) { res.status(ok.status); throw new Error(ok.message); }

    // Cash comes out of the drawer the refunder has open, if they have one.
    const drawer = await client.query(
      `SELECT session_id FROM "CASH_SESSION" WHERE b_id = $1 AND opened_by = $2 AND status = 'open' LIMIT 1`,
      [r.order.b_id, req.user?.u_id ?? null]
    );
    const { rows: [refund] } = await client.query(
      `INSERT INTO "ORDER_REFUND" (or_id, b_id, amount, method, reason, refund_date, refunded_by, approved_by, session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, r.order.b_id, amount, method, reason, hotelToday(), req.user?.u_id ?? null,
       ok.approver?.u_id ?? null, method === "cash" ? drawer.rows[0]?.session_id ?? null : null]
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO "ORDER_REFUND_ITEM" (refund_id, "orderItem_id", qty, amount) VALUES ($1,$2,$3,$4)`,
        [refund.refund_id, it.line.orderItem_id, it.qty, it.amount]
      );
    }
    await client.query("COMMIT");

    const what = items.length ? items.map((it) => `${it.qty} × ${it.line.name}`).join(", ") : "an amount";
    logActivity(req, {
      action: "refund", entity: "order", entity_id: id, b_id: r.order.b_id,
      summary: `Refunded LKR ${amount.toFixed(2)} (${method.replace(/_/g, " ")}) on order #${id} for ${what} — ${reason}. `
             + (ok.approver ? `Approved by ${ok.approver.name || "manager"}` : "No PIN set at the property"),
      details: { refund_id: refund.refund_id, or_id: id, amount, method, reason,
                 items: items.map((it) => ({ orderItem_id: it.line.orderItem_id, name: it.line.name, qty: it.qty, amount: it.amount })),
                 approved_by: ok.approver?.u_id ?? null, approver: ok.approver?.name ?? null },
    });
    res.status(201).json({ success: true, refund: { ...refund, amount: Number(refund.amount) } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}
