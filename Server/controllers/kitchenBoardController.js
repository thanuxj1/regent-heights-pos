import pool from "../config/database.js";
import { branchClause } from "../utils/scope.js";

// How long a "Ready" order stays on the board after the kitchen marks it ready.
// By then it has been carried out; the board is for what is cooking or waiting
// at the pass, not the day's history.
export const READY_WINDOW_MINUTES = 30;

/**
 * GET /api/orders/board — what the kitchen is working on right now at the
 * caller's own property: every order waiting or being prepared, and those
 * marked ready in the last half hour, each with its dishes.
 *
 * The waiter's Kitchen Status tab reads this. It used to list only the orders
 * that waiter had placed, so a table rung up at the till or a room-service
 * ticket from the front desk never appeared, and the tab looked dead while the
 * kitchen was busy. The staff who can call this can already read these orders
 * through GET /api/orders; this is the same scope, trimmed to the pass.
 */
export async function getKitchenBoard(req, res) {
  try {
    const values = [READY_WINDOW_MINUTES];
    // The kitchen's own screens want what is at the pass. The till wants that
    // and everything still unpaid, because a ticket the kitchen finished an
    // hour ago is money nobody has collected yet — and it is the same list to
    // the person standing at the counter. Only who sent it differs.
    const forTheTill = String(req.query.scope || "") === "till";
    const atThePass = `(o.or_status IN ('pending', 'preparing')
        OR (o.or_status = 'completed'
            AND o.status_changed_at > NOW() - make_interval(mins => $1::int)))`;
    const unpaid = `(o.payment_method IS NULL AND o.or_status <> 'cancelled'
        AND o.or_type <> 'room_service' AND o.or_date >= CURRENT_DATE - 7)`;
    const conditions = [
      forTheTill ? `(${atThePass} OR ${unpaid})` : atThePass,
      // Nothing on it, nothing to cook. A waiter's order is written a moment
      // before its dishes, and would otherwise flash up empty.
      `EXISTS (SELECT 1 FROM "ORDER_ITEM" i WHERE i.order_id = o.or_id)`,
    ];

    const scope = branchClause(req, "o.b_id", values);
    if (scope) {
      conditions.push(scope);
    } else if (req.query.b_id) {
      // Platform staff see every property, so they name the one they want.
      values.push(Number(req.query.b_id));
      conditions.push(`o.b_id = $${values.length}`);
    }

    values.push(req.user?.u_id ?? null);
    const me = `$${values.length}`;

    const { rows } = await pool.query(
      `SELECT o.or_id, o.or_type, o.or_status, o.or_date::text AS or_date, o.or_time, o.b_id,
              o.table_id, t.table_number, o.room_id, r.room_number,
              o.status_changed_at, o."or_totalCostWtax" AS total,
              o.payment_method, o.kitchen_note, u.role_id AS placed_by_role,
              (o.u_id IS NOT DISTINCT FROM ${me}::int) AS mine,
              TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')) AS placed_by,
              FLOOR(EXTRACT(EPOCH FROM (NOW() - o.status_changed_at)) / 60)::int AS minutes_in_status,
              COALESCE((
                SELECT json_agg(json_build_object('name', COALESCE(bp.pro_name, 'Item'),
                                                  'qty', i.pro_quantity)
                                ORDER BY i."orderItem_id")
                  FROM "ORDER_ITEM" i
                  LEFT JOIN "Branch_Product" bp ON bp."Bpro_id" = i."Bpro_id"
                 WHERE i.order_id = o.or_id), '[]'::json) AS items
         FROM "ORDER" o
         LEFT JOIN "TABLES" t ON t.table_id = o.table_id
         LEFT JOIN "ROOM"   r ON r.room_id  = o.room_id
         LEFT JOIN "User"   u ON u.u_id     = o.u_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY CASE o.or_status WHEN 'completed' THEN 0 WHEN 'preparing' THEN 1 ELSE 2 END,
                 o.or_id DESC
        LIMIT 200`,
      values,
    );

    res.json({
      success: true,
      ready_window_minutes: READY_WINDOW_MINUTES,
      server_time: new Date().toISOString(),
      data: rows,
    });
  } catch (err) {
    console.error("[orders] kitchen board failed:", err);
    res.status(500).json({ success: false, error: "Could not read the kitchen board" });
  }
}
