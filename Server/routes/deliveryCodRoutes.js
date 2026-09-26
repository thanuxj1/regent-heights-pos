import express from "express";
import { requireAuth, requireCashierOrAbove, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import { getOutstandingCod, getCodHistory, createCodSettlement } from "../controllers/deliveryCodController.js";

const router = express.Router();

// Seeing what's outstanding is operational — a cashier taking a delivery
// order should be able to see the running COD balance building up. Recording
// a settlement (money actually changing hands) is a manager-tier action,
// same as a supplier payment.
router.get("/outstanding", requireAuth, requireCashierOrAbove, getOutstandingCod);
router.get("/history", requireAuth, requireCashierOrAbove, getCodHistory);
router.post("/settle", requireAuth, requireBranchAdminOr(CAPABILITIES.DELIVERY_MANAGEMENT), createCodSettlement);

export default router;
