import { Router } from "express";
import { requireAuth, requireBranchAdminOr, CAPABILITIES } from "../middleware/authMiddleware.js";
import {
  getLoginLocations, addLoginLocation, setLoginLocationActive, removeLoginLocation,
  setApprovalPin, clearApprovalPin, getSecurityOverview, getDiscountApproval,
} from "../controllers/securityController.js";

const router = Router();

// The till asks this before a discounted sale: any signed-in staff may, and it
// says only whether a PIN is needed, nothing about whose.
router.get("/discount-approval", requireAuth, getDiscountApproval);

// Deciding where staff may sign in, and holding an approval PIN, are the owner's
// job. A till must never be able to widen its own fence.
router.use(requireAuth, requireBranchAdminOr(CAPABILITIES.SECURITY_SETTINGS));

router.get("/overview", getSecurityOverview);

router.get("/login-locations",         getLoginLocations);
router.post("/login-locations",        addLoginLocation);
router.put("/login-locations/:id",     setLoginLocationActive);
router.delete("/login-locations/:id",  removeLoginLocation);

router.put("/approval-pin",    setApprovalPin);
router.delete("/approval-pin", clearApprovalPin);

export default router;
