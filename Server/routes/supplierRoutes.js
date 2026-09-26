import express from "express";
import {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from "../controllers/supplierController.js";
import {
  getSupplierLedger,
  getSupplierHistory,
  getSpendTrend,
} from "../controllers/supplierLedgerController.js";
import {
  requireAuth,
  requireBranchAdminOr,
  CAPABILITIES,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Apply auth + role to ALL routes at once
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.SUPPLIER_MANAGEMENT));

router.get("/ledger", getSupplierLedger);
router.get("/spend-trend", getSpendTrend);
router.get("/:id/history", getSupplierHistory);

router.get("/",       getSuppliers);
router.get("/:id",    getSupplierById);
router.post("/",      createSupplier);
router.put("/:id",    updateSupplier);
router.delete("/:id", deleteSupplier);

export default router;
