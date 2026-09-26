import express from "express";
import {
  requireAuth,
  requireBranchAdminOr,
  CAPABILITIES,
  requireCashierOrAbove,
  requireWaiterOrAbove,
  requireDefaultNotRevoked,
  DEFAULT_PERMISSIONS,
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
// A Waiter's own default, inert for Cashier/Kitchen/Admin — Cashier's own POS
// menu view isn't touched by a Waiter's "Viewing the Menu" toggle.
const waiterMenu = requireDefaultNotRevoked(DEFAULT_PERMISSIONS.WAITER_MENU);
router.get("/", requireWaiterOrAbove, waiterMenu, getBranchProducts);
router.get("/:id", requireWaiterOrAbove, waiterMenu, getBranchProductById);
router.post("/", requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU), createBranchProduct);
router.put("/:id", requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU), updateBranchProduct);
// A manager's count of what is on the shelf — with a reason, on the record.
router.post("/:id/count", requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU), countBranchProduct);
// Bring more of a counted item across from the main store.
router.post("/:id/restock", requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU), restockBranchProduct);
router.delete("/:id", requireBranchAdminOr(CAPABILITIES.PRODUCT_MENU), deleteBranchProduct);

export default router;
