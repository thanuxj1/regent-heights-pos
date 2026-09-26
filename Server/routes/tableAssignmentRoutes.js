import express from "express";
import {
  getTableAssignments,
  getTableAssignmentById,
  getAssignmentsByTable,
  getAssignmentsByUser,
  createTableAssignment,
  updateTableAssignment,
  deleteTableAssignment,
} from "../controllers/tableAssignmentController.js";

import {
  requireAuth,
  requireBranchAdminOr,
  CAPABILITIES,
  requireWaiterOrAbove,
  requireDefaultNotRevoked,
  DEFAULT_PERMISSIONS,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// A Waiter's own default, inert for Cashier/Kitchen/Admin (see requireDefaultNotRevoked).
const waiterTables = requireDefaultNotRevoked(DEFAULT_PERMISSIONS.WAITER_TABLES);

// ─────────────────────────────────────────────
// PUBLIC (AUTHENTICATED USERS BASED ON ROLE)
// ─────────────────────────────────────────────

// Get all assignments
// 👉 Waiter+ can view (they need schedule)
router.get("/", requireAuth, requireWaiterOrAbove, waiterTables, getTableAssignments);

// Get assignment by ID
router.get("/:id", requireAuth, requireWaiterOrAbove, waiterTables, getTableAssignmentById);

// Get assignments by table
router.get(
  "/table/:tableId",
  requireAuth,
  requireWaiterOrAbove,
  waiterTables,
  getAssignmentsByTable,
);

// Get assignments by user
router.get(
  "/user/:userId",
  requireAuth,
  requireWaiterOrAbove,
  waiterTables,
  getAssignmentsByUser,
);

// ─────────────────────────────────────────────
// RESTRICTED (ADMIN / BRANCH ADMIN)
// ─────────────────────────────────────────────

// Create assignment
router.post("/", requireAuth, requireBranchAdminOr(CAPABILITIES.TABLES_MANAGEMENT), createTableAssignment);

// Update assignment
router.put(
  "/:id",
  requireAuth,
  requireBranchAdminOr(CAPABILITIES.TABLES_MANAGEMENT),
  updateTableAssignment,
);

// Delete assignment
router.delete(
  "/:id",
  requireAuth,
  requireBranchAdminOr(CAPABILITIES.TABLES_MANAGEMENT),
  deleteTableAssignment,
);

export default router;
