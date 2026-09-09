import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { getSummary, getTransactions } from "../controllers/reportController.js";

const router = Router();
router.use(requireAuth);

router.get("/summary",      getSummary);
router.get("/transactions", getTransactions);

export default router;
