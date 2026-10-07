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
// GRANTABLE CAPABILITIES
// A capability is an individual permission an admin can grant to (or revoke
// from) a specific user, independent of their role_id. Branch Admin/Owner
// and Super Admin already pass every check below and never need a row in
// "USER_CAPABILITY" — this exists so a cashier can be handed one specific
// slice of admin-tier access (e.g. Supplier Management) without promoting
// them to Branch Admin and handing them everything at once.
// ─────────────────────────────────────────────
export const CAPABILITIES = {
  REPORTS_ACCOUNTING:  { key: "reports_accounting",  label: "Reports & Accounting" },
  SUPPLIER_MANAGEMENT: { key: "supplier_management", label: "Supplier Management" },
  PURCHASE_ORDERS:     { key: "purchase_orders",     label: "Purchase Orders" },
  PRODUCT_MENU:        { key: "product_menu",        label: "Product & Menu Management" },
  RAW_MATERIALS:       { key: "raw_materials",        label: "Raw Materials & Stock" },
  HOTEL_MANAGEMENT:    { key: "hotel_management",    label: "Hotel & Room Management" },
  // hidden: true — real backend exists, but no frontend page anywhere calls
  // the endpoints it gates, so granting it does nothing today. Kept in this
  // object (route files still reference these for backend protection) but
  // filtered out of the grantable catalog so the toggle can't mislead an
  // admin into thinking it does something. Un-hide once a real page exists.
  TABLES_MANAGEMENT:   { key: "tables_management",   label: "Tables & Assignments", hidden: true },
  TERMINALS:           { key: "terminals",            label: "Terminal/Device Management", hidden: true },
  WASTE_TRACKING:      { key: "waste_tracking",       label: "Waste Tracking" },
  CASH_DRAWER_ADMIN:   { key: "cash_drawer_admin",    label: "Cash Drawer Administration" },
  ACTIVITY_LOG:        { key: "activity_log",         label: "Activity Log / Audit" },
  BRANCH_SETTINGS:     { key: "branch_settings",      label: "Branch Settings" },
  // Now gates recording a delivery-partner COD settlement (Server/routes/deliveryCodRoutes.js) —
  // no longer hidden, since that page exists.
  DELIVERY_MANAGEMENT: { key: "delivery_management",  label: "Delivery Management" },
  COMMISSION_AGENTS:   { key: "commission_agents",    label: "Commission Agents" },
  USER_MANAGEMENT:     { key: "user_management",      label: "User Management", sensitive: true },
  ROLES_MANAGEMENT:    { key: "roles_management",     label: "Roles Management", sensitive: true, hidden: true },
  SECURITY_SETTINGS:   { key: "security_settings",    label: "Security Settings", sensitive: true, hidden: true },
  // hidden: meant to hand a waiter or kitchen account the till, but the till's own
  // endpoints are cashier-level, and extra permissions now apply to Cashier
  // accounts only (see grantsApply below) — so it could never work. A person who
  // needs the till is given the Cashier role instead.
  CASHIER_POS_ACCESS:  { key: "cashier_pos_access",   label: "Cashier POS Terminal", hidden: true },
};

export const CAPABILITY_LIST = Object.values(CAPABILITIES);

/**
 * Same shape as statusCache/invalidateUserStatus below, kept as a separate
 * Map rather than folded in: this one is only ever consulted for cashier-tier
 * requests hitting a capability-gated route, not on every authenticated
 * request, so there's no reason to pay its query cost universally.
 */
const CAPABILITY_TTL_MS = 30_000;
const capabilityCache = new Map(); // u_id -> { caps: Set<string>, at }

export function invalidateUserCapabilities(u_id) {
  capabilityCache.delete(Number(u_id));
}

async function userCapabilities(u_id) {
  const now = Date.now();
  const hit = capabilityCache.get(Number(u_id));
  if (hit && now - hit.at < CAPABILITY_TTL_MS) return hit.caps;

  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT capability FROM "USER_CAPABILITY" WHERE u_id = $1',
      [Number(u_id)],
    ));
  } catch (err) {
    // Same philosophy as accountIsLive: a DB blink here should not lock a
    // granted cashier out of a route they were using seconds ago. Serve the
    // stale set if we have one; otherwise fail closed (no set = no grants).
    console.warn(`[AUTH] capability lookup failed for u_id=${u_id}: ${err.message}`);
    if (hit) return hit.caps;
    return new Set();
  }
  const caps = new Set(rows.map((r) => r.capability));
  capabilityCache.set(Number(u_id), { caps, at: now });
  return caps;
}

/**
 * Extra permissions are for Cashier accounts. The pages they open sit in the
 * back-office screens, and read data that is cashier-level (lists of roles,
 * delivery partners, rooms and so on). A waiter or kitchen account holding one
 * reached a page it could not navigate to, that then failed to load half of
 * what it needed. A person who needs back-office access is made a Cashier and
 * given the slices they need. Grants left on an account whose role later
 * changed are ignored rather than quietly honoured.
 */
export const grantsApply = (roleId) => Number(roleId) === ROLES.CASHIER;

const isManager = (roleId) =>
  roleId === ROLES.SUPER_ADMIN || roleId === ROLES.BRANCH_ADMIN || roleId === ROLES.ADMIN;

/** Does this signed-in person hold this capability (and is it one that applies to them)? */
export async function holdsCapability(req, capability) {
  const roleId = req.user?.role_id != null ? Number(req.user.role_id) : undefined;
  if (!grantsApply(roleId) || req.user?.u_id == null) return false;
  const caps = await userCapabilities(req.user.u_id);
  return caps.has(capability.key);
}

