import express from "express";
import {
  requireAuth,
  requireBranchAdminOrAdmin,
  requireCashierOrAbove,
  requireWaiterOrAbove,
} from "../middleware/authMiddleware.js";
import {
  getBranchProducts,
  getBranchProductById,
  createBranchProduct,
  updateBranchProduct,
  deleteBranchProduct,
  countBranchProduct,
  restockBranchProduct,
} from "../controllers/branchProductController.js";

const router = express.Router();

router.use(requireAuth);
router.get("/", requireWaiterOrAbove, getBranchProducts);
router.get("/:id", requireWaiterOrAbove, getBranchProductById);
router.post("/", requireBranchAdminOrAdmin, createBranchProduct);
router.put("/:id", requireBranchAdminOrAdmin, updateBranchProduct);
// A manager's count of what is on the shelf — with a reason, on the record.
router.post("/:id/count", requireBranchAdminOrAdmin, countBranchProduct);
// Bring more of a counted item across from the main store.
router.post("/:id/restock", requireBranchAdminOrAdmin, restockBranchProduct);
router.delete("/:id", requireBranchAdminOrAdmin, deleteBranchProduct);

export default router;
