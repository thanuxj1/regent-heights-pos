import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";
import {
  emitSocketEvent,
  emitOrderEvent,
  getCashierSocketRoom,
  getKitchenSocketRoom,
} from "../utils/socket.js";
import {
  validateQuantity as validateItemQuantity,
  validateUnitPrice as validateItemUnitPrice,
} from "./orderItemController.js";
import { branchClause, writeBranchId } from "../utils/scope.js";
import { takeStock, returnStock, isStockProblem } from "../utils/inventory.js";
import { logActivity } from "../utils/activityLog.js";
import { requireApproval, DISCOUNT_APPROVAL_PCT } from "../utils/approval.js";
import { hotelToday } from "../utils/hotelTime.js";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const VALID_STATUSES = ["pending", "preparing", "completed", "cancelled"];
const VALID_TYPES = ["dine-in", "takeaway", "delivery"];
// Tenders the till can take. "room" is a charge to a guest folio, not money
// in the drawer, so it is a tender but never a cash one. "cod" is cash the
// delivery partner's rider collected from the customer — also never a till
// tender, since the hotel's own cashier never touches it until settlement.
const TENDERS = ["cash", "card", "mobile_pay", "voucher", "room", "split", "cod"];

// Delivery partners a "delivery" order can be attributed to — a real,
// manager-editable list (Server/controllers/deliveryPartnerController.js),
// not a hardcoded one. Checked live so a newly-added partner works
// immediately and a deactivated one is refused on new orders without
// touching orders that already reference it.
// requireActive=false is for settling a partner's existing debt — deactivating
// a partner must stop *new* orders through them, never strand what they
// already owe from before they were switched off.
export async function isValidDeliveryPartner(com_id, key, { requireActive = true } = {}) {
  if (!key) return false;
  const params = [com_id, key];
  const { rows } = await pool.query(
    `SELECT 1 FROM "DELIVERY_PARTNER" WHERE com_id = $1 AND key = $2${requireActive ? " AND active = TRUE" : ""}`,
    params,
  );
  return rows.length > 0;
}

// Legal status transitions for a POS system
// Key = current status, Value = allowed next statuses
const STATUS_TRANSITIONS = {
  pending: ["preparing", "cancelled"],
  preparing: ["completed", "cancelled"],
  completed: [], // terminal — no further changes
  cancelled: [], // terminal — no further changes
};

// ─────────────────────────────────────────────
// SHARED VALIDATORS
// ─────────────────────────────────────────────

/**
 * Validates cost fields and business logic relationships.
 * Returns an error string or null if valid.
 */
function validateCosts(or_tax, or_totalcost, or_totalCostWtax) {
  const tax = parseFloat(or_tax);
  const cost = parseFloat(or_totalcost);
  const costWtx = parseFloat(or_totalCostWtax);

  if (isNaN(cost) || cost < 0) {
    return "or_totalcost must be a non-negative number";
  }
  if (isNaN(costWtx) || costWtx < 0) {
    return "or_totalCostWtax must be a non-negative number";
  }
  if (or_tax !== undefined && or_tax !== null) {
    if (isNaN(tax) || tax < 0 || tax > 100) {
      return "or_tax must be a number between 0 and 100";
    }
  }
  if (costWtx < cost) {
    return "or_totalCostWtax cannot be less than or_totalcost";
  }
  // Sanity check: cost with tax should roughly match (within 1% tolerance for rounding)
  if (or_tax !== undefined && or_tax !== null && !isNaN(tax)) {
    const expected = parseFloat((cost * (1 + tax / 100)).toFixed(2));
    const diff = Math.abs(expected - costWtx);
    if (diff > 0.05) {
      return `or_totalCostWtax (${costWtx}) does not match or_totalcost * (1 + tax/100) = ${expected}`;
    }
  }
  return null;
}

/**
 * Validates order type business rules:
 * - delivery → cust_id required (unless skipCustCheck is true — a cashier
 *   placing a delivery-partner order never has a registered customer to
 *   pick; the partner is the party of record, not the end customer)
 * - dine-in → table_id required (unless skipTableCheck is true, e.g. cashier counter dine-in)
 * Returns an error string or null if valid.
 */
function validateTypeConstraints(or_type, cust_id, table_id, skipTableCheck = false, skipCustCheck = false) {
  if (or_type === "dine-in" && !table_id && !skipTableCheck) {
    return "table_id is required for dine-in orders";
  }
  if (or_type === "delivery" && !cust_id && !skipCustCheck) {
    return "cust_id is required for delivery orders";
  }
  return null;
}

/**
 * Checks whether a status transition is legal.
 * Returns an error string or null if valid.
 */
function validateStatusTransition(currentStatus, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    return `Invalid status "${newStatus}". Use: ${VALID_STATUSES.join(" | ")}`;
  }
  const allowed = STATUS_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    if (allowed.length === 0) {
      return `Order is already "${currentStatus}" — no further status changes are allowed`;
    }
    return `Cannot change status from "${currentStatus}" to "${newStatus}". Allowed: ${allowed.join(" | ")}`;
  }
  return null;
}

