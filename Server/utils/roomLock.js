// utils/roomLock.js
//
// Booking a room is a read-then-write: check nothing overlaps, then insert. Two
// requests that read before either writes both see a free room and both take it
// — measured, three simultaneous requests for one room all returned 201.
//
// Locking the ROOM rows first makes concurrent transactions for the same room
// queue up, so the second one's overlap check runs against the first one's
// committed booking. Rooms are locked in id order so two transactions holding
// different rooms can never deadlock waiting for each other's.

import { effectiveCheckout } from "./occupancy.js";

const ACTIVE = ["tentative", "confirmed", "checked_in"];

/**
 * Take the write lock on these rooms and confirm they belong to this property.
 * Must be called inside a transaction, before any overlap check.
 *
 * Returns null when all is well, or { status, message } to fail with.
 */
export async function lockRooms(client, roomIds, b_id) {
  const ids = [...new Set((roomIds || []).map(Number).filter(Boolean))].sort((a, b) => a - b);
  if (!ids.length) return null;

  const { rows } = await client.query(
    `SELECT room_id, room_number, hk_status, is_active FROM "ROOM"
     WHERE room_id = ANY($1::int[]) AND b_id = $2
     ORDER BY room_id
     FOR UPDATE`,
    [ids, Number(b_id)]
  );
  if (rows.length !== ids.length) {
    return { status: 400, message: "One or more of those rooms does not belong to this property" };
  }

  // Availability already hides these, but a room can be taken out of service
  // after a booking screen was opened, and the room id can be posted directly.
  // A guest sent to a room with no working shower is a complaint at the desk,
  // so the refusal belongs here, next to the lock, where every write passes.
  const unusable = rows.find(
    (r) => r.is_active === false || ["out_of_order", "maintenance"].includes(r.hk_status)
  );
  if (unusable) {
    return {
      status: 409,
      message: `Room ${unusable.room_number} is ${
        unusable.is_active === false ? "not in service" : unusable.hk_status.replace("_", " ")
      } and cannot be given to a guest.`,
    };
  }
  return null;
}

/**
 * Is any of these rooms already spoken for over these dates?
 *
 * `ignoreBookingId` lets a booking be edited without clashing with itself.
 * Half-open comparison: a stay ending on the 5th and one starting on the 5th do
 * not overlap, which is how back-to-back nights are sold.
 *
 * The departure side is `effectiveCheckout`, not `check_out_date`: a guest who
 * is still checked in has not left, whatever the calendar says, and their room
 * must not be sold tonight. Without this a walk-in was handed an occupied room.
 */
export async function roomClash(client, roomIds, checkIn, checkOut, ignoreBookingId) {
  const ids = (roomIds || []).map(Number).filter(Boolean);
  if (!ids.length) return null;

  const { rows } = await client.query(
    `SELECT r.room_number FROM "BOOKING_ROOM" br
     JOIN "BOOKING" b ON b.booking_id = br.booking_id
     JOIN "ROOM" r    ON r.room_id = br.room_id
     WHERE br.room_id = ANY($1::int[])
       AND b.status = ANY($2::text[])
       AND b.check_in_date < $4::date AND ${effectiveCheckout("b")} > $3::date
       AND ($5::int IS NULL OR b.booking_id <> $5::int)
     LIMIT 1`,
    [ids, ACTIVE, checkIn, checkOut, ignoreBookingId ?? null]
  );
  return rows.length ? rows[0].room_number : null;
}
