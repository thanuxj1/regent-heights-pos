import { Router } from "express";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import { getSummary, getTransactions, getProductProfit, getPurchases } from "../controllers/reportController.js";

const router = Router();
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.REPORTS_ACCOUNTING));

router.get("/summary",      getSummary);
router.get("/transactions", getTransactions);
router.get("/products",     getProductProfit);
router.get("/purchases",    getPurchases);

export default router;
