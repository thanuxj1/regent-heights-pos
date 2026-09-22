import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";
import { branchClause } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";

/*
 * Payments to suppliers.
 *
 * Every read and write here is scoped to the caller's own property, through the
 * purchase order the payment belongs to. None of it used to be: the routes had
 * no login at all and the queries had no tenant filter, so anyone who could
 * reach the server could list every company's payments — supplier names and
 * phone numbers included — and add, change or delete them.
 */

// ─── Helpers ──────────────────────────────────────────────────────

function parsePositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw Object.assign(new Error(`${fieldName} must be a positive integer`), {
      status: 400,
    });
  }
  return parsed;
}

function sanitizeBody(body, allowedFields) {
  const sanitized = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      sanitized[field] =
        typeof body[field] === "string" ? body[field].trim() : body[field];
    }
  }
  return sanitized;
}

function parsePositiveDecimal(value, fieldName) {
  const parsed = Number(value);
  if (isNaN(parsed) || parsed <= 0) {
    throw Object.assign(
      new Error(`${fieldName} must be a positive number`),
      { status: 400 },
    );
  }
  return parsed;
}

const VALID_METHODS = ["cash", "card", "bank_transfer", "cheque", "online"];
const MAX_AMOUNT    = 9_999_999.99;

/** " AND <the purchase order is the caller's>", its parameter pushed onto params. */
function poScope(req, params, column = "po.b_id") {
  const clause = branchClause(req, column, params);
  return clause ? ` AND ${clause}` : "";
}

/** Suppliers are company-wide: " AND <the supplier is the caller's company's>". */
function supplierScope(req, params) {
  if (Number(req.user?.role_id) === ROLES.SUPER_ADMIN) return "";
  params.push(req.user?.com_id ?? -1);
  return ` AND "Com_id" = $${params.length}`;
}

const SELECT_PAYMENT = `
  SELECT sp.pay_id, sp.amount, sp.payment_date, sp.method,
         s.sup_id, s.sup_name, s.sup_contact,
         po.po_id, po.b_id, po.status AS order_status
    FROM supplier_payment sp
    JOIN "SUPPLIER"     s  ON s.sup_id = sp.sup_id
    JOIN purchase_order po ON po.po_id  = sp.po_id`;

