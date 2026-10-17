// utils/sales.js
//
// Which orders are restaurant takings — the same rule Reports uses
// (reportController.js): not cancelled, not on a guest's room bill (that is
// hotel revenue), and a credit sale or cash-on-delivery order only once its
// money is in.
//
// Several screens used to count only orders the kitchen had marked
// "completed". A property that cooks from the printed KOT never marks
// anything, so those screens showed a fraction of the day's sales.

/** SQL condition: the order (aliased `o`) is a sale whose money is in. */
export const soldOrder = (o = "o") =>
  `(${o}.or_status <> 'cancelled' AND ${o}.folio_id IS NULL
    AND NOT ((${o}.payment_method = 'credit' OR (${o}.or_type = 'delivery' AND ${o}.payment_method = 'cod'))
             AND ${o}.cod_settlement_id IS NULL))`;
