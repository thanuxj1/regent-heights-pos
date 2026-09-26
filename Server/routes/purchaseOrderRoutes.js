// purchaseOrderRoutes.js
import express from "express";
import {
  getPurchaseOrders,
  getPurchaseOrdersBySupplier,
  getMostPurchasedItems,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
  deletePurchaseOrder,
} from "../controllers/purchaseOrderController.js";
import {
  requireAuth,
  requireBranchAdminOr,
  CAPABILITIES,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// All purchase order routes — Admin and Branch Admin, or a cashier granted
// the Purchase Orders capability
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.PURCHASE_ORDERS));

router.get("/", getPurchaseOrders);
router.get("/supplier/:supId", getPurchaseOrdersBySupplier);
router.get("/most-purchased-items", getMostPurchasedItems);
router.get("/:id", getPurchaseOrderById);
router.post("/", createPurchaseOrder);
router.put("/:id", updatePurchaseOrder);
router.patch("/:id/status", updatePurchaseOrderStatus);
router.delete("/:id", deletePurchaseOrder);

export default router;
