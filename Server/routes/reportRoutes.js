import { Router } from "express";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import { getSummary, getTransactions, getProductProfit } from "../controllers/reportController.js";

const router = Router();
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.REPORTS_ACCOUNTING));

router.get("/summary",      getSummary);
router.get("/transactions", getTransactions);
router.get("/products",     getProductProfit);

export default router;
