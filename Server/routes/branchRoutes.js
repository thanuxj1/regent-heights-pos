import express from "express";
import {
  requireAuth,
  requireAdmin,
  requireBranchAdminOr,
  CAPABILITIES,
  requireCashierOrAbove,
  requireWaiterOrAbove,
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
router.get("/", requireCashierOrAbove, getBranches);
router.get("/:id", requireWaiterOrAbove, getBranchById);
router.post("/", requireAdmin, createBranch);
// The Administrator may edit its own property (guarded inside the controller);
// creating and removing branches stays with the platform, since that is the
// expansion path, not day-to-day work.
router.put("/:id", requireBranchAdminOr(CAPABILITIES.BRANCH_SETTINGS), updateBranch);
router.delete("/:id", requireAdmin, deleteBranch);

export default router;
