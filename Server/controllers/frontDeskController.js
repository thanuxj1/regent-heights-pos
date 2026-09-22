import { takeStock, noteShortfall } from "../utils/inventory.js";
import pool from "../config/database.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { effectiveCheckout, isOverstaying } from "../utils/occupancy.js";
import { hotelToday } from "../utils/hotelTime.js";
import {
  emitSocketEvent, emitOrderEvent, getKitchenSocketRoom,
} from "../utils/socket.js";

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
// The hotel's day, not GMT's. See utils/hotelTime.js.
const todayStr = () => hotelToday();

/**
 * GET /api/hotel/room-grid?b_id=&date=
 * The front-desk rack: one card per room with its status on the given date.
 *   occupied  — a guest is checked in
 *   booked    — reserved for that date, not yet arrived
 *   dirty     — needs housekeeping / blocked
 *   available — free and clean
 */
export async function getRoomGrid(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }
    const date = req.query.date || todayStr();

    const { rows } = await pool.query(
      `SELECT r.room_id, r.room_number, r.floor, r.hk_status, r.is_active,
              rt.room_type_id, rt.type_name, rt.type_code, rt.base_rate,
              rt.included_guests, rt.max_adults, rt.max_children,
              bk.booking_id, bk.booking_ref, bk.status AS booking_status, bk.source,
              bk.check_in_date, bk.check_out_date, bk.adults, bk.children,
              bk.grand_total, bk.advance_paid,
              g.guest_id, g.full_name AS guest_name, g.phone AS guest_phone, g.country
       FROM "ROOM" r
       JOIN "ROOM_TYPE" rt ON rt.room_type_id = r.room_type_id
       LEFT JOIN LATERAL (
         SELECT b.*
         FROM "BOOKING_ROOM" br
         JOIN "BOOKING" b ON b.booking_id = br.booking_id
         WHERE br.room_id = r.room_id
           AND b.status IN ('tentative','confirmed','checked_in')
           AND b.check_in_date  <= $2::date
           AND ${effectiveCheckout("b")} > $2::date
         ORDER BY CASE WHEN b.status = 'checked_in' THEN 0 ELSE 1 END, b.booking_id
         LIMIT 1
       ) bk ON TRUE
       LEFT JOIN "GUEST" g ON g.guest_id = bk.guest_id
       WHERE r.b_id = $1 AND r.is_active = TRUE
       ORDER BY r.room_number`,
      [b_id, date]
    );

    const asOf = new Date(date);
    const rooms = rows.map(r => {
      let status;
      if (r.booking_status === "checked_in") status = "occupied";
      else if (r.booking_id) status = "booked";
      else if (["dirty", "maintenance", "out_of_order"].includes(r.hk_status)) status = "dirty";
      else status = "available";

      // A guest past their departure date is still occupying the room, but the
      // desk needs to know they are late — that is a bill to close and a room
      // housekeeping is waiting on, not business as usual.
      const overstay = isOverstaying(
        { status: r.booking_status, check_out_date: r.check_out_date }, asOf);

      return { ...r, status, overstay };
    });

    const counts = rooms.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});

    res.json({
      date,
      rooms,
      counts: {
        available: counts.available || 0,
        booked:    counts.booked    || 0,
        occupied:  counts.occupied  || 0,
        dirty:     counts.dirty     || 0,
        overstay:  rooms.filter(r => r.overstay).length,
        total:     rooms.length,
      },
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/hotel/guest-directory?b_id=&search=&filter=
 * The searchable guest book, with enough on each row to triage at the counter.
 */
export async function getGuestDirectory(req, res, next) {
  try {
    const { search, filter } = req.query;
    const params = [];
    const where = [];

    // The directory is restricted to this branch's guests, and their stats to
    // this branch's bookings.
    const guestScope = branchClause(req, "g.b_id", params);
    if (guestScope) where.push(guestScope);

    let branchJoin = "";
    const b_id = writeBranchId(req, req.query.b_id);
    if (b_id) { params.push(Number(b_id)); branchJoin = `AND b.b_id = $${params.length}`; }

    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      const p = `$${params.length}`;
      where.push(`(g.full_name ILIKE ${p} OR g.phone ILIKE ${p} OR g.email ILIKE ${p}
                   OR g.passport_nic ILIKE ${p} OR g.country ILIKE ${p})`);
    }

    const having = filter === "in_house"
      ? `HAVING BOOL_OR(b.status = 'checked_in')`
      : filter === "repeat"
        ? `HAVING COUNT(b.booking_id) FILTER (WHERE b.status = 'checked_out') >= 2`
        : "";

    const { rows } = await pool.query(
      `SELECT g.guest_id, g.full_name, g.phone, g.email, g.country, g.nationality,
              g.passport_nic, g.guest_status, g.notes,
              COUNT(b.booking_id)                                              AS bookings,
              COUNT(b.booking_id) FILTER (WHERE b.status = 'checked_out')      AS stays,
              COALESCE(SUM(b.grand_total) FILTER
                (WHERE b.status IN ('checked_in','checked_out')), 0)           AS lifetime_spend,
              MAX(b.check_in_date)                                             AS last_stay,
              BOOL_OR(b.status = 'checked_in')                                 AS in_house
       FROM "GUEST" g
       LEFT JOIN "BOOKING" b ON b.guest_id = g.guest_id ${branchJoin}
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       GROUP BY g.guest_id
       ${having}
       ORDER BY BOOL_OR(b.status = 'checked_in') DESC NULLS LAST,
                MAX(b.check_in_date) DESC NULLS LAST,
                g.full_name
       LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

/**
 * GET /api/hotel/guests/:id/history
 * Everything the property knows about one guest — the trace track.
 */
export async function getGuestHistory(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "GUEST", idColumn: "guest_id", id });

    const g = await pool.query('SELECT * FROM "GUEST" WHERE guest_id = $1', [id]);
    if (!g.rows.length) { res.status(404); return next(new Error("Guest not found")); }

    const bookings = await pool.query(
      `SELECT b.*, a.agent_name,
              COALESCE(pay.paid, 0) AS paid_total,
              (SELECT string_agg(DISTINCT COALESCE(r.room_number, rt.type_name), ', ')
               FROM "BOOKING_ROOM" br
               LEFT JOIN "ROOM" r       ON r.room_id = br.room_id
               LEFT JOIN "ROOM_TYPE" rt ON rt.room_type_id = br.room_type_id
               WHERE br.booking_id = b.booking_id) AS rooms_label
       FROM "BOOKING" b
       LEFT JOIN "COMMISSION_AGENT" a ON a.agent_id = b.agent_id
       LEFT JOIN LATERAL (
         SELECT SUM(CASE WHEN kind='refund' THEN -amount ELSE amount END) AS paid
         FROM "BOOKING_PAYMENT" WHERE booking_id = b.booking_id
       ) pay ON TRUE
       WHERE b.guest_id = $1
       ORDER BY b.check_in_date DESC`,
      [id]
    );

    // Every line ever charged to this guest, across all stays
    const charges = await pool.query(
      `SELECT fi.*, b.booking_ref, b.check_in_date
       FROM "FOLIO_ITEM" fi
       JOIN "FOLIO" f   ON f.folio_id = fi.folio_id
       JOIN "BOOKING" b ON b.booking_id = f.booking_id
       WHERE b.guest_id = $1
       ORDER BY fi.posted_at DESC
       LIMIT 300`,
      [id]
    );

    // Restaurant side of the record. Two ways an order belongs to this guest:
    //   room    — charged to one of their folios, so the link is certain
    //   walk-in — a CUSTOMER row with the same phone/email placed it themselves
    const restaurant = await pool.query(
      `SELECT o.or_id, o.or_date, o.or_time, o.or_type, o.or_status,
              COALESCE(o."or_totalCostWtax", o.or_totalcost, 0) AS amount,
              o.table_id, o.room_id, b.booking_ref,
              CASE WHEN o.folio_id IS NOT NULL THEN 'room' ELSE 'walk-in' END AS via
       FROM "ORDER" o
       LEFT JOIN "FOLIO" f   ON f.folio_id = o.folio_id
       LEFT JOIN "BOOKING" b ON b.booking_id = f.booking_id
       LEFT JOIN "CUSTOMER" c ON c.cust_id = o.cust_id
       WHERE o.or_status <> 'cancelled'
         AND (
           b.guest_id = $1
           OR ($2::text <> '' AND c.cust_phone = $2)
           OR ($3::text <> '' AND c.cust_email = $3)
         )
       ORDER BY o.or_date DESC, o.or_id DESC
       LIMIT 200`,
      [id, g.rows[0].phone || "", g.rows[0].email || ""]
    );

    // Line items for those orders, so the counter can see what they actually ate
    let orderItems = [];
    if (restaurant.rows.length) {
      const oi = await pool.query(
        `SELECT oi.order_id, oi.pro_quantity, oi.unit_price, oi.total_price,
                bp.pro_name
         FROM "ORDER_ITEM" oi
         LEFT JOIN "Branch_Product" bp ON bp."Bpro_id" = oi."Bpro_id"
         WHERE oi.order_id = ANY($1::int[])`,
        [restaurant.rows.map(r => r.or_id)]
      );
      orderItems = oi.rows;
    }
    const itemsByOrder = orderItems.reduce((a, i) => {
      (a[i.order_id] ||= []).push(i);
      return a;
    }, {});
    const restaurantOrders = restaurant.rows.map(o => ({ ...o, items: itemsByOrder[o.or_id] || [] }));

    const stays = bookings.rows.filter(b => ["checked_out", "checked_in"].includes(b.status));
    const lifetimeSpend = stays.reduce((s, b) => s + num(b.grand_total), 0);
    const totalNights   = stays.reduce((s, b) => s + num(b.nights), 0);
    const restaurantSpend = restaurantOrders.reduce((s, o) => s + num(o.amount), 0);

    // Favourites — what they order again and again
    const dishCount = {};
    orderItems.forEach(i => {
      if (!i.pro_name) return;
      dishCount[i.pro_name] = (dishCount[i.pro_name] || 0) + num(i.pro_quantity, 1);
    });
    const favourites = Object.entries(dishCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    // What they spend on, by category — useful for repeat-guest service
    const byCategory = charges.rows.reduce((a, c) => {
      a[c.source] = (a[c.source] || 0) + num(c.amount);
      return a;
    }, {});

    res.json({
      guest: g.rows[0],
      bookings: bookings.rows,
      charges: charges.rows,
      restaurant_orders: restaurantOrders,
      stats: {
        total_bookings: bookings.rows.length,
        completed_stays: bookings.rows.filter(b => b.status === "checked_out").length,
        cancelled: bookings.rows.filter(b => b.status === "cancelled").length,
        total_nights: totalNights,
        lifetime_spend: +lifetimeSpend.toFixed(2),
        restaurant_spend: +restaurantSpend.toFixed(2),
        restaurant_orders: restaurantOrders.length,
        total_spend: +(lifetimeSpend + restaurantSpend).toFixed(2),
        first_stay: stays.length ? stays[stays.length - 1].check_in_date : null,
        last_stay:  stays.length ? stays[0].check_in_date : null,
        by_category: byCategory,
        favourites,
      },
    });
  } catch (err) { next(err); }
}

/**
 * POST /api/hotel/room-service
 * Guest phones the front desk. We raise a kitchen ticket AND put it on their folio
 * in one step, so the charge is already on the bill before they hang up.
 * body: { room_id, items:[{Bpro_id, pro_quantity, unit_price}], notes, tax_pct }
 */
export async function createRoomServiceOrder(req, res, next) {
  // Inside the try, deliberately. Taking the connection on the line above meant
  // a database blip rejected before any handler existed, and in Express 4 that
  // is an unhandled rejection — which took the whole server down rather than
  // failing this one order.
  let client;
  try {
    client = await pool.connect();
    const { room_id, items, notes, tax_pct } = req.body;
    if (!room_id) { res.status(400); return next(new Error("room_id is required")); }
    await assertInScope(req, res, { table: "ROOM", idColumn: "room_id", id: room_id });
    if (!Array.isArray(items) || !items.length) {
      res.status(400); return next(new Error("At least one item is required"));
    }
    for (const [n, i] of items.entries()) {
      const q = Number(i?.pro_quantity ?? 1);
      if (!Number.isInteger(Number(i?.Bpro_id)) || !Number.isInteger(q) || q <= 0 || q > 999) {
        res.status(400);
        return next(new Error(`Item ${n + 1}: needs a product and a whole quantity between 1 and 999`));
      }
    }

    await client.query("BEGIN");

    // The room must have a guest in it with an open folio
    const occ = await client.query(
      `SELECT b.booking_id, b.b_id, b.guest_id, b.meal_plan_id, b.adults, b.children,
              f.folio_id, r.room_number, g.full_name
       FROM "BOOKING_ROOM" br
       JOIN "BOOKING" b ON b.booking_id = br.booking_id
       JOIN "ROOM" r    ON r.room_id = br.room_id
       JOIN "FOLIO" f   ON f.booking_id = b.booking_id AND f.status = 'open'
       LEFT JOIN "GUEST" g ON g.guest_id = b.guest_id
       WHERE br.room_id = $1 AND b.status = 'checked_in'
       LIMIT 1`,
      [Number(room_id)]
    );
    if (!occ.rows.length) {
      await client.query("ROLLBACK");
      res.status(409);
      return next(new Error("That room has no checked-in guest with an open folio"));
    }
    const { booking_id, b_id, folio_id, room_number, full_name } = occ.rows[0];
    const booking = occ.rows[0];

    const priced = items.map(i => ({ ...i, qty: num(i.pro_quantity, 1) }));

    const subtotal = priced.reduce((s, i) => s + num(i.unit_price) * i.qty, 0);
    const taxPct   = num(tax_pct, 0);
    const tax      = +(subtotal * taxPct / 100).toFixed(2);
    const total    = +(subtotal + tax).toFixed(2);

    const ord = await client.query(
      `INSERT INTO "ORDER"
         (or_tax, or_totalcost, "or_totalCostWtax", or_status, or_type,
          u_id, b_id, room_id, folio_id)
       VALUES ($1,$2,$3,'pending','room_service',$4,$5,$6,$7)
       RETURNING *`,
      [tax, subtotal, total, req.user?.u_id || null, b_id, Number(room_id), folio_id]
    );
    const order = ord.rows[0];

    const lines = [];
    for (const i of priced) {
      const unit = num(i.unit_price);
      const line = await client.query(
        `INSERT INTO "ORDER_ITEM" ("Bpro_id", pro_quantity, unit_price, total_price, order_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING "orderItem_id"`,
        [Number(i.Bpro_id), i.qty, unit, +(i.qty * unit).toFixed(2), order.or_id]
      );
      lines.push({ bpro_id: Number(i.Bpro_id), qty: i.qty, order_item_id: line.rows[0].orderItem_id });
    }

    // Room service is a sale like any other: the dish goes, so its ingredients
    // go — it never reduced stock at all before. A dish from another property's
    // menu is refused; a count that says there is none is noted, not refused.
    const stock = await takeStock(client, { b_id, order_id: order.or_id, lines, u_id: req.user?.u_id ?? null });

    // Put it on the bill straight away. The checkout sweep skips anything already
    // posted (it matches on ref_order_id), so this never double-charges.
    // A folio line only where there is something to pay. An order the plan
    // covered in full still happened — the ticket and the stock movement say so
    // — but putting 0.00 on the bill only invites the question "what is this?".
    if (total > 0) {
      await client.query(
        `INSERT INTO "FOLIO_ITEM"
           (folio_id, source, ref_order_id, description, qty, unit_price, amount, posted_by)
         VALUES ($1,'restaurant',$2,$3,1,$4,$4,$5)`,
        [folio_id, order.or_id,
         `Room service — order #${order.or_id}${notes ? ` (${notes})` : ""}`,
         total, req.user?.u_id || null]
      );
    }

    await client.query("COMMIT");
    noteShortfall(req, { b_id, order_id: order.or_id, short: stock.short });

    // Kitchen sees it the same as any other ticket
    const ticket = { ...order, room_number, guest_name: full_name, notes: notes || null };
    emitSocketEvent("order:created", ticket, { room: getKitchenSocketRoom(order.b_id) });
    // Carry the room and guest with the event. The bare ORDER row only has ids,
    // so the notification could say no more than "New order #37 (room_service)"
    // — technically true and no use to anyone reading it.
    emitOrderEvent("order:new", {
      ...order,
      room_number,
      guest_name: full_name,
      // Units ordered, not lines on the ticket: two of one dish is "2 items"
      // to the person reading the alert, not "1".
      item_count: items.reduce((n, i) => n + num(i.pro_quantity, 1), 0),
    });

    res.status(201).json({
      success: true, order, folio_id, booking_id,
      room_number, guest_name: full_name, total,
    });
  } catch (err) {
    // client may be undefined if it was the connect itself that failed.
    await client?.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client?.release();
  }
}