// ─── GET /api/supplier-payments ───────────────────────────────────
export async function getSupplierPayments(req, res, next) {
  try {
    const params = [];
    const scope = branchClause(req, "po.b_id", params);
    const result = await pool.query(
      `${SELECT_PAYMENT} ${scope ? `WHERE ${scope}` : ""}
       ORDER BY sp.payment_date DESC, sp.pay_id DESC`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/supplier-payments/:id ───────────────────────────────
export async function getSupplierPaymentById(req, res, next) {
  try {
    const id = parsePositiveInt(req.params.id, "pay_id");
    const params = [id];
    const result = await pool.query(
      `${SELECT_PAYMENT} WHERE sp.pay_id = $1${poScope(req, params)}`,
      params,
    );
    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("Supplier payment not found");
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/supplier-payments/supplier/:supId ───────────────────
export async function getPaymentsBySupplier(req, res, next) {
  try {
    const supId = parsePositiveInt(req.params.supId, "sup_id");

    const sp = [supId];
    const sup = await pool.query(
      `SELECT sup_id FROM "SUPPLIER" WHERE sup_id = $1${supplierScope(req, sp)}`, sp);
    if (sup.rows.length === 0) {
      res.status(404);
      throw new Error("Supplier not found");
    }

    const params = [supId];
    const result = await pool.query(
      `SELECT sp.pay_id, sp.amount, sp.payment_date, sp.method,
              po.po_id, po.status AS order_status
         FROM supplier_payment sp
         JOIN purchase_order po ON po.po_id = sp.po_id
        WHERE sp.sup_id = $1${poScope(req, params)}
        ORDER BY sp.payment_date DESC, sp.pay_id DESC`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/supplier-payments/order/:poId ───────────────────────
export async function getPaymentsByOrder(req, res, next) {
  try {
    const poId = parsePositiveInt(req.params.poId, "po_id");

    const op = [poId];
    const order = await pool.query(
      `SELECT po.po_id FROM purchase_order po WHERE po.po_id = $1${poScope(req, op)}`, op);
    if (order.rows.length === 0) {
      res.status(404);
      throw new Error("Purchase order not found");
    }

    const result = await pool.query(
      `SELECT sp.pay_id, sp.amount, sp.payment_date, sp.method, s.sup_id, s.sup_name
         FROM supplier_payment sp
         JOIN "SUPPLIER" s ON s.sup_id = sp.sup_id
        WHERE sp.po_id = $1
        ORDER BY sp.payment_date DESC, sp.pay_id DESC`,
      [poId],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/supplier-payments ──────────────────────────────────
// A payment against a received order — the whole balance, or part of it.
export async function createSupplierPayment(req, res, next) {
  const client = await pool.connect();
  try {
    const body = sanitizeBody(req.body || {}, [
      "sup_id", "po_id", "amount", "method", "payment_date",
    ]);
    const { sup_id, po_id, amount, method, payment_date } = body;

    if (sup_id === undefined || po_id === undefined || amount === undefined || !method) {
      res.status(400);
      throw new Error("sup_id, po_id, amount and method are required");
    }

    const parsedSupId  = parsePositiveInt(sup_id, "sup_id");
    const parsedPoId   = parsePositiveInt(po_id, "po_id");
    const parsedAmount = parsePositiveDecimal(amount, "amount");

    if (parsedAmount > MAX_AMOUNT) {
      res.status(400);
      throw new Error(`amount cannot exceed ${MAX_AMOUNT.toLocaleString()}`);
    }
    if (!VALID_METHODS.includes(method)) {
      res.status(400);
      throw new Error(`method must be one of: ${VALID_METHODS.join(", ")}`);
    }
    if (payment_date && isNaN(Date.parse(payment_date))) {
      res.status(400);
      throw new Error("payment_date is not a valid date");
    }

    await client.query("BEGIN");

    // Lock the order, so two payments recorded at the same moment cannot both
    // squeeze under its total.
    const op = [parsedPoId];
    const order = await client.query(
      `SELECT po.po_id, po.sup_id, po.status, po.b_id
         FROM purchase_order po
        WHERE po.po_id = $1${poScope(req, op)}
        FOR UPDATE`,
      op,
    );
    if (order.rows.length === 0) {
      res.status(404);
      throw new Error("Purchase order not found");
    }
    if (Number(order.rows[0].sup_id) !== parsedSupId) {
      res.status(409);
      throw new Error("sup_id does not match the supplier on this purchase order");
    }
    if (order.rows[0].status !== "received") {
      res.status(409);
      throw new Error("Cannot record payment — purchase order has not been received yet");
    }

    const sums = await client.query(
      `SELECT (SELECT COALESCE(SUM(amount), 0) FROM supplier_payment WHERE po_id = $1) AS paid,
              (SELECT COALESCE(SUM(price),  0) FROM purchase_item    WHERE po_id = $1) AS total`,
      [parsedPoId],
    );
    const alreadyPaid = Number(sums.rows[0].paid);
    const orderValue  = Number(sums.rows[0].total);
    if (orderValue > 0 && alreadyPaid + parsedAmount > orderValue + 0.005) {
      res.status(409);
      throw new Error(
        `Payment would exceed order total. Order value: ${orderValue.toFixed(2)}, ` +
        `already paid: ${alreadyPaid.toFixed(2)}, this payment: ${parsedAmount.toFixed(2)}`,
      );
    }

    const result = await client.query(
      `INSERT INTO supplier_payment (sup_id, po_id, amount, method, payment_date)
       VALUES ($1, $2, $3, $4, COALESCE($5::DATE, CURRENT_DATE))
       RETURNING pay_id, sup_id, po_id, amount, method, payment_date`,
      [parsedSupId, parsedPoId, parsedAmount, method, payment_date || null],
    );
    await client.query("COMMIT");

    logActivity(req, {
      action: "payment", entity: "supplier_payment", entity_id: result.rows[0].pay_id,
      b_id: order.rows[0].b_id,
      summary: `Paid ${parsedAmount.toFixed(2)} (${method}) against purchase order #${parsedPoId}`,
      details: { po_id: parsedPoId, sup_id: parsedSupId, amount: parsedAmount, method },
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

// ─── PUT /api/supplier-payments/:id ───────────────────────────────
export async function updateSupplierPayment(req, res, next) {
  try {
    const id = parsePositiveInt(req.params.id, "pay_id");

    const body = sanitizeBody(req.body || {}, ["amount", "method", "payment_date"]);
    if (Object.keys(body).length === 0) {
      res.status(400);
      throw new Error("No fields provided to update");
    }
    const { amount, method, payment_date } = body;

    const params = [id];
    const existing = await pool.query(
      `SELECT sp.pay_id, sp.po_id, sp.amount, po.b_id
         FROM supplier_payment sp
         JOIN purchase_order po ON po.po_id = sp.po_id
        WHERE sp.pay_id = $1${poScope(req, params)}`,
      params,
    );
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Supplier payment not found");
    }
    const current = existing.rows[0];

    let parsedAmount = null;
    if (amount !== undefined) {
      parsedAmount = parsePositiveDecimal(amount, "amount");
      if (parsedAmount > MAX_AMOUNT) {
        res.status(400);
        throw new Error(`amount cannot exceed ${MAX_AMOUNT.toLocaleString()}`);
      }
      const sums = await pool.query(
        `SELECT (SELECT COALESCE(SUM(amount), 0) FROM supplier_payment
                  WHERE po_id = $1 AND pay_id <> $2) AS others,
                (SELECT COALESCE(SUM(price), 0) FROM purchase_item WHERE po_id = $1) AS total`,
        [current.po_id, id],
      );
      const othersPaid = Number(sums.rows[0].others);
      const orderValue = Number(sums.rows[0].total);
      if (orderValue > 0 && othersPaid + parsedAmount > orderValue + 0.005) {
        res.status(409);
        throw new Error(
          `Payment would exceed order total. Order value: ${orderValue.toFixed(2)}, ` +
          `other payments: ${othersPaid.toFixed(2)}, this payment: ${parsedAmount.toFixed(2)}`,
        );
      }
    }
    if (method !== undefined && !VALID_METHODS.includes(method)) {
      res.status(400);
      throw new Error(`method must be one of: ${VALID_METHODS.join(", ")}`);
    }
    if (payment_date && isNaN(Date.parse(payment_date))) {
      res.status(400);
      throw new Error("payment_date is not a valid date");
    }

    const result = await pool.query(
      `UPDATE supplier_payment
          SET amount       = COALESCE($1, amount),
              method       = COALESCE($2, method),
              payment_date = COALESCE($3::DATE, payment_date)
        WHERE pay_id = $4
        RETURNING pay_id, sup_id, po_id, amount, method, payment_date`,
      [parsedAmount, method ?? null, payment_date || null, id],
    );

    logActivity(req, {
      action: "update", entity: "supplier_payment", entity_id: id, b_id: current.b_id,
      summary: `Changed a supplier payment on purchase order #${current.po_id}`,
      details: { before: Number(current.amount), after: Number(result.rows[0].amount),
                 method: result.rows[0].method },
    });

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/supplier-payments/:id ────────────────────────────
export async function deleteSupplierPayment(req, res, next) {
  try {
    const id = parsePositiveInt(req.params.id, "pay_id");

    const params = [id];
    const existing = await pool.query(
      `SELECT sp.pay_id, sp.po_id, sp.amount, sp.method, po.b_id
         FROM supplier_payment sp
         JOIN purchase_order po ON po.po_id = sp.po_id
        WHERE sp.pay_id = $1${poScope(req, params)}`,
      params,
    );
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Supplier payment not found");
    }

    await pool.query(`DELETE FROM supplier_payment WHERE pay_id = $1`, [id]);

    const gone = existing.rows[0];
    logActivity(req, {
      action: "delete", entity: "supplier_payment", entity_id: id, b_id: gone.b_id,
      summary: `Deleted a payment of ${Number(gone.amount).toFixed(2)} on purchase order #${gone.po_id}`,
      details: gone,
    });

    res.status(204).send();
  } catch (err) {
    if (err?.code === "23503") {
      res.status(409);
      return next(new Error("Cannot delete payment because it is referenced elsewhere"));
    }
    next(err);
  }
}
