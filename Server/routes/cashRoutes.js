import express from "express";
import {
  getCurrentSession, openSession, addMovement, closeSession,
  listSessions, getSession, getDrawerPinSetting, setDrawerPinSetting,
} from "../controllers/cashSessionController.js";
import { requireAuth, requireRole, ROLES } from "../middleware/authMiddleware.js";
import { requireDrawerPin } from "../utils/drawerPin.js";

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

// A cashier's own drawer — and the drawer opens only with its PIN. Reading it
// without the PIN says only whether one is open; every change needs the PIN.
const drawerPin = requireDrawerPin();
router.get("/session",           worksATill, requireDrawerPin({ soft: true }), getCurrentSession);
router.post("/session/open",     worksATill, drawerPin, openSession);
router.post("/session/movement", worksATill, drawerPin, addMovement);
router.post("/session/close",    worksATill, drawerPin, closeSession);

// The PIN itself is the manager's: to set, change and look up.
router.get("/pin", reviewsDrawers, getDrawerPinSetting);
router.put("/pin", reviewsDrawers, setDrawerPinSetting);

// The owner's review. Listed after the fixed paths so "/sessions/:id" cannot
// swallow them.
router.get("/sessions",     reviewsDrawers, listSessions);
router.get("/sessions/:id", reviewsDrawers, getSession);

export default router;
