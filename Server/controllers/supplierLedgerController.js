import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";

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

// ─── POST /api/suppliers/:id/pay ──────────────────────────────────────────────
// Record a new payment against the supplier's balance
export async function makeSupplierPayment(req, res, next) {
  try {
    const sup_id = Number(req.params.id);
    const { role_id, com_id } = req.user;
    const { amount, method } = req.body;

    if (!amount || Number(amount) <= 0) {
      res.status(400);
      throw new Error("Payment amount must be greater than zero");
    }

    const payMethod = method || "cash";
    const VALID_METHODS = ["cash", "card", "bank_transfer", "cheque", "online"];
    if (!VALID_METHODS.includes(payMethod)) {
      res.status(400);
      throw new Error("Invalid payment method");
    }

    // 1. Verify supplier
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

    // 2. Insert payment
    // We link the payment to the supplier, but not a specific PO for generic payments
    // Wait, the schema in schema.sql for supplier_payment says:
    // po_id INTEGER NOT NULL REFERENCES purchase_order(po_id)
    // If we make a generic payment, we don't have a po_id!
    // Let's check if po_id is really NOT NULL in the database.
    const result = await pool.query(
      `INSERT INTO supplier_payment (amount, payment_date, method, sup_id, po_id)
       VALUES ($1, CURRENT_DATE, $2, $3, NULL)
       RETURNING *`,
      [Number(amount), payMethod, sup_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}
