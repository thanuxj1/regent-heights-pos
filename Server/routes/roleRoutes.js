import express from "express";
import {
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
} from "../controllers/roleController.js";
import { requireAuth, requireBranchAdminOr, requireCashierOrAbove, CAPABILITIES } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth);

// The role list is what populates the "select a role" dropdown on the User
// Management forms — a cashier granted only User Management (not the
// separate, more sensitive Roles Management) still needs to read it to
// create/edit a user. Reading it isn't sensitive; only defining/removing
// roles is.
router.get("/", requireCashierOrAbove, getRoles);
router.get("/:id", requireCashierOrAbove, getRoleById);
router.post("/", requireBranchAdminOr(CAPABILITIES.ROLES_MANAGEMENT), createRole);
router.put("/:id", requireBranchAdminOr(CAPABILITIES.ROLES_MANAGEMENT), updateRole);
router.delete("/:id", requireBranchAdminOr(CAPABILITIES.ROLES_MANAGEMENT), deleteRole);

export default router;