/**
 * POST /api/hotel/room-service/charge-order
 * body: { order_id, room_id, tax_pct }
 *
 * An order the kitchen already has — sent as a KOT, or a waiter's — is put on a
 * guest's bill. It is the same order: no second ticket, and no second round of
 * stock, because the first one already took it. Charging it through the
 * room-service endpoint instead made a brand-new order, so the food was cooked
 * and counted out twice.
 */
export async function chargeOrderToRoom(req, res, next) {
  let client;
  try {
    client = await pool.connect();
    const order_id = Number(req.body?.order_id);
    const room_id = Number(req.body?.room_id);
    if (!Number.isInteger(order_id) || order_id <= 0) { res.status(400); return next(new Error("order_id is required")); }
    if (!Number.isInteger(room_id) || room_id <= 0) { res.status(400); return next(new Error("room_id is required")); }
    await assertInScope(req, res, { table: "ROOM", idColumn: "room_id", id: room_id });
    await assertInScope(req, res, { table: "ORDER", idColumn: "or_id", id: order_id });

    await client.query("BEGIN");
    const found = await client.query(
      `SELECT or_id, or_status, folio_id, payment_method, voided_by, b_id FROM "ORDER" WHERE or_id = $1 FOR UPDATE`,
      [order_id]);
    if (!found.rows.length) { await client.query("ROLLBACK"); res.status(404); return next(new Error("Order not found")); }
    const o = found.rows[0];
    if (o.folio_id) { await client.query("ROLLBACK"); res.status(409); return next(new Error("This order is already on a guest's bill.")); }
    if (o.payment_method || o.voided_by || o.or_status === "cancelled") {
      await client.query("ROLLBACK");
      res.status(409);
      return next(new Error("This order has already been paid or cancelled, so it cannot be put on a room bill."));
    }

    const occ = await client.query(
      `SELECT b.booking_id, f.folio_id, r.room_number, g.full_name
       FROM "BOOKING_ROOM" br
       JOIN "BOOKING" b ON b.booking_id = br.booking_id
       JOIN "ROOM" r    ON r.room_id = br.room_id
       JOIN "FOLIO" f   ON f.booking_id = b.booking_id AND f.status = 'open'
       LEFT JOIN "GUEST" g ON g.guest_id = b.guest_id
       WHERE br.room_id = $1 AND b.status = 'checked_in'
       LIMIT 1`,
      [room_id]);
    if (!occ.rows.length) {
      await client.query("ROLLBACK");
      res.status(409);
      return next(new Error("That room has no checked-in guest with an open folio"));
    }
    const { booking_id, folio_id, room_number, full_name } = occ.rows[0];

    // What is on the order now, not what the till thinks — the lines were brought
    // up to date just before this call.
    const sum = await client.query(
      `SELECT COALESCE(SUM(total_price), 0) AS s FROM "ORDER_ITEM" WHERE order_id = $1`, [order_id]);
    const subtotal = num(sum.rows[0].s);
    const tax = +(subtotal * num(req.body?.tax_pct, 0) / 100).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);

    await client.query(
      `UPDATE "ORDER" SET or_type = 'room_service', room_id = $2, folio_id = $3,
              or_tax = $4, or_totalcost = $5, "or_totalCostWtax" = $6
        WHERE or_id = $1`,
      [order_id, room_id, folio_id, tax, subtotal, total]);
    if (total > 0) {
      await client.query(
        `INSERT INTO "FOLIO_ITEM"
           (folio_id, source, ref_order_id, description, qty, unit_price, amount, posted_by)
         VALUES ($1,'restaurant',$2,$3,1,$4,$4,$5)`,
        [folio_id, order_id, `Room service — order #${order_id}`, total, req.user?.u_id || null]);
    }
    await client.query("COMMIT");

    emitOrderEvent("order:updated", { or_id: order_id, b_id: o.b_id, or_type: "room_service", room_number, guest_name: full_name });
    res.status(200).json({ success: true, order: { or_id: order_id }, folio_id, booking_id, room_number, guest_name: full_name, total });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client?.release();
  }
}
