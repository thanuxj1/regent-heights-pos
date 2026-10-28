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
  requireBranchAdminOrAny,
  CAPABILITIES,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Reading suppliers, and adding one while recording a purchase, are part of
// buying stock — so Purchase Orders needs them as much as Supplier Management
// does. Changing or removing a supplier stays Supplier Management's.
const buying = requireBranchAdminOrAny([CAPABILITIES.SUPPLIER_MANAGEMENT, CAPABILITIES.PURCHASE_ORDERS]);
const managing = requireBranchAdminOr(CAPABILITIES.SUPPLIER_MANAGEMENT);

router.use(requireAuth);

router.get("/ledger", buying, getSupplierLedger);
router.get("/spend-trend", buying, getSpendTrend);
router.get("/:id/history", buying, getSupplierHistory);

router.get("/",       buying, getSuppliers);
router.get("/:id",    buying, getSupplierById);
router.post("/",      buying, createSupplier);
router.put("/:id",    managing, updateSupplier);
router.delete("/:id", managing, deleteSupplier);

export default router;
