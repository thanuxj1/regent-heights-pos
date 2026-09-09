// utils/occupancy.js
//
// When does a booking actually give the room back?
//
// Not on its check-out date. A guest who has checked in holds the room until
// somebody checks them out — their scheduled departure passing does not put
// them and their luggage on the pavement. Until 2026-09-09 four separate
// queries decided occupancy from the date range alone, so the morning after a
// guest was due to leave:
//
//   • the rack showed their room available (or "dirty", falling through to
//     housekeeping status), while the bookings list still said In House;
//   • availability offered the room to the next caller;
//   • and the overlap guard raised no clash, so the front desk could sell an
//     occupied room. Reproduced: a walk-in was given a room with a guest in it.
//
// The rule, in one place, used by all four.

/**
 * SQL for the date a booking releases its room.
 *
 * A checked-in stay is extended to at least tomorrow, so an overstay blocks
 * tonight — but only tonight. Extending it indefinitely would be the opposite
 * error: a guest two days late must not block a booking three weeks out, which
 * the housekeeper will have turned over long before.
 *
 * @param {string} alias  the BOOKING alias in the surrounding query
 */
export const effectiveCheckout = (alias = "b") =>
  `(CASE WHEN ${alias}.status = 'checked_in'
         THEN GREATEST(${alias}.check_out_date, CURRENT_DATE + 1)
         ELSE ${alias}.check_out_date END)`;

/** Statuses that hold a room against anyone else taking it. */
export const HOLDING_STATUSES = ["tentative", "confirmed", "checked_in"];

/**
 * Is this booking past its departure date and still in house?
 * Used to label the rack so the desk can go and chase them.
 */
export const isOverstaying = (booking, today = new Date()) => {
  if (!booking || booking.status !== "checked_in" || !booking.check_out_date) return false;
  const due = new Date(booking.check_out_date);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return due < t;
};
