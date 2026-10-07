import express from "express";
import {
  requireAuth, requireCashierOrAbove, requireBranchAdminOr, CAPABILITIES,
  requireDefaultNotRevoked, DEFAULT_PERMISSIONS,
} from "../middleware/authMiddleware.js";
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
const viewPartners = requireDefaultNotRevoked(DEFAULT_PERMISSIONS.VIEW_DIRECTORY, { unless: CAPABILITIES.DELIVERY_MANAGEMENT });
router.get("/", requireAuth, requireCashierOrAbove, viewPartners, getDeliveryPartners);
router.get("/:key/analytics", requireAuth, requireCashierOrAbove, viewPartners, getDeliveryPartnerAnalytics);
router.post("/", requireAuth, requireBranchAdminOr(CAPABILITIES.DELIVERY_MANAGEMENT), createDeliveryPartner);
router.patch("/:id", requireAuth, requireBranchAdminOr(CAPABILITIES.DELIVERY_MANAGEMENT), updateDeliveryPartner);
router.delete("/:id", requireAuth, requireBranchAdminOr(CAPABILITIES.DELIVERY_MANAGEMENT), deleteDeliveryPartner);

export default router;
