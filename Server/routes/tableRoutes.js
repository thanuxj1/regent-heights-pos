import express from "express";
import {
  getTables,
  getTableById,
  getTablesByBranch,
  createTable,
  updateTable,
  updateTableStatus,
  deleteTable,
} from "../controllers/tableController.js";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";

const router = express.Router();

// Branch Admin (1) + Admin (2), or a cashier granted the Tables capability
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.TABLES_MANAGEMENT));


router.get("/", getTables);
router.get("/branch/:branchId", getTablesByBranch); 
router.get("/:id", getTableById);
router.post("/", createTable);
router.put("/:id", updateTable);
router.patch("/:id/status", updateTableStatus);
router.delete("/:id", deleteTable);

export default router;
