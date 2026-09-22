import pool from "../config/database.js";
import { emitSocketEvent, getBranchSocketRoom } from "../utils/socket.js";
import { logActivity } from "../utils/activityLog.js";
import { effectiveCheckout } from "../utils/occupancy.js";
import { hotelToday } from "../utils/hotelTime.js";
import { branchClause, writeBranchId, assertInScope, assertBookingInScope } from "../utils/scope.js";
import {
  moneyField, countField, pctField, textField, timeField, dateField, oneOf,
  cleanGuest, assertTotals, assertOccupancy, assertNotInThePast,
  BOOKING_SOURCES, BOOKING_STATUSES, PAYMENT_METHODS, PAYMENT_KINDS, FOLIO_SOURCES,
  MAX_NIGHTS, MAX_MONEY,
} from "../utils/validate.js";
import { lateCheckoutFee, prettyTime, cancellationLine, termsLines, SUGGESTED_TERMS, POLICY_DEFAULTS } from "../utils/stayPolicy.js";
import { syncBookingCommission } from "../utils/commission.js";
import { lockRooms, roomClash } from "../utils/roomLock.js";
import { seatGuests, guestCharges, occupancyWarnings } from "../utils/guestCharges.js";
import { takeStock, noteShortfall } from "../utils/inventory.js";

/**
 * Tell every front desk on this branch that the rack/calendar is stale.
 * Fire-and-forget: a socket problem must never fail a check-in.
 */
function announce(b_id, payload) {
  try {
    if (b_id) emitSocketEvent("booking:changed", payload, { room: getBranchSocketRoom(b_id) });
  } catch { /* non-critical */ }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function nightsBetween(inDate, outDate) {
  const a = new Date(inDate + "T00:00:00");
  const b = new Date(outDate + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

async function nextBookingRef(client) {
  const { rows } = await client.query("SELECT nextval('booking_ref_seq') AS n");
  const year = new Date().getFullYear();
  return `RH-${year}-${String(rows[0].n).padStart(4, "0")}`;
}

/**
 * Price a booking the same way the paper confirmation does:
 *   room charges -> tax on room charges -> guests past what the rate includes
 *   -> meal inclusions (tax inclusive) -> extras -> discount -> grand total
 *
 * Tax is charged on the room and nothing else, which is how it has always been
 * here: not on meals, not on extras, and not on the extra-guest lines.
 */
function priceBooking({ rooms, nights, adults, children, taxPct, extras, discount }) {
  const room_charges = rooms.reduce((s, r) => s + num(r.rate_per_night) * nights, 0);
  const guests = guestCharges(rooms, nights);
  const tax_amount  = room_charges * (num(taxPct, 0) / 100);
  const grand_total = room_charges + tax_amount + guests.total
    + num(extras) - num(discount);
  return {
    room_charges:   +room_charges.toFixed(2),
    person_charges: guests.total,
    person_lines:   guests.lines,
    meal_charges:   0,
    tax_amount:     +tax_amount.toFixed(2),
    grand_total:    +grand_total.toFixed(2),
  };
}

/** House rules for a property, falling back to the defaults if none were saved. */
async function loadPolicy(db, b_id) {
  const { rows } = await db.query('SELECT * FROM "HOTEL_POLICY" WHERE b_id = $1', [Number(b_id)]);
  const row = rows[0] || {};
  // The numbers fall back to working defaults, because the desk needs some rule
  // to price a late check-out. What a GUEST reads is different: the times, the
  // cancellation rule and the terms are printed only once the owner has saved
  // them (policy_saved), never as defaults the hotel did not choose.
  return { ...POLICY_DEFAULTS, ...row, extra_terms: row.extra_terms ?? "", policy_saved: Boolean(row.policy_saved) };
}

/** The booking's own nightly rate: what its rooms cost per night, added up. */
async function nightlyRateFor(db, booking_id) {
  const { rows } = await db.query(
    'SELECT COALESCE(SUM(rate_per_night),0) AS r FROM "BOOKING_ROOM" WHERE booking_id = $1',
    [Number(booking_id)]
  );
  return num(rows[0]?.r);
}

const BOOKING_SELECT = `
  SELECT b.*,
         g.full_name AS guest_name, g.phone AS guest_phone, g.email AS guest_email,
         g.country AS guest_country, g.nationality AS guest_nationality,
         a.agent_name,
         f.folio_id,
         COALESCE(pay.paid_total, 0) AS paid_total
  FROM "BOOKING" b
  LEFT JOIN "GUEST" g       ON g.guest_id = b.guest_id
  LEFT JOIN "COMMISSION_AGENT" a ON a.agent_id = b.agent_id
  LEFT JOIN "FOLIO" f       ON f.booking_id = b.booking_id
  LEFT JOIN LATERAL (
    SELECT SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END) AS paid_total
    FROM "BOOKING_PAYMENT" WHERE booking_id = b.booking_id
  ) pay ON TRUE
`;

async function attachRooms(bookings) {
  if (!bookings.length) return bookings;
  const ids = bookings.map(b => b.booking_id);
  const { rows } = await pool.query(
    `SELECT br.*, rt.type_name, rt.type_code, r.room_number
     FROM "BOOKING_ROOM" br
     JOIN "ROOM_TYPE" rt ON rt.room_type_id = br.room_type_id
     LEFT JOIN "ROOM" r  ON r.room_id = br.room_id
     WHERE br.booking_id = ANY($1::int[])`,
    [ids]
  );
  const byBooking = {};
  rows.forEach(r => { (byBooking[r.booking_id] ||= []).push(r); });
  bookings.forEach(b => { b.rooms = byBooking[b.booking_id] || []; });
  return bookings;
}

// ─── GUESTS ──────────────────────────────────────────────────────────────────

export async function getGuests(req, res, next) {
  try {
    const { search } = req.query;
    const params = [];
    const clauses = [];
    const scope = branchClause(req, "b_id", params);
    if (scope) clauses.push(scope);
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      const n = params.length;
      clauses.push(`(full_name ILIKE $${n} OR phone ILIKE $${n} OR email ILIKE $${n} OR passport_nic ILIKE $${n})`);
    }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT * FROM "GUEST" ${where} ORDER BY full_name LIMIT 200`, params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

const GUEST_FIELDS = [
  "full_name","email","phone","country","nationality","passport_nic",
  "passport_issue_date","passport_expiry_date","date_of_birth","address",
  "company","guest_status","chauffeur_name","chauffeur_phone","next_destination","notes",
];

export async function createGuest(req, res, next) {
  try {
    const clean = cleanGuest(req.body, { requireName: true });
    const vals = GUEST_FIELDS.map(f => {
      const v = clean[f];
      return v === undefined || v === "" ? null : v;
    });
    vals.push(writeBranchId(req));
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(",");
    const { rows } = await pool.query(
      `INSERT INTO "GUEST" (${GUEST_FIELDS.map(f => `"${f}"`).join(",")}, b_id)
       VALUES (${placeholders}) RETURNING *`,
      vals
    );
    logActivity(req, { action: "create", entity: "guest", entity_id: rows[0].guest_id, b_id: rows[0].b_id,
      summary: `Added guest ${rows[0].full_name}` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateGuest(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "GUEST", idColumn: "guest_id", id });
    const clean = cleanGuest(req.body, { requireName: false });
    const sets = [];
    const vals = [];
    GUEST_FIELDS.forEach(f => {
      if (req.body[f] !== undefined) {
        vals.push(clean[f] === "" ? null : clean[f]);
        sets.push(`"${f}" = $${vals.length}`);
      }
    });
    if (!sets.length) { res.status(400); return next(new Error("No fields to update")); }
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE "GUEST" SET ${sets.join(", ")} WHERE guest_id = $${vals.length} RETURNING *`, vals
    );
    if (!rows.length) { res.status(404); return next(new Error("Guest not found")); }
    logActivity(req, { action: "update", entity: "guest", entity_id: id, b_id: rows[0].b_id,
      summary: `Updated guest ${rows[0].full_name}` });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ─── AVAILABILITY ────────────────────────────────────────────────────────────

/** GET /api/hotel/availability?b_id=&check_in=&check_out= */
export async function getAvailability(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }
    const checkIn  = dateField(req.query.check_in,  "Check-in date",  { required: true });
    const checkOut = dateField(req.query.check_out, "Check-out date", { required: true });
    if (nightsBetween(checkIn, checkOut) < 1) {
      res.status(400); return next(new Error("check_out must be after check_in"));
    }
    // Editing a booking: its own rooms are not "taken" by itself.
    const excludeId = Number.isInteger(Number(req.query.exclude_booking)) && Number(req.query.exclude_booking) > 0
      ? Number(req.query.exclude_booking) : null;

    // A room is free when no active booking overlaps [check_in, check_out) —
    // where a checked-in guest occupies until checked out, not until their
    // departure date passes.
    //
    // The interval is half-open on purpose: a guest leaving on the 24th and a
    // guest arriving on the 24th do not overlap, because the room is handed back
    // in the morning and the next guest arrives in the afternoon.
    //
    // Each room also says why it is taken, and where a same-day hand-over is
    // involved, so the desk can see the reason instead of a bare "fully booked".
    const who = (extraWhere) => `
      SELECT json_build_object(
               'booking_id', b.booking_id, 'booking_ref', b.booking_ref, 'guest_name', g.full_name,
               'status', b.status, 'check_in', b.check_in_date::text, 'due_out', b.check_out_date::text,
               'check_out', ${effectiveCheckout("b")}::text)
        FROM "BOOKING_ROOM" br
        JOIN "BOOKING" b ON b.booking_id = br.booking_id
        JOIN "GUEST" g   ON g.guest_id = b.guest_id
       WHERE br.room_id = r.room_id
         AND b.status IN ('tentative','confirmed','checked_in')
         AND ($4::int IS NULL OR b.booking_id <> $4::int)
         AND ${extraWhere}
       ORDER BY b.check_in_date
       LIMIT 1`;

    const { rows } = await pool.query(
      `SELECT r.room_id, r.room_number, r.floor, r.hk_status,
              rt.room_type_id, rt.type_name, rt.type_code, rt.base_rate,
              rt.included_guests, rt.max_adults, rt.max_children, rt.extra_adult_rate, rt.extra_child_rate,
              rt.description, rt.amenities, rt.images,
              NOT EXISTS (
                SELECT 1 FROM "BOOKING_ROOM" br
                JOIN "BOOKING" b ON b.booking_id = br.booking_id
                WHERE br.room_id = r.room_id
                  AND b.status IN ('tentative','confirmed','checked_in')
                  AND ($4::int IS NULL OR b.booking_id <> $4::int)
                  AND b.check_in_date  < $3::date
                  AND ${effectiveCheckout("b")} > $2::date
              ) AS is_available,
              (${who(`b.check_in_date < $3::date AND ${effectiveCheckout("b")} > $2::date`)}) AS blocked_by,
              (${who(`b.check_out_date = $2::date AND ${effectiveCheckout("b")} <= $2::date`)}) AS leaving_that_day,
              (${who(`b.check_in_date = $3::date`)}) AS arriving_that_day
       FROM "ROOM" r
       JOIN "ROOM_TYPE" rt ON rt.room_type_id = r.room_type_id
       WHERE r.b_id = $1
         AND r.is_active = TRUE
         AND r.hk_status NOT IN ('out_of_order','maintenance')
       ORDER BY rt.type_name, r.room_number`,
      [b_id, checkIn, checkOut, excludeId]
    );

    const nights = nightsBetween(checkIn, checkOut);
    const byType = {};
    rows.forEach(r => {
      const t = (byType[r.room_type_id] ||= {
        room_type_id: r.room_type_id, type_name: r.type_name, type_code: r.type_code,
        base_rate: r.base_rate, included_guests: r.included_guests,
        max_adults: r.max_adults, max_children: r.max_children,
        extra_adult_rate: r.extra_adult_rate, extra_child_rate: r.extra_child_rate,
        description: r.description, amenities: r.amenities, images: r.images,
        available_rooms: [], total_rooms: 0,
      });
      t.total_rooms++;
      if (r.is_available) {
        t.available_rooms.push({
          room_id: r.room_id, room_number: r.room_number, floor: r.floor, hk_status: r.hk_status,
          // Someone checking out that morning / checking in the day we leave.
          leaving_that_day: r.leaving_that_day || null,
          arriving_that_day: r.arriving_that_day || null,
        });
      } else {
        (t.unavailable_rooms ||= []).push({
          room_id: r.room_id, room_number: r.room_number, blocked_by: r.blocked_by || null,
        });
      }
    });

    res.json({ check_in: checkIn, check_out: checkOut, nights, room_types: Object.values(byType) });
  } catch (err) { next(err); }
}

// ─── BOOKINGS ────────────────────────────────────────────────────────────────

export async function getBookings(req, res, next) {
  try {
    const { status, from, to, search } = req.query;
    const params = [];
    const clauses = [];
    const scope = branchClause(req, "b.b_id", params);
    if (scope) clauses.push(scope);
    if (status) { params.push(status);       clauses.push(`b.status = $${params.length}`); }
    if (from)   { params.push(from);         clauses.push(`b.check_out_date >= $${params.length}`); }
    if (to)     { params.push(to);           clauses.push(`b.check_in_date  <= $${params.length}`); }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      clauses.push(`(b.booking_ref ILIKE $${params.length} OR g.full_name ILIKE $${params.length} OR g.phone ILIKE $${params.length})`);
    }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    const { rows } = await pool.query(
      `${BOOKING_SELECT} ${where} ORDER BY b.check_in_date DESC, b.booking_id DESC LIMIT 300`,
      params
    );
    res.json(await attachRooms(rows));
  } catch (err) { next(err); }
}

