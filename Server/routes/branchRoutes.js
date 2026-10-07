import express from "express";
import {
  requireAuth,
  requireAdmin,
  requireBranchAdminOr,
  CAPABILITIES,
  requireCashierOrAbove,
  requireWaiterOrAbove,
  requireDefaultNotRevoked,
  DEFAULT_PERMISSIONS,
} from "../middleware/authMiddleware.js";
import {
  getBranches,
  getBranchById,
  createBranch,
  updateBranch,
  deleteBranch,
} from "../controllers/branchController.js";

const router = express.Router();

router.use(requireAuth);
// The full list is the Cashier-tier "browse branches" view; a single branch's
// own details (GET /:id) stay open to every floor role — Waiter and Kitchen
// Staff need their own property's info too, so that one isn't part of this
// default and can't be switched off.
router.get("/", requireCashierOrAbove, requireDefaultNotRevoked(DEFAULT_PERMISSIONS.VIEW_DIRECTORY, { unless: CAPABILITIES.USER_MANAGEMENT }), getBranches);
router.get("/:id", requireWaiterOrAbove, getBranchById);
router.post("/", requireAdmin, createBranch);
// The Administrator may edit its own property (guarded inside the controller);
// creating and removing branches stays with the platform, since that is the
// expansion path, not day-to-day work.
router.put("/:id", requireBranchAdminOr(CAPABILITIES.BRANCH_SETTINGS), updateBranch);
router.delete("/:id", requireAdmin, deleteBranch);

export default router;
