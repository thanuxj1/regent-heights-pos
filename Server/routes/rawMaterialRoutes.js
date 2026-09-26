import express from "express";
import {
  getRawMaterials,
  getRawMaterialById,
  createRawMaterial,
  updateRawMaterial,
  deleteRawMaterial,
  getLowStockMaterials,
  adjustStock,
  countRawMaterial,
} from "../controllers/rawMaterialController.js";
import {
  requireAuth,
  requireRole,
  requireBranchAdminOr,
  CAPABILITIES,
  ROLES,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Apply auth to all routes
router.use(requireAuth);

// ── Collection routes ──────────────────────────────────────────────────────

// Any authenticated staff can view materials
router.get(
  "/",
  requireRole(
    [ROLES.ADMIN, ROLES.BRANCH_ADMIN, ROLES.CASHIER, ROLES.KITCHEN_STAFF],
    "Staff",
  ),
  getRawMaterials,
);

// Kitchen staff and managers can view low-stock alerts
router.get(
  "/low-stock",
  requireRole(
    [ROLES.ADMIN, ROLES.BRANCH_ADMIN, ROLES.KITCHEN_STAFF],
    "Kitchen Staff or Admin",
  ),
  getLowStockMaterials,
);

// Only admins can create new raw materials
router.post(
  "/",
  requireBranchAdminOr(CAPABILITIES.RAW_MATERIALS),
  createRawMaterial,
);

// ── Single item routes ─────────────────────────────────────────────────────

// Any authenticated staff can view a single material
router.get(
  "/:id",
  requireRole(
    [ROLES.ADMIN, ROLES.BRANCH_ADMIN, ROLES.CASHIER, ROLES.KITCHEN_STAFF],
    "Staff",
  ),
  getRawMaterialById,
);

// Only admins can fully update a material's details
router.put(
  "/:id",
  requireBranchAdminOr(CAPABILITIES.RAW_MATERIALS),
  updateRawMaterial,
);

// Kitchen staff can adjust stock (after delivery or usage)
router.patch(
  "/:id/stock",
  requireRole(
    [ROLES.ADMIN, ROLES.BRANCH_ADMIN, ROLES.KITCHEN_STAFF],
    "Kitchen Staff or Admin",
  ),
  adjustStock,
);

// Only a manager corrects the count, and every correction says why.
router.post(
  "/:id/count",
  requireBranchAdminOr(CAPABILITIES.RAW_MATERIALS),
  countRawMaterial,
);

// Admin and Branch Admin can delete — destructive operation
router.delete(
  "/:id",
  requireBranchAdminOr(CAPABILITIES.RAW_MATERIALS),
  deleteRawMaterial
);

export default router;