export async function getBookingById(req, res, next) {
  try {
    await assertBookingInScope(req, res, req.params.id);
    const { rows } = await pool.query(
      `${BOOKING_SELECT} WHERE b.booking_id = $1`, [Number(req.params.id)]
    );
    if (!rows.length) { res.status(404); return next(new Error("Booking not found")); }
    const [booking] = await attachRooms(rows);

    const payments = await pool.query(
      `SELECT bp.*, u.u_fname || ' ' || u.u_lname AS received_by_name
       FROM "BOOKING_PAYMENT" bp
       LEFT JOIN "User" u ON u.u_id = bp.received_by
       WHERE bp.booking_id = $1 ORDER BY bp.paid_at`,
      [booking.booking_id]
    );
    booking.payments = payments.rows;
    res.json(booking);
  } catch (err) { next(err); }
}

/** POST /api/hotel/bookings */
export async function createBooking(req, res, next) {
  const client = await pool.connect();
  try {
    const {
      guest_id, guest, agent_id, source, check_in_date, check_out_date,
      adults, children, meal_plan_id, arrival_time, special_requests,
      rooms, tax_pct, extra_charges, discount, promotion, remarks,
      advance_payment, advance_method, status,
    } = req.body;

    // The branch a booking lands in is the caller's own, never the body's.
    const b_id = writeBranchId(req);
    if (!b_id)                       { res.status(400); return next(new Error("b_id is required")); }

    // An existing guest must already belong to this branch, or a booking could
    // be hung off another company's guest record.
    if (guest_id) {
      await assertInScope(req, res, { table: "GUEST", idColumn: "guest_id", id: guest_id });
    }
    if (!Array.isArray(rooms) || !rooms.length) {
      res.status(400); return next(new Error("At least one room is required"));
    }
    const checkIn  = dateField(check_in_date,  "Check-in date",  { required: true });
    const checkOut = dateField(check_out_date, "Check-out date", { required: true });
    assertNotInThePast(checkIn, "Check-in date");
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1)          { res.status(400); return next(new Error("Check-out must be after check-in.")); }
    if (nights > MAX_NIGHTS) { res.status(400); return next(new Error(`A booking cannot run longer than ${MAX_NIGHTS} nights.`)); }

    const adultCount   = countField(adults,   "Adults",   { min: 1, max: 99, dflt: 1 });
    const childCount   = countField(children, "Children", { min: 0, max: 99, dflt: 0 });
    // The tax on a new booking is what was typed, else the hotel's own rate — and
    // that is 0 until the owner sets one, not a rate nobody chose.
    const taxPct       = pctField(tax_pct, "Tax %", num((await loadPolicy(pool, b_id)).default_tax_pct, 0));
    const extrasAmt    = moneyField(extra_charges,   "Extra charges");
    const discountAmt  = moneyField(discount,        "Discount");
    const advanceAmt   = moneyField(advance_payment, "Advance payment");
    const bookingSource  = oneOf(source, "Source", BOOKING_SOURCES, "phone");
    const bookingStatus  = oneOf(status, "Status", BOOKING_STATUSES, "confirmed");
    const advanceMethod  = oneOf(advance_method, "Payment method", PAYMENT_METHODS, "cash");
    const arrivalTime    = timeField(arrival_time, "Arrival time");
    const promotionText  = textField(promotion, "Promotion", 100);
    const requestsText   = textField(special_requests, "Special request", 2000);
    const remarksText    = textField(remarks, "Remarks", 2000);

    // Vet the guest before opening the transaction — nothing here needs the database.
    const newGuest = guest_id ? null : cleanGuest(guest, { requireName: true });

    await client.query("BEGIN");

    // Guest: use existing, or create inline from the reservation form
    let guestId = guest_id ? Number(guest_id) : null;
    if (!guestId) {
      const vals = GUEST_FIELDS.map(f => (newGuest[f] === undefined || newGuest[f] === "" ? null : newGuest[f]));
      vals.push(b_id);
      const ph = vals.map((_, i) => `$${i + 1}`).join(",");
      const g = await client.query(
        `INSERT INTO "GUEST" (${GUEST_FIELDS.map(f => `"${f}"`).join(",")}, b_id)
         VALUES (${ph}) RETURNING guest_id`, vals
      );
      guestId = g.rows[0].guest_id;
    }
    if (!guestId) {
      await client.query("ROLLBACK");
      res.status(400); return next(new Error("A guest is required — pass guest_id or a guest object with full_name"));
    }

    // Lock the rooms, then re-check availability. The lock is what makes this
    // safe: without it two simultaneous requests both read "free" and both book.
    const assigned = rooms.filter(r => r.room_id).map(r => Number(r.room_id));
    if (assigned.length) {
      const bad = await lockRooms(client, assigned, b_id);
      if (bad) {
        await client.query("ROLLBACK");
        res.status(bad.status); return next(new Error(bad.message));
      }
      const taken = await roomClash(client, assigned, checkIn, checkOut);
      if (taken) {
        await client.query("ROLLBACK");
        res.status(409);
        return next(new Error(`Room ${taken} is already booked for those dates`));
      }
    }


    // Fall back to the room type's base rate when no override was typed
    let pricedRooms = [];
    let capacity = 0;
    for (const r of rooms) {
      const rt = await client.query(
        `SELECT room_type_id, type_name, base_rate, included_guests, max_adults, max_children,
                extra_adult_rate, extra_child_rate
           FROM "ROOM_TYPE" WHERE room_type_id = $1`,
        [Number(r.room_type_id)]
      );
      if (!rt.rows.length) {
        await client.query("ROLLBACK");
        res.status(400); return next(new Error(`Unknown room_type_id ${r.room_type_id}`));
      }
      const t = rt.rows[0];
      capacity += num(t.max_adults) + num(t.max_children);
      pricedRooms.push({
        room_id: r.room_id ? Number(r.room_id) : null,
        room_type_id: t.room_type_id,
        type_name: t.type_name,
        rate_per_night: r.rate_per_night != null && r.rate_per_night !== ""
          ? moneyField(r.rate_per_night, "Rate per night")
          : num(t.base_rate),
        included_guests: t.included_guests == null ? null : num(t.included_guests),
        max_adults: t.max_adults == null ? null : num(t.max_adults),
        max_children: t.max_children == null ? null : num(t.max_children),
        extra_adult_rate: num(t.extra_adult_rate),
        extra_child_rate: num(t.extra_child_rate),
      });
    }
    // The party is entered once for the whole booking, so it is seated across
    // the rooms here and written down room by room.
    pricedRooms = seatGuests(pricedRooms, adultCount, childCount);
    assertOccupancy(adultCount, childCount, capacity, pricedRooms.length);

    const totals = priceBooking({
      rooms: pricedRooms, nights,
      adults: adultCount, children: childCount,
      taxPct,
      extras: extrasAmt, discount: discountAmt,
    });
    assertTotals({ totals, extras: extrasAmt, discount: discountAmt, advance: advanceAmt });

    const ref = await nextBookingRef(client);

    const bk = await client.query(
      `INSERT INTO "BOOKING"
        (booking_ref, b_id, guest_id, agent_id, source, check_in_date, check_out_date, nights,
         adults, children, meal_plan_id, arrival_time, special_requests, status,
         room_charges, meal_charges, tax_pct, tax_amount, extra_charges, discount,
         grand_total, advance_paid, promotion, remarks, taken_by, person_charges)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING *`,
      [ref, Number(b_id), guestId, agent_id ? Number(agent_id) : null, bookingSource,
       checkIn, checkOut, nights, adultCount, childCount,
       null, arrivalTime, requestsText,
       bookingStatus,
       totals.room_charges, 0, taxPct, totals.tax_amount,
       extrasAmt, discountAmt, totals.grand_total, advanceAmt,
       promotionText, remarksText, req.user?.u_id || null, totals.person_charges]
    );
    const booking = bk.rows[0];

    for (const r of pricedRooms) {
      await client.query(
        `INSERT INTO "BOOKING_ROOM" (booking_id, room_id, room_type_id, rate_per_night, adults, children)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [booking.booking_id, r.room_id, r.room_type_id, r.rate_per_night, r.adults, r.children]
      );
    }

    // An agent booking earns its commission the moment it is taken, so the
    // agent's profile shows it straight away rather than after check-out.
    await syncBookingCommission(client, booking.booking_id);

    if (advanceAmt > 0) {
      const drawer = await client.query(
        `SELECT session_id FROM "CASH_SESSION" WHERE b_id = $1 AND opened_by = $2 AND status = 'open'`,
        [booking.b_id, req.user?.u_id || null],
      );
      await client.query(
        `INSERT INTO "BOOKING_PAYMENT" (booking_id, amount, method, kind, received_by, session_id)
         VALUES ($1,$2,$3,'advance',$4,$5)`,
        [booking.booking_id, advanceAmt, advanceMethod, req.user?.u_id || null, drawer.rows[0]?.session_id ?? null]
      );
    }

    await client.query("COMMIT");
    announce(booking.b_id, { action: "created", booking_id: booking.booking_id });
    logActivity(req, { action: "create", entity: "booking", entity_id: booking.booking_id, b_id: booking.b_id,
      summary: `Created booking ${booking.booking_ref} — ${totals.grand_total.toFixed(2)}` });
    res.status(201).json(booking);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

/** PUT /api/hotel/bookings/:id — edit + reprice */
/** A DATE column as "YYYY-MM-DD". pg hands DATEs back as local-midnight Dates, and
 *  toISOString() on those is the day before whenever the server is ahead of UTC. */
const dateOnly = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export async function updateBooking(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    await assertBookingInScope(req, res, id);
    await client.query("BEGIN");

    const cur = await client.query('SELECT * FROM "BOOKING" WHERE booking_id = $1 FOR UPDATE', [id]);
    if (!cur.rows.length) {
      await client.query("ROLLBACK");
      res.status(404); return next(new Error("Booking not found"));
    }
    const b = cur.rows[0];
    const given = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
    if (["checked_out", "cancelled"].includes(b.status)) {
      await client.query("ROLLBACK");
      res.status(409); return next(new Error(`Cannot edit a ${b.status} booking`));
    }

    // A booking already under way legitimately has a check-in date in the past,
    // so the "not in the past" rule belongs to creation only.
    const checkIn  = req.body.check_in_date  ? dateField(req.body.check_in_date,  "Check-in date")  : dateOnly(b.check_in_date);
    const checkOut = req.body.check_out_date ? dateField(req.body.check_out_date, "Check-out date") : dateOnly(b.check_out_date);
    const nights   = nightsBetween(checkIn, checkOut);
    if (nights < 1) {
      await client.query("ROLLBACK");
      res.status(400); return next(new Error("Check-out must be after check-in."));
    }
    if (nights > MAX_NIGHTS) {
      await client.query("ROLLBACK");
      res.status(400); return next(new Error(`A booking cannot run longer than ${MAX_NIGHTS} nights.`));
    }

    const adults   = req.body.adults   != null ? countField(req.body.adults,   "Adults",   { min: 1, max: 99, dflt: 1 }) : b.adults;
    const children = req.body.children != null ? countField(req.body.children, "Children", { min: 0, max: 99, dflt: 0 }) : b.children;
    const taxPct   = req.body.tax_pct  != null ? pctField(req.body.tax_pct, "Tax %", 0)                                 : num(b.tax_pct, 0);
    const extras   = req.body.extra_charges != null ? moneyField(req.body.extra_charges, "Extra charges") : num(b.extra_charges);
    const discount = req.body.discount      != null ? moneyField(req.body.discount,      "Discount")      : num(b.discount);

    // Once a guest has checked in, the bill is open: the room charges were posted
    // to the folio at that moment. Moving the dates, the rooms or the prices from
    // here would change the booking and leave the bill saying something else, so
    // those go through the bill (Post Charge). Names, notes and the arrival time
    // are still theirs to correct.
    if (b.status === "checked_in") {
      const moved =
        (Array.isArray(req.body.rooms) && req.body.rooms.length > 0)
        || checkIn !== dateOnly(b.check_in_date) || checkOut !== dateOnly(b.check_out_date)
        || adults !== b.adults || children !== b.children
        || Math.abs(taxPct - num(b.tax_pct, 0)) > 0.001
        || Math.abs(extras - num(b.extra_charges)) > 0.001
        || Math.abs(discount - num(b.discount)) > 0.001;
      if (moved) {
        await client.query("ROLLBACK");
        res.status(409);
        return next(new Error(
          "This guest has already checked in, so the bill is open. Add a night or a charge from the bill; "
          + "here you can change the guest's details, the arrival time and the notes."));
      }
    }

    // Replace room lines when the caller sent a new set
    let pricedRooms;
    let capacity = 0;
    if (Array.isArray(req.body.rooms) && req.body.rooms.length) {
      pricedRooms = [];
      for (const r of req.body.rooms) {
        const rt = await client.query(
          `SELECT room_type_id, type_name, base_rate, included_guests, max_adults, max_children,
                  extra_adult_rate, extra_child_rate
             FROM "ROOM_TYPE" WHERE room_type_id = $1`, [Number(r.room_type_id)]);
        if (!rt.rows.length) {
          await client.query("ROLLBACK");
          res.status(400); return next(new Error(`Unknown room_type_id ${r.room_type_id}`));
        }
        const t = rt.rows[0];
        capacity += num(t.max_adults) + num(t.max_children);
        pricedRooms.push({
          room_id: r.room_id ? Number(r.room_id) : null,
          room_type_id: t.room_type_id,
          type_name: t.type_name,
          rate_per_night: r.rate_per_night != null && r.rate_per_night !== "" ? moneyField(r.rate_per_night, "Rate per night") : num(t.base_rate),
          included_guests: t.included_guests == null ? null : num(t.included_guests),
          max_adults: t.max_adults == null ? null : num(t.max_adults),
          max_children: t.max_children == null ? null : num(t.max_children),
          extra_adult_rate: num(t.extra_adult_rate),
          extra_child_rate: num(t.extra_child_rate),
        });
      }
      pricedRooms = seatGuests(pricedRooms, adults, children);
      // Editing had no overlap check at all, so a booking could be moved onto a
      // room another guest already had. Lock and check before rewriting the lines.
      const wanted = pricedRooms.map(x => x.room_id).filter(Boolean);
      if (wanted.length) {
        const bad = await lockRooms(client, wanted, b.b_id);
        if (bad) {
          await client.query("ROLLBACK");
          res.status(bad.status); return next(new Error(bad.message));
        }
        const taken = await roomClash(client, wanted, checkIn, checkOut, id);
        if (taken) {
          await client.query("ROLLBACK");
          res.status(409);
          return next(new Error(`Room ${taken} is already booked for those dates`));
        }
      }

      await client.query('DELETE FROM "BOOKING_ROOM" WHERE booking_id = $1', [id]);
      for (const r of pricedRooms) {
        await client.query(
          `INSERT INTO "BOOKING_ROOM" (booking_id, room_id, room_type_id, rate_per_night, adults, children)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, r.room_id, r.room_type_id, r.rate_per_night, r.adults, r.children]
        );
      }
    } else {
      const existing = await client.query(
        `SELECT br.*, rt.type_name, rt.included_guests, rt.max_adults, rt.max_children,
                rt.extra_adult_rate, rt.extra_child_rate
           FROM "BOOKING_ROOM" br
           JOIN "ROOM_TYPE" rt ON rt.room_type_id = br.room_type_id
          WHERE br.booking_id = $1 ORDER BY br.booking_room_id`, [id]
      );
      capacity = existing.rows.reduce((sum, r) => sum + num(r.max_adults) + num(r.max_children), 0);
      // The dates may have moved onto another guest's, exactly as when rooms are
      // sent: this branch used to skip the check altogether.
      const kept = existing.rows.map(r => r.room_id).filter(Boolean);
      if (kept.length && b.status !== "checked_in") {
        const taken = await roomClash(client, kept, checkIn, checkOut, id);
        if (taken) {
          await client.query("ROLLBACK");
          res.status(409);
          return next(new Error(`Room ${taken} is already booked for those dates`));
        }
      }
      // And the party may have changed size. Without seating them again the
      // extra-guest charge came out as nothing, because the room's inclusion was
      // never loaded.
      pricedRooms = seatGuests(existing.rows.map(r => ({
        ...r,
        rate_per_night: num(r.rate_per_night),
        included_guests: r.included_guests == null ? null : num(r.included_guests),
        max_adults: r.max_adults == null ? null : num(r.max_adults),
        max_children: r.max_children == null ? null : num(r.max_children),
        extra_adult_rate: num(r.extra_adult_rate),
        extra_child_rate: num(r.extra_child_rate),
      })), adults, children);
      for (const r of pricedRooms) {
        await client.query(
          'UPDATE "BOOKING_ROOM" SET adults = $1, children = $2 WHERE booking_room_id = $3',
          [r.adults, r.children, r.booking_room_id]
        );
      }
    }
    assertOccupancy(adults, children, capacity, pricedRooms.length);

    const totals = priceBooking({ rooms: pricedRooms, nights, adults, children, taxPct, extras, discount });
    // Payments already taken are left alone; an edit may only fail to invert the bill.
    assertTotals({ totals, extras, discount, advance: 0 });

    const { rows } = await client.query(
      `UPDATE "BOOKING" SET
         check_in_date=$1, check_out_date=$2, nights=$3, adults=$4, children=$5,
         meal_plan_id=NULL, tax_pct=$6, extra_charges=$7, discount=$8,
         room_charges=$9, meal_charges=0, tax_amount=$10, grand_total=$11,
         person_charges=$20,
         agent_id      = $12,
         source        = COALESCE($13, source),
         arrival_time  = $14,
         special_requests = $15,
         promotion     = $16,
         remarks       = $17,
         status        = COALESCE($18, status)
       WHERE booking_id = $19 RETURNING *`,
      [checkIn, checkOut, nights, adults, children, taxPct, extras, discount,
       totals.room_charges, totals.tax_amount, totals.grand_total,
       // A field the caller sent replaces what is there — including with nothing.
       // These were COALESCEd, so once an arrival time, a request or an agent had
       // been saved it could never be taken off again.
       given("agent_id") ? (req.body.agent_id ? Number(req.body.agent_id) : null) : b.agent_id,
       oneOf(req.body.source, "Source", BOOKING_SOURCES),
       given("arrival_time") ? timeField(req.body.arrival_time, "Arrival time") : b.arrival_time,
       given("special_requests") ? textField(req.body.special_requests, "Special request", 2000) : b.special_requests,
       given("promotion") ? textField(req.body.promotion, "Promotion", 100) : b.promotion,
       given("remarks") ? textField(req.body.remarks, "Remarks", 2000) : b.remarks,
       oneOf(req.body.status, "Status", BOOKING_STATUSES), id, totals.person_charges]
    );

    // The rate, the discount or the agent may all have moved; recompute.
    const commissionNote = await syncBookingCommission(client, id);

    await client.query("COMMIT");
    logActivity(req, { action: "update", entity: "booking", entity_id: id, b_id: rows[0].b_id,
      summary: `Edited booking ${rows[0].booking_ref} — ${rows[0].check_in_date} to ${rows[0].check_out_date}, total ${rows[0].grand_total}`
             + (commissionNote ? ` (${commissionNote})` : "") });
    announce(rows[0].b_id, { action: "updated", booking_id: rows[0].booking_id });
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

