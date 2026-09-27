import express from "express";
import { getOverview, getBranchStats } from "../controllers/statsController.js";
import { requireAuth, requireBranchAdminOrAdmin } from "../middleware/authMiddleware.js";
const router = express.Router();
router.use(requireAuth, requireBranchAdminOrAdmin);
router.get("/overview", getOverview);
router.get("/branches", getBranchStats);
export default router;