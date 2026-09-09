import express from "express";
import {
  getCurrentSession, openSession, addMovement, closeSession,
  listSessions, getSession,
} from "../controllers/cashSessionController.js";
import { requireAuth, requireRole, ROLES } from "../middleware/authMiddleware.js";

const router = express.Router();

/** Anyone who works a till owns a drawer. */
const worksATill = requireRole(
  [ROLES.CASHIER, ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Cashier, Branch Admin or Admin",
);

/** Reviewing everyone's drawers is the owner's job, not the cashier's. */
const reviewsDrawers = requireRole(
  [ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Branch Admin or Admin",
);

router.use(requireAuth);

// A cashier's own drawer
router.get("/session",           worksATill, getCurrentSession);
router.post("/session/open",     worksATill, openSession);
router.post("/session/movement", worksATill, addMovement);
router.post("/session/close",    worksATill, closeSession);

// The owner's review. Listed after the fixed paths so "/sessions/:id" cannot
// swallow them.
router.get("/sessions",     reviewsDrawers, listSessions);
router.get("/sessions/:id", reviewsDrawers, getSession);

export default router;