/** POST /api/hotel/bookings/:id/cancel */
export async function cancelBooking(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertBookingInScope(req, res, id);
    const cur = await pool.query('SELECT status FROM "BOOKING" WHERE booking_id = $1', [id]);
    if (!cur.rows.length) { res.status(404); return next(new Error("Booking not found")); }
    if (cur.rows[0].status === "checked_in") {
      res.status(409); return next(new Error("Guest is already checked in — check them out instead"));
    }
    if (cur.rows[0].status === "checked_out") {
      res.status(409); return next(new Error("Cannot cancel a completed stay"));
    }
    // Cancelling twice used to succeed, overwriting the original reason and the
    // timestamp that recorded when the guest actually pulled out.
    if (["cancelled", "no_show"].includes(cur.rows[0].status)) {
      res.status(409);
      return next(new Error(`This booking is already marked "${cur.rows[0].status}"`));
    }
    const { rows } = await pool.query(
      `UPDATE "BOOKING" SET status='cancelled', cancelled_at=NOW(), remarks = COALESCE($2, remarks)
       WHERE booking_id=$1 RETURNING *`,
      [id, req.body?.reason || null]
    );
    // No stay, no commission — unless it has already been paid out, which
    // syncBookingCommission leaves alone for the hotel to chase.
    const commissionNote = await syncBookingCommission(pool, id);

    announce(rows[0].b_id, { action: "cancelled", booking_id: id });
    logActivity(req, { action: "delete", entity: "booking", entity_id: id, b_id: rows[0].b_id,
      summary: `Cancelled booking ${rows[0].booking_ref}` + (commissionNote ? ` (${commissionNote})` : ""),
      details: { reason: req.body?.reason || null } });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

// ─── CHECK-IN ────────────────────────────────────────────────────────────────

/** POST /api/hotel/bookings/:id/check-in  body: { room_assignments: [{booking_room_id, room_id}] } */
export async function checkIn(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    await assertBookingInScope(req, res, id);
    await client.query("BEGIN");

    const bk = await client.query('SELECT * FROM "BOOKING" WHERE booking_id=$1 FOR UPDATE', [id]);
    if (!bk.rows.length) {
      await client.query("ROLLBACK");
      res.status(404); return next(new Error("Booking not found"));
    }
    const b = bk.rows[0];
    if (!["confirmed", "tentative"].includes(b.status)) {
      await client.query("ROLLBACK");
      res.status(409); return next(new Error(`Cannot check in a booking with status "${b.status}"`));
    }

    // A guest is checked in during their booked stay. Nothing looked at the dates
    // before: a booking for the 23rd could be checked in on the 21st, leaving the
    // bill, the room and the record saying the guest arrives two days after they
    // did — and the room held by someone the rack did not expect.
    {
      const today  = hotelToday();
      const arrive = dateOnly(b.check_in_date);
      const leave  = dateOnly(b.check_out_date);
      const nice = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      if (arrive > today) {
        await client.query("ROLLBACK");
        res.status(409);
        return next(new Error(
          `This booking starts on ${nice(arrive)}, not today (${nice(today)}). If the guest has arrived early, `
          + `change the check-in date first: Edit Booking → Check-In, then check them in.`));
      }
      if (leave <= today) {
        await client.query("ROLLBACK");
        res.status(409);
        return next(new Error(
          `This stay was booked to end on ${nice(leave)}. Change the dates with Edit Booking if the guest has `
          + `arrived for a different stay, then check them in.`));
      }
    }

    // Apply any room assignments sent from the check-in screen. lockRooms both
    // holds the rooms for the duration and refuses any that belong to another
    // property — this loop trusted the id it was handed.
    const wanted = (req.body?.room_assignments || []).map(a => Number(a.room_id)).filter(Boolean);
    if (wanted.length) {
      const bad = await lockRooms(client, wanted, b.b_id);
      if (bad) {
        await client.query("ROLLBACK");
        res.status(bad.status); return next(new Error(bad.message));
      }
    }
    for (const a of req.body?.room_assignments || []) {
      await client.query(
        'UPDATE "BOOKING_ROOM" SET room_id=$1 WHERE booking_room_id=$2 AND booking_id=$3',
        [Number(a.room_id), Number(a.booking_room_id), id]
      );
    }

    const brs = await client.query(
      `SELECT br.*, r.room_number, rt.type_name, rt.included_guests
       FROM "BOOKING_ROOM" br
       LEFT JOIN "ROOM" r ON r.room_id = br.room_id
       JOIN "ROOM_TYPE" rt ON rt.room_type_id = br.room_type_id
       WHERE br.booking_id = $1`,
      [id]
    );
    if (brs.rows.some(r => !r.room_id)) {
      await client.query("ROLLBACK");
      res.status(400); return next(new Error("Every room on the booking must be assigned before check-in"));
    }

    // Guard against a room being double-occupied right now
    const clash = await client.query(
      `SELECT r.room_number FROM "BOOKING_ROOM" br
       JOIN "BOOKING" b2 ON b2.booking_id = br.booking_id
       JOIN "ROOM" r ON r.room_id = br.room_id
       WHERE br.room_id = ANY($1::int[]) AND b2.booking_id <> $2
         AND b2.status = 'checked_in' LIMIT 1`,
      [brs.rows.map(r => r.room_id), id]
    );
    if (clash.rows.length) {
      await client.query("ROLLBACK");
      res.status(409); return next(new Error(`Room ${clash.rows[0].room_number} is still occupied`));
    }

    // Open the folio and post the stay charges onto it
    const folio = await client.query(
      `INSERT INTO "FOLIO" (booking_id) VALUES ($1) RETURNING *`, [id]
    );
    const folioId = folio.rows[0].folio_id;
    const post = (source, description, qty, unit, amount) =>
      client.query(
        `INSERT INTO "FOLIO_ITEM" (folio_id, source, description, qty, unit_price, amount, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [folioId, source, description, qty, unit, amount, req.user?.u_id || null]
      );

    for (const r of brs.rows) {
      await post("room", `Room ${r.room_number} (${r.type_name}) × ${b.nights} night(s)`,
                 b.nights, r.rate_per_night, num(r.rate_per_night) * b.nights);
    }
    // Guests past what the rate includes, as their own line: a bill that shows
    // only a second room charge is one the guest cannot check.
    if (num(b.person_charges) > 0) {
      const extra = brs.rows.reduce((acc, r) => {
        const included = r.included_guests == null ? null : num(r.included_guests);
        if (included == null) return acc;
        const adultsIn = Math.min(num(r.adults), included);
        const childrenIn = Math.min(num(r.children), included - adultsIn);
        acc.adults += Math.max(0, num(r.adults) - adultsIn);
        acc.children += Math.max(0, num(r.children) - childrenIn);
        return acc;
      }, { adults: 0, children: 0 });
      const who = [
        extra.adults ? `${extra.adults} adult${extra.adults === 1 ? "" : "s"}` : null,
        extra.children ? `${extra.children} child${extra.children === 1 ? "" : "ren"}` : null,
      ].filter(Boolean).join(" and ");
      await post("guests", `Extra guests — ${who || "beyond the rate"} × ${b.nights} night(s)`,
                 1, b.person_charges, b.person_charges);
    }
    if (num(b.tax_amount) > 0) await post("tax", `Room charges tax (${b.tax_pct}%)`, 1, b.tax_amount, b.tax_amount);
    if (num(b.extra_charges) > 0) await post("misc", "Extra charges", 1, b.extra_charges, b.extra_charges);
    if (num(b.discount) > 0)      await post("discount", "Discount", 1, -num(b.discount), -num(b.discount));


    await client.query(
      `UPDATE "BOOKING" SET status='checked_in', checked_in_at=NOW(), checked_in_by=$2 WHERE booking_id=$1`,
      [id, req.user?.u_id || null]
    );
    await client.query(
      `UPDATE "ROOM" SET hk_status='dirty' WHERE room_id = ANY($1::int[])`,
      [brs.rows.map(r => r.room_id)]
    );

    await client.query("COMMIT");
    announce(b.b_id, { action: "checked_in", booking_id: id });
    logActivity(req, { action: "check_in", entity: "booking", entity_id: id, b_id: b.b_id,
      summary: `Checked in booking ${b.booking_ref}` });
    res.json({ success: true, folio_id: folioId, message: "Checked in" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// ─── FOLIO ───────────────────────────────────────────────────────────────────

/** GET /api/hotel/bookings/:id/folio — the auto-calculated bill */
export async function getFolio(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertBookingInScope(req, res, id);
    const f = await pool.query('SELECT * FROM "FOLIO" WHERE booking_id=$1', [id]);
    if (!f.rows.length) { res.status(404); return next(new Error("No folio — guest has not checked in yet")); }
    const folio = f.rows[0];

    const items = await pool.query(
      `SELECT fi.*, u.u_fname || ' ' || u.u_lname AS posted_by_name
       FROM "FOLIO_ITEM" fi
       LEFT JOIN "User" u ON u.u_id = fi.posted_by
       WHERE fi.folio_id = $1 ORDER BY fi.posted_at`,
      [folio.folio_id]
    );
    const payments = await pool.query(
      'SELECT * FROM "BOOKING_PAYMENT" WHERE booking_id=$1 ORDER BY paid_at', [id]
    );

    const charges = items.rows.reduce((s, i) => s + num(i.amount), 0);
    const paid = payments.rows.reduce(
      (s, p) => s + (p.kind === "refund" ? -num(p.amount) : num(p.amount)), 0
    );

    // What a late departure would add if the guest walked out now. Shown, not
    // charged — the desk needs to be able to say the number out loud, and to
    // waive it, before check-out makes it real.
    const bk = await pool.query(
      'SELECT b_id, check_out_date, status FROM "BOOKING" WHERE booking_id=$1', [id]
    );
    let late = null;
    if (bk.rows.length && bk.rows[0].status === "checked_in") {
      const policy = await loadPolicy(pool, bk.rows[0].b_id);
      const alreadyCharged = items.rows.some(i => i.source === "late_checkout");
      late = {
        ...lateCheckoutFee({
          checkOutDate: bk.rows[0].check_out_date,
          nightlyRate: await nightlyRateFor(pool, id),
          policy,
        }),
        already_charged: alreadyCharged,
      };
      if (alreadyCharged) late.amount = 0;
    }

    res.json({
      ...folio,
      items: items.rows,
      payments: payments.rows,
      total_charges: +charges.toFixed(2),
      total_paid: +paid.toFixed(2),
      balance_due: +(charges - paid).toFixed(2),
      late_checkout: late,
    });
  } catch (err) { next(err); }
}

/** POST /api/hotel/bookings/:id/folio/items — laundry, minibar, anything manual */
export async function postFolioItem(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertBookingInScope(req, res, id);
    const { source, description, qty, unit_price, amount } = req.body;
    const desc = textField(description, "Description", 255, { required: true });
    const src  = oneOf(source, "Charge type", FOLIO_SOURCES, "misc");

    const f = await pool.query(`SELECT * FROM "FOLIO" WHERE booking_id=$1 AND status='open'`, [id]);
    if (!f.rows.length) { res.status(404); return next(new Error("No open folio for this booking")); }

    // A folio carries credit lines as well as charges, so amounts may be negative.
    const q   = qty != null && qty !== "" ? moneyField(qty, "Quantity", { max: 9999 }) : 1;
    const u   = moneyField(unit_price, "Unit price", { min: -MAX_MONEY });
    const amt = amount != null && amount !== ""
      ? moneyField(amount, "Amount", { min: -MAX_MONEY })
      : Math.round(q * u * 100) / 100;

    const { rows } = await pool.query(
      `INSERT INTO "FOLIO_ITEM" (folio_id, source, description, qty, unit_price, amount, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [f.rows[0].folio_id, src, desc, q, u, amt, req.user?.u_id || null]
    );
    logActivity(req, { action: "create", entity: "folio_item", entity_id: rows[0].item_id,
      summary: `Charged "${rows[0].description}" (${rows[0].amount}) to booking #${id}` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteFolioItem(req, res, next) {
  try {
    const owner = await pool.query(
      `SELECT f.booking_id FROM "FOLIO_ITEM" fi
       JOIN "FOLIO" f ON f.folio_id = fi.folio_id
       WHERE fi.item_id = $1`,
      [Number(req.params.itemId)]
    );
    if (!owner.rows.length) { res.status(404); return next(new Error("Item not found")); }
    await assertBookingInScope(req, res, owner.rows[0].booking_id);
    const item = await pool.query(
      'SELECT description, amount FROM "FOLIO_ITEM" WHERE item_id = $1', [Number(req.params.itemId)]);

    const { rowCount } = await pool.query(
      `DELETE FROM "FOLIO_ITEM" fi USING "FOLIO" f
       WHERE fi.item_id=$1 AND fi.folio_id=f.folio_id AND f.status='open'`,
      [Number(req.params.itemId)]
    );
    if (!rowCount) { res.status(404); return next(new Error("Item not found, or its folio is already closed")); }
    logActivity(req, { action: "delete", entity: "folio_item", entity_id: req.params.itemId,
      summary: `Removed "${item.rows[0]?.description ?? "an item"}" (${item.rows[0]?.amount ?? "?"}) from booking #${owner.rows[0].booking_id}` });
    res.status(204).send();
  } catch (err) { next(err); }
}

/** POST /api/hotel/bookings/:id/payments */
export async function addPayment(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertBookingInScope(req, res, id);
    const { amount, method, kind, reference } = req.body;
    const paid = moneyField(amount, "Amount");
    if (!(paid > 0)) { res.status(400); return next(new Error("Amount must be greater than zero.")); }
    const payMethod = oneOf(method, "Payment method", PAYMENT_METHODS, "cash");
    const payKind   = oneOf(kind,   "Payment type",   PAYMENT_KINDS,   "settlement");
    const payRef    = textField(reference, "Reference", 100);

    // You cannot give back money that was never taken.
    //
    // Without this a refund of any size was accepted: 50,000 handed back against
    // a 5,000 payment left the folio at -45,000 paid, which reads as the guest
    // owing 45,000 more than they do — and is 45,000 in cash out of the drawer
    // with a receipt to justify it. Refunds are capped at what this booking has
    // actually received.
    if (payKind === "refund") {
      const { rows: net } = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -amount ELSE amount END),0) AS paid
         FROM "BOOKING_PAYMENT" WHERE booking_id=$1`,
        [id]
      );
      const available = Number(net[0].paid);
      if (paid > available + 0.01) {
        res.status(400);
        return next(new Error(
          available <= 0
            ? "Nothing has been paid on this booking, so there is nothing to refund."
            : `Only LKR ${available.toFixed(2)} has been paid on this booking; `
              + `a refund cannot exceed it.`
        ));
      }
    }

    // The same drawer a restaurant sale would use — a room payment taken in cash
    // is money in the same physical till, and must be counted with it.
    const drawer = await pool.query(
      `SELECT cs.session_id FROM "CASH_SESSION" cs
       JOIN "BOOKING" b ON b.b_id = cs.b_id
       WHERE b.booking_id = $1 AND cs.opened_by = $2 AND cs.status = 'open'`,
      [id, req.user?.u_id || null],
    );
    const { rows } = await pool.query(
      `INSERT INTO "BOOKING_PAYMENT" (booking_id, amount, method, kind, reference, received_by, session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, paid, payMethod, payKind, payRef, req.user?.u_id || null, drawer.rows[0]?.session_id ?? null]
    );

    // Keep the booking's advance_paid mirror in step
    await pool.query(
      `UPDATE "BOOKING" SET advance_paid = (
         SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -amount ELSE amount END),0)
         FROM "BOOKING_PAYMENT" WHERE booking_id=$1
       ) WHERE booking_id=$1`,
      [id]
    );
    logActivity(req, { action: "payment", entity: "booking", entity_id: id,
      summary: `Took a ${rows[0].kind || "payment"} of ${rows[0].amount} by ${rows[0].method || "cash"}`,
      details: { amount: rows[0].amount, method: rows[0].method, reference: rows[0].reference } });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

// ─── CHECK-OUT ───────────────────────────────────────────────────────────────

/** POST /api/hotel/bookings/:id/check-out  body: { settle_amount?, method?, force? } */
export async function checkOut(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    await assertBookingInScope(req, res, id);
    await client.query("BEGIN");

    const bk = await client.query('SELECT * FROM "BOOKING" WHERE booking_id=$1 FOR UPDATE', [id]);
    if (!bk.rows.length) {
      await client.query("ROLLBACK");
      res.status(404); return next(new Error("Booking not found"));
    }
    if (bk.rows[0].status !== "checked_in") {
      await client.query("ROLLBACK");
      res.status(409); return next(new Error("Only a checked-in booking can be checked out"));
    }

    const f = await client.query(`SELECT * FROM "FOLIO" WHERE booking_id=$1 AND status='open'`, [id]);
    if (!f.rows.length) {
      await client.query("ROLLBACK");
      res.status(409); return next(new Error("No open folio for this booking"));
    }
    const folioId = f.rows[0].folio_id;

    // Pull any unbilled restaurant orders charged to this room onto the folio
    await client.query(
      `INSERT INTO "FOLIO_ITEM" (folio_id, source, ref_order_id, description, qty, unit_price, amount, item_date, posted_by)
       SELECT $1, 'restaurant', o.or_id,
              'Restaurant order #' || o.or_id, 1,
              COALESCE(o."or_totalCostWtax", o.or_totalcost, 0),
              COALESCE(o."or_totalCostWtax", o.or_totalcost, 0),
              o.or_date, $2
       FROM "ORDER" o
       WHERE o.folio_id = $1
         AND o.or_status <> 'cancelled'
         AND NOT EXISTS (SELECT 1 FROM "FOLIO_ITEM" fi WHERE fi.ref_order_id = o.or_id AND fi.folio_id = $1)`,
      [folioId, req.user?.u_id || null]
    );

    // A late departure is charged before the bill is totted up, so the guest
    // settles one number. The desk can waive it — a delayed flight is not the
    // guest's fault, and that call belongs to the front desk, not to us.
    let lateCharge = null;
    if (!req.body?.waive_late_fee) {
      const policy = await loadPolicy(client, bk.rows[0].b_id);
      const fee = lateCheckoutFee({
        checkOutDate: bk.rows[0].check_out_date,
        nightlyRate: await nightlyRateFor(client, id),
        policy,
      });
      const already = await client.query(
        `SELECT 1 FROM "FOLIO_ITEM" WHERE folio_id=$1 AND source='late_checkout' LIMIT 1`, [folioId]
      );
      if (fee.amount > 0 && !already.rows.length) {
        await client.query(
          `INSERT INTO "FOLIO_ITEM" (folio_id, source, description, qty, unit_price, amount, posted_by)
           VALUES ($1,'late_checkout',$2,$3,$4,$5,$6)`,
          [folioId,
           `Late check-out — ${fee.reason}`,
           fee.hours_charged || 1,
           fee.per_hour != null ? fee.per_hour : fee.amount,
           fee.amount,
           req.user?.u_id || null]
        );
        lateCharge = fee;
      }
    }

    // Optional settlement taken at the desk
    if (num(req.body?.settle_amount) > 0) {
      const drawer = await client.query(
        `SELECT cs.session_id FROM "CASH_SESSION" cs
         JOIN "BOOKING" b ON b.b_id = cs.b_id
         WHERE b.booking_id = $1 AND cs.opened_by = $2 AND cs.status = 'open'`,
        [id, req.user?.u_id || null],
      );
      await client.query(
        `INSERT INTO "BOOKING_PAYMENT" (booking_id, amount, method, kind, received_by, session_id)
         VALUES ($1,$2,$3,'settlement',$4,$5)`,
        [id, num(req.body.settle_amount), req.body.method || "cash", req.user?.u_id || null, drawer.rows[0]?.session_id ?? null]
      );
    }

    const charges = await client.query(
      'SELECT COALESCE(SUM(amount),0) AS t FROM "FOLIO_ITEM" WHERE folio_id=$1', [folioId]
    );
    const paid = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN -amount ELSE amount END),0) AS t
       FROM "BOOKING_PAYMENT" WHERE booking_id=$1`, [id]
    );
    const balance = +(num(charges.rows[0].t) - num(paid.rows[0].t)).toFixed(2);

    if (balance > 0.01 && !req.body?.force) {
      await client.query("ROLLBACK");
      res.status(409);
      return next(Object.assign(
        new Error(`Outstanding balance of LKR ${balance.toFixed(2)} must be settled before check-out`),
        { balance }
      ));
    }

    await client.query(`UPDATE "FOLIO" SET status='closed', closed_at=NOW() WHERE folio_id=$1`, [folioId]);
    await client.query(
      `UPDATE "BOOKING" SET status='checked_out', checked_out_at=NOW(), checked_out_by=$2,
                            grand_total=$3, advance_paid=$4
       WHERE booking_id=$1`,
      [id, req.user?.u_id || null, num(charges.rows[0].t), num(paid.rows[0].t)]
    );
    await client.query(
      `UPDATE "ROOM" SET hk_status='dirty'
       WHERE room_id IN (SELECT room_id FROM "BOOKING_ROOM" WHERE booking_id=$1 AND room_id IS NOT NULL)`,
      [id]
    );

    // Settle the commission against the room revenue as finally billed.
    await syncBookingCommission(client, id);

    await client.query("COMMIT");
    announce(bk.rows[0].b_id, { action: "checked_out", booking_id: id });
    logActivity(req, { action: "check_out", entity: "booking", entity_id: id, b_id: bk.rows[0].b_id,
      summary: `Checked out booking ${bk.rows[0].booking_ref} — billed ${num(charges.rows[0].t).toFixed(2)}`
             + (lateCharge ? `, incl. late check-out ${lateCharge.amount.toFixed(2)}` : "")
             + (req.body?.waive_late_fee ? ", late fee waived" : ""),
      details: { total_charges: num(charges.rows[0].t), total_paid: num(paid.rows[0].t),
                 late_checkout: lateCharge } });
    res.json({
      success: true,
      total_charges: num(charges.rows[0].t),
      total_paid: num(paid.rows[0].t),
      balance,
      late_checkout: lateCharge,
      message: "Checked out",
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

/** GET /api/hotel/dashboard?b_id= — arrivals, departures, in-house, occupancy */
export async function getDashboard(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }
    const today = hotelToday();

    const [arrivals, departures, inHouse, roomStats] = await Promise.all([
      pool.query(`${BOOKING_SELECT} WHERE b.b_id=$1 AND b.check_in_date=$2 AND b.status IN ('confirmed','tentative') ORDER BY b.arrival_time NULLS LAST`, [b_id, today]),
      pool.query(`${BOOKING_SELECT} WHERE b.b_id=$1 AND b.check_out_date=$2 AND b.status='checked_in'`, [b_id, today]),
      pool.query(`${BOOKING_SELECT} WHERE b.b_id=$1 AND b.status='checked_in'`, [b_id]),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE is_active) AS total_rooms,
                COUNT(*) FILTER (WHERE hk_status='dirty')      AS dirty,
                COUNT(*) FILTER (WHERE hk_status='clean')      AS clean,
                COUNT(*) FILTER (WHERE hk_status IN ('maintenance','out_of_order')) AS blocked
         FROM "ROOM" WHERE b_id=$1`, [b_id]
      ),
    ]);

    const occupied = await pool.query(
      `SELECT COUNT(DISTINCT br.room_id) AS n
       FROM "BOOKING_ROOM" br JOIN "BOOKING" b ON b.booking_id=br.booking_id
       WHERE b.b_id=$1 AND b.status='checked_in' AND br.room_id IS NOT NULL`, [b_id]
    );

    const totalRooms = Number(roomStats.rows[0]?.total_rooms || 0);
    const occ = Number(occupied.rows[0]?.n || 0);

    res.json({
      date: today,
      arrivals:   await attachRooms(arrivals.rows),
      departures: await attachRooms(departures.rows),
      in_house:   await attachRooms(inHouse.rows),
      rooms: {
        total: totalRooms,
        occupied: occ,
        available: Math.max(totalRooms - occ, 0),
        occupancy_pct: totalRooms ? +((occ / totalRooms) * 100).toFixed(1) : 0,
        ...roomStats.rows[0],
      },
    });
  } catch (err) { next(err); }
}

