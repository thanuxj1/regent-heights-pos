import express from "express";
import { requireAuth, requireCashierOrAbove, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import {
  getDeliveryPartners,
  createDeliveryPartner,
  updateDeliveryPartner,
  deleteDeliveryPartner,
  getDeliveryPartnerAnalytics,
} from "../controllers/deliveryPartnerController.js";

const router = express.Router();

// The POS needs the active list to build its partner picker — read is
// operational, same tier as seeing outstanding COD. Adding/editing a
// partner is a manager-tier action, same guard as recording a settlement.
router.get("/", requireAuth, requireCashierOrAbove, getDeliveryPartners);
router.get("/:key/analytics", requireAuth, requireCashierOrAbove, getDeliveryPartnerAnalytics);
router.post("/", requireAuth, requireBranchAdminOr(CAPABILITIES.DELIVERY_MANAGEMENT), createDeliveryPartner);
router.patch("/:id", requireAuth, requireBranchAdminOr(CAPABILITIES.DELIVERY_MANAGEMENT), updateDeliveryPartner);
router.delete("/:id", requireAuth, requireBranchAdminOr(CAPABILITIES.DELIVERY_MANAGEMENT), deleteDeliveryPartner);

export default router;
