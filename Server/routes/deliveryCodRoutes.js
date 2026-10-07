import express from "express";
import {
  requireAuth, requireCashierOrAbove, requireBranchAdminOr, CAPABILITIES,
  requireDefaultNotRevoked, DEFAULT_PERMISSIONS,
} from "../middleware/authMiddleware.js";
import { getOutstandingCod, getCodHistory, createCodSettlement } from "../controllers/deliveryCodController.js";

const router = express.Router();

// Seeing what's outstanding is operational — a cashier taking a delivery
// order should be able to see the running COD balance building up. Recording
// that the rider has come back with the cash is the till's job too: the cashier
// is the person the rider hands it to. It is the same trust as taking a payment,
// so it follows the till's own permission and an owner can still take it away from
// one person (Permissions → Point of Sale).
const viewCod = requireDefaultNotRevoked(DEFAULT_PERMISSIONS.VIEW_DIRECTORY, { unless: CAPABILITIES.DELIVERY_MANAGEMENT });
router.get("/outstanding", requireAuth, requireCashierOrAbove, viewCod, getOutstandingCod);
router.get("/history", requireAuth, requireCashierOrAbove, viewCod, getCodHistory);
router.post("/settle", requireAuth, requireCashierOrAbove, requireDefaultNotRevoked(DEFAULT_PERMISSIONS.POS_TERMINAL), createCodSettlement);

export default router;