/**
 * Branch Admin/Owner/Super Admin always pass, same as requireBranchAdminOrAdmin.
 * A cashier passes only if this specific capability has been granted to
 * them, so they can hold exactly one slice of admin-tier access without
 * being promoted.
 */
export function requireBranchAdminOr(capability) {
  return requireBranchAdminOrAny([capability]);
}

/**
 * The same, for something more than one grant should open — the supplier list,
 * say, which both Supplier Management and Purchase Orders need to work.
 */
export function requireBranchAdminOrAny(capabilities) {
  return async (req, res, next) => {
    const roleId = req.user?.role_id != null ? Number(req.user.role_id) : undefined;
    if (isManager(roleId)) return next();

    if (req.user?.u_id == null) {
      return res.status(403).json({ message: "Your account doesn't have a role assigned yet. Please contact your administrator." });
    }

    for (const capability of capabilities) {
      if (await holdsCapability(req, capability)) return next();
    }

    const needed = capabilities.map((c) => c.label).join(" or ");
    return res.status(403).json({
      message: `You don't have permission to perform this action. ${needed} access is required.`,
    });
  };
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
// REVOCABLE DEFAULTS
// The mirror of CAPABILITIES above: instead of granting a slice of access a
// role does NOT have by default, this switches off a slice it DOES have by
// default, for one specific account, without touching the role itself or
// anyone else holding it.
// ─────────────────────────────────────────────
export const DEFAULT_PERMISSIONS = {
  POS_TERMINAL:     { key: "default_pos",              label: "Point of Sale (own terminal)", role: ROLES.CASHIER },
  OWN_DRAWER:        { key: "default_drawer",            label: "Own Cash Drawer",              role: ROLES.CASHIER },
  HOTEL_FRONT_DESK:  { key: "default_hotel_front_desk",  label: "Hotel Front Desk",             role: ROLES.CASHIER },
  VIEW_DIRECTORY:    { key: "default_view_directory",    label: "Viewing Commission Agents, Delivery, Roles & Branches", role: ROLES.CASHIER },
  WAITER_ORDERS:     { key: "default_orders",            label: "Take & Void Orders",           role: ROLES.WAITER },
  WAITER_TABLES:     { key: "default_tables",            label: "Table Assignments",            role: ROLES.WAITER },
  WAITER_MENU:       { key: "default_menu",              label: "Viewing the Menu & Order Board", role: ROLES.WAITER },
  KITCHEN_BOARD:     { key: "default_board",             label: "Viewing the Order/Kitchen Board", role: ROLES.KITCHEN_STAFF },
  KITCHEN_STATUS:    { key: "default_status",            label: "Marking Order Items Ready",    role: ROLES.KITCHEN_STAFF },
  KITCHEN_STOCK:     { key: "default_stock",             label: "Low-Stock Alerts",             role: ROLES.KITCHEN_STAFF },
};

export const DEFAULT_PERMISSION_LIST = Object.values(DEFAULT_PERMISSIONS);

const DEFAULT_REVOKE_TTL_MS = 30_000;
const defaultRevokeCache = new Map(); // u_id -> { set: Set<string>, at }

export function invalidateUserDefaultRevocations(u_id) {
  defaultRevokeCache.delete(Number(u_id));
}

async function userRevokedDefaults(u_id) {
  const now = Date.now();
  const hit = defaultRevokeCache.get(Number(u_id));
  if (hit && now - hit.at < DEFAULT_REVOKE_TTL_MS) return hit.set;

  let rows;
  try {
    ({ rows } = await pool.query(
      'SELECT default_key FROM "USER_DEFAULT_OVERRIDE" WHERE u_id = $1',
      [Number(u_id)],
    ));
  } catch (err) {
    console.warn(`[AUTH] default-revocation lookup failed for u_id=${u_id}: ${err.message}`);
    if (hit) return hit.set;
    return new Set();
  }
  const set = new Set(rows.map((r) => r.default_key));
  defaultRevokeCache.set(Number(u_id), { set, at: now });
  return set;
}

/**
 * Sits alongside a route's normal role/capability guard, not in place of it.
 * Inert for anyone whose role isn't the one `perm` names — so it can share a
 * route with other roles unaffected by this specific toggle (e.g. Kitchen
 * Staff and Waiter both hit canReadOrders; only a Cashier's own POS_TERMINAL
 * default has anything to say about it). Branch Admin/Admin/Super Admin never
 * carry role_id === perm.role, so they're never blocked by this.
 */
//
// `unless`: a capability that needs this same read to do its job. A cashier whose
// "viewing commission agents" default was switched off but who was then handed
// Commission Agents management must still be able to list the agents they manage
// — the grant is the more specific instruction.
export function requireDefaultNotRevoked(perm, { unless = [] } = {}) {
  return async (req, res, next) => {
    const roleId = req.user?.role_id != null ? Number(req.user.role_id) : undefined;
    if (roleId !== perm.role) return next();

    const uId = req.user?.u_id;
    if (uId == null) return next();

    const revoked = await userRevokedDefaults(uId);
    if (revoked.has(perm.key)) {
      for (const capability of [].concat(unless)) {
        if (await holdsCapability(req, capability)) return next();
      }
      return res.status(403).json({
        message: `Your ${perm.label} access has been switched off by your administrator.`,
      });
    }
    return next();
  };
}

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
