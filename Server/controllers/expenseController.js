import pool from "../config/database.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";
import { hotelToday } from "../utils/hotelTime.js";
import { moneyField, textField, dateField, oneOf, invalid } from "../utils/validate.js";

const MAX_EXPENSE = 99999999.99; // what NUMERIC(10,2) holds
const given = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

export const EXPENSE_CATEGORIES = [
  "utilities", "salary", "raw_materials", "commission",
  "maintenance", "marketing", "delivery", "food_packets", "other"
];

export async function getExpenses(req, res, next) {
  try {
    const { category, from, to } = req.query;
    const params = [];
    const clauses = [];

    const scope = branchClause(req, "b_id", params);
    if (scope) clauses.push(scope);
    if (category) { params.push(category);     clauses.push(`exp_category = $${params.length}`); }
    if (from)     { params.push(from);         clauses.push(`exp_date >= $${params.length}`); }
    if (to)       { params.push(to);           clauses.push(`exp_date <= $${params.length}`); }

    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    const { rows } = await pool.query(
      `SELECT e.*, u.u_fname || ' ' || u.u_lname AS created_by_name
       FROM "EXPENSE" e
       LEFT JOIN "User" u ON u.u_id = e.created_by
       ${where}
       ORDER BY e.exp_date DESC, e.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getExpenseSummary(req, res, next) {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();

    // Every figure is scoped the same way: the caller's own property, from the
    // token. This used to read a `b_id` that was never declared, so the whole
    // summary failed — and the Accounting page, which loads the list and the
    // summary together, showed an empty list even after an expense was saved.
    const inYear = (column) => {
      const params = [year];
      const clause = branchClause(req, column, params);
      return { params, where: clause ? ` AND ${clause}` : "" };
    };

    const e = inYear("b_id");
    const h = inYear("b.b_id");
    // "o." because the restaurant queries below now join to the COD
    // settlement table to decide which date a delivery-COD sale counts on.
    const o = inYear("o.b_id");
    const s = inYear("po.b_id");
    // Waste has no b_id of its own — scoped through the raw material it wasted.
    const w = inYear("rm.b_id");
    // Commission for the same year as everything else on the page. It was counted
    // across all years, so the "(2026)" figures did not add up.
    const cParams = [year];
    const cClause = branchClause(req, "a.b_id", cParams);
    const cod = inYear("b_id");

    const [monthly, byCategory, hotel, restaurant, suppliers, commissions, waste, codOutstanding,
           hotelMonthly, restaurantMonthly, supplierMonthly, commissionMonthly, wasteMonthly] = await Promise.all([
      pool.query(
        `SELECT to_char(exp_date,'YYYY-MM') AS month, exp_category, SUM(exp_amount) AS total
           FROM "EXPENSE"
          WHERE EXTRACT(YEAR FROM exp_date) = $1${e.where}
          GROUP BY month, exp_category
          ORDER BY month DESC`, e.params),
      pool.query(
        `SELECT exp_category, SUM(exp_amount) AS total
           FROM "EXPENSE"
          WHERE EXTRACT(YEAR FROM exp_date) = $1${e.where}
          GROUP BY exp_category
          ORDER BY total DESC`, e.params),
      // Revenue the way the owner's report counts it: everything posted to a
      // guest's bill, plus restaurant sales not charged to a room (those are
      // already on the bill). This page used to count restaurant orders only,
      // so a hotel's rooms never appeared in its own profit.
      pool.query(
        `SELECT COALESCE(SUM(fi.amount), 0) AS t
           FROM "FOLIO_ITEM" fi
           JOIN "FOLIO" f   ON f.folio_id = fi.folio_id
           JOIN "BOOKING" b ON b.booking_id = f.booking_id
          WHERE EXTRACT(YEAR FROM fi.item_date) = $1${h.where}`, h.params),
      // A COD delivery order isn't a real sale until the rider actually
      // hands the cash over — it's excluded here and counted instead on
      // the date it's settled (see the LEFT JOIN), not the date it was
      // placed. Everything else counts on its own order date, as before.
      pool.query(
        `SELECT COALESCE(SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)), 0) AS t
           FROM "ORDER" o
           LEFT JOIN "DELIVERY_COD_SETTLEMENT" cs ON cs.settlement_id = o.cod_settlement_id
          WHERE o.folio_id IS NULL AND o.or_status <> 'cancelled'
            AND (
              (NOT (o.or_type = 'delivery' AND o.payment_method = 'cod') AND EXTRACT(YEAR FROM o.or_date) = $1)
              OR (o.or_type = 'delivery' AND o.payment_method = 'cod' AND cs.settled_date IS NOT NULL AND EXTRACT(YEAR FROM cs.settled_date) = $1)
            )${o.where}`, o.params),
      // Money paid to suppliers is money out too, even though it is not typed
      // in on this page — it is recorded against purchase orders.
      pool.query(
        `SELECT COALESCE(SUM(sp.amount), 0) AS t
           FROM supplier_payment sp
           JOIN purchase_order po ON po.po_id = sp.po_id
          WHERE EXTRACT(YEAR FROM sp.payment_date) = $1${s.where}`, s.params),
      pool.query(
        `SELECT COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status = 'pending'), 0) AS pending,
                COALESCE(SUM(r.commission_amount), 0) AS total
           FROM "COMMISSION_RECORD" r
           JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
          WHERE EXTRACT(YEAR FROM r.record_date) = $1${cClause ? ` AND ${cClause}` : ""}`, cParams),
      // Wasted raw materials, priced at the item's current unit cost — 0 for
      // anything never received through a priced purchase order.
      pool.query(
        `SELECT COALESCE(SUM(w.waste_qty * COALESCE(rm.unit_price, 0)), 0) AS t
           FROM "public"."Waste" w
           JOIN "Raw_Material" rm ON rm.rm_id = w.rm_id
          WHERE EXTRACT(YEAR FROM w.recorded_at) = $1${w.where}`, w.params),
      // Cash a delivery partner is holding on the hotel's behalf, not yet
      // settled — a receivable, not a cost, so it is never folded into
      // moneyOut/monthlyTotals below, only reported as its own figure.
      pool.query(
        `SELECT COALESCE(SUM("or_totalCostWtax"), 0) AS t
           FROM "ORDER"
          WHERE or_type = 'delivery' AND payment_method = 'cod' AND cod_settlement_id IS NULL
            AND or_status <> 'cancelled'
            AND EXTRACT(YEAR FROM or_date) = $1${cod.where}`, cod.params),

      // Month by month, the same four figures the headline is made of — so the
      // Income tab and the trend chart add up to the totals above them.
      pool.query(
        `SELECT to_char(fi.item_date, 'YYYY-MM') AS month, COALESCE(SUM(fi.amount), 0) AS total
           FROM "FOLIO_ITEM" fi
           JOIN "FOLIO" f   ON f.folio_id = fi.folio_id
           JOIN "BOOKING" b ON b.booking_id = f.booking_id
          WHERE EXTRACT(YEAR FROM fi.item_date) = $1${h.where}
          GROUP BY 1`, h.params),
      pool.query(
        `SELECT to_char(COALESCE(cs.settled_date, o.or_date), 'YYYY-MM') AS month,
                COALESCE(SUM(COALESCE(o."or_totalCostWtax", o.or_totalcost, 0)), 0) AS total
           FROM "ORDER" o
           LEFT JOIN "DELIVERY_COD_SETTLEMENT" cs ON cs.settlement_id = o.cod_settlement_id
          WHERE o.folio_id IS NULL AND o.or_status <> 'cancelled'
            AND (
              (NOT (o.or_type = 'delivery' AND o.payment_method = 'cod') AND EXTRACT(YEAR FROM o.or_date) = $1)
              OR (o.or_type = 'delivery' AND o.payment_method = 'cod' AND cs.settled_date IS NOT NULL AND EXTRACT(YEAR FROM cs.settled_date) = $1)
            )${o.where}
          GROUP BY 1`, o.params),
      pool.query(
        `SELECT to_char(sp.payment_date, 'YYYY-MM') AS month, COALESCE(SUM(sp.amount), 0) AS total
           FROM supplier_payment sp
           JOIN purchase_order po ON po.po_id = sp.po_id
          WHERE EXTRACT(YEAR FROM sp.payment_date) = $1${s.where}
          GROUP BY 1`, s.params),
      pool.query(
        `SELECT to_char(r.record_date, 'YYYY-MM') AS month, COALESCE(SUM(r.commission_amount), 0) AS total
           FROM "COMMISSION_RECORD" r
           JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
          WHERE EXTRACT(YEAR FROM r.record_date) = $1${cClause ? ` AND ${cClause}` : ""}
          GROUP BY 1`, cParams),
      pool.query(
        `SELECT to_char(w.recorded_at, 'YYYY-MM') AS month, COALESCE(SUM(w.waste_qty * COALESCE(rm.unit_price, 0)), 0) AS total
           FROM "public"."Waste" w
           JOIN "Raw_Material" rm ON rm.rm_id = w.rm_id
          WHERE EXTRACT(YEAR FROM w.recorded_at) = $1${w.where}
          GROUP BY 1`, w.params),
    ]);

    // One row per month that had anything in it.
    const byMonth = {};
    const addTo = (rows, key) => rows.forEach((r) => {
      (byMonth[r.month] ||= { month: r.month, hotel: 0, restaurant: 0, expenses: 0, suppliers: 0, commission: 0, waste: 0 })[key] += Number(r.total);
    });
    addTo(hotelMonthly.rows, "hotel");
    addTo(restaurantMonthly.rows, "restaurant");
    addTo(monthly.rows, "expenses");
    addTo(supplierMonthly.rows, "suppliers");
    addTo(commissionMonthly.rows, "commission");
    addTo(wasteMonthly.rows, "waste");
    const monthlyTotals = Object.values(byMonth).sort((a, b) => (a.month < b.month ? -1 : 1)).map((m) => {
      const revenue = m.hotel + m.restaurant;
      const out = m.expenses + m.suppliers + m.commission + m.waste;
      return { ...m, revenue: +revenue.toFixed(2), out: +out.toFixed(2), net: +(revenue - out).toFixed(2) };
    });

    const totalExpenses = byCategory.rows.reduce((sum, r) => sum + Number(r.total), 0);
    const supplierPayments = Number(suppliers.rows[0].t);
    const wasteTotal = Number(waste.rows[0].t);
    const hotelRevenue = Number(hotel.rows[0].t);
    const restaurantRevenue = Number(restaurant.rows[0].t);

    res.json({
      year,
      monthly: monthly.rows,
      byCategory: byCategory.rows,
      totalExpenses,
      supplierPayments,
      wasteTotal,
      moneyOut: +(totalExpenses + supplierPayments + wasteTotal).toFixed(2),
      revenue: { hotel: hotelRevenue, restaurant: restaurantRevenue },
      totalRevenue: +(hotelRevenue + restaurantRevenue).toFixed(2),
      commissionPending: Number(commissions.rows[0].pending),
      commissionTotal: Number(commissions.rows[0].total),
      codOutstanding: Number(codOutstanding.rows[0].t),
      monthlyTotals,
    });
  } catch (err) { next(err); }
}

export async function createExpense(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    // Everything is checked here, in words, rather than left for the database to
    // refuse with a constraint error the screen can only call "something went wrong".
    const category = oneOf(req.body.exp_category, "Category", EXPENSE_CATEGORIES);
    if (!category) invalid("Choose a category for this expense.");
    const amount = moneyField(req.body.exp_amount, "Amount", { min: 0.01, max: MAX_EXPENSE });
    if (!(amount > 0)) invalid("Enter the amount spent.");
    const description = textField(req.body.exp_description, "Description", 500);
    // The hotel's day, not GMT's, when no date was given.
    const date = dateField(req.body.exp_date, "Date") || hotelToday();

    const { rows } = await pool.query(
      `INSERT INTO "EXPENSE" (b_id, exp_category, exp_amount, exp_description, exp_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b_id||null, category, amount, description, date, req.user?.u_id||null]
    );
    logActivity(req, { action: "create", entity: "expense", entity_id: rows[0].exp_id, b_id: rows[0].b_id,
      summary: `Recorded ${rows[0].exp_category} expense of ${rows[0].exp_amount}` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateExpense(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "EXPENSE", idColumn: "exp_id", id });
    const cur = await pool.query('SELECT * FROM "EXPENSE" WHERE exp_id = $1', [id]);
    if (!cur.rows.length) { res.status(404); return next(new Error("Expense not found")); }
    const was = cur.rows[0];

    // A field that is sent replaces what is there — including with nothing. The
    // description was COALESCEd, so once written it could never be cleared.
    let category = was.exp_category;
    if (given(req.body, "exp_category")) {
      category = oneOf(req.body.exp_category, "Category", EXPENSE_CATEGORIES);
      if (!category) invalid("Choose a category for this expense.");
    }
    let amount = was.exp_amount;
    if (given(req.body, "exp_amount")) {
      amount = moneyField(req.body.exp_amount, "Amount", { min: 0.01, max: MAX_EXPENSE });
      if (!(amount > 0)) invalid("Enter the amount spent.");
    }
    const description = given(req.body, "exp_description")
      ? textField(req.body.exp_description, "Description", 500) : was.exp_description;
    const date = given(req.body, "exp_date") ? dateField(req.body.exp_date, "Date") : null;

    const { rows } = await pool.query(
      `UPDATE "EXPENSE"
       SET exp_category = $1, exp_amount = $2, exp_description = $3, exp_date = COALESCE($4, exp_date)
       WHERE exp_id = $5 RETURNING *`,
      [category, amount, description, date, id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Expense not found")); }
    logActivity(req, { action: "update", entity: "expense", entity_id: id, b_id: rows[0].b_id,
      summary: `Updated ${rows[0].exp_category} expense to ${rows[0].exp_amount}` });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteExpense(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "EXPENSE", idColumn: "exp_id", id });
    // Read it before deleting so the log line can name what went.
    const doomed = await pool.query(
      'SELECT b_id, exp_category, exp_amount, exp_description FROM "EXPENSE" WHERE exp_id = $1', [id]
    );
    const { rowCount } = await pool.query('DELETE FROM "EXPENSE" WHERE exp_id = $1', [id]);
    if (!rowCount) { res.status(404); return next(new Error("Expense not found")); }

    const gone = doomed.rows[0];
    logActivity(req, {
      action: "delete", entity: "expense", entity_id: id, b_id: gone?.b_id,
      summary: gone
        ? `Deleted ${gone.exp_category} expense of ${gone.exp_amount}`
        : `Deleted expense #${id}`,
      details: gone || null,
    });
    res.status(204).send();
  } catch (err) { next(err); }
}
