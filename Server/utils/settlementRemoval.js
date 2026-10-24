// utils/settlementRemoval.js
//
// Undo a recorded payment for restaurant orders: a rider's cash-on-delivery
// hand-over ("Mark as paid", Delivery COD) or a credit customer paying their
// tab (Credit Sales). Both live in DELIVERY_COD_SETTLEMENT and are tied to the
// orders they paid for through ORDER.cod_settlement_id.
//
// Recorded by mistake — the wrong orders, the wrong amount, the rider had not
// actually paid — the only way back used to be asking support to edit the
// database (order #34's settlement on 2026-10-17). Removing it puts the orders
// back to unpaid, so they show as outstanding again and leave the takings
// until the money really comes in. The Activity Log keeps the removed record.

import pool from "../config/database.js";
import { branchClause } from "./scope.js";
import { logActivity } from "./activityLog.js";
import { checkDeletePin } from "./approval.js";

/**
 * POST …/settlements/:id/delete  body: { reason, pin? } — Administrators only
 * (the route says so). `kind` is "cod" or "credit": each page removes only its
 * own records.
 */
export const removeSettlement = (kind) => async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400); throw new Error("Invalid payment record"); }
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 3) { res.status(400); throw new Error("Say why this payment is being removed — it goes in the Activity Log."); }
    if (reason.length > 200) { res.status(400); throw new Error("That reason is too long (200 characters)."); }

    await client.query("BEGIN");
    const params = [id, kind];
    const scope = branchClause(req, "b_id", params);
    const { rows: [s] } = await client.query(
      `SELECT * FROM "DELIVERY_COD_SETTLEMENT"
        WHERE settlement_id = $1 AND kind = $2 ${scope ? `AND ${scope}` : ""} FOR UPDATE`, params);
    if (!s) { res.status(404); throw new Error("Payment record not found"); }

    const pin = await checkDeletePin(req, s.b_id);
    if (!pin.ok) { res.status(pin.status); throw new Error(pin.message); }

    // The orders it paid for go back to unpaid: outstanding again.
    const { rows: unsorted } = await client.query(
      `UPDATE "ORDER" SET cod_settlement_id = NULL WHERE cod_settlement_id = $1
       RETURNING or_id, "or_totalCostWtax" AS total, or_status`, [id]);
    const orders = unsorted.sort((a, b) => a.or_id - b.or_id);
    await client.query(`DELETE FROM "DELIVERY_COD_SETTLEMENT" WHERE settlement_id = $1`, [id]);
    await client.query("COMMIT");

    const who = kind === "cod" ? `from ${s.delivery_partner || "the rider"}` : `from ${s.customer_name || "the customer"}`;
    const refs = orders.map((o) => "#" + o.or_id).join(", ");
    logActivity(req, {
      action: "delete",
      entity: kind === "cod" ? "delivery_cod_settlement" : "credit_settlement",
      entity_id: id, b_id: s.b_id,
      summary: `Removed a ${kind === "cod" ? "cash-on-delivery" : "credit"} payment of LKR ${Number(s.amount).toFixed(2)} `
             + `(${String(s.method || "").replace(/_/g, " ")}) ${who}`
             + (orders.length ? `; order${orders.length > 1 ? "s" : ""} ${refs} unpaid again` : "")
             + ` — ${reason}. ` + (pin.pinSet ? `PIN: ${pin.approver.name || "manager"}` : "No PIN set at the property"),
      details: { reason, settlement: s, orders, approved_by: pin.approver.u_id, approver: pin.approver.name },
    });
    res.json({ success: true, removed: id, orders_unpaid_again: orders.map((o) => o.or_id) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};
