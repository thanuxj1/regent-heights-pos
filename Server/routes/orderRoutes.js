import express from "express";
import {
  getAllOrders,
  getOrderById,
  createOrder,
  updateOrder,
  patchOrder,
  updateOrderStatus,
  deleteOrder,
  voidOrder,
  createOrderWithItems,
} from "../controllers/orderController.js";
import { getKitchenBoard } from "../controllers/kitchenBoardController.js";

import {
  requireAuth,
  requireRole,
  ROLES,
  requireDefaultNotRevoked,
  DEFAULT_PERMISSIONS,
} from "../middleware/authMiddleware.js";

const router = express.Router();



// Read Orders
const canReadOrders = requireRole(
  [
    ROLES.KITCHEN_STAFF,
    ROLES.WAITER,
    ROLES.CASHIER,
    ROLES.BRANCH_ADMIN,
    ROLES.ADMIN,
  ],
  "Kitchen Staff, Waiter, Cashier, Branch Admin, or Admin",
);

// Create Orders
const canCreateOrder = requireRole(
  [ROLES.WAITER, ROLES.CASHIER, ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Waiter, Cashier, Branch Admin, or Admin",
);

// Update Order Status
const canUpdateOrderStatus = requireRole(
  [ROLES.KITCHEN_STAFF, ROLES.CASHIER, ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Kitchen Staff, Cashier, Branch Admin, or Admin",
);

// Edit Orders
const canEditOrder = requireRole(
  [ROLES.CASHIER, ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Cashier, Branch Admin or Admin",
);

// Delete Orders
/**
 * Hard deletion is a data-repair tool, not a way to cancel a sale — a deleted
 * order leaves no evidence it ever existed, which is exactly how cash walks out
 * of a till. The floor voids instead (POST /:id/void): the row stays, with a
 * reason and a manager's approval against it.
 */
const canDeleteOrder = requireRole(
  [ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Branch Admin or Admin",
);

/** Voiding is everyday floor work — it just has to be accounted for. */
const canVoidOrder = requireRole(
  [ROLES.CASHIER, ROLES.WAITER, ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Cashier, Waiter, Branch Admin or Admin",
);

// Each role's own default, inert for anyone else's role (see
// requireDefaultNotRevoked) — safe to chain on the same shared route.
const posTerminal   = requireDefaultNotRevoked(DEFAULT_PERMISSIONS.POS_TERMINAL);   // Cashier's "ring up sales"
const waiterOrders   = requireDefaultNotRevoked(DEFAULT_PERMISSIONS.WAITER_ORDERS);  // Waiter's "take & void orders"
const kitchenBoard   = requireDefaultNotRevoked(DEFAULT_PERMISSIONS.KITCHEN_BOARD);  // Kitchen's "view the board"
const kitchenStatus  = requireDefaultNotRevoked(DEFAULT_PERMISSIONS.KITCHEN_STATUS); // Kitchen's "mark items ready"

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

// GET /orders
router.get("/", requireAuth, canReadOrders, getAllOrders);

// GET /orders/board — what the kitchen is working on now. Before "/:id".
router.get("/board", requireAuth, canReadOrders, kitchenBoard, getKitchenBoard);

// GET /orders/:id
router.get("/:id", requireAuth, canReadOrders, getOrderById);

// POST /orders
router.post("/", requireAuth, canCreateOrder, posTerminal, waiterOrders, createOrder);

// POST /orders/with-items — the whole sale in one transaction, safe to resend.
// This is what the till uses, online or flushing its offline queue.
router.post("/with-items", requireAuth, canCreateOrder, posTerminal, waiterOrders, createOrderWithItems);

// Must be before "/:id"
router.patch(
  "/:id/status",
  requireAuth,
  canUpdateOrderStatus,
  posTerminal,
  kitchenStatus,
  updateOrderStatus,
);

// PUT /orders/:id
router.put("/:id", requireAuth, canEditOrder, updateOrder);

// PATCH /orders/:id
router.patch("/:id", requireAuth, canEditOrder, patchOrder);

// DELETE /orders/:id
router.post("/:id/void", requireAuth, canVoidOrder, posTerminal, waiterOrders, voidOrder);
router.delete("/:id", requireAuth, canDeleteOrder, deleteOrder);

export default router;