// ─────────────────────────────────────────────
// GET /orders — list all orders (with filters)
// ─────────────────────────────────────────────
export const getAllOrders = async (req, res) => {
  try {
    const { status, type, b_id, cust_id, u_id, date } = req.query;

    // Validate filter values if provided
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status filter. Use: ${VALID_STATUSES.join(" | ")}`,
      });
    }
    if (type && !VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type filter. Use: ${VALID_TYPES.join(" | ")}`,
      });
    }
    if (date && isNaN(Date.parse(date))) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid date format" });
    }

    const conditions = [];
    const values = [];
    let i = 1;

    // Qualified with o. because the query joins "User" to pick up the staff name.
    if (status) {
      conditions.push(`o.or_status = $${i++}`);
      values.push(status);
    }
    if (type) {
      conditions.push(`o.or_type = $${i++}`);
      values.push(type);
    }
    // The branch comes from the token, never the query string. Without this a
    // signed-in user of any company saw every order on the platform whenever
    // b_id was simply left off the URL.
    const scope = branchClause(req, "o.b_id", values);
    if (scope) {
      conditions.push(scope);
      i = values.length + 1;
    }
    if (cust_id) {
      conditions.push(`o.cust_id = $${i++}`);
      values.push(cust_id);
    }
    if (u_id) {
      conditions.push(`o.u_id = $${i++}`);
      values.push(u_id);
    }
    if (date) {
      conditions.push(`o.or_date = $${i++}`);
      values.push(date);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await pool.query(
      // u_name lets the ledger show who rang the sale up; the table has u_id only.
      `SELECT o.*, TRIM(COALESCE(u.u_fname,'') || ' ' || COALESCE(u.u_lname,'')) AS u_name,
              t.table_number
       FROM "ORDER" o
       LEFT JOIN "User" u ON u.u_id = o.u_id
       LEFT JOIN "TABLES" t ON t.table_id = o.table_id
       ${where}
       ORDER BY o.or_date DESC, o.or_time DESC`,
      values,
    );

    res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /orders/:id — get one order
// ─────────────────────────────────────────────
export const getOrderById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid order ID" });
    }

    const { rows } = await pool.query(
      `SELECT * FROM "ORDER" WHERE or_id = $1`,
      [id],
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /orders — create new order
// Roles allowed: Cashier (3), Branch Admin (1), Admin (2)
// ─────────────────────────────────────────────
export const createOrder = async (req, res) => {
  try {
    const {
      or_tax = 0,
      or_totalcost,
      or_totalCostWtax,
      or_status = "pending",
      or_type,
      cust_id,
      u_id,
      b_id,
      table_id,
    } = req.body;

    // ── Required fields ──
    const missing = [];
    if (or_totalcost === undefined) missing.push("or_totalcost");
    if (or_totalCostWtax === undefined) missing.push("or_totalCostWtax");
    if (!or_type) missing.push("or_type");
    if (!u_id) missing.push("u_id");
    if (!b_id) missing.push("b_id");

    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    // ── Enum validation ──
    if (!VALID_TYPES.includes(or_type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid or_type. Use: ${VALID_TYPES.join(" | ")}`,
      });
    }
    if (!VALID_STATUSES.includes(or_status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid or_status. Use: ${VALID_STATUSES.join(" | ")}`,
      });
    }
    // New orders can only start as pending (Cashier restriction)
    if (or_status !== "pending") {
      return res.status(400).json({
        success: false,
        error: 'New orders must start with status "pending"',
      });
    }

    // ── Cost validation ──
    const costError = validateCosts(or_tax, or_totalcost, or_totalCostWtax);
    if (costError) {
      return res.status(400).json({ success: false, error: costError });
    }

    // ── Type-specific business rules ──
    // Cashiers doing counter dine-in may not have a table_id (no waiter flow involved)
    const isCashierOrder = req.user?.role_id === ROLES.CASHIER;
    const typeError = validateTypeConstraints(or_type, cust_id, table_id, isCashierOrder && !table_id, isCashierOrder);
    if (typeError) {
      return res.status(400).json({ success: false, error: typeError });
    }

    if (req.user?.role_id === ROLES.WAITER) {
      if (Number(u_id) !== Number(req.user.u_id)) {
        return res.status(403).json({
          success: false,
          error: "Waiters can only create orders under their own user account",
        });
      }
      if (or_type !== "dine-in") {
        return res.status(403).json({
          success: false,
          error: "Waiters can only create dine-in orders",
        });
      }

      const table = await pool.query(
        `SELECT branch_id FROM "TABLES" WHERE table_id = $1`,
        [table_id],
      );
      if (!table.rows.length) {
        return res.status(404).json({
          success: false,
          error: "Table not found",
        });
      }
      if (Number(table.rows[0].branch_id) !== Number(b_id)) {
        return res.status(403).json({
          success: false,
          error: "Order branch must match the selected table branch",
        });
      }

      const today = hotelToday();
      const assigned = await pool.query(
        `SELECT assign_id
         FROM "TABLE_ASSIGNMENT"
         WHERE u_id = $1 AND table_id = $2 AND assigned_date = $3
         LIMIT 1`,
        [req.user.u_id, table_id, today],
      );
      if (!assigned.rows.length) {
        return res.status(403).json({
          success: false,
          error: "Waiters can only create orders for tables assigned to them today",
        });
      }
    }

    // A sale the client has already sent once must never become two. If the
    // reply was lost on the way back, the retry lands here and gets the
    // original order returned to it, untouched.
    const clientRef = String(req.body?.client_ref ?? "").trim().slice(0, 64) || null;
    if (clientRef) {
      const seen = await pool.query(
        `SELECT * FROM "ORDER" WHERE b_id = $1 AND client_ref = $2`,
        [b_id, clientRef],
      );
      if (seen.rows.length) {
        return res.status(200).json({
          success: true, data: seen.rows[0], duplicate: true,
        });
      }
    }

    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO "ORDER"
           (or_tax, or_totalcost, "or_totalCostWtax", or_status, or_type, cust_id, u_id, b_id, table_id, client_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          parseFloat(or_tax),
          parseFloat(or_totalcost),
          parseFloat(or_totalCostWtax),
          or_status,
          or_type,
          cust_id ?? null,
          u_id,
          b_id,
          table_id ?? null,
          clientRef,
        ],
      ));
    } catch (err) {
      // Two copies of the same sale raced each other here. The index refused
      // the second; hand back the one that won rather than an error.
      if (err.code === "23505" && clientRef) {
        const won = await pool.query(
          `SELECT * FROM "ORDER" WHERE b_id = $1 AND client_ref = $2`,
          [b_id, clientRef],
        );
        if (won.rows.length) {
          return res.status(200).json({ success: true, data: won.rows[0], duplicate: true });
        }
      }
      throw err;
    }

    emitOrderEvent("order:new", rows[0]);
    // Also notify kitchen staff so they see new orders without a manual refresh.
    emitSocketEvent("order:created", rows[0], { room: getKitchenSocketRoom(rows[0].b_id) });

    // The till kept no record of who rang up what. It does now, with the IP.
    logActivity(req, {
      action: "create", entity: "order", entity_id: rows[0].or_id, b_id: rows[0].b_id,
      summary: `Rang up order #${rows[0].or_id} — ${Number(rows[0]["or_totalCostWtax"] ?? 0).toFixed(2)} (${rows[0].or_type ?? "order"})`,
      details: { total: rows[0]["or_totalCostWtax"], type: rows[0].or_type, status: rows[0].or_status },
    });
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === "23514") {
      return res
        .status(400)
        .json({
          success: false,
          error: "Constraint violation: invalid status or type value",
        });
    }
    if (err.code === "23503") {
      return res
        .status(400)
        .json({
          success: false,
          error: "Foreign key violation — check b_id, u_id, cust_id, table_id",
        });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────
// PUT /orders/:id — full update
// Roles allowed: Branch Admin (1), Admin (2)
// ─────────────────────────────────────────────
export const updateOrder = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid order ID" });
    }

    const {
      or_tax,
      or_totalcost,
      or_totalCostWtax,
      or_status,
      or_type,
      cust_id,
      u_id,
      b_id,
      table_id,
      payment_method,
      delivery_partner,
    } = req.body;

    // ── Required fields for full update ──
    const missing = [];
    if (or_totalcost === undefined) missing.push("or_totalcost");
    if (or_totalCostWtax === undefined) missing.push("or_totalCostWtax");
    if (!or_status) missing.push("or_status");
    if (!or_type) missing.push("or_type");
    if (!u_id) missing.push("u_id");
    if (!b_id) missing.push("b_id");

    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields for full update: ${missing.join(", ")}`,
      });
    }

    // ── Fetch current order to validate status transition ──
    const existing = await pool.query(
      // discount_pct and service_fee come along so the settle-time total check
      // below allows for a discount that was properly declared and approved.
      `SELECT or_status, discount_pct, service_fee, payment_method FROM "ORDER" WHERE or_id = $1`,
      [id],
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    const currentStatus = existing.rows[0].or_status;

    // ── Enum validation ──
    if (!VALID_TYPES.includes(or_type)) {
      return res
        .status(400)
        .json({
          success: false,
          error: `Invalid or_type. Use: ${VALID_TYPES.join(" | ")}`,
        });
    }

    // ── Status transition guard ──
    if (or_status !== currentStatus) {
      const transitionError = validateStatusTransition(
        currentStatus,
        or_status,
      );
      if (transitionError) {
        return res.status(400).json({ success: false, error: transitionError });
      }
    }

    // ── A finished ticket and a billed ticket are not the same thing ──
    //
    // "completed" means the kitchen has finished cooking. The customer pays
    // afterwards, so the till has to be able to settle a ticket that is already
    // completed. What actually says a ticket has been billed is the tender
    // recorded on it.
    //
    // Guarding on the status alone meant exempting the cashier from the rule
    // altogether, and that exemption let one ticket be settled twice with a
    // second payment taken against it: 1,800 taken on a 900 sale, measured.
    const tenderOnFile = TENDERS.includes(
      String(existing.rows[0].payment_method || "").toLowerCase(),
    );
    const settlingNow =
      or_status === "completed" &&
      TENDERS.includes(String(payment_method || "").toLowerCase());

    if (currentStatus === "cancelled") {
      return res.status(400).json({
        success: false,
        error: `Cannot edit a "${currentStatus}" order`,
      });
    }
    if (currentStatus === "completed") {
      if (tenderOnFile) {
        return res.status(409).json({
          success: false,
          error: "This ticket has already been billed. Void it if it has to change.",
        });
      }
      if (!settlingNow) {
        return res.status(400).json({
          success: false,
          error: `Cannot edit a "${currentStatus}" order`,
        });
      }
    }

    // ── Cost validation ──
    const costError = validateCosts(or_tax, or_totalcost, or_totalCostWtax);
    if (costError) {
      return res.status(400).json({ success: false, error: costError });
    }

    // ── Type-specific business rules ──
    const isCashierUpdate = req.user?.role_id === ROLES.CASHIER;
    const typeError = validateTypeConstraints(or_type, cust_id, table_id, isCashierUpdate && !table_id, isCashierUpdate);
    if (typeError) {
      return res.status(400).json({ success: false, error: typeError });
    }

    // ── Settling a sale: does the total match what is actually on it? ──
    //
    // This route sets the total before any lines exist, so it cannot be checked
    // at creation the way POST /orders/with-items is. It can be checked here, at
    // the moment the money is called settled — by which point the lines are in
    // and the menu can be consulted. Without it, a sale worth 5,000 could be
    // completed as 1 and the difference pocketed.
    if (or_status === "completed") {
      const priced = await pool.query(
        // Same COALESCE as the menu and the creation-time check: the promotion
        // usually lives on Product, not on Branch_Product.
        `SELECT COALESCE(SUM(oi.pro_quantity * bp." Pro_Price"
                             * (1 - COALESCE(bp.discount_pct, pr.discount_pct, 0) / 100.0)), 0) AS expected,
                COUNT(*) AS lines
         FROM "ORDER_ITEM" oi
         JOIN "Branch_Product" bp ON bp."Bpro_id" = oi."Bpro_id"
         LEFT JOIN "Product" pr ON pr.pro_id = bp.pro_id
         WHERE oi.order_id = $1`,
        [id],
      );
      const expected = Number(priced.rows[0].expected);
      const claimed = parseFloat(or_totalcost);
      const declaredDiscount = Number(existing.rows[0].discount_pct ?? 0);
      const afterDiscount = expected * (1 - declaredDiscount / 100)
                          + Number(existing.rows[0].service_fee ?? 0);

      // Generous on purpose: rounding, tax groups and per-item promos differ by
      // pennies between the till and this sum. Catching a bent total, not audit.
      const tolerance = Math.max(1, afterDiscount * 0.01);
      if (Number(priced.rows[0].lines) > 0 && Math.abs(claimed - afterDiscount) > tolerance) {
        return res.status(400).json({
          success: false,
          error: `The total does not match what is on this order. Expected about `
               + `${afterDiscount.toFixed(2)}, got ${claimed.toFixed(2)}.`,
        });
      }
    }

    // Settling at the till records how it was paid, and puts it in the drawer
    // of the cashier taking the money. A ticket sent to the kitchen first used
    // to settle with no tender at all, so the drawer never counted it as cash.
    const tender = TENDERS.includes(String(payment_method || "").toLowerCase())
      ? String(payment_method).toLowerCase()
      : null;
    let drawerId = null;
    if (or_status === "completed" && tender) {
      const drawer = await pool.query(
        `SELECT session_id FROM "CASH_SESSION"
         WHERE b_id = $1 AND opened_by = $2 AND status = 'open'`,
        [writeBranchId(req, b_id), req.user?.u_id ?? u_id],
      );
      drawerId = drawer.rows[0]?.session_id ?? null;
    }

    const resolvedDeliveryPartner =
      or_type === "delivery" && (await isValidDeliveryPartner(req.user?.com_id, delivery_partner))
        ? delivery_partner
        : null;

    const { rows } = await pool.query(
      `UPDATE "ORDER" SET
         or_tax             = $1,
         or_totalcost       = $2,
         "or_totalCostWtax" = $3,
         or_status          = $4,
         or_type            = $5,
         cust_id            = $6,
         u_id               = $7,
         b_id               = $8,
         table_id           = $9,
         payment_method     = COALESCE($11, payment_method),
         session_id         = COALESCE(session_id, $12),
         delivery_partner   = $13
       WHERE or_id = $10
       RETURNING *`,
      [
        parseFloat(or_tax),
        parseFloat(or_totalcost),
        parseFloat(or_totalCostWtax),
        or_status,
        or_type,
        cust_id ?? null,
        u_id,
        b_id,
        table_id ?? null,
        id,
        tender,
        drawerId,
        resolvedDeliveryPartner,
      ],
    );

    res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === "23514")
      return res
        .status(400)
        .json({
          success: false,
          error: "Constraint violation: invalid status or type value",
        });
    if (err.code === "23503")
      return res
        .status(400)
        .json({
          success: false,
          error: "Foreign key violation — check b_id, u_id, cust_id, table_id",
        });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────
// PATCH /orders/:id — partial update
// Roles allowed: Branch Admin (1), Admin (2)
// ─────────────────────────────────────────────
export const patchOrder = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid order ID" });
    }

    const allowed = [
      "or_tax",
      "or_totalcost",
      "or_totalCostWtax",
      "or_status",
      "or_type",
      "cust_id",
      "u_id",
      "b_id",
      "table_id",
    ];

    // Filter to only fields present in the request body
    const incoming = Object.fromEntries(
      allowed
        .filter((k) => req.body[k] !== undefined)
        .map((k) => [k, req.body[k]]),
    );

    if (!Object.keys(incoming).length) {
      return res
        .status(400)
        .json({ success: false, error: "No valid fields to update" });
    }

    // ── Fetch current order ──
    const existing = await pool.query(
      `SELECT * FROM "ORDER" WHERE or_id = $1`,
      [id],
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    const current = existing.rows[0];

    // ── Block editing terminal orders unless only status is being changed ──
    const isOnlyStatusChange =
      Object.keys(incoming).length === 1 && incoming.or_status;
    if (
      !isOnlyStatusChange &&
      (current.or_status === "completed" || current.or_status === "cancelled")
    ) {
      return res.status(400).json({
        success: false,
        error: `Cannot edit a "${current.or_status}" order`,
      });
    }

    // ── Validate type if being changed ──
    const newType = incoming.or_type ?? current.or_type;
    if (incoming.or_type && !VALID_TYPES.includes(incoming.or_type)) {
      return res
        .status(400)
        .json({
          success: false,
          error: `Invalid or_type. Use: ${VALID_TYPES.join(" | ")}`,
        });
    }

    // ── Validate status transition if status is being changed ──
    if (incoming.or_status && incoming.or_status !== current.or_status) {
      const transitionError = validateStatusTransition(
        current.or_status,
        incoming.or_status,
      );
      if (transitionError) {
        return res.status(400).json({ success: false, error: transitionError });
      }
    }

    // ── Validate costs if any cost field is being changed ──
    const hasCostField = ["or_tax", "or_totalcost", "or_totalCostWtax"].some(
      (k) => k in incoming,
    );
    if (hasCostField) {
      const merged = {
        or_tax: incoming.or_tax ?? current.or_tax,
        or_totalcost: incoming.or_totalcost ?? current.or_totalcost,
        or_totalCostWtax: incoming.or_totalCostWtax ?? current.or_totalCostWtax,
      };
      const costError = validateCosts(
        merged.or_tax,
        merged.or_totalcost,
        merged.or_totalCostWtax,
      );
      if (costError) {
        return res.status(400).json({ success: false, error: costError });
      }
    }

    // ── Type-specific business rules using merged state ──
    const newCustId = incoming.cust_id ?? current.cust_id;
    const newTableId = incoming.table_id ?? current.table_id;
    const typeError = validateTypeConstraints(newType, newCustId, newTableId);
    if (typeError) {
      return res.status(400).json({ success: false, error: typeError });
    }

    // ── Build dynamic UPDATE ──
    const updates = [];
    const values = [];
    let i = 1;

    for (const key of Object.keys(incoming)) {
      const col = key === "or_totalCostWtax" ? `"or_totalCostWtax"` : key;
      updates.push(`${col} = $${i++}`);
      const numericFields = ["or_tax", "or_totalcost", "or_totalCostWtax"];
      values.push(
        numericFields.includes(key) ? parseFloat(incoming[key]) : incoming[key],
      );
    }

    values.push(id);

    const { rows } = await pool.query(
      `UPDATE "ORDER" SET ${updates.join(", ")} WHERE or_id = $${i} RETURNING *`,
      values,
    );

    res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === "23514")
      return res
        .status(400)
        .json({
          success: false,
          error: "Constraint violation: invalid status or type value",
        });
    if (err.code === "23503")
      return res
        .status(400)
        .json({
          success: false,
          error: "Foreign key violation — check b_id, u_id, cust_id, table_id",
        });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────
// PATCH /orders/:id/status — update status only
// Roles allowed: Cashier (3), Branch Admin (1), Admin (2)
// ─────────────────────────────────────────────
export const updateOrderStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid order ID" });
    }

    const { status } = req.body;

    if (!status) {
      return res
        .status(400)
        .json({ success: false, error: "status field is required" });
    }

    // ── Fetch current status ──
    const existing = await pool.query(
      `SELECT or_status FROM "ORDER" WHERE or_id = $1`,
      [id],
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    const currentStatus = existing.rows[0].or_status;

    // ── Guard: no-op update ──
    if (status === currentStatus) {
      return res.status(400).json({
        success: false,
        error: `Order is already "${currentStatus}"`,
      });
    }

    // ── Transition guard ──
    const transitionError = validateStatusTransition(currentStatus, status);
    if (transitionError) {
      return res.status(400).json({ success: false, error: transitionError });
    }

    // Two screens can act on one order at once — two kitchen tablets, or the
    // till cancelling while the kitchen plates it. A change applies only if the
    // order is still where it was read; the second screen is told, instead of
    // one silently undoing the other (a cancel's returned stock sitting under an
    // order then marked ready).
    const changedMeanwhile = () =>
      res.status(409).json({
        success: false,
        error: "This order was just changed on another screen. Refresh to see where it is now.",
      });

    // Cancelling puts back exactly what the order took from stock.
    if (status === "cancelled") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // NO KEY UPDATE: a line being added to this order holds a KEY SHARE on
        // it, and asking to upgrade past that is how transactions deadlock.
        const locked = await client.query(
          `SELECT or_status FROM "ORDER" WHERE or_id = $1 FOR NO KEY UPDATE`,
          [id],
        );
        if (locked.rows[0]?.or_status !== currentStatus) {
          await client.query("ROLLBACK");
          client.release();
          return changedMeanwhile();
        }
        await returnStock(client, { order_id: id, u_id: req.user?.u_id ?? null });
        await client.query(
          `UPDATE "ORDER" SET or_status = $1, status_changed_at = NOW() WHERE or_id = $2`,
          [status, id],
        );
        await client.query("COMMIT");
        client.release();
      } catch (err) {
        await client.query("ROLLBACK");
        client.release();
        throw err;
      }
    } else {
      const moved = await pool.query(
        `UPDATE "ORDER" SET or_status = $1, status_changed_at = NOW()
          WHERE or_id = $2 AND or_status = $3`,
        [status, id, currentStatus],
      );
      if (!moved.rowCount) return changedMeanwhile();
    }

    const { rows } = await pool.query(
      `SELECT * FROM "ORDER" WHERE or_id = $1`,
      [id],
    );

    emitSocketEvent("order:updated", rows[0], { room: getKitchenSocketRoom(rows[0].b_id) });
    emitOrderEvent("order:updated", rows[0]);

    if (status === "completed") {
      emitSocketEvent("order:ready", rows[0], {
        room: getCashierSocketRoom(rows[0].u_id),
      });
    }

    logActivity(req, {
      action: "update", entity: "order", entity_id: rows[0].or_id, b_id: rows[0].b_id,
      summary: `Order #${rows[0].or_id} moved to ${rows[0].or_status}`,
    });

    res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === "23514") {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Use: ${VALID_STATUSES.join(" | ")}`,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────
// DELETE /orders/:id — delete order
// Roles allowed: Admin (2) only
// Cannot delete completed or preparing orders
// ─────────────────────────────────────────────
export const deleteOrder = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid order ID" });
    }

    // ── Fetch current order to check status ──
    const existing = await pool.query(
      `SELECT or_status, u_id FROM "ORDER" WHERE or_id = $1`,
      [id],
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const { or_status } = existing.rows[0];

    if (
      req.user?.role_id === ROLES.WAITER &&
      Number(existing.rows[0].u_id) !== Number(req.user.u_id)
    ) {
      return res.status(403).json({
        success: false,
        error: "Waiters can only delete orders created by themselves",
      });
    }

    // ── Business rule: cannot hard-delete active or completed orders ──
    if (or_status === "preparing" || or_status === "completed") {
      return res.status(400).json({
        success: false,
        error: `Cannot delete an order with status "${or_status}". Cancel it first.`,
      });
    }

    const client = await pool.connect();
    let rows;
    try {
      await client.query("BEGIN");

      // Look again under a lock: the kitchen may have started it since it was
      // read above, and a started order is cancelled, never deleted.
      const now = await client.query(
        `SELECT or_status FROM "ORDER" WHERE or_id = $1 FOR UPDATE`,
        [id],
      );
      if (!now.rows.length || ["preparing", "completed"].includes(now.rows[0].or_status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          error: "The kitchen has already started this order. Cancel it instead.",
        });
      }

      // Put back exactly what the order took, before its lines go.
      await returnStock(client, { order_id: id, u_id: req.user?.u_id ?? null });

      await client.query(`DELETE FROM public."ORDER_ITEM" WHERE order_id = $1`, [
        id,
      ]);

      const deleted = await client.query(
        `DELETE FROM "ORDER" WHERE or_id = $1 RETURNING *`,
        [id],
      );
      rows = deleted.rows;
      await client.query("COMMIT");
      // Screens showing it drop it now, not at their next refresh.
      if (rows[0]) {
        const gone = { or_id: id, b_id: rows[0].b_id };
        emitSocketEvent("order:deleted", gone, { room: getKitchenSocketRoom(gone.b_id) });
        emitOrderEvent("order:deleted", gone);
      }
      // Even the owner's repair path is on the record.
      logActivity(req, {
        action: "delete", entity: "order", entity_id: id, b_id: rows[0]?.b_id,
        summary: `Deleted order #${id} outright (status was "${or_status}")`,
        details: { total: rows[0]?.["or_totalCostWtax"], previous_status: or_status },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res
      .status(200)
      .json({
        success: true,
        message: "Order deleted successfully",
        data: rows[0],
      });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/orders/with-items — one sale, one request, one transaction.
 *
 * Sending the order and then its lines separately leaves a window where the
 * network can die between them, and the kitchen gets a sale with nothing on it.
 * Offline makes that window a certainty: a queued sale is replayed after the
 * fact, possibly more than once.
 *
 * So the whole sale lands together or not at all, and `client_ref` makes
 * replaying it safe — send the same sale ten times and there is still one
 * order, one set of lines, one deduction from stock.
 */
export const createOrderWithItems = async (req, res) => {
  const { order, items } = req.body ?? {};

  if (!order || typeof order !== "object") {
    return res.status(400).json({ success: false, error: "An order is required" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: "A sale needs at least one item" });
  }
  if (items.length > 200) {
    return res.status(400).json({ success: false, error: "Too many lines on one sale" });
  }

  const clientRef = String(order.client_ref ?? "").trim().slice(0, 64) || null;
  if (!clientRef) {
    return res.status(400).json({
      success: false,
      error: "client_ref is required so the sale can be sent again safely",
    });
  }

  // The branch comes from the token, never the body — a queued sale replayed
  // hours later must not be able to name someone else's property.
  const b_id = writeBranchId(req, order.b_id);
  if (!b_id || b_id < 0) {
    return res.status(400).json({ success: false, error: "No branch for this sale" });
  }
  // Who rang it up comes from the token, like the branch. Taken from the body, a
  // cashier could put a sale under a colleague's name — or another property's user.
  if (req.user?.u_id) order.u_id = req.user.u_id;
  if (!order.u_id) {
    return res.status(400).json({ success: false, error: "Missing required fields: u_id" });
  }
  if (!VALID_TYPES.includes(order.or_type)) {
    return res.status(400).json({
      success: false, error: `Invalid or_type. Use: ${VALID_TYPES.join(" | ")}`,
    });
  }

  const costError = validateCosts(order.or_tax ?? 0, order.or_totalcost, order.or_totalCostWtax);
  if (costError) return res.status(400).json({ success: false, error: costError });

  const isCashierOrder = req.user?.role_id === ROLES.CASHIER;
  const typeError = validateTypeConstraints(
    order.or_type, order.cust_id, order.table_id,
    isCashierOrder && !order.table_id,
    isCashierOrder,
  );
  if (typeError) return res.status(400).json({ success: false, error: typeError });

  for (const [i, it] of items.entries()) {
    if (!it?.Bpro_id) {
      return res.status(400).json({ success: false, error: `Line ${i + 1}: no product` });
    }
    const q = validateItemQuantity(it.pro_quantity);
    if (q) return res.status(400).json({ success: false, error: `Line ${i + 1}: ${q}` });
    const p = validateItemUnitPrice(it.unit_price);
    if (p) return res.status(400).json({ success: false, error: `Line ${i + 1}: ${p}` });
  }

  // Every line must be a product of this branch. Without it a queued sale could
  // name any Bpro_id in the database and quietly move another property's stock.
  // The prices come back too — the till is not the authority on what things cost.
  const ids = [...new Set(items.map((it) => Number(it.Bpro_id)))];
  const owned = await pool.query(
    // Priced exactly as the menu endpoint prices it, including the COALESCE.
    // A promotion lives on Product and is only sometimes overridden on
    // Branch_Product, so reading the branch column alone reported every
    // discounted item at full price and refused the sale — the till could not
    // sell anything that was on offer.
    //
    // The price column really is named with a leading space in this schema;
    // aliased here so nothing downstream has to know that.
    `SELECT bp."Bpro_id", bp." Pro_Price" AS pro_price,
            COALESCE(bp.discount_pct, pr.discount_pct, 0) AS discount_pct
     FROM "Branch_Product" bp
     LEFT JOIN "Product" pr ON pr.pro_id = bp.pro_id
     WHERE bp."Bpro_id" = ANY($1::int[]) AND bp."B_id" = $2`,
    [ids, b_id],
  );
  if (owned.rows.length !== ids.length) {
    return res.status(400).json({
      success: false, error: "This sale lists a product that is not on this menu",
    });
  }

  // ── What this sale should cost, worked out from the menu, not from the till ──
  //
  // Until now the server took the total on trust. A cashier could charge a guest
  // the full price, ring the sale up at any discount they liked, and pocket the
  // difference — nothing recorded that a discount had happened at all.
  const priceOf = new Map(owned.rows.map((r) => [
    Number(r.Bpro_id),
    Number(r.pro_price) * (1 - Number(r.discount_pct ?? 0) / 100),
  ]));
  const lineSubtotal = items.reduce(
    (sum, it) => sum + priceOf.get(Number(it.Bpro_id)) * Number(it.pro_quantity), 0);

  const discountPct = Math.min(100, Math.max(0, Number(order.discount_pct ?? 0)));
  const serviceFee = Math.max(0, Number(order.service_fee ?? 0));
  const expected = lineSubtotal * (1 - discountPct / 100) + serviceFee;
  const claimed = Number(order.or_totalcost);

  // Deliberately loose. Rounding, per-item promos and tax groups all differ by
  // pennies between the till's arithmetic and this one, and a sale must never be
  // refused over a cent. This is here to catch a total that has been bent, not
  // to audit rounding.
  const tolerance = Math.max(1, expected * 0.01);
  if (Math.abs(claimed - expected) > tolerance) {
    return res.status(400).json({
      success: false,
      error: `The total does not match the menu. Expected about ${expected.toFixed(2)}`
           + ` for these items${discountPct ? ` at ${discountPct}% off` : ""}, got ${claimed.toFixed(2)}.`,
    });
  }

  // A discount past the house limit needs a manager's PIN, exactly like a void.
  let discountApprover = null;
  if (discountPct > DISCOUNT_APPROVAL_PCT) {
    const approval = await requireApproval(req, {
      pin: order.approval_pin,
      b_id,
      what: `give a ${discountPct}% discount (over the ${DISCOUNT_APPROVAL_PCT}% limit)`,
    });
    if (!approval.ok) {
      return res.status(approval.status).json({ success: false, error: approval.message });
    }
    discountApprover = approval.approver?.u_id ?? null;
  }

  // Already in? Hand back what is there. Cheap, and covers the common retry
  // without opening a transaction at all.
  const existing = await pool.query(
    `SELECT * FROM "ORDER" WHERE b_id = $1 AND client_ref = $2`, [b_id, clientRef]);
  if (existing.rows.length) {
    const lines = await pool.query(
      `SELECT * FROM "ORDER_ITEM" WHERE order_id = $1`, [existing.rows[0].or_id]);
    return res.status(200).json({
      success: true, data: existing.rows[0], items: lines.rows, duplicate: true,
    });
  }

  // How it was paid, and whose drawer it belongs to.
  //
  // The tender used to be recorded only if the cashier pressed "Pay" on the
  // invoice screen afterwards — a separate, optional step on another page, and
  // the Payment table was empty in practice. Without it no drawer can be
  // counted, because there is no way to tell a cash sale from a card one.
  const tender = TENDERS.includes(String(order.payment_method || "").toLowerCase())
    ? String(order.payment_method).toLowerCase()
    : null;

  // Attach the sale to the cashier's open drawer if they have one. Deliberately
  // not required: a missing shift must never stop a queue being served. The
  // close-out surfaces sales that belong to no drawer instead of losing them.
  const drawer = await pool.query(
    `SELECT session_id FROM "CASH_SESSION"
     WHERE b_id = $1 AND opened_by = $2 AND status = 'open'`,
    [b_id, order.u_id],
  );
  const drawerId = drawer.rows[0]?.session_id ?? null;

  const resolvedDeliveryPartner =
    order.or_type === "delivery" && (await isValidDeliveryPartner(req.user?.com_id, order.delivery_partner))
      ? order.delivery_partner
      : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO "ORDER"
         (or_tax, or_totalcost, "or_totalCostWtax", or_status, or_type,
          cust_id, u_id, b_id, table_id, client_ref,
          discount_pct, service_fee, discount_approved_by,
          payment_method, session_id, kitchen_note, delivery_partner)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        parseFloat(order.or_tax), parseFloat(order.or_totalcost),
        parseFloat(order.or_totalCostWtax), order.or_status ?? "pending",
        order.or_type, order.cust_id ?? null, order.u_id, b_id,
        order.table_id ?? null, clientRef,
        discountPct, serviceFee, discountApprover,
        tender, drawerId,
        String(order.kitchen_note ?? "").trim().slice(0, 500) || null,
        resolvedDeliveryPartner,
      ],
    );
    const created = rows[0];

    const lines = [];
    for (const it of items) {
      const qty = Number(it.pro_quantity);
      const unit = Number(it.unit_price);
      const line = await client.query(
        `INSERT INTO public."ORDER_ITEM" ("Bpro_id", pro_quantity, unit_price, total_price, order_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [it.Bpro_id, qty, unit, Number((qty * unit).toFixed(2)), created.or_id],
      );
      lines.push(line.rows[0]);
    }

    // The sale's ingredients, taken together and recorded against each line.
    // Never refused for stock: if the count says there is not enough, it is the
    // count that is wrong. It goes below zero and the manager is told to recount.
    const stock = await takeStock(client, {
      b_id,
      order_id: created.or_id,
      lines: lines.map((l) => ({
        bpro_id: Number(l.Bpro_id), qty: Number(l.pro_quantity), order_item_id: l.orderItem_id,
      })),
      u_id: req.user?.u_id ?? null,
    });

    await client.query("COMMIT");

    emitOrderEvent("order:new", created);
    emitSocketEvent("order:created", created, { room: getKitchenSocketRoom(created.b_id) });

    logActivity(req, {
      action: "create", entity: "order", entity_id: created.or_id, b_id: created.b_id,
      summary: `Rang up order #${created.or_id} — ${Number(created["or_totalCostWtax"] ?? 0).toFixed(2)}`
             + ` (${created.or_type ?? "order"}${discountPct ? `, ${discountPct}% off` : ""}`
             + `${order.queued_at ? ", sent from offline queue" : ""})`
             + (stock.short.length
               ? ` — beyond the stock count for ${stock.short.map((s) => s.name).join(", ")}; worth a recount`
               : ""),
      details: { total: created["or_totalCostWtax"], type: created.or_type,
                 lines: lines.length, queued_at: order.queued_at ?? null,
                 discount_pct: discountPct, service_fee: serviceFee,
                 discount_approved_by: discountApprover,
                 // A sale the stock count could not cover is kept, and named
                 // here so the owner knows what to recount.
                 stock_shortfall: stock.short.length ? stock.short.map((s) => s.name) : null },
    });

    return res.status(201).json({ success: true, data: created, items: lines });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (isStockProblem(err)) {
      return res.status(err.status).json({ success: false, error: err.message, short: err.short });
    }
    // Two copies raced. The loser reads back the winner's sale.
    if (err.code === "23505") {
      const won = await pool.query(
        `SELECT * FROM "ORDER" WHERE b_id = $1 AND client_ref = $2`, [b_id, clientRef]);
      if (won.rows.length) {
        const lines = await pool.query(
          `SELECT * FROM "ORDER_ITEM" WHERE order_id = $1`, [won.rows[0].or_id]);
        return res.status(200).json({
          success: true, data: won.rows[0], items: lines.rows, duplicate: true,
        });
      }
    }
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/orders/:id/void — cancel a sale without erasing it.
 *
 * Deleting a paid order is how cash walks out of a restaurant: take the money,
 * remove the sale, and the drawer still balances at close. So the row never
 * goes. It is marked cancelled, with who did it, why, and which manager
 * approved — and the stock the order consumed is returned.
 */
