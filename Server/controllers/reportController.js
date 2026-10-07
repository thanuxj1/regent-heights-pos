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
           expByCat, roomNights, occupancy, suppliers, supplierDaily, waste, wasteDaily,
           codOutstanding] = await Promise.all([

      pool.query(
        `SELECT COALESCE(SUM(fi.amount),0) AS total
         FROM "FOLIO_ITEM" fi
         JOIN "FOLIO" f   ON f.folio_id = fi.folio_id
         JOIN "BOOKING" b ON b.booking_id = f.booking_id
         WHERE b.b_id = $1 AND fi.item_date BETWEEN $2::date AND $3::date`,
        [b_id, from, to]
      ),

      // A COD delivery order isn't a real sale until the rider hands the
      // cash over — excluded here on its order date, counted instead once
      // settled, on the settlement's date (see the LEFT JOIN below).
      pool.query(
        `SELECT COALESCE(SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)),0) AS total,
                -- Already inside "total" (the charge is part of what the customer
                -- paid); reported again on its own so it is visible, not lost in
                -- the food sales. Same rows, same dates, so the two always agree.
                COALESCE(SUM(o.delivery_charge),0) AS delivery_charges,
                COUNT(*) FILTER (WHERE NOT (o.or_type = 'delivery' AND o.payment_method = 'cod' AND cs.settled_date IS NULL)) AS orders
         FROM "ORDER" o
         LEFT JOIN "DELIVERY_COD_SETTLEMENT" cs ON cs.settlement_id = o.cod_settlement_id
         WHERE o.b_id = $1 AND o.folio_id IS NULL
           AND o.or_status <> 'cancelled'
           AND (
             (NOT (o.or_type = 'delivery' AND o.payment_method = 'cod') AND o.or_date BETWEEN $2::date AND $3::date)
             OR (o.or_type = 'delivery' AND o.payment_method = 'cod' AND cs.settled_date BETWEEN $2::date AND $3::date)
           )`,
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
        `SELECT COALESCE(cs.settled_date, o.or_date) AS day, SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)) AS total
         FROM "ORDER" o
         LEFT JOIN "DELIVERY_COD_SETTLEMENT" cs ON cs.settlement_id = o.cod_settlement_id
         WHERE o.b_id = $1 AND o.folio_id IS NULL AND o.or_status <> 'cancelled'
           AND (
             (NOT (o.or_type = 'delivery' AND o.payment_method = 'cod') AND o.or_date BETWEEN $2::date AND $3::date)
             OR (o.or_type = 'delivery' AND o.payment_method = 'cod' AND cs.settled_date BETWEEN $2::date AND $3::date)
           )
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

      // Wasted raw materials, priced at each item's current unit cost — money
      // out the same as an expense, though nobody types it in as one.
      pool.query(
        `SELECT COALESCE(SUM(w.waste_qty * COALESCE(rm.unit_price, 0)),0) AS total
         FROM "public"."Waste" w
         JOIN "Raw_Material" rm ON rm.rm_id = w.rm_id
         WHERE rm.b_id = $1 AND w.recorded_at::date BETWEEN $2::date AND $3::date`,
        [b_id, from, to]
      ),
      pool.query(
        `SELECT w.recorded_at::date AS day, SUM(w.waste_qty * COALESCE(rm.unit_price, 0)) AS total
         FROM "public"."Waste" w
         JOIN "Raw_Material" rm ON rm.rm_id = w.rm_id
         WHERE rm.b_id = $1 AND w.recorded_at::date BETWEEN $2::date AND $3::date
         GROUP BY day ORDER BY day`,
        [b_id, from, to]
      ),

      // Cash a delivery partner is holding for us, not yet settled — a
      // receivable, reported on its own, never folded into expenses/profit
      // (the sale itself already counted as restaurant revenue above).
      pool.query(
        `SELECT COALESCE(SUM("or_totalCostWtax"),0) AS total
         FROM "ORDER"
         WHERE b_id = $1 AND or_type = 'delivery' AND payment_method = 'cod'
           AND cod_settlement_id IS NULL AND or_status <> 'cancelled'
           AND or_date BETWEEN $2::date AND $3::date`,
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
    put(wasteDaily.rows, "expenses");

    const daily = Object.values(dayMap)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(d => ({ ...d, revenue: d.hotel + d.restaurant, profit: d.hotel + d.restaurant - d.expenses }));

    const hotelRev = num(hotel.rows[0].total);
    const restRev  = num(restaurant.rows[0].total);
    const deliveryCharges = num(restaurant.rows[0].delivery_charges);
    const expTotal = num(expenses.rows[0].total);
    const supTotal = num(suppliers.rows[0].total);
    const wasteTotal = num(waste.rows[0].total);
    const outTotal = expTotal + supTotal + wasteTotal;
    const commTotal = num(commissions.rows[0].total);
    const revenue  = hotelRev + restRev;

    const spanDays = Math.max(
      Math.round((new Date(to) - new Date(from)) / 86400000) + 1, 1
    );
    const roomsAvailable = num(occupancy.rows[0].n) * spanDays;
    const roomsSold = num(roomNights.rows[0].sold);

    // ── Hotel vs restaurant ──────────────────────────────────────────────
    // Money out is split only where the books say which side it belongs to:
    //   hotel      — hotel supplies bought, agent commissions, hotel supplies wasted
    //   restaurant — food & drink bought and wasted, raw materials / packaging / delivery costs
    //   shared     — everything else (utilities, salaries, maintenance, marketing, other):
    //                nothing says whose they are, so they are shown on their own, not guessed at.
    // The three always add up to the money-out figure the net profit uses.
    const supSplit = await pool.query(
      `SELECT COALESCE(SUM(sp.amount * COALESCE(sh.share, 0)), 0) AS hotel
       FROM supplier_payment sp
       JOIN purchase_order po ON po.po_id = sp.po_id
       LEFT JOIN (
         SELECT pi.po_id,
                SUM(CASE WHEN rm.item_category = 'supply' THEN COALESCE(pi.price, pi.qty * pi.unit_price, 0) ELSE 0 END)
                  / NULLIF(SUM(COALESCE(pi.price, pi.qty * pi.unit_price, 0)), 0) AS share
         FROM purchase_item pi
         LEFT JOIN "Raw_Material" rm ON rm.rm_id = pi.rm_id
         GROUP BY pi.po_id
       ) sh ON sh.po_id = po.po_id
       WHERE po.b_id = $1 AND sp.payment_date BETWEEN $2::date AND $3::date`,
      [b_id, from, to]
    );
    const wasteSplit = await pool.query(
      `SELECT COALESCE(SUM(w.waste_qty * COALESCE(rm.unit_price, 0)) FILTER (WHERE rm.item_category = 'supply'), 0) AS hotel
       FROM "public"."Waste" w
       JOIN "Raw_Material" rm ON rm.rm_id = w.rm_id
       WHERE rm.b_id = $1 AND w.recorded_at::date BETWEEN $2::date AND $3::date`,
      [b_id, from, to]
    );
    const hotelSupplies = num(supSplit.rows[0].hotel);
    const hotelWaste = num(wasteSplit.rows[0].hotel);
    const expCat = Object.fromEntries(expByCat.rows.map(r => [r.exp_category, num(r.total)]));
    const HOTEL_EXP = ["commission"];
    const REST_EXP = ["raw_materials", "food_packets", "delivery"];
    const sumOf = (keys) => keys.reduce((n, k) => n + (expCat[k] || 0), 0);
    const hotelExpCommission = sumOf(HOTEL_EXP);
    const restExpenses = sumOf(REST_EXP);
    const sharedByCat = Object.entries(expCat)
      .filter(([k]) => !HOTEL_EXP.includes(k) && !REST_EXP.includes(k))
      .map(([k, v]) => ({ exp_category: k, total: +v.toFixed(2) }))
      .sort((a, b) => b.total - a.total);
    const sharedTotal = sharedByCat.reduce((n, c) => n + c.total, 0);

    const hotelCosts = {
      commissions: +(commTotal + hotelExpCommission).toFixed(2),
      supplies_bought: +hotelSupplies.toFixed(2),
      supplies_wasted: +hotelWaste.toFixed(2),
    };
    const hotelCostTotal = hotelCosts.commissions + hotelCosts.supplies_bought + hotelCosts.supplies_wasted;
    const restCosts = {
      food_and_drink_bought: +(supTotal - hotelSupplies).toFixed(2),
      food_wasted: +(wasteTotal - hotelWaste).toFixed(2),
      raw_materials_packaging_delivery: +restExpenses.toFixed(2),
    };
    const restCostTotal = restCosts.food_and_drink_bought + restCosts.food_wasted + restCosts.raw_materials_packaging_delivery;
    const byDepartment = {
      hotel: {
        revenue: hotelRev, costs: hotelCosts, cost_total: +hotelCostTotal.toFixed(2),
        profit: +(hotelRev - hotelCostTotal).toFixed(2),
      },
      restaurant: {
        revenue: restRev, delivery_charges: deliveryCharges, orders: num(restaurant.rows[0].orders),
        costs: restCosts, cost_total: +restCostTotal.toFixed(2),
        profit: +(restRev - restCostTotal).toFixed(2),
      },
      shared: { by_category: sharedByCat, total: +sharedTotal.toFixed(2) },
    };

    const prod = await productProfitRows(b_id, from, to);
    const prodSales = prod.reduce((n, p) => n + p.sales, 0);
    const prodCost = prod.reduce((n, p) => n + p.cost, 0);

    res.json({
      range: { from, to, days: spanDays },
      // Dish-level profit: what the food sold for against what it cost. A different
      // view from "profit" below (cash in less cash out) — see productProfitRows.
      by_department: byDepartment,
      product_profit: {
        sales: +prodSales.toFixed(2), cost: +prodCost.toFixed(2),
        profit: +(prodSales - prodCost).toFixed(2),
        margin_pct: prodSales ? +(((prodSales - prodCost) / prodSales) * 100).toFixed(1) : 0,
        products_without_cost: prod.filter((p) => p.no_cost_set).length,
      },
      // delivery_charges is a part of restaurant, not an addition to it — total
      // is hotel + restaurant exactly as before.
      revenue: { hotel: hotelRev, restaurant: restRev, delivery_charges: deliveryCharges, total: revenue },
      expenses: {
        total: +outTotal.toFixed(2),
        recorded: expTotal,
        supplier_payments: supTotal,
        commissions: commTotal,
        waste: wasteTotal,
        by_category: [
          ...expByCat.rows,
          ...(supTotal > 0 ? [{ exp_category: "supplier_payments", total: supTotal }] : []),
          ...(wasteTotal > 0 ? [{ exp_category: "waste", total: wasteTotal }] : []),
        ].sort((a, b) => Number(b.total) - Number(a.total)),
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
      receivables: {
        cod_outstanding: num(codOutstanding.rows[0].total),
      },
      daily,
    });
  } catch (err) { next(err); }
}


/**
 * What each dish sold and what it cost to make or buy.
 *
 * Counts the same sales as the restaurant revenue figure (walk-in orders, not
 * cancelled, a COD delivery only once settled), so the two always agree on
 * which sales are in. Sales here are the line totals — before any order-level
 * discount, service charge, tax or delivery charge, which belong to the whole
 * bill and not to one dish.
 *
 * Cost is what the product cost when it was sold (ORDER_ITEM.unit_cost). A
 * line sold before costs were recorded falls back to the product's cost price
 * today; a product with no cost price at all is flagged, not counted as free.
 */
async function productProfitRows(b_id, from, to) {
  const { rows } = await pool.query(
    `SELECT COALESCE(p.pro_id::text, 'b' || bp."Bpro_id"::text) AS key,
            COALESCE(p.pro_name, bp.pro_name, 'Unknown item') AS name,
            c.cat_name AS category,
            SUM(oi.pro_quantity)::numeric AS units,
            SUM(COALESCE(oi.total_price, oi.pro_quantity * oi.unit_price, 0)) AS sales,
            SUM(oi.pro_quantity * COALESCE(oi.unit_cost, NULLIF(p.cost_price, 0), 0)) AS cost,
            COALESCE(SUM(oi.pro_quantity) FILTER (WHERE COALESCE(oi.unit_cost, NULLIF(p.cost_price, 0)) IS NULL), 0)::numeric AS units_no_cost
     FROM "ORDER_ITEM" oi
     JOIN "ORDER" o ON o.or_id = oi.order_id
      LEFT JOIN "DELIVERY_COD_SETTLEMENT" cs ON cs.settlement_id = o.cod_settlement_id
     LEFT JOIN "Branch_Product" bp ON bp."Bpro_id" = oi."Bpro_id"
     LEFT JOIN "Product" p ON p.pro_id = bp.pro_id
     LEFT JOIN "category" c ON c.cat_id = p.cat_id
     WHERE o.b_id = $1 AND o.folio_id IS NULL AND o.or_status <> 'cancelled'
       AND (
         (NOT (o.or_type = 'delivery' AND o.payment_method = 'cod') AND o.or_date BETWEEN $2::date AND $3::date)
         OR (o.or_type = 'delivery' AND o.payment_method = 'cod' AND cs.settled_date BETWEEN $2::date AND $3::date)
       )
     GROUP BY 1, 2, 3
     ORDER BY 5 DESC`,
    [b_id, from, to]
  );
  return rows.map((r) => {
    const sales = num(r.sales), cost = num(r.cost);
    return {
      key: r.key, name: r.name, category: r.category || null,
      units: num(r.units), sales, cost,
      profit: +(sales - cost).toFixed(2),
      margin_pct: sales ? +(((sales - cost) / sales) * 100).toFixed(1) : 0,
      units_no_cost: num(r.units_no_cost),
      no_cost_set: num(r.units_no_cost) > 0,
    };
  });
}

/**
 * GET /api/reports/products?b_id=&from=&to=
 * Per-product sales, cost, profit and margin.
 */
export async function getProductProfit(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }
    const from = req.query.from || daysAgo(29);
    const to   = req.query.to   || todayStr();
    const products = await productProfitRows(b_id, from, to);
    const sales = products.reduce((s, p) => s + p.sales, 0);
    const cost = products.reduce((s, p) => s + p.cost, 0);
    res.json({
      range: { from, to },
      products,
      totals: {
        units: products.reduce((s, p) => s + p.units, 0),
        sales: +sales.toFixed(2), cost: +cost.toFixed(2), profit: +(sales - cost).toFixed(2),
        margin_pct: sales ? +(((sales - cost) / sales) * 100).toFixed(1) : 0,
        products_without_cost: products.filter((p) => p.no_cost_set).length,
      },
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/reports/payables?b_id=
 * Who the business owes money to, as of now (not a date range — a debt does not
 * stop being owed because the period ended).
 *
 *   suppliers   — goods received but not yet fully paid for, per supplier, with
 *                 each unpaid order (a pending order is not a debt until it is
 *                 received, the same rule the Supplier Ledger uses)
 *   commissions — agent commission earned and not yet paid out
 */
export async function getPayables(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }

    const pos = await pool.query(
      `SELECT po.po_id, po.received_date, s.sup_id, s.sup_name, s.sup_contact,
              COALESCE((SELECT SUM(COALESCE(pi.price, pi.qty * pi.unit_price, 0)) FROM purchase_item pi WHERE pi.po_id = po.po_id), 0) AS total,
              COALESCE((SELECT SUM(sp.amount) FROM supplier_payment sp WHERE sp.po_id = po.po_id), 0) AS paid
       FROM purchase_order po
       JOIN "SUPPLIER" s ON s.sup_id = po.sup_id
       WHERE po.b_id = $1 AND po.status = 'received'
       ORDER BY po.received_date`,
      [b_id]
    );

    const bySupplier = new Map();
    const now = Date.now();
    for (const r of pos.rows) {
      const total = num(r.total), paid = num(r.paid), balance = +(total - paid).toFixed(2);
      if (!bySupplier.has(r.sup_id)) {
        bySupplier.set(r.sup_id, { sup_id: r.sup_id, supplier: r.sup_name, contact: r.sup_contact || null, purchased: 0, paid: 0, owed: 0, oldest_unpaid: null, orders: [] });
      }
      const s = bySupplier.get(r.sup_id);
      s.purchased += total; s.paid += paid;
      if (balance > 0.005) {
        s.owed += balance;
        const days = r.received_date ? Math.max(0, Math.floor((now - new Date(r.received_date).getTime()) / 86400000)) : null;
        if (!s.oldest_unpaid || (r.received_date && new Date(r.received_date) < new Date(s.oldest_unpaid))) s.oldest_unpaid = r.received_date;
        s.orders.push({ po_id: r.po_id, received_date: r.received_date, total, paid, balance, days_outstanding: days });
      }
    }
    const suppliers = [...bySupplier.values()]
      .filter(s => s.owed > 0.005)
      .map(s => ({ ...s, purchased: +s.purchased.toFixed(2), paid: +s.paid.toFixed(2), owed: +s.owed.toFixed(2) }))
      .sort((a, b) => b.owed - a.owed);

    const comm = await pool.query(
      `SELECT a.agent_id, a.agent_name, COALESCE(SUM(r.commission_amount), 0) AS owed,
              COUNT(*) AS records, MIN(r.record_date) AS oldest
       FROM "COMMISSION_RECORD" r
       JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
       WHERE a.b_id = $1 AND r.status = 'pending'
       GROUP BY a.agent_id, a.agent_name
       HAVING COALESCE(SUM(r.commission_amount), 0) > 0
       ORDER BY owed DESC`,
      [b_id]
    );
    const commissions = comm.rows.map(r => ({
      agent_id: r.agent_id, agent: r.agent_name, owed: num(r.owed), records: num(r.records), oldest: r.oldest,
    }));

    const supplierTotal = suppliers.reduce((n, s) => n + s.owed, 0);
    const commissionTotal = commissions.reduce((n, c) => n + c.owed, 0);
    res.json({
      as_of: todayStr(),
      suppliers,
      commissions,
      totals: {
        suppliers: +supplierTotal.toFixed(2),
        commissions: +commissionTotal.toFixed(2),
        total: +(supplierTotal + commissionTotal).toFixed(2),
      },
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/reports/orders-mix?b_id=&from=&to=
 * How the restaurant's orders split by type (dine-in, takeaway, delivery) and,
 * for deliveries, by partner and by how they were paid.
 *
 * Counted by the day the order was placed — it answers "how busy was each part of
 * the business", so a cash-on-delivery order is in its day here even though its
 * money counts as revenue only once the rider hands it over (the COD columns
 * say where that money is). Cancelled orders and room-service charges are out.
 */
export async function getOrdersMix(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }
    const from = req.query.from || daysAgo(29);
    const to   = req.query.to   || todayStr();

    const types = await pool.query(
      `SELECT COALESCE(o.or_type, 'unknown') AS type,
              COUNT(*)::int AS orders,
              COALESCE(SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)), 0) AS value
       FROM "ORDER" o
       WHERE o.b_id = $1 AND o.folio_id IS NULL AND o.or_status <> 'cancelled'
         AND o.or_type <> 'room_service'
         AND o.or_date BETWEEN $2::date AND $3::date
       GROUP BY 1 ORDER BY 2 DESC`,
      [b_id, from, to]
    );

    const partners = await pool.query(
      `SELECT COALESCE(NULLIF(o.delivery_partner, ''), 'unassigned') AS partner_key,
              COALESCE(dp.name, CASE WHEN COALESCE(o.delivery_partner, '') = '' THEN 'No partner (own delivery)' ELSE o.delivery_partner END) AS partner,
              COUNT(*)::int AS orders,
              COALESCE(SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)), 0) AS value,
              COALESCE(SUM(o.delivery_charge), 0) AS delivery_charges,
              COUNT(*) FILTER (WHERE o.payment_method = 'cod')::int AS cod_orders,
              COALESCE(SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)) FILTER (WHERE o.payment_method = 'cod' AND o.cod_settlement_id IS NULL), 0) AS cod_outstanding,
              COALESCE(SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)) FILTER (WHERE o.payment_method = 'cod' AND o.cod_settlement_id IS NOT NULL), 0) AS cod_settled
       FROM "ORDER" o
       JOIN "Branch" b ON b."B_id" = o.b_id
       LEFT JOIN "DELIVERY_PARTNER" dp ON dp.com_id = b.com_id AND dp.key = o.delivery_partner
       WHERE o.b_id = $1 AND o.or_type = 'delivery' AND o.or_status <> 'cancelled'
         AND o.or_date BETWEEN $2::date AND $3::date
       GROUP BY 1, 2 ORDER BY 3 DESC`,
      [b_id, from, to]
    );

    const methods = await pool.query(
      `SELECT COALESCE(NULLIF(o.payment_method, ''), 'unknown') AS method,
              COUNT(*)::int AS orders,
              COALESCE(SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)), 0) AS value
       FROM "ORDER" o
       WHERE o.b_id = $1 AND o.or_type = 'delivery' AND o.or_status <> 'cancelled'
         AND o.or_date BETWEEN $2::date AND $3::date
       GROUP BY 1 ORDER BY 2 DESC`,
      [b_id, from, to]
    );

    const typeRows = types.rows.map(r => ({ type: r.type, orders: r.orders, value: num(r.value) }));
    const totalOrders = typeRows.reduce((n, r) => n + r.orders, 0);
    const totalValue = typeRows.reduce((n, r) => n + r.value, 0);
    const partnerRows = partners.rows.map(r => ({
      key: r.partner_key, partner: r.partner, orders: r.orders, value: num(r.value),
      delivery_charges: num(r.delivery_charges), cod_orders: r.cod_orders,
      cod_outstanding: num(r.cod_outstanding), cod_settled: num(r.cod_settled),
    }));
    const delivery = typeRows.find(r => r.type === 'delivery');

    res.json({
      range: { from, to },
      types: typeRows.map(r => ({
        ...r,
        orders_pct: totalOrders ? +((r.orders / totalOrders) * 100).toFixed(1) : 0,
        value_pct: totalValue ? +((r.value / totalValue) * 100).toFixed(1) : 0,
        avg_order: r.orders ? +(r.value / r.orders).toFixed(2) : 0,
      })),
      totals: { orders: totalOrders, value: +totalValue.toFixed(2) },
      delivery: {
        orders: delivery?.orders ?? 0,
        value: delivery?.value ?? 0,
        delivery_charges: +partnerRows.reduce((n, r) => n + r.delivery_charges, 0).toFixed(2),
        cod_outstanding: +partnerRows.reduce((n, r) => n + r.cod_outstanding, 0).toFixed(2),
        cod_settled: +partnerRows.reduce((n, r) => n + r.cod_settled, 0).toFixed(2),
        by_partner: partnerRows,
        by_payment: methods.rows.map(r => ({ method: r.method, orders: r.orders, value: num(r.value) })),
      },
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/reports/purchases?b_id=&from=&to=
 * Every purchase order placed in the range: what was bought, from whom, what it
 * came to, what has been paid and what is still owed.
 */
export async function getPurchases(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    if (!b_id) { res.status(400); return next(new Error("b_id is required")); }
    const from = req.query.from || daysAgo(29);
    const to   = req.query.to   || todayStr();

    const lines = await pool.query(
      `SELECT po.po_id, po.order_date, po.received_date, po.status, s.sup_name,
              rm.rm_name, pi.qty, pi.unit_price,
              COALESCE(pi.price, pi.qty * pi.unit_price, 0) AS line_total
       FROM purchase_order po
       JOIN "SUPPLIER" s ON s.sup_id = po.sup_id
       LEFT JOIN purchase_item pi ON pi.po_id = po.po_id
       LEFT JOIN "Raw_Material" rm ON rm.rm_id = pi.rm_id
       WHERE po.b_id = $1 AND po.order_date::date BETWEEN $2::date AND $3::date
       ORDER BY po.order_date DESC, po.po_id DESC, pi.pi_id`,
      [b_id, from, to]
    );
    const paid = await pool.query(
      `SELECT sp.po_id, SUM(sp.amount) AS paid
       FROM supplier_payment sp
       JOIN purchase_order po ON po.po_id = sp.po_id
       WHERE po.b_id = $1 AND po.order_date::date BETWEEN $2::date AND $3::date
       GROUP BY sp.po_id`,
      [b_id, from, to]
    );
    const paidBy = Object.fromEntries(paid.rows.map(r => [r.po_id, num(r.paid)]));

    const orders = new Map();
    const flat = [];
    for (const r of lines.rows) {
      if (!orders.has(r.po_id)) {
        orders.set(r.po_id, {
          po_id: r.po_id, order_date: r.order_date, received_date: r.received_date,
          status: r.status, supplier: r.sup_name, total: 0, paid: paidBy[r.po_id] || 0,
        });
      }
      orders.get(r.po_id).total += num(r.line_total);
      if (r.rm_name) {
        flat.push({
          po_id: r.po_id, order_date: r.order_date, supplier: r.sup_name, status: r.status,
          item: r.rm_name, qty: num(r.qty), unit_price: num(r.unit_price), line_total: num(r.line_total),
        });
      }
    }
    const list = [...orders.values()].map(o => ({
      ...o, total: +o.total.toFixed(2), balance: +(o.total - o.paid).toFixed(2),
    }));
    res.json({
      range: { from, to },
      orders: list,
      lines: flat,
      totals: {
        orders: list.length,
        purchased: +list.reduce((s, o) => s + o.total, 0).toFixed(2),
        paid: +list.reduce((s, o) => s + o.paid, 0).toFixed(2),
        owed: +list.reduce((s, o) => s + o.balance, 0).toFixed(2),
      },
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
      // A COD delivery order is excluded here entirely — settled or not.
      // Its own "Delivery COD Settlement" row (below) is what represents
      // that money landing, on the date it actually lands; listing the
      // order here too would count the same sale twice in this ledger.
      const r = await pool.query(
        `SELECT o.or_id, o.or_date AS at, COALESCE(o."or_totalCostWtax", o.or_totalcost, 0) AS amount,
                o.delivery_charge, o.payment_method,
                o.or_type, o.u_id AS handled_by_id, c.cust_name AS party,
                NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS handled_by
         FROM "ORDER" o
         LEFT JOIN "CUSTOMER" c ON c.cust_id = o.cust_id
         LEFT JOIN "User" u     ON u.u_id = o.u_id
         WHERE o.b_id = $1 AND o.folio_id IS NULL AND o.or_status <> 'cancelled'
           AND NOT (o.or_type = 'delivery' AND o.payment_method = 'cod')
           AND o.or_date BETWEEN $2::date AND $3::date
         ORDER BY o.or_date DESC, o.or_id DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: `Restaurant (${x.or_type || "order"})`, direction: "in",
        amount: num(x.amount), method: x.payment_method || "—", reference: `#${x.or_id}`, party: x.party,
        handled_by: x.handled_by || null, handled_by_id: x.handled_by_id ?? null,
        or_id: x.or_id,
        // Part of `amount`, shown on its own for a delivery order.
        delivery_charge: num(x.delivery_charge),
      }));
    }

    if (kind === "all" || kind === "expense") {
      const r = await pool.query(
        `SELECT e.exp_id, e.exp_date AS at, e.exp_amount AS amount, e.exp_category, e.exp_description,
                NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS handled_by
         FROM "EXPENSE" e
         LEFT JOIN "User" u ON u.u_id = e.created_by
         WHERE e.b_id = $1 AND e.exp_date BETWEEN $2::date AND $3::date
         ORDER BY e.exp_date DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: `Expense (${x.exp_category})`, direction: "out",
        amount: num(x.amount), method: "—", reference: "", party: x.exp_description,
        handled_by: x.handled_by || null,
        exp_id: x.exp_id,
      }));
    }

    if (kind === "all" || kind === "commission") {
      const r = await pool.query(
        `SELECT r.record_id, r.record_date AS at, r.commission_amount AS amount, r.status, a.agent_name
         FROM "COMMISSION_RECORD" r
         JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
         WHERE a.b_id = $1 AND r.record_date BETWEEN $2::date AND $3::date
         ORDER BY r.record_date DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: `Commission (${x.status})`, direction: "out",
        amount: num(x.amount), method: "—", reference: "", party: x.agent_name,
        record_id: x.record_id,
      }));
    }

    // Money paid to suppliers — recorded against a purchase order, never typed
    // in as an "expense", so a ledger that stopped at the four kinds above
    // left the single biggest kind of money-out invisible here (getSummary
    // counts it; this list, the one meant to be complete, did not).
    if (kind === "all" || kind === "supplier") {
      const r = await pool.query(
        `SELECT sp.pay_id, sp.po_id, sp.created_at AS at, sp.amount, sp.method,
                s.sup_name AS party,
                NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS handled_by
         FROM supplier_payment sp
         JOIN purchase_order po ON po.po_id = sp.po_id
         JOIN "SUPPLIER" s ON s.sup_id = sp.sup_id
         LEFT JOIN "User" u ON u.u_id = sp.recorded_by
         WHERE po.b_id = $1 AND sp.payment_date BETWEEN $2::date AND $3::date
         ORDER BY sp.created_at DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: "Supplier payment", direction: "out",
        amount: num(x.amount), method: x.method, reference: `PO#${x.po_id}`, party: x.party,
        handled_by: x.handled_by || null,
        pay_id: x.pay_id, po_id: x.po_id,
      }));
    }

    // Wasted raw materials, priced at each item's current unit cost — a real
    // cost with no bill or payment behind it, so it belongs in this ledger
    // the same way an expense does, not just in the Waste Tracking page.
    if (kind === "all" || kind === "waste") {
      const r = await pool.query(
        `SELECT w.waste_id, w.recorded_at AS at, w.waste_qty * COALESCE(rm.unit_price, 0) AS amount,
                rm.rm_name AS party, w.reason,
                NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS handled_by
         FROM "public"."Waste" w
         JOIN "Raw_Material" rm ON rm.rm_id = w.rm_id
         LEFT JOIN "User" u ON u.u_id = w.recorded_by
         WHERE rm.b_id = $1 AND w.recorded_at::date BETWEEN $2::date AND $3::date
         ORDER BY w.recorded_at DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: "Waste", direction: "out",
        amount: num(x.amount), method: "—", reference: x.reason || "", party: x.party,
        handled_by: x.handled_by || null,
        waste_id: x.waste_id,
      }));
    }

    // A delivery-partner COD settlement — cash the partner was holding on the
    // hotel's behalf actually arriving. One row per settlement (like one
    // supplier payment is one row, not one per purchase order it covers).
    if (kind === "all" || kind === "delivery_cod") {
      const r = await pool.query(
        `SELECT s.settlement_id, s.created_at AS at, s.amount, s.delivery_partner, s.method, s.note,
                -- The delivery charges inside the orders this settlement closed: the order itself is
                -- not listed (its money is this row), so its charge is shown here.
                (SELECT COALESCE(SUM(o.delivery_charge), 0) FROM "ORDER" o WHERE o.cod_settlement_id = s.settlement_id) AS delivery_charge,
                NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS handled_by
         FROM "DELIVERY_COD_SETTLEMENT" s
         LEFT JOIN "User" u ON u.u_id = s.created_by
         WHERE s.b_id = $1 AND s.settled_date BETWEEN $2::date AND $3::date
         ORDER BY s.created_at DESC`,
        [b_id, from, to]
      );
      r.rows.forEach(x => out.push({
        at: x.at, type: "Delivery COD Settlement", direction: "in",
        amount: num(x.amount), method: x.method, reference: x.note || "", party: x.delivery_partner,
        handled_by: x.handled_by || null,
        settlement_id: x.settlement_id,
        delivery_charge: num(x.delivery_charge),
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
