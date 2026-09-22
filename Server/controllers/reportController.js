import pool from "../config/database.js";
import { branchClause, writeBranchId } from "../utils/scope.js";
import { hotelToday, hotelDay } from "../utils/hotelTime.js";

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
// The hotel's day, not GMT's. See utils/hotelTime.js.
const todayStr = () => hotelToday();
// Also the hotel's calendar: a report headed "last 7 days" must start on the
// day the staff would name, not the day GMT happens to be on.
const daysAgo = (n) => hotelDay(-n);
// A DATE column reaches Node as a Date at local midnight. Its UTC date is the day
// before whenever the server is ahead of UTC — every daily bar sat a day early.
const dayOf = (v) => {
  const x = new Date(v);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/**
 * GET /api/reports/summary?b_id=&from=&to=
 *
 * Revenue is split so nothing is counted twice:
 *   hotel      — every line posted to a guest folio (room, meals, tax, room service)
 *   restaurant — only walk-in orders (folio_id IS NULL); anything charged to a room
 *                is already inside the hotel figure via its folio line
 */
export async function getSummary(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }
    const from = req.query.from || daysAgo(29);
    const to   = req.query.to   || todayStr();

    const [hotel, restaurant, expenses, commissions, hotelDaily, restDaily, expDaily,
           expByCat, roomNights, occupancy, suppliers, supplierDaily] = await Promise.all([

      pool.query(
        `SELECT COALESCE(SUM(fi.amount),0) AS total
         FROM "FOLIO_ITEM" fi
         JOIN "FOLIO" f   ON f.folio_id = fi.folio_id
         JOIN "BOOKING" b ON b.booking_id = f.booking_id
         WHERE b.b_id = $1 AND fi.item_date BETWEEN $2::date AND $3::date`,
        [b_id, from, to]
      ),

      pool.query(
        `SELECT COALESCE(SUM(COALESCE("or_totalCostWtax", or_totalcost, 0)),0) AS total,
                COUNT(*) AS orders
         FROM "ORDER"
         WHERE b_id = $1 AND folio_id IS NULL
           AND or_status <> 'cancelled'
           AND or_date BETWEEN $2::date AND $3::date`,
        [b_id, from, to]
      ),

      pool.query(
        `SELECT COALESCE(SUM(exp_amount),0) AS total
         FROM "EXPENSE"
         WHERE b_id = $1 AND exp_date BETWEEN $2::date AND $3::date`,
        [b_id, from, to]
      ),


      pool.query(
        `SELECT COALESCE(SUM(r.commission_amount),0) AS total,
                COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status='pending'),0) AS pending
         FROM "COMMISSION_RECORD" r
         JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
         WHERE a.b_id = $1 AND r.record_date BETWEEN $2::date AND $3::date`,
        [b_id, from, to]
      ),

      pool.query(
        `SELECT fi.item_date AS day, SUM(fi.amount) AS total
         FROM "FOLIO_ITEM" fi
         JOIN "FOLIO" f   ON f.folio_id = fi.folio_id
         JOIN "BOOKING" b ON b.booking_id = f.booking_id
         WHERE b.b_id = $1 AND fi.item_date BETWEEN $2::date AND $3::date
         GROUP BY day ORDER BY day`,
        [b_id, from, to]
      ),

      pool.query(
        `SELECT or_date AS day, SUM(COALESCE("or_totalCostWtax", or_totalcost, 0)) AS total
         FROM "ORDER"
         WHERE b_id = $1 AND folio_id IS NULL AND or_status <> 'cancelled'
           AND or_date BETWEEN $2::date AND $3::date
         GROUP BY day ORDER BY day`,
        [b_id, from, to]
      ),

      pool.query(
        `SELECT exp_date AS day, SUM(exp_amount) AS total
         FROM "EXPENSE"
         WHERE b_id = $1 AND exp_date BETWEEN $2::date AND $3::date
         GROUP BY day ORDER BY day`,
        [b_id, from, to]
      ),

      pool.query(
        `SELECT exp_category, SUM(exp_amount) AS total
         FROM "EXPENSE"
         WHERE b_id = $1 AND exp_date BETWEEN $2::date AND $3::date
         GROUP BY exp_category ORDER BY total DESC`,
        [b_id, from, to]
      ),

      pool.query(
        // Nights actually inside the range. A stay was counted whole if it began in
        // the range, so one that ran on past the end (or began before it) put the
        // wrong number of nights into occupancy, ADR and RevPAR.
        `SELECT COALESCE(SUM(
                  GREATEST(0, LEAST(b.check_out_date, $3::date + 1) - GREATEST(b.check_in_date, $2::date))
                  * (SELECT COUNT(*) FROM "BOOKING_ROOM" br WHERE br.booking_id = b.booking_id)
                ),0) AS sold
         FROM "BOOKING" b
         WHERE b.b_id = $1 AND b.status IN ('checked_in','checked_out')
           AND b.check_in_date <= $3::date AND b.check_out_date > $2::date`,
        [b_id, from, to]
      ),

      pool.query(`SELECT COUNT(*) AS n FROM "ROOM" WHERE b_id = $1 AND is_active = TRUE`, [b_id]),

      // Money paid to suppliers is money out, though nobody types it in as an
      // expense — it is recorded against purchase orders. Counted on the day it
      // was paid, like everything else on this page.
      pool.query(
        `SELECT COALESCE(SUM(sp.amount),0) AS total
         FROM supplier_payment sp
         JOIN purchase_order po ON po.po_id = sp.po_id
         WHERE po.b_id = $1 AND sp.payment_date BETWEEN $2::date AND $3::date`,
        [b_id, from, to]
      ),
      pool.query(
        `SELECT sp.payment_date AS day, SUM(sp.amount) AS total
         FROM supplier_payment sp
         JOIN purchase_order po ON po.po_id = sp.po_id
         WHERE po.b_id = $1 AND sp.payment_date BETWEEN $2::date AND $3::date
         GROUP BY day ORDER BY day`,
        [b_id, from, to]
      ),
    ]);

    // Merge the three daily series onto one timeline
    const dayMap = {};
    const put = (rows, key) => rows.forEach(r => {
      const d = dayOf(r.day);
      (dayMap[d] ||= { day: d, hotel: 0, restaurant: 0, expenses: 0 })[key] += num(r.total);
    });
    put(hotelDaily.rows, "hotel");
    put(restDaily.rows, "restaurant");
    put(expDaily.rows, "expenses");
    put(supplierDaily.rows, "expenses");

    const daily = Object.values(dayMap)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(d => ({ ...d, revenue: d.hotel + d.restaurant, profit: d.hotel + d.restaurant - d.expenses }));

    const hotelRev = num(hotel.rows[0].total);
    const restRev  = num(restaurant.rows[0].total);
    const expTotal = num(expenses.rows[0].total);
    const supTotal = num(suppliers.rows[0].total);
    const outTotal = expTotal + supTotal;
    const commTotal = num(commissions.rows[0].total);
    const revenue  = hotelRev + restRev;

    const spanDays = Math.max(
      Math.round((new Date(to) - new Date(from)) / 86400000) + 1, 1
    );
    const roomsAvailable = num(occupancy.rows[0].n) * spanDays;
    const roomsSold = num(roomNights.rows[0].sold);

    res.json({
      range: { from, to, days: spanDays },
      revenue: { hotel: hotelRev, restaurant: restRev, total: revenue },
      expenses: {
        total: +outTotal.toFixed(2),
        recorded: expTotal,
        supplier_payments: supTotal,
        commissions: commTotal,
        by_category: (supTotal > 0
          ? [...expByCat.rows, { exp_category: "supplier_payments", total: supTotal }]
          : expByCat.rows).sort((a, b) => Number(b.total) - Number(a.total)),
      },
      profit: {
        gross: revenue,
        net: +(revenue - outTotal - commTotal).toFixed(2),
        margin_pct: revenue ? +(((revenue - outTotal - commTotal) / revenue) * 100).toFixed(1) : 0,
      },
      occupancy: {
        rooms_sold: roomsSold,
        rooms_available: roomsAvailable,
        occupancy_pct: roomsAvailable ? +((roomsSold / roomsAvailable) * 100).toFixed(1) : 0,
        adr: roomsSold ? +(hotelRev / roomsSold).toFixed(2) : 0,     // average daily rate
        revpar: roomsAvailable ? +(hotelRev / roomsAvailable).toFixed(2) : 0,
      },
      restaurant_orders: num(restaurant.rows[0].orders),
      daily,
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/reports/transactions?b_id=&from=&to=&kind=
 * A flat, exportable ledger — every money movement in one list.
 */
export async function getTransactions(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }
    const from = req.query.from || daysAgo(29);
    const to   = req.query.to   || todayStr();
    const kind = req.query.kind || "all";

    const out = [];

    if (kind === "all" || kind === "hotel") {
      const r = await pool.query(
        `SELECT bp.paid_at AS at, bp.amount, bp.method, bp.kind, bp.received_by,
                b.booking_ref AS ref, g.full_name AS party,
                NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS handled_by
         FROM "BOOKING_PAYMENT" bp
         JOIN "BOOKING" b ON b.booking_id = bp.booking_id
         LEFT JOIN "GUEST" g ON g.guest_id = b.guest_id
         LEFT JOIN "User" u ON u.u_id = bp.received_by
         WHERE b.b_id = $1 AND bp.paid_at::date BETWEEN $2::date AND $3::date
         ORDER BY bp.paid_at DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: "Hotel payment", direction: x.kind === "refund" ? "out" : "in",
        amount: num(x.amount), method: x.method, reference: x.ref, party: x.party,
        // The staff member who took the money — not the guest who paid it.
        handled_by: x.handled_by || null,
        handled_by_id: x.received_by ?? null,
      }));
    }

    if (kind === "all" || kind === "restaurant") {
      const r = await pool.query(
        `SELECT o.or_id, o.or_date AS at, COALESCE(o."or_totalCostWtax", o.or_totalcost, 0) AS amount,
                o.or_type, c.cust_name AS party
         FROM "ORDER" o
         LEFT JOIN "CUSTOMER" c ON c.cust_id = o.cust_id
         WHERE o.b_id = $1 AND o.folio_id IS NULL AND o.or_status <> 'cancelled'
           AND o.or_date BETWEEN $2::date AND $3::date
         ORDER BY o.or_date DESC, o.or_id DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: `Restaurant (${x.or_type || "order"})`, direction: "in",
        amount: num(x.amount), method: "—", reference: `#${x.or_id}`, party: x.party,
      }));
    }

    if (kind === "all" || kind === "expense") {
      const r = await pool.query(
        `SELECT exp_date AS at, exp_amount AS amount, exp_category, exp_description
         FROM "EXPENSE"
         WHERE b_id = $1 AND exp_date BETWEEN $2::date AND $3::date
         ORDER BY exp_date DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: `Expense (${x.exp_category})`, direction: "out",
        amount: num(x.amount), method: "—", reference: "", party: x.exp_description,
      }));
    }

    if (kind === "all" || kind === "commission") {
      const r = await pool.query(
        `SELECT r.record_date AS at, r.commission_amount AS amount, r.status, a.agent_name
         FROM "COMMISSION_RECORD" r
         JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
         WHERE a.b_id = $1 AND r.record_date BETWEEN $2::date AND $3::date
         ORDER BY r.record_date DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: `Commission (${x.status})`, direction: "out",
        amount: num(x.amount), method: "—", reference: "", party: x.agent_name,
      }));
    }

    out.sort((a, b) => new Date(b.at) - new Date(a.at));

    const totalIn  = out.filter(t => t.direction === "in").reduce((s, t) => s + t.amount, 0);
    const totalOut = out.filter(t => t.direction === "out").reduce((s, t) => s + t.amount, 0);

    res.json({
      range: { from, to },
      transactions: out,
      totals: { in: +totalIn.toFixed(2), out: +totalOut.toFixed(2), net: +(totalIn - totalOut).toFixed(2) },
    });
  } catch (err) { next(err); }
}
