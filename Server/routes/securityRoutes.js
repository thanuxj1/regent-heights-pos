import { Router } from "express";
import { requireAuth, requireBranchAdminOrAdmin } from "../middleware/authMiddleware.js";
import {
  getLoginLocations, addLoginLocation, setLoginLocationActive, removeLoginLocation,
  setApprovalPin, clearApprovalPin, getSecurityOverview,
} from "../controllers/securityController.js";

const router = Router();

// Deciding where staff may sign in, and holding an approval PIN, are the owner's
// job. A till must never be able to widen its own fence.
router.use(requireAuth, requireBranchAdminOrAdmin);

router.get("/overview", getSecurityOverview);

router.get("/login-locations",         getLoginLocations);
router.post("/login-locations",        addLoginLocation);
router.put("/login-locations/:id",     setLoginLocationActive);
router.delete("/login-locations/:id",  removeLoginLocation);

router.put("/approval-pin",    setApprovalPin);
router.delete("/approval-pin", clearApprovalPin);

export default router;