export const voidOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: "Invalid order ID" });
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 3) {
      return res.status(400).json({
        success: false,
        error: "Say why this sale is being voided — it is kept on the record.",
      });
    }
    if (reason.length > 200) {
      return res.status(400).json({ success: false, error: "That reason is too long (200 characters)." });
    }

    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT or_id, b_id, or_status, "or_totalCostWtax", or_totalcost, voided_at
       FROM "ORDER" WHERE or_id = $1 FOR NO KEY UPDATE`,
      [id]
    );
    if (!cur.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    const order = cur.rows[0];

    // Another property's sale is not this caller's to void.
    const scope = branchClause(req, "b_id", []);
    if (scope && Number(order.b_id) !== Number(req.user?.b_id)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    if (order.or_status === "cancelled" || order.voided_at) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: "That order is already voided" });
    }

    const approval = await requireApproval(req, {
      pin: req.body?.approval_pin, b_id: order.b_id, what: "void a sale",
    });
    if (!approval.ok) {
      await client.query("ROLLBACK");
      return res.status(approval.status).json({ success: false, error: approval.message });
    }

    // Put the ingredients back — the food was never served. Exactly what this
    // sale took when it was rung up; never a portion it did not take.
    await returnStock(client, { order_id: id, u_id: req.user?.u_id ?? null });

    const { rows } = await client.query(
      `UPDATE "ORDER"
       SET or_status='cancelled', void_reason=$2, voided_by=$3, voided_at=NOW(), approved_by=$4,
           status_changed_at=NOW()
       WHERE or_id=$1 RETURNING *`,
      [id, reason, req.user?.u_id ?? null, approval.approver?.u_id ?? null]
    );
    await client.query("COMMIT");

    // The kitchen stops cooking it and the floor's boards drop it — now.
    emitSocketEvent("order:updated", rows[0], { room: getKitchenSocketRoom(rows[0].b_id) });
    emitOrderEvent("order:updated", rows[0]);

    const value = Number(order["or_totalCostWtax"] ?? order.or_totalcost ?? 0);
    logActivity(req, {
      action: "void", entity: "order", entity_id: id, b_id: order.b_id,
      summary: `Voided order #${id} worth ${value.toFixed(2)} — ${reason}`,
      details: { value, reason, approved_by: approval.approver?.u_id ?? null,
                 approver: approval.approver?.name ?? null, previous_status: order.or_status },
    });

    return res.json({ success: true, data: rows[0], approved_by: approval.approver?.name ?? null });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[orders] void failed:", err);
    return res.status(500).json({ success: false, error: "Could not void that order" });
  } finally {
    client.release();
  }
};
