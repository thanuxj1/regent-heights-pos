import express from "express";
import { requireAuth, requireSuperAdmin } from "../middleware/authMiddleware.js";
import { getHosting, markHostingPaid } from "../controllers/hostingController.js";

const router = express.Router();
router.get("/", requireAuth, getHosting);
router.post("/paid", requireAuth, requireSuperAdmin, markHostingPaid);

export default router;
