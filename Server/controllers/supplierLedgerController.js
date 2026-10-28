import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";
import { hotelToday } from "../utils/hotelTime.js";

// ─── GET /api/suppliers/ledger ────────────────────────────────────────────────
// Returns all suppliers with their total purchases, total payments, and balance
export async function getSupplierLedger(req, res, next) {
  try {
    const { role_id, com_id } = req.user;

    let query = `
      WITH purchases AS (
        SELECT po.sup_id, COALESCE(SUM(pi.price), 0) AS total_purchased
        FROM purchase_order po
        JOIN purchase_item pi ON po.po_id = pi.po_id
        WHERE po.status = 'received'
        GROUP BY po.sup_id
      ),
      payments AS (
        SELECT sp.sup_id, COALESCE(SUM(sp.amount), 0) AS total_paid
        FROM supplier_payment sp
        GROUP BY sp.sup_id
      )
      SELECT
        s.sup_id,
        s.sup_name,
        s.sup_contact,
        s.sup_email,
        s.sup_address,
        COALESCE(pu.total_purchased, 0) AS total_purchased,
        COALESCE(pa.total_paid, 0) AS total_paid,
        (COALESCE(pu.total_purchased, 0) - COALESCE(pa.total_paid, 0)) AS balance_due
      FROM "SUPPLIER" s
      LEFT JOIN purchases pu ON s.sup_id = pu.sup_id
      LEFT JOIN payments pa ON s.sup_id = pa.sup_id
      WHERE 1=1
    `;
    const params = [];

    if (role_id !== ROLES.SUPER_ADMIN) {
      query += ` AND s."Com_id" = $1`;
      params.push(com_id);
    }

    query += ` ORDER BY s.sup_name ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/suppliers/:id/history ───────────────────────────────────────────
// Returns chronological history of POs and Payments for a supplier
export async function getSupplierHistory(req, res, next) {
  try {
    const sup_id = Number(req.params.id);
    const { role_id, com_id } = req.user;

    // 1. Verify supplier belongs to company
    let supQuery = `SELECT sup_id FROM "SUPPLIER" WHERE sup_id = $1`;
    const supParams = [sup_id];
    if (role_id !== ROLES.SUPER_ADMIN) {
      supQuery += ` AND "Com_id" = $2`;
      supParams.push(com_id);
    }
    const supCheck = await pool.query(supQuery, supParams);
    if (supCheck.rows.length === 0) {
      res.status(404);
      throw new Error("Supplier not found");
    }

    // 2. Fetch history (union of received POs and Payments)
    const historyQuery = `
      SELECT 
        'purchase' AS type,
        po.po_id AS id,
        po.received_date AS date,
        COALESCE(SUM(pi.price), 0) AS amount,
        'PO #' || LPAD(po.po_id::text, 4, '0') AS description
      FROM purchase_order po
      JOIN purchase_item pi ON po.po_id = pi.po_id
      WHERE po.sup_id = $1 AND po.status = 'received'
      GROUP BY po.po_id, po.received_date

      UNION ALL

      SELECT 
        'payment' AS type,
        sp.pay_id AS id,
        sp.payment_date::timestamp AS date,
        sp.amount,
        'Payment via ' || UPPER(sp.method) AS description
      FROM supplier_payment sp
      WHERE sp.sup_id = $1

      ORDER BY date DESC
    `;

    const result = await pool.query(historyQuery, [sup_id]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/suppliers/spend-trend ───────────────────────────────────────────
// Monthly purchasing totals for the last N months (default 12, clamped to a
// sane 1-24 range) — either across every supplier (no sup_id) or for one
// (sup_id given), same response shape either way so the client's chart
// component doesn't need to know which it got.
export async function getSpendTrend(req, res, next) {
  try {
    const { role_id, com_id, b_id } = req.user;
    const supId = req.query.sup_id ? parseInt(req.query.sup_id, 10) : null;
    const monthsRaw = parseInt(req.query.months, 10);
    const months = Number.isInteger(monthsRaw) ? Math.min(24, Math.max(1, monthsRaw)) : 12;

    const params = [months];
    const conditions = [`po.status = 'received'`, `po.order_date >= now() - ($1 || ' months')::interval`];
    if (supId) {
      params.push(supId);
      conditions.push(`po.sup_id = $${params.length}`);
    }
    if (role_id !== ROLES.SUPER_ADMIN) {
      params.push(com_id);
      conditions.push(`b.com_id = $${params.length}`);
      if (b_id) {
        params.push(b_id);
        conditions.push(`po.b_id = $${params.length}`);
      }
    }

    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('month', po.order_date), 'YYYY-MM') AS month,
              COALESCE(SUM(pi.price), 0) AS total
       FROM purchase_order po
       JOIN purchase_item pi ON pi.po_id = po.po_id
       JOIN "Branch" b       ON b."B_id" = po.b_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY 1 ORDER BY 1`,
      params
    );

    // Zero-fill: a month with no purchases should read as 0 on the chart,
    // not be silently absent (which would look like a gap in the timeline).
    const byMonth = new Map(rows.map((r) => [r.month, Number(r.total)]));
    const out = [];
    const cursor = new Date();
    cursor.setDate(1);
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(cursor);
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({ month: key, total: byMonth.get(key) || 0 });
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
}

// A third payment-recording path used to live here (POST /api/suppliers/:id/pay),
// inserting supplier_payment rows with po_id left NULL. Every other place that
// reads this table — the main supplier ledger, Accounting, Reports, the
// Financial Ledger — joins through purchase_order to get there, an INNER JOIN,
// so a NULL-po_id payment was invisible everywhere except the one screen that
// created it: money left the books here and simply never appeared in a P&L, a
// report or an export. Removed. The client now records every payment through
// POST /api/supplier-payments (createSupplierPayment), which requires a real
// po_id and validates it against what that order actually still owes.

// ─── GET /api/suppliers/delivery-book ─────────────────────────────────────────
// What the Record a delivery page needs to fill itself in, for every supplier
// of the caller's property: what is owed, when they last delivered, whether
// they usually come on this weekday, how they are usually paid, and the items
// they usually bring (from their last three deliveries, with the quantity and
// price of the latest one). All of it from past purchase orders: nothing to set
// up. ?b_id= for platform staff.
export async function getDeliveryBook(req, res, next) {
  try {
    const { role_id, com_id } = req.user;
    const b_id = role_id === ROLES.SUPER_ADMIN ? Number(req.query.b_id) || null : req.user.b_id;
    if (!b_id) { res.status(400); throw new Error("b_id is required"); }

    const sups = await pool.query(
      `WITH purchases AS (
         SELECT po.sup_id, COALESCE(SUM(pi.price), 0) AS total
           FROM purchase_order po JOIN purchase_item pi ON po.po_id = pi.po_id
          WHERE po.status = 'received' GROUP BY po.sup_id
       ), payments AS (
         SELECT sp.sup_id, COALESCE(SUM(sp.amount), 0) AS total FROM supplier_payment sp GROUP BY sp.sup_id
       )
       SELECT s.sup_id, s.sup_name, s.sup_contact,
              COALESCE(pu.total, 0) - COALESCE(pa.total, 0) AS balance_due
         FROM "SUPPLIER" s
         LEFT JOIN purchases pu ON pu.sup_id = s.sup_id
         LEFT JOIN payments pa ON pa.sup_id = s.sup_id
        WHERE ($1::int IS NULL OR s."Com_id" = $1)
        ORDER BY s.sup_name`,
      [role_id === ROLES.SUPER_ADMIN ? null : com_id],
    );

    // Their deliveries to this property, newest first.
    const recv = `
      SELECT po.po_id, po.sup_id, COALESCE(po.received_date, po.order_date) AS d,
             ROW_NUMBER() OVER (PARTITION BY po.sup_id ORDER BY COALESCE(po.received_date, po.order_date) DESC, po.po_id DESC) AS rn
        FROM purchase_order po
       WHERE po.status = 'received' AND po.b_id = $1`;
    const pos = await pool.query(
      `SELECT r.po_id, r.sup_id, r.d, r.rn,
              (SELECT COALESCE(SUM(pi.price), 0) FROM purchase_item pi WHERE pi.po_id = r.po_id) AS total,
              (SELECT COALESCE(SUM(sp.amount), 0) FROM supplier_payment sp WHERE sp.po_id = r.po_id) AS paid
         FROM (${recv}) r WHERE r.rn <= 8`,
      [b_id],
    );
    const lines = await pool.query(
      `SELECT r.sup_id, r.rn, pi.rm_id, pi.pro_id, pi.qty, pi.unit_price,
              COALESCE(rm.rm_name, p.pro_name) AS name
         FROM (${recv}) r
         JOIN purchase_item pi ON pi.po_id = r.po_id
         LEFT JOIN "Raw_Material" rm ON rm.rm_id = pi.rm_id
         LEFT JOIN "Product" p ON p.pro_id = pi.pro_id
        WHERE r.rn <= 3
        ORDER BY r.rn, pi.pi_id`,
      [b_id],
    );

    const weekday = new Date(`${hotelToday()}T12:00:00Z`).getUTCDay();
    const dayOf = (d) => new Date(`${hotelToday(new Date(d))}T12:00:00Z`).getUTCDay();

    const book = sups.rows.map((s) => {
      const mine = pos.rows.filter((p) => p.sup_id === s.sup_id).sort((a, b) => a.rn - b.rn);

      // Usually today: the weekday they come on most, at least twice.
      const days = {};
      for (const p of mine) days[dayOf(p.d)] = (days[dayOf(p.d)] || 0) + 1;
      const top = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
      const usuallyToday = Boolean(top && Number(top[0]) === weekday && top[1] >= 2);

      // How they are usually paid, from the last five deliveries.
      const ways = { F: 0, P: 0, L: 0 };
      for (const p of mine.slice(0, 5)) {
        const total = Number(p.total), paid = Number(p.paid);
        ways[paid >= total - 0.5 && total > 0 ? "F" : paid > 0 ? "P" : "L"] += 1;
      }
      const habit = mine.length ? Object.entries(ways).sort((a, b) => b[1] - a[1])[0][0] : null;

      // Usual items: anything in the last three deliveries, most often first.
      const items = new Map();
      for (const l of lines.rows.filter((x) => x.sup_id === s.sup_id)) {
        const key = l.rm_id ? `rm:${l.rm_id}` : `pro:${l.pro_id}`;
        const it = items.get(key);
        if (it) it.times += 1;
        else items.set(key, {
          kind: l.rm_id ? "rm" : "pro", id: l.rm_id || l.pro_id, name: l.name,
          last_qty: Number(l.qty), last_price: Number(l.unit_price), times: 1, first_rn: Number(l.rn),
        });
      }
      const usual = [...items.values()]
        .sort((a, b) => b.times - a.times || a.first_rn - b.first_rn)
        .slice(0, 15)
        .map(({ first_rn: _r, ...it }) => it);

      return {
        sup_id: s.sup_id, sup_name: s.sup_name, sup_contact: s.sup_contact,
        balance_due: Number(s.balance_due), deliveries: mine.length,
        last_delivery: mine[0]?.d ?? null, usually_today: usuallyToday, habit, usual,
      };
    });

    book.sort((a, b) => Number(b.usually_today) - Number(a.usually_today)
      || (b.last_delivery ? new Date(b.last_delivery).getTime() : 0) - (a.last_delivery ? new Date(a.last_delivery).getTime() : 0)
      || a.sup_name.localeCompare(b.sup_name));
    res.json(book);
  } catch (err) {
    next(err);
  }
}
