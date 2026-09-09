// utils/commission.js
//
// An agent earns on the room, not on the dinner. Commission is calculated from
// BOOKING.room_charges at the agent's own rate — food, tax, extras and late
// fees are the hotel's, and were never part of what the rate was agreed on.

/**
 * Bring a booking's commission record in line with the booking.
 *
 * Called after anything that can change the agent, the room rate or the
 * booking's fate. Safe to call repeatedly: there is one record per booking and
 * this rewrites it, so re-saving a booking corrects the figure instead of
 * stacking duplicates.
 *
 * A record already marked `paid` is never touched — that money has left the
 * building, and rewriting history would hide the discrepancy rather than show it.
 *
 * Returns a short description of what changed, or null, for the audit line.
 */
export async function syncBookingCommission(db, booking_id) {
  const { rows } = await db.query(
    `SELECT b.booking_id, b.booking_ref, b.agent_id, b.status, b.check_in_date,
            COALESCE(b.room_charges, 0) AS room_charges,
            a.agent_name, a.commission_rate
     FROM "BOOKING" b
     LEFT JOIN "COMMISSION_AGENT" a ON a.agent_id = b.agent_id
     WHERE b.booking_id = $1`,
    [Number(booking_id)]
  );
  if (!rows.length) return null;
  const b = rows[0];

  const existing = await db.query(
    'SELECT record_id, status, commission_amount FROM "COMMISSION_RECORD" WHERE booking_id = $1',
    [Number(booking_id)]
  );
  const rec = existing.rows[0] || null;

  // Already paid out: leave it exactly as it is.
  if (rec && rec.status === "paid") return null;

  // No agent, or a stay that will never happen — nothing is owed.
  const earns = b.agent_id && !["cancelled", "no_show"].includes(b.status);
  if (!earns) {
    if (rec) {
      await db.query('DELETE FROM "COMMISSION_RECORD" WHERE record_id = $1', [rec.record_id]);
      return "commission removed";
    }
    return null;
  }

  const rate   = Number(b.commission_rate) || 0;
  const amount = +(Number(b.room_charges) * rate / 100).toFixed(2);
  const note   = `Booking ${b.booking_ref} — ${rate}% of room charges`;
  const date   = b.check_in_date;

  if (rec) {
    if (+Number(rec.commission_amount).toFixed(2) === amount) return null;   // nothing moved
    await db.query(
      `UPDATE "COMMISSION_RECORD"
       SET agent_id=$2, commission_amount=$3, record_date=$4, notes=$5
       WHERE record_id=$1`,
      [rec.record_id, b.agent_id, amount, date, note]
    );
    return `commission for ${b.agent_name} updated to ${amount.toFixed(2)}`;
  }

  await db.query(
    `INSERT INTO "COMMISSION_RECORD" (agent_id, booking_id, commission_amount, record_date, status, notes)
     VALUES ($1,$2,$3,$4,'pending',$5)`,
    [b.agent_id, b.booking_id, amount, date, note]
  );
  return `commission of ${amount.toFixed(2)} recorded for ${b.agent_name}`;
}
