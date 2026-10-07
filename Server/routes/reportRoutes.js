import { Router } from "express";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import { getSummary, getTransactions, getProductProfit, getPurchases, getPayables, getOrdersMix } from "../controllers/reportController.js";

const router = Router();
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.REPORTS_ACCOUNTING));

router.get("/summary",      getSummary);
router.get("/transactions", getTransactions);
router.get("/products",     getProductProfit);
router.get("/purchases",    getPurchases);
router.get("/payables",     getPayables);
router.get("/orders-mix",   getOrdersMix);

export default router;
