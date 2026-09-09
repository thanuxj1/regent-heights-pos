import jwt from "jsonwebtoken";
import pool from "../config/database.js";

// ─────────────────────────────────────────────
// TOKEN EXTRACTION
// ─────────────────────────────────────────────
function extractToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader && typeof authHeader === "string") {
    if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
    return authHeader;
  }

  const headerToken = req.headers["x-access-token"];
  if (typeof headerToken === "string" && headerToken.length > 0)
    return headerToken;

  if (typeof req.query?.token === "string" && req.query.token.length > 0)
    return req.query.token;

  return null;
}

// ─────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────
/**
 * Deactivated accounts must stop working, not merely stop logging in — a token
 * already in a browser stays valid for days. Every authenticated request checks
 * the account is still live, through a short cache so it costs one query per
 * user per 30s rather than one per request. Deactivation bites within 30s.
 */
const STATUS_TTL_MS = 30_000;
const statusCache = new Map(); // u_id -> { active, role_id, name, at }

export function invalidateUserStatus(u_id) {
  statusCache.delete(Number(u_id));
}

async function accountIsLive(u_id) {
  const now = Date.now();
  const hit = statusCache.get(Number(u_id));
  if (hit && now - hit.at < STATUS_TTL_MS) return hit;

  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT u_status, role_id, u_fname, u_lname FROM "User" WHERE u_id = $1',
      [Number(u_id)],
    ));
  } catch (err) {
    // The database blinked — Neon suspends when idle and takes seconds to wake,
    // and any network here is a shared one. This says nothing about whether the
    // token is genuine: it was signed by us and has not expired.
    //
    // Treating it as an auth failure logged the whole floor out mid-sale, which
    // is a far worse outcome than a deactivated account staying live a few
    // seconds longer. Serve the last known answer, or wave the request through
    // on the token's own claims, and leave a note either way.
    console.warn(`[AUTH] account status check failed for u_id=${u_id}: ${err.message}`);
    if (hit) return { ...hit, stale: true };
    return { active: true, role_id: null, unverified: true, at: 0 };
  }
  const entry = rows.length
    ? {
        active: rows[0].u_status !== false,
        role_id: Number(rows[0].role_id),
        u_fname: rows[0].u_fname,
        u_lname: rows[0].u_lname,
        at: now,
      }
    : { active: false, role_id: null, at: now }; // deleted account: fail closed
  statusCache.set(Number(u_id), entry);
  return entry;
}

export async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      message: "Please log in to continue.",
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error("[AUTH] JWT_SECRET is not set");
    return res.status(500).json({
      message: "Something went wrong on our end. Please try again later.",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded?.u_id != null) {
      const account = await accountIsLive(decoded.u_id);
      if (!account.active) {
        return res.status(401).json({
          message: "This account has been deactivated. Please contact your administrator.",
        });
      }
      // The role in the token is a snapshot; the database is the truth. A
      // demotion takes effect without waiting for the token to expire.
      if (account.role_id != null) decoded.role_id = account.role_id;

      // The token carries no name, so the audit trail would read "who did it"
      // as an email address. This row is already in hand — use it.
      if (account.u_fname) decoded.u_fname = account.u_fname;
      if (account.u_lname) decoded.u_lname = account.u_lname;
    }

    req.user = decoded;
    return next();
  } catch (err) {
    const isExpired = err?.name === "TokenExpiredError";

    return res.status(401).json({
      message: isExpired
        ? "Your session has expired. Please log in again."
        : "We couldn't verify your identity. Please log in again.",
    });
  }
}

// ─────────────────────────────────────────────
// ROLE CONSTANTS
// ─────────────────────────────────────────────
export const ROLES = {
  SUPER_ADMIN: 6, //SLT
  // RETIRED (migration 007): company-wide owner, no branch of its own. Nobody
  // holds it and the API refuses to assign it, but the code path stays — it is
  // the only role that spans branches, so a company with a second property
  // needs it back. Route guards keep listing it so an old session still works.
  ADMIN: 2,
  BRANCH_ADMIN: 1, // the Administrator — owner and property manager in one
  CASHIER: 3,
  WAITER: 8,
  KITCHEN_STAFF: 9,
};

// ─────────────────────────────────────────────
// ROLE MIDDLEWARE
// Super Admin (6) bypasses ALL role checks automatically.
// ─────────────────────────────────────────────
export function requireRole(allowedRoles, label) {
  return (req, res, next) => {
    // Coerce to Number in case JWT decoded role_id as a string
    const roleId = req.user?.role_id != null ? Number(req.user.role_id) : undefined;

    if (roleId === undefined || roleId === null || isNaN(roleId)) {
      return res.status(403).json({
        message:
          "Your account doesn't have a role assigned yet. Please contact your administrator.",
      });
    }

    // Super Admin can access every route — no further checks needed
    if (roleId === ROLES.SUPER_ADMIN) {
      return next();
    }

    if (!allowedRoles.includes(roleId)) {
      return res.status(403).json({
        message: `You don't have permission to perform this action. ${label} access is required.`,
      });
    }

    return next();
  };
}

// ─────────────────────────────────────────────
// READY-MADE HELPERS
// ─────────────────────────────────────────────

// Super Admin only
export const requireSuperAdmin = requireRole(
  [ROLES.SUPER_ADMIN],
  "Super Admin",
);

// Admin only
export const requireAdmin = requireRole([ROLES.ADMIN], "Admin");

// Branch Admin OR Admin
export const requireBranchAdminOrAdmin = requireRole(
  [ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Branch Admin or Admin",
);

// Cashier OR Branch Admin OR Admin
export const requireCashierOrAbove = requireRole(
  [ROLES.CASHIER, ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Cashier, Branch Admin, or Admin",
);

// Waiter OR Cashier OR Branch Admin OR Admin
export const requireWaiterOrAbove = requireRole(
  [ROLES.WAITER, ROLES.CASHIER, ROLES.KITCHEN_STAFF, ROLES.BRANCH_ADMIN, ROLES.ADMIN],
  "Waiter, Cashier, Kitchen Staff, Branch Admin, or Admin",
);
