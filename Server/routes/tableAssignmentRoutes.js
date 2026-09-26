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
} from "../middleware/authMiddleware.js";

const router = express.Router();

// ─────────────────────────────────────────────
// PUBLIC (AUTHENTICATED USERS BASED ON ROLE)
// ─────────────────────────────────────────────

// Get all assignments
// 👉 Waiter+ can view (they need schedule)
router.get("/", requireAuth, requireWaiterOrAbove, getTableAssignments);

// Get assignment by ID
router.get("/:id", requireAuth, requireWaiterOrAbove, getTableAssignmentById);

// Get assignments by table
router.get(
  "/table/:tableId",
  requireAuth,
  requireWaiterOrAbove,
  getAssignmentsByTable,
);

// Get assignments by user
router.get(
  "/user/:userId",
  requireAuth,
  requireWaiterOrAbove,
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
