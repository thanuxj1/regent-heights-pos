// purchaseItemRoutes.js
import express from "express";
import {
  getPurchaseItems,
  getPurchaseItemsByOrder,
  getPurchaseItemById,
  createPurchaseItem,
  updatePurchaseItem,
  deletePurchaseItem,
} from "../controllers/purchaseItemController.js";
import {
  requireAuth,
  requireRole,
  requireBranchAdminOr,
  CAPABILITIES,
  ROLES,
} from "../middleware/authMiddleware.js";

const router = Router();

function Router() {
  return express.Router();
}

router.use(requireAuth);

// Anyone in kitchen staff, branch admin, or admin can list purchase items
router.get(
  "/",
  requireRole(
    [ROLES.ADMIN, ROLES.BRANCH_ADMIN, ROLES.KITCHEN_STAFF],
    "Admin, Branch Admin, or Kitchen Staff",
  ),
  getPurchaseItems,
);

// Kitchen staff can VIEW items in an order (so they know what's coming in)
// but cannot create, edit, or delete them
router.get(
  "/order/:orderId",
  requireRole(
    [ROLES.ADMIN, ROLES.BRANCH_ADMIN, ROLES.KITCHEN_STAFF],
    "Admin, Branch Admin, or Kitchen Staff",
  ),
  getPurchaseItemsByOrder,
);

router.get(
  "/:id",
  requireRole(
    [ROLES.ADMIN, ROLES.BRANCH_ADMIN, ROLES.KITCHEN_STAFF],
    "Admin, Branch Admin, or Kitchen Staff",
  ),
  getPurchaseItemById,
);

// Admin, Branch Admin, or a cashier granted the Purchase Orders capability
router.post("/", requireBranchAdminOr(CAPABILITIES.PURCHASE_ORDERS), createPurchaseItem);
router.put("/:id", requireBranchAdminOr(CAPABILITIES.PURCHASE_ORDERS), updatePurchaseItem);
router.delete("/:id", requireBranchAdminOr(CAPABILITIES.PURCHASE_ORDERS), deletePurchaseItem);

export default router;

