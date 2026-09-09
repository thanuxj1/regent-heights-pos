import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  getAgents, getAgentById, createAgent, updateAgent, deleteAgent,
  getRecords, createRecord, updateRecord, deleteRecord, getMonthlySummary
} from "../controllers/commissionController.js";

const router = Router();
router.use(requireAuth);

router.get("/agents",              getAgents);
router.get("/agents/summary",      getMonthlySummary);
router.get("/agents/:id",          getAgentById);
router.post("/agents",             createAgent);
router.put("/agents/:id",          updateAgent);
router.delete("/agents/:id",       deleteAgent);

router.get("/records",             getRecords);
router.post("/records",            createRecord);
router.put("/records/:id",         updateRecord);
router.delete("/records/:id",      deleteRecord);

export default router;
