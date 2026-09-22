// utils/cashDrawer.js
//
// What should be in the drawer?
//
// The arithmetic is not hard; getting it wrong is expensive, so it lives in one
// place and is used by both the live "what should be there now" view and the
// figure frozen onto a closed shift.
//
//   opening float
// + cash taken for sales during the shift
// - cash handed back for refunds
// + money put in   (topping up change)
// - money taken out (a supplier paid from the drawer, a run to the safe)
// = expected cash
//
// Card and room-charge (billed-to-folio) sales are deliberately absent: no note
// ever entered the drawer for them. A guest's cash advance or settlement is
// different — that is a note handed across the desk into this same drawer — so
// it counts, the same as a restaurant cash sale.

/** Tenders that put physical money in the drawer. Everything else does not. */
export const CASH_TENDERS = ["cash"];

/**
 * The sales, movements and totals for one session.
 *
 * Voided sales are excluded by status: a void returns the money, so it must not
 * count towards what should be in the drawer. That is also why a void needs a
 * manager — it is the one action that lowers the expected figure.
 */
export async function sessionTotals(db, session_id) {
  const [sales, movements, hotel] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM("or_totalCostWtax") FILTER (
           WHERE payment_method = ANY($2::text[]) AND or_status <> 'cancelled'), 0) AS cash_sales,
         COUNT(*) FILTER (
           WHERE payment_method = ANY($2::text[]) AND or_status <> 'cancelled') AS cash_orders,
         COALESCE(SUM("or_totalCostWtax") FILTER (
           WHERE (payment_method IS NULL OR payment_method <> ALL($2::text[]))
             AND or_status <> 'cancelled'), 0) AS non_cash_sales,
         COALESCE(SUM("or_totalCostWtax") FILTER (WHERE or_status = 'cancelled'), 0) AS voided_value,
         COUNT(*) FILTER (WHERE or_status = 'cancelled') AS voided_orders,
         COUNT(*) AS total_orders
       FROM "ORDER" WHERE session_id = $1`,
      [session_id, CASH_TENDERS],
    ),
    db.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE kind = 'pay_in'), 0)  AS pay_in,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'pay_out'), 0) AS pay_out,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'drop'), 0)    AS drops
       FROM "CASH_MOVEMENT" WHERE session_id = $1`,
      [session_id],
    ),
    // A guest's cash advance or settlement, taken against this same drawer. A
    // refund handed back in cash comes back out of it, the same as a void.
    db.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE method = ANY($2::text[]) AND kind <> 'refund'), 0) AS hotel_cash_in,
         COALESCE(SUM(amount) FILTER (WHERE method = ANY($2::text[]) AND kind = 'refund'), 0)   AS hotel_cash_refunds,
         COUNT(*) FILTER (WHERE method = ANY($2::text[])) AS hotel_cash_payments
       FROM "BOOKING_PAYMENT" WHERE session_id = $1`,
      [session_id, CASH_TENDERS],
    ),
  ]);

  const [s, m, h] = [sales.rows[0], movements.rows[0], hotel.rows[0]];
  const n = (v) => Number(v || 0);

  return {
    cash_sales:     +n(s.cash_sales).toFixed(2),
    cash_orders:     Number(s.cash_orders),
    non_cash_sales: +n(s.non_cash_sales).toFixed(2),
    voided_value:   +n(s.voided_value).toFixed(2),
    voided_orders:   Number(s.voided_orders),
    total_orders:    Number(s.total_orders),
    pay_in:         +n(m.pay_in).toFixed(2),
    pay_out:        +n(m.pay_out).toFixed(2),
    drops:          +n(m.drops).toFixed(2),
    hotel_cash_in:      +n(h.hotel_cash_in).toFixed(2),
    hotel_cash_refunds: +n(h.hotel_cash_refunds).toFixed(2),
    hotel_cash_payments: Number(h.hotel_cash_payments),
  };
}

/** expected = float + cash sales + pay-ins - pay-outs - drops */
export function expectedCash(openingFloat, totals) {
  return +(
    Number(openingFloat || 0)
    + totals.cash_sales
    + totals.pay_in
    - totals.pay_out
    - totals.drops
    + (totals.hotel_cash_in || 0)
    - (totals.hotel_cash_refunds || 0)
  ).toFixed(2);
}

/**
 * How far out is too far?
 *
 * A few rupees is rounding and honest error; a cashier should not have to fetch
 * a manager over it, or they will start "fixing" the count to avoid the walk —
 * which is exactly the habit that hides real shortages. Past the limit, the
 * variance is a fact somebody with authority has to look at and sign.
 */
export const VARIANCE_LIMIT = Number(process.env.CASH_VARIANCE_LIMIT || 100);

export const varianceNeedsApproval = (variance) =>
  Math.abs(Number(variance || 0)) > VARIANCE_LIMIT;

/** Plain words for a number that is easy to read the wrong way round. */
export function describeVariance(variance) {
  const v = +Number(variance || 0).toFixed(2);
  if (Math.abs(v) < 0.01) return { state: "balanced", text: "The drawer balances exactly." };
  return v < 0
    ? { state: "short", text: `The drawer is short by ${Math.abs(v).toFixed(2)}.` }
    : { state: "over",  text: `The drawer is over by ${v.toFixed(2)}.` };
}
