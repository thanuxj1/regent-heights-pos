import { recordPurchase } from "../utils/inventory.js";
import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const VALID_STATUSES = ["pending", "received"];
// Same list the supplier_payment table's CHECK allows.
const PAY_METHODS = ["cash", "card", "bank_transfer", "cheque", "online"];

// ─── GET /api/purchase-orders ─────────────────────────────────────────────────
// ─── GET /api/purchase-orders ─────────────────────────────────────────────────
export async function getPurchaseOrders(req, res, next) {
  try {
    const { role_id, com_id, b_id } = req.user;
    let query = `SELECT
         po.po_id,
         po.status,
         po.order_date,
         po.received_date,
         s.sup_id,
         s.sup_name,
         s.sup_contact,
         b."B_id",
         b."B_name"
       FROM purchase_order po
       JOIN "SUPPLIER" s ON s.sup_id = po.sup_id
       JOIN "Branch"   b ON b."B_id" = po.b_id`;

    const conditions = [];
    const params = [];

    if (role_id !== ROLES.SUPER_ADMIN) {
      conditions.push(`b.com_id = $${params.length + 1}`);
      params.push(com_id);

      if (b_id) {
        conditions.push(`po.b_id = $${params.length + 1}`);
        params.push(b_id);
      }
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += ` ORDER BY po.order_date DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/purchase-orders/supplier/:supId ────────────────────────────────
export async function getPurchaseOrdersBySupplier(req, res, next) {
  try {
    const supId = parsePositiveInt(req.params.supId, "sup_id");
    const { role_id, com_id, b_id } = req.user;

    // Verify supplier exists and belongs to company
    let supQuery = `SELECT sup_id FROM "SUPPLIER" WHERE sup_id = $1`;
    const supParams = [supId];
    if (role_id !== ROLES.SUPER_ADMIN) {
      supQuery += ` AND "Com_id" = $2`;
      supParams.push(com_id);
    }
    const supCheck = await pool.query(supQuery, supParams);
    if (supCheck.rows.length === 0) {
      res.status(404);
      throw new Error(`Supplier not found`);
    }

    let query = `SELECT
         po.po_id,
         po.status,
         po.order_date,
         po.received_date,
         s.sup_id,
         s.sup_name,
         s.sup_contact,
         b."B_id",
         b."B_name"
       FROM purchase_order po
       JOIN "SUPPLIER" s ON s.sup_id = po.sup_id
       JOIN "Branch"   b ON b."B_id" = po.b_id
       WHERE po.sup_id = $1`;
    const params = [supId];

    if (role_id !== ROLES.SUPER_ADMIN) {
      query += ` AND b.com_id = $2`;
      params.push(com_id);

      if (b_id) {
        query += ` AND po.b_id = $3`;
        params.push(b_id);
      }
    }

    query += ` ORDER BY po.order_date DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/purchase-orders/most-purchased-items ────────────────────────────
// Top 10 raw materials/supplies/products by total spend, across every
// received purchase order. A purchase_item names exactly one of rm_id/pro_id
// (enforced by a CHECK constraint — migrations/028_product_purchase.sql), so
// the two are combined here via COALESCE rather than queried separately.
export async function getMostPurchasedItems(req, res, next) {
  try {
    const { role_id, com_id, b_id } = req.user;

    const conditions = [`po.status = 'received'`];
    const params = [];
    if (role_id !== ROLES.SUPER_ADMIN) {
      params.push(com_id);
      conditions.push(`b.com_id = $${params.length}`);
      if (b_id) {
        params.push(b_id);
        conditions.push(`po.b_id = $${params.length}`);
      }
    }

    const { rows } = await pool.query(
      `SELECT
         COALESCE(rm.rm_name, p.pro_name) AS name,
         CASE WHEN pi.pro_id IS NOT NULL THEN 'product' ELSE COALESCE(rm.item_category, 'ingredient') END AS kind,
         COALESCE(rm.unit, 'units') AS unit,
         SUM(pi.qty) AS total_qty,
         SUM(pi.price) AS total_spend
       FROM purchase_order po
       JOIN purchase_item pi     ON pi.po_id = po.po_id
       JOIN "Branch" b           ON b."B_id" = po.b_id
       LEFT JOIN "Raw_Material" rm ON rm.rm_id = pi.rm_id
       LEFT JOIN "Product" p       ON p.pro_id = pi.pro_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY 1, 2, 3
       ORDER BY total_spend DESC
       LIMIT 10`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/purchase-orders/:id ─────────────────────────────────────────────
export async function getPurchaseOrderById(req, res, next) {
  try {
    const id = parsePositiveInt(req.params.id, "po_id");
    const { role_id, com_id, b_id } = req.user;

    let query = `SELECT
         po.po_id,
         po.status,
         po.order_date,
         po.received_date,
         s.sup_id,
         s.sup_name,
         s.sup_contact,
         b."B_id",
         b."B_name"
       FROM purchase_order po
       JOIN "SUPPLIER" s ON s.sup_id = po.sup_id
       JOIN "Branch"   b ON b."B_id" = po.b_id
       WHERE po.po_id = $1`;
    const params = [id];

    if (role_id !== ROLES.SUPER_ADMIN) {
      query += ` AND b.com_id = $2`;
      params.push(com_id);

      if (b_id) {
        query += ` AND po.b_id = $3`;
        params.push(b_id);
      }
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("Purchase order not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/purchase-orders ────────────────────────────────────────────────
export async function createPurchaseOrder(req, res, next) {
  try {
    const body = sanitizeBody(req.body, [
      "sup_id",
      "B_id",
      "status",
      "order_date",
      "received_date",
    ]);

    const { sup_id, B_id, status, order_date, received_date } = body;

    // ── Required fields ──
    if (sup_id === undefined || B_id === undefined) {
      res.status(400);
      throw new Error("sup_id and B_id are required");
    }

    const parsedSupId = parsePositiveInt(sup_id, "sup_id");
    const parsedBId   = parsePositiveInt(B_id,   "B_id");

    // ── Status validation ──
    const resolvedStatus = status ?? "pending";
    if (!VALID_STATUSES.includes(resolvedStatus)) {
      res.status(400);
      throw new Error(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    // ── received_date only allowed when status is 'received' ──
    if (received_date && resolvedStatus !== "received") {
      res.status(400);
      throw new Error("received_date can only be set when status is 'received'");
    }

    // ── Date format validation ──
    if (order_date && isNaN(Date.parse(order_date))) {
      res.status(400);
      throw new Error("order_date is not a valid date");
    }
    if (received_date && isNaN(Date.parse(received_date))) {
      res.status(400);
      throw new Error("received_date is not a valid date");
    }

    // ── received_date cannot be before order_date ──
    if (order_date && received_date) {
      if (new Date(received_date) < new Date(order_date)) {
        res.status(400);
        throw new Error("received_date cannot be before order_date");
      }
    }

    // ── Supplier existence & scoping check ──
    let supQuery = `SELECT sup_id FROM "SUPPLIER" WHERE sup_id = $1`;
    const supParams = [parsedSupId];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      supQuery += ` AND "Com_id" = $2`;
      supParams.push(req.user.com_id);
    }
    const supCheck = await pool.query(supQuery, supParams);
    if (supCheck.rows.length === 0) {
      res.status(404);
      throw new Error(`Supplier with id ${parsedSupId} not found`);
    }

    // ── Branch existence & scoping check ──
    let branchQuery = `SELECT "B_id" FROM "Branch" WHERE "B_id" = $1`;
    const branchParams = [parsedBId];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      branchQuery += ` AND "com_id" = $2`;
      branchParams.push(req.user.com_id);
    }
    const branchCheck = await pool.query(branchQuery, branchParams);
    if (branchCheck.rows.length === 0) {
      res.status(404);
      throw new Error(`Branch with id ${parsedBId} not found`);
    }

    const result = await pool.query(
      `INSERT INTO purchase_order (sup_id, b_id, status, order_date, received_date)
       VALUES ($1, $2, $3, COALESCE($4::TIMESTAMP, CURRENT_TIMESTAMP), $5::TIMESTAMP)
       RETURNING po_id, sup_id, b_id, status, order_date, received_date`,
      [
        parsedSupId,
        parsedBId,
        resolvedStatus,
        order_date    || null,
        received_date || null,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/purchase-orders/:id ─────────────────────────────────────────────
export async function updatePurchaseOrder(req, res, next) {
  try {
    const id = parsePositiveInt(req.params.id, "po_id");

    const body = sanitizeBody(req.body, [
      "sup_id",
      "B_id",
      "status",
      "order_date",
      "received_date",
    ]);

    if (Object.keys(body).length === 0) {
      res.status(400);
      throw new Error("No fields provided to update");
    }

    const { sup_id, B_id, status, order_date, received_date } = body;

    // ── Existence & Scoping check ──
    let existQuery = `
      SELECT po.po_id, po.status, po.order_date 
      FROM purchase_order po
      JOIN "Branch" b ON b."B_id" = po.b_id
      WHERE po.po_id = $1
    `;
    const existParams = [id];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      existQuery += ` AND b.com_id = $2`;
      existParams.push(req.user.com_id);
      if (req.user.b_id) {
        existQuery += ` AND po.b_id = $3`;
        existParams.push(req.user.b_id);
      }
    }
    const existing = await pool.query(existQuery, existParams);
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Purchase order not found");
    }

    const currentStatus    = existing.rows[0].status;
    const currentOrderDate = existing.rows[0].order_date;

    // ── Cannot edit a received order ──
    if (currentStatus === "received" && status && status !== "received") {
      res.status(409);
      throw new Error("Cannot revert a received purchase order back to pending");
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      res.status(400);
      throw new Error(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    const resolvedStatus = status ?? currentStatus;
    if (received_date && resolvedStatus !== "received") {
      res.status(400);
      throw new Error("received_date can only be set when status is 'received'");
    }

    if (order_date && isNaN(Date.parse(order_date))) {
      res.status(400);
      throw new Error("order_date is not a valid date");
    }
    if (received_date && isNaN(Date.parse(received_date))) {
      res.status(400);
      throw new Error("received_date is not a valid date");
    }

    const resolvedOrderDate = order_date
      ? new Date(order_date)
      : new Date(currentOrderDate);
    if (received_date && new Date(received_date) < resolvedOrderDate) {
      res.status(400);
      throw new Error("received_date cannot be before order_date");
    }

    // ── FK validations ──
    if (sup_id !== undefined) {
      const parsedSupId = parsePositiveInt(sup_id, "sup_id");
      let supQuery = `SELECT sup_id FROM "SUPPLIER" WHERE sup_id = $1`;
      const supParams = [parsedSupId];
      if (req.user.role_id !== ROLES.SUPER_ADMIN) {
        supQuery += ` AND "Com_id" = $2`;
        supParams.push(req.user.com_id);
      }
      const supCheck = await pool.query(supQuery, supParams);
      if (supCheck.rows.length === 0) {
        res.status(404);
        throw new Error(`Supplier with id ${parsedSupId} not found`);
      }
    }

    if (B_id !== undefined) {
      const parsedBId = parsePositiveInt(B_id, "B_id");
      let branchQuery = `SELECT "B_id" FROM "Branch" WHERE "B_id" = $1`;
      const branchParams = [parsedBId];
      if (req.user.role_id !== ROLES.SUPER_ADMIN) {
        branchQuery += ` AND "com_id" = $2`;
        branchParams.push(req.user.com_id);
      }
      const branchCheck = await pool.query(branchQuery, branchParams);
      if (branchCheck.rows.length === 0) {
        res.status(404);
        throw new Error(`Branch with id ${parsedBId} not found`);
      }
    }

    const result = await pool.query(
      `UPDATE purchase_order
       SET
         sup_id        = COALESCE($1, sup_id),
         b_id          = COALESCE($2, b_id),
         status        = COALESCE($3, status),
         order_date    = COALESCE($4::TIMESTAMP, order_date),
         received_date = COALESCE($5::TIMESTAMP, received_date)
       WHERE po_id = $6
       RETURNING po_id, sup_id, b_id, status, order_date, received_date`,
      [
        sup_id        ? Number(sup_id) : null,
        B_id          ? Number(B_id)   : null,
        status        ?? null,
        order_date    || null,
        received_date || null,
        id,
      ],
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// // ─── PATCH /api/purchase-orders/:id/status ───────────────────────────────────
// export async function updatePurchaseOrderStatus(req, res, next) {
//   try {
//     const id = parsePositiveInt(req.params.id, "po_id");

//     const body = sanitizeBody(req.body, ["status"]);
//     const { status } = body;

//     if (!status) {
//       res.status(400);
//       throw new Error("status is required");
//     }

//     if (!VALID_STATUSES.includes(status)) {
//       res.status(400);
//       throw new Error(`status must be one of: ${VALID_STATUSES.join(", ")}`);
//     }

//     // ── Existence & Scoping check ──
//     let existQuery = `
//       SELECT po.po_id, po.status 
//       FROM purchase_order po
//       JOIN "Branch" b ON b."B_id" = po.b_id
//       WHERE po.po_id = $1
//     `;
//     const existParams = [id];
//     if (req.user.role_id !== ROLES.SUPER_ADMIN) {
//       existQuery += ` AND b.com_id = $2`;
//       existParams.push(req.user.com_id);
//       if (req.user.b_id) {
//         existQuery += ` AND po.b_id = $3`;
//         existParams.push(req.user.b_id);
//       }
//     }
//     const existing = await pool.query(existQuery, existParams);
//     if (existing.rows.length === 0) {
//       res.status(404);
//       throw new Error("Purchase order not found");
//     }

//     const currentStatus = existing.rows[0].status;

//     if (currentStatus === "received" && status !== "received") {
//       res.status(409);
//       throw new Error("Cannot revert a received purchase order back to pending");
//     }

//     if (currentStatus === status) {
//       res.status(409);
//       throw new Error(`Purchase order is already '${status}'`);
//     }

//     if (status === "received") {
//       const itemCheck = await pool.query(
//         `SELECT pi_id FROM purchase_item WHERE po_id = $1 LIMIT 1`,
//         [id],
//       );
//       if (itemCheck.rows.length === 0) {
//         res.status(422);
//         throw new Error(
//           "Cannot mark order as received — no purchase items exist for this order",
//         );
//       }
//     }

//     const result = await pool.query(
//       `UPDATE purchase_order
//        SET
//          status        = $1::VARCHAR,
//          received_date = CASE WHEN $1::VARCHAR = 'received' THEN CURRENT_TIMESTAMP ELSE received_date END
//        WHERE po_id = $2
//        RETURNING po_id, sup_id, b_id, status, order_date, received_date`,
//       [status, id],
//     );
export async function updatePurchaseOrderStatus(req, res, next) {
  try {
    const id = parsePositiveInt(req.params.id, "po_id");

    const body = sanitizeBody(req.body, ["status", "payment"]);
    const { status, payment } = body;

    if (!status) {
      res.status(400);
      throw new Error("status is required");
    }

    if (!VALID_STATUSES.includes(status)) {
      res.status(400);
      throw new Error(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    // ── Existence & Scoping check ──
    let existQuery = `
      SELECT po.po_id, po.status, po.b_id, po.sup_id
      FROM purchase_order po
      JOIN "Branch" b ON b."B_id" = po.b_id
      WHERE po.po_id = $1
    `;
    const existParams = [id];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      existQuery += ` AND b.com_id = $2`;
      existParams.push(req.user.com_id);
      if (req.user.b_id) {
        existQuery += ` AND po.b_id = $3`;
        existParams.push(req.user.b_id);
      }
    }
    const existing = await pool.query(existQuery, existParams);
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Purchase order not found");
    }

    const currentStatus = existing.rows[0].status;

    if (currentStatus === "received" && status !== "received") {
      res.status(409);
      throw new Error("Cannot revert a received purchase order back to pending");
    }

    if (currentStatus === status) {
      res.status(409);
      throw new Error(`Purchase order is already '${status}'`);
    }

    // If marking as received, ensure there is at least one purchase_item
    if (status === "received") {
      const itemCheck = await pool.query(
        `SELECT pi_id FROM purchase_item WHERE po_id = $1 LIMIT 1`,
        [id],
      );
      if (itemCheck.rows.length === 0) {
        res.status(422);
        throw new Error(
          "Cannot mark order as received — no purchase items exist for this order",
        );
      }
    }

    // Paying on receipt is optional. A supplier who gives credit is paid later
    // from the Suppliers page, in as many parts as it takes. When it is paid
    // now, the payment is written in the same transaction as the goods — the
    // screen used to send it as a second request that never checked whether
    // the first had worked.
    let pay = null;
    if (payment && status === "received") {
      const amount = Number(payment.amount);
      const method = String(payment.method || "").toLowerCase().trim();
      const total = Number((await pool.query(
        `SELECT COALESCE(SUM(price), 0) AS t FROM purchase_item WHERE po_id = $1`, [id],
      )).rows[0].t);
      if (!(amount > 0)) {
        res.status(400);
        throw new Error("A payment needs an amount above zero");
      }
      if (amount > total + 0.005) {
        res.status(409);
        throw new Error(`That is more than the order is worth (${total.toFixed(2)})`);
      }
      if (!PAY_METHODS.includes(method)) {
        res.status(400);
        throw new Error(`Payment method must be one of: ${PAY_METHODS.join(", ")}`);
      }
      pay = { amount, method };
    }

    // Perform the status update and stock adjustments in a single transaction
    const client = await pool.connect();
    try {
      let paid = null;
      await client.query("BEGIN");

      // If the target status is 'received', add each purchase_item.qty to the corresponding Raw_Material.stock_qty
      if (status === "received") {
        // Ordered by material so a sale drawing on the same rows at the same
        // moment queues behind this instead of deadlocking with it.
        const items = await client.query(
          `SELECT rm_id, pro_id, qty, unit_price FROM purchase_item WHERE po_id = $1 ORDER BY COALESCE(rm_id, 0), COALESCE(pro_id, 0)`,
          [id],
        );

        for (const it of items.rows) {
          if (!(Number(it.qty) > 0)) continue;

          if (it.pro_id) {
            // Resale product — add received qty directly to Product stock
            const updateRes = await client.query(
              `UPDATE "Product"
               SET pro_qty = COALESCE(pro_qty, 0) + $1::numeric
               WHERE pro_id = $2
               RETURNING pro_id`,
              [it.qty, it.pro_id],
            );
            if (updateRes.rows.length === 0) {
              res.status(404);
              throw new Error(`Product with id ${it.pro_id} not found`);
            }
          } else {
            // Kitchen ingredient — add to Raw Material stock (existing behaviour),
            // and keep its unit cost current so anything pricing a quantity of
            // this item (e.g. Waste Tracking) has a real figure to read.
            const updateRes = await client.query(
              `UPDATE "Raw_Material"
               SET stock_qty = COALESCE(stock_qty, 0) + $1::numeric,
                   unit_price = COALESCE($3::numeric, unit_price)
               WHERE rm_id = $2
               RETURNING rm_id`,
              [it.qty, it.rm_id, it.unit_price],
            );
            if (updateRes.rows.length === 0) {
              res.status(404);
              throw new Error(`Raw material with id ${it.rm_id} not found`);
            }
            await recordPurchase(client, {
              b_id: existing.rows[0].b_id, po_id: id, rm_id: it.rm_id, qty: it.qty,
              u_id: req.user?.u_id ?? null,
            });
          }
        }

        if (pay) {
          const p = await client.query(
            `INSERT INTO supplier_payment (sup_id, po_id, amount, method, payment_date)
             VALUES ($1, $2, $3, $4, CURRENT_DATE)
             RETURNING pay_id, sup_id, po_id, amount, method, payment_date`,
            [existing.rows[0].sup_id, id, pay.amount, pay.method],
          );
          paid = p.rows[0];
        }
      }

      // Update purchase_order status + received_date
      const result = await client.query(
        `UPDATE purchase_order
         SET
           status        = $1::VARCHAR,
           received_date = CASE WHEN $1::VARCHAR = 'received' THEN CURRENT_TIMESTAMP ELSE received_date END
         WHERE po_id = $2
         RETURNING po_id, sup_id, b_id, status, order_date, received_date`,
        [status, id],
      );

      await client.query("COMMIT");
      res.json({ ...result.rows[0], payment: paid });
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}


// ─── DELETE /api/purchase-orders/:id ─────────────────────────────────────────
export async function deletePurchaseOrder(req, res, next) {
  try {
    const id = parsePositiveInt(req.params.id, "po_id");

    // ── Existence & Scoping check ──
    let existQuery = `
      SELECT po.po_id, po.status 
      FROM purchase_order po
      JOIN "Branch" b ON b."B_id" = po.b_id
      WHERE po.po_id = $1
    `;
    const existParams = [id];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      existQuery += ` AND b.com_id = $2`;
      existParams.push(req.user.com_id);
      if (req.user.b_id) {
        existQuery += ` AND po.b_id = $3`;
        existParams.push(req.user.b_id);
      }
    }
    const existing = await pool.query(existQuery, existParams);
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Purchase order not found");
    }

    if (existing.rows[0].status === "received") {
      res.status(409);
      throw new Error("Cannot delete a received purchase order");
    }

    // ── Cascade-safe: delete items first, then order ──
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM purchase_item  WHERE po_id = $1`, [id]);
      await client.query(`DELETE FROM purchase_order WHERE po_id = $1`, [id]);
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    res.status(204).send();
  } catch (err) {
    if (err?.code === "23503") {
      res.status(409);
      return next(
        new Error("Cannot delete purchase order because it is referenced elsewhere"),
      );
    }
    next(err);
  }
}
