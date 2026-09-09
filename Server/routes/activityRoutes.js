import { Router } from "express";
import { requireAuth, requireRole, ROLES } from "../middleware/authMiddleware.js";
import {
  getActivity, getActivitySummary, getRetention, runPrune,
} from "../controllers/activityController.js";

const router = Router();
router.use(requireAuth);

// The audit trail is a management view — it shows every staff member's actions.
const canAudit = requireRole([ROLES.BRANCH_ADMIN, ROLES.ADMIN], "Branch Admin or Admin");

router.get("/",        canAudit, getActivity);
router.get("/summary", canAudit, getActivitySummary);

// How long the trail is kept, and running the trim by hand. Deleting history is
// the owner's call, so it sits behind the same guard as reading it.
router.get("/retention",        canAudit, getRetention);
router.post("/retention/prune", canAudit, runPrune);

export default router;
