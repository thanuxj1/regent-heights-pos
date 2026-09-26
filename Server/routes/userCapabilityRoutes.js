import express from "express";
import {
  getCapabilityCatalog,
  getUserCapabilities,
  setUserCapabilities,
} from "../controllers/userCapabilityController.js";
import { requireAuth, requireBranchAdminOrAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Deliberately its own router, mounted separately from userRoutes.js, and
 * deliberately still requireBranchAdminOrAdmin rather than the capability
 * guard: userRoutes.js itself becomes grantable via the USER_MANAGEMENT
 * capability, but granting/revoking permissions can never be delegated —
 * a cashier handed User Management access must not be able to grant
 * themselves (or anyone else) further capabilities.
 *
 * Guards are applied per-route, not as a blanket router.use(): this router is
 * mounted at the bare "/api" prefix (so /users/:id/capabilities can sit
 * alongside userRoutes.js's own /api/users mount) — a path-less router.use()
 * here would run for every /api/* request, not just this router's own two
 * routes, and would 403 a cashier's request to completely unrelated routes
 * like /api/suppliers before it ever reached supplierRoutes.js.
 */
router.get("/capabilities", requireAuth, requireBranchAdminOrAdmin, getCapabilityCatalog);

// A person may always read their own granted capabilities — the frontend
// needs this to decide what to show them (e.g. a POS link someone was just
// handed). Viewing someone ELSE's grants still requires admin/manager.
router.get(
  "/users/:id/capabilities",
  requireAuth,
  (req, res, next) =>
    Number(req.user.u_id) === Number(req.params.id) ? next() : requireBranchAdminOrAdmin(req, res, next),
  getUserCapabilities,
);

router.put("/users/:id/capabilities", requireAuth, requireBranchAdminOrAdmin, setUserCapabilities);

export default router;
