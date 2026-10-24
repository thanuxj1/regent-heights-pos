import express from "express";
import {
  requireAuth, requireCashierOrAbove, requireDefaultNotRevoked, DEFAULT_PERMISSIONS, requireRole, ROLES,
} from "../middleware/authMiddleware.js";
import { getOutstandingCredit, getCreditHistory, settleCredit } from "../controllers/creditController.js";
import { removeSettlement } from "../utils/settlementRemoval.js";

const router = express.Router();

// The till that gave the credit is where the customer comes back to pay, so a
// cashier sees and records it, like a delivery partner's COD hand-over.
router.get("/outstanding", requireAuth, requireCashierOrAbove, getOutstandingCredit);
router.get("/history", requireAuth, requireCashierOrAbove, getCreditHistory);
router.post("/settle", requireAuth, requireCashierOrAbove, requireDefaultNotRevoked(DEFAULT_PERMISSIONS.POS_TERMINAL), settleCredit);
// Undo a payment recorded by mistake: the Administrator's own correction.
router.post("/settlements/:id/delete", requireAuth,
  requireRole([ROLES.BRANCH_ADMIN, ROLES.ADMIN], "Administrator"), removeSettlement("credit"));

export default router;