// ─── CONFIRMATION (WhatsApp / print) ─────────────────────────────────────────

/** GET /api/hotel/bookings/:id/confirmation — payload + ready-to-send WhatsApp text */
export async function getConfirmation(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertBookingInScope(req, res, id);
    const { rows } = await pool.query(
      `${BOOKING_SELECT} WHERE b.booking_id=$1`, [id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Booking not found")); }
    const [b] = await attachRooms(rows);

    const branch = await pool.query(
      'SELECT "B_name","B_address","B_conNo","B_email" FROM "Branch" WHERE "B_id"=$1', [b.b_id]
    );
    const hotel = branch.rows[0] || {};
    const policy = await loadPolicy(pool, b.b_id);
    // Only what the owner has set is quoted to a guest.
    const inTime  = policy.policy_saved ? prettyTime(policy.check_in_time)  : null;
    const outTime = policy.policy_saved ? prettyTime(policy.check_out_time) : null;
    const cancelText = policy.policy_saved ? cancellationLine(policy) : null;
    const money = (n) => `LKR ${Number(n || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dmy = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
    const balance = num(b.grand_total) - num(b.paid_total);

    const roomLines = (b.rooms || [])
      .map(r => `• ${r.type_name}${r.room_number ? ` (Room ${r.room_number})` : ""} — ${money(r.rate_per_night)}/night`)
      .join("\n");

    const text = [
      `*${(hotel.B_name || "Hotel").toUpperCase()}*`,
      `_Booking Confirmation_`,
      ``,
      `Dear ${b.guest_name || "Guest"},`,
      `Thank you for choosing us. Your reservation is *CONFIRMED*.`,
      ``,
      `*Booking Ref:* ${b.booking_ref}`,
      `*Check-In:* ${dmy(b.check_in_date)}${inTime ? ` (from ${inTime})` : ""}`,
      `*Check-Out:* ${dmy(b.check_out_date)}${outTime ? ` (by ${outTime})` : ""}`,
      `*Nights:* ${b.nights}`,
      `*Guests:* ${b.adults} adult(s)${b.children ? `, ${b.children} child(ren)` : ""}`,
      b.plan_name ? `*Meal Plan:* ${b.plan_name}` : null,
      b.special_requests ? `*Special Request:* ${b.special_requests}` : null,
      ``,
      `*ROOMS*`,
      roomLines || "—",
      ``,
      `*RATE BREAKDOWN*`,
      `Room Charges: ${money(b.room_charges)}`,
      `Tax (${b.tax_pct}%): ${money(b.tax_amount)}`,
      num(b.meal_charges) ? `Inclusions: ${money(b.meal_charges)}` : null,
      num(b.extra_charges) ? `Extra Charges: ${money(b.extra_charges)}` : null,
      num(b.discount) ? `Discount: -${money(b.discount)}` : null,
      `*Grand Total: ${money(b.grand_total)}*`,
      `Total Paid: ${money(b.paid_total)}`,
      `*Amount Due at Check-In: ${money(balance)}*`,
      ``,
      cancelText ? `_${cancelText}_` : null,
      cancelText ? `` : null,
      hotel.B_address || null,
      hotel.B_conNo ? `Tel: ${hotel.B_conNo}` : null,
    ].filter(Boolean).join("\n");

    const digits = (b.guest_phone || "").replace(/\D/g, "");
    // Sri Lankan local numbers (0xxxxxxxxx) need the 94 country code for wa.me
    const waNumber = digits.startsWith("0") ? `94${digits.slice(1)}` : digits;

    res.json({
      booking: b,
      hotel,
      policy: { ...policy, check_in_pretty: inTime, check_out_pretty: outTime, cancellation_line: cancelText },
      balance_due: +balance.toFixed(2),
      whatsapp_text: text,
      whatsapp_url: waNumber
        ? `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`
        : null,
    });
  } catch (err) { next(err); }
}

// ─── STAY POLICY ─────────────────────────────────────────────────────────────

/** GET /api/hotel/policy — the property's house rules. Readable by any signed-in
 *  user, because the till, the rack and the voucher all quote the times. */
export async function getStayPolicy(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    if (!b_id) { res.status(400); return next(new Error("No property on this account")); }
    const p = await loadPolicy(pool, b_id);
    res.json({
      ...p,
      b_id,
      check_in_pretty:  prettyTime(p.check_in_time),
      check_out_pretty: prettyTime(p.check_out_time),
      cancellation_line: cancellationLine(p),
      suggested_extra_terms: SUGGESTED_TERMS,
    });
  } catch (err) { next(err); }
}

/** PUT /api/hotel/policy — owner only; this changes what guests are charged. */
export async function updateStayPolicy(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    if (!b_id) { res.status(400); return next(new Error("No property on this account")); }

    // Anything the caller left out keeps the value it already had. Falling back
    // to the built-in defaults instead would let a partial save quietly undo
    // settings the owner never touched.
    const cur = await loadPolicy(pool, b_id);

    const checkIn  = timeField(req.body.check_in_time,  "Check-in time")  || cur.check_in_time;
    const checkOut = timeField(req.body.check_out_time, "Check-out time") || cur.check_out_time;
    const grace    = countField(req.body.late_grace_minutes, "Grace period", { min: 0, max: 720, dflt: num(cur.late_grace_minutes, 60) });
    const mode     = oneOf(req.body.late_mode, "Late check-out charge", ["none", "hourly", "flat", "night"], cur.late_mode);
    const pct      = pctField(req.body.late_hourly_pct, "Hourly rate", num(cur.late_hourly_pct, 25));
    const flat     = req.body.late_flat_amount === undefined
      ? num(cur.late_flat_amount) : moneyField(req.body.late_flat_amount, "Flat late fee");
    const cutoff   = countField(req.body.late_full_night_after, "Full-night cut-off", { min: 1, max: 24, dflt: num(cur.late_full_night_after, 6) });
    const freeHrs  = countField(req.body.cancel_free_hours, "Free cancellation window", { min: 0, max: 720, dflt: num(cur.cancel_free_hours, 48) });
    const cancelN  = countField(req.body.cancel_charge_nights, "Cancellation charge", { min: 0, max: 30, dflt: num(cur.cancel_charge_nights, 1) });

    const taxDefault = pctField(req.body.default_tax_pct, "Tax on room charges", num(cur.default_tax_pct, 0));

    let extraTerms = cur.extra_terms;
    if (req.body.extra_terms !== undefined) {
      const lines = termsLines(req.body.extra_terms);
      if (lines.length > 12) { res.status(400); return next(new Error("Keep the terms to 12 lines or fewer.")); }
      if (lines.some((l) => l.length > 300)) { res.status(400); return next(new Error("Each line of the terms can be up to 300 characters.")); }
      extraTerms = lines.join("\n");
    }

    const { rows } = await pool.query(
      `INSERT INTO "HOTEL_POLICY"
         (b_id, check_in_time, check_out_time, late_grace_minutes, late_mode,
          late_hourly_pct, late_flat_amount, late_full_night_after,
          cancel_free_hours, cancel_charge_nights, extra_terms, default_tax_pct, policy_saved, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,NOW())
       ON CONFLICT (b_id) DO UPDATE SET
         check_in_time=$2, check_out_time=$3, late_grace_minutes=$4, late_mode=$5,
         late_hourly_pct=$6, late_flat_amount=$7, late_full_night_after=$8,
         cancel_free_hours=$9, cancel_charge_nights=$10, extra_terms=$11, default_tax_pct=$12, policy_saved=TRUE, updated_at=NOW()
       RETURNING *`,
      [b_id, checkIn, checkOut, grace, mode, pct, flat, cutoff, freeHrs, cancelN, extraTerms, taxDefault]
    );

    const p = rows[0];
    logActivity(req, {
      action: "update", entity: "policy", entity_id: b_id, b_id,
      summary: `Stay policy — check-out ${prettyTime(p.check_out_time)}, late charge: ${
        p.late_mode === "none"   ? "not charged"
        : p.late_mode === "flat"  ? `flat ${p.late_flat_amount}`
        : p.late_mode === "night" ? "a full night"
        : `${p.late_hourly_pct}% per hour after ${p.late_grace_minutes} min`}`,
      details: p,
    });

    res.json({ ...p, check_in_pretty: prettyTime(p.check_in_time), check_out_pretty: prettyTime(p.check_out_time),
               cancellation_line: cancellationLine(p), suggested_extra_terms: SUGGESTED_TERMS });
  } catch (err) { next(err); }
}
