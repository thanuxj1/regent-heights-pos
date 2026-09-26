import express from "express";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import {
  getSupplierPayments,
  getSupplierPaymentById,
  getPaymentsBySupplier,
  getPaymentsByOrder,
  createSupplierPayment,
  updateSupplierPayment,
  deleteSupplierPayment,
} from "../controllers/supplierPaymentController.js";

const router = express.Router();

// Money paid to suppliers is the owner's business, and it was not behind a
// login at all: anyone who could reach the server could list every company's
// payments, supplier names and phone numbers included, and add or delete them.
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.SUPPLIER_MANAGEMENT));

router.get("/", getSupplierPayments);
router.get("/supplier/:supId", getPaymentsBySupplier);
router.get("/order/:poId", getPaymentsByOrder);
router.get("/:id", getSupplierPaymentById);
router.post("/", createSupplierPayment);
router.put("/:id", updateSupplierPayment);
router.delete("/:id", deleteSupplierPayment);

export default router;
