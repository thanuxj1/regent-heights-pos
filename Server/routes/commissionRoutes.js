import { Router } from "express";
import { requireAuth, requireCashierOrAbove, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import {
  getAgents, getAgentById, createAgent, updateAgent, deleteAgent,
  getRecords, createRecord, updateRecord, deleteRecord, getMonthlySummary
} from "../controllers/commissionController.js";

const router = Router();
router.use(requireAuth);

// Front desk needs the agent list to attribute a booking while creating or
// viewing it (Client/src/pages/hotel/Bookings.jsx, BookingDetail.jsx) — kept
// at Cashier-or-above. Managing agents, and the commission records/summary
// themselves, is admin-tier data gated behind the same capability grant as
// everything else this migration adds.
router.get("/agents",              requireCashierOrAbove, getAgents);
router.get("/agents/:id",          requireCashierOrAbove, getAgentById);
router.get("/agents/summary",      requireBranchAdminOr(CAPABILITIES.COMMISSION_AGENTS), getMonthlySummary);
router.post("/agents",             requireBranchAdminOr(CAPABILITIES.COMMISSION_AGENTS), createAgent);
router.put("/agents/:id",          requireBranchAdminOr(CAPABILITIES.COMMISSION_AGENTS), updateAgent);
router.delete("/agents/:id",       requireBranchAdminOr(CAPABILITIES.COMMISSION_AGENTS), deleteAgent);

router.get("/records",             requireBranchAdminOr(CAPABILITIES.COMMISSION_AGENTS), getRecords);
router.post("/records",            requireBranchAdminOr(CAPABILITIES.COMMISSION_AGENTS), createRecord);
router.put("/records/:id",         requireBranchAdminOr(CAPABILITIES.COMMISSION_AGENTS), updateRecord);
router.delete("/records/:id",      requireBranchAdminOr(CAPABILITIES.COMMISSION_AGENTS), deleteRecord);

export default router;
