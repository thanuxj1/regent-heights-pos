import express from "express";
import {
  requireAuth, requireCashierOrAbove, requireDefaultNotRevoked, DEFAULT_PERMISSIONS,
} from "../middleware/authMiddleware.js";
import { getOutstandingCredit, getCreditHistory, settleCredit } from "../controllers/creditController.js";

const router = express.Router();

// The till that gave the credit is where the customer comes back to pay, so a
// cashier sees and records it, like a delivery partner's COD hand-over.
router.get("/outstanding", requireAuth, requireCashierOrAbove, getOutstandingCredit);
router.get("/history", requireAuth, requireCashierOrAbove, getCreditHistory);
router.post("/settle", requireAuth, requireCashierOrAbove, requireDefaultNotRevoked(DEFAULT_PERMISSIONS.POS_TERMINAL), settleCredit);

export default router;
