/**
 * What a booking's guests cost, beyond the room itself.
 *
 * The nightly rate covers `included_guests` people. Anyone past that is charged
 * per night: adults at the room type's extra adult rate, children at its extra
 * child rate. Adults take the included places first, so in a room that includes
 * two, a party of two adults and a child pays for the child.
 *
 * Guests are entered once for the whole booking, not room by room, so they are
 * seated here — in the order the rooms were picked, each room taking up to the
 * adults and children it holds, and anyone left over going in the last room
 * (the desk is warned about that, not stopped: a cot is an everyday answer).
 * The seating is written to BOOKING_ROOM, so the bill can show which room each
 * charge came from rather than asserting a total nobody can check.
 *
 * A property that prices purely by the room leaves `included_guests` blank and
 * every figure here is zero.
 */

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * Seat the booking's guests across its rooms.
 * rooms: [{ room_type_id, included_guests, max_adults, max_children,
 *           extra_adult_rate, extra_child_rate, ... }]
 * Returns the same rooms with `adults` and `children` filled in.
 */
export function seatGuests(rooms, adults, children) {
  const seats = rooms.map((r) => ({ ...r, adults: 0, children: 0 }));
  if (!seats.length) return seats;

  let a = Math.max(0, Math.round(num(adults)));
  let c = Math.max(0, Math.round(num(children)));

  // Adults first, then children, each room taking what it holds. A room with no
  // stated limit takes whatever is left, which is the old behaviour for a
  // property that has not filled these in.
  for (const seat of seats) {
    if (a <= 0) break;
    const room = seat.max_adults == null ? a : Math.max(0, num(seat.max_adults));
    const take = Math.min(a, room);
    seat.adults += take;
    a -= take;
  }
  for (const seat of seats) {
    if (c <= 0) break;
    const room = seat.max_children == null ? c : Math.max(0, num(seat.max_children));
    const take = Math.min(c, room);
    seat.children += take;
    c -= take;
  }

  // Anyone the rooms could not hold still has to sleep somewhere.
  if (a > 0 || c > 0) {
    const last = seats[seats.length - 1];
    last.adults += a;
    last.children += c;
  }
  return seats;
}

/**
 * What the seated guests cost per night, room by room.
 * Returns { total, lines: [{ room_type_id, extra_adults, extra_children, amount }] }
 */
export function guestCharges(seatedRooms, nights) {
  const n = Math.max(0, num(nights));
  const lines = [];
  let total = 0;

  for (const room of seatedRooms) {
    // No stated inclusion means the rate covers the room, whoever is in it.
    if (room.included_guests == null) continue;

    const included = Math.max(0, num(room.included_guests));
    const adults = Math.max(0, num(room.adults));
    const children = Math.max(0, num(room.children));

    const adultsIncluded = Math.min(adults, included);
    const placesLeft = included - adultsIncluded;
    const childrenIncluded = Math.min(children, placesLeft);

    const extraAdults = adults - adultsIncluded;
    const extraChildren = children - childrenIncluded;
    if (extraAdults <= 0 && extraChildren <= 0) continue;

    const amount = +(
      (extraAdults * num(room.extra_adult_rate) + extraChildren * num(room.extra_child_rate)) * n
    ).toFixed(2);
    if (amount === 0) continue;

    total += amount;
    lines.push({
      room_type_id: room.room_type_id ?? null,
      room_id: room.room_id ?? null,
      extra_adults: extraAdults,
      extra_children: extraChildren,
      adult_rate: num(room.extra_adult_rate),
      child_rate: num(room.extra_child_rate),
      amount,
    });
  }

  return { total: +total.toFixed(2), lines };
}

/**
 * Where a party does not fit the rooms picked. Advisory on purpose: the desk
 * decides, and a warning it can act on beats a refusal it has to work around.
 */
export function occupancyWarnings(seatedRooms) {
  const out = [];
  for (const room of seatedRooms) {
    const name = room.type_name || `room type ${room.room_type_id}`;
    if (room.max_adults != null && room.adults > num(room.max_adults)) {
      out.push(`${name} takes ${num(room.max_adults)} adult${num(room.max_adults) === 1 ? "" : "s"}`
        + `, and ${room.adults} are booked into it.`);
    }
    if (room.max_children != null && room.children > num(room.max_children)) {
      out.push(`${name} takes ${num(room.max_children)} child${num(room.max_children) === 1 ? "" : "ren"}`
        + `, and ${room.children} are booked into it.`);
    }
  }
  return out;
}
