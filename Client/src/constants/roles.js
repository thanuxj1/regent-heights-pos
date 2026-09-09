/**
 * Role identity in one place.
 *
 * These screens used to decide things by reading the role's *name* — e.g.
 * `role_name.toLowerCase().includes("admin")`. Renaming role 1 from "Branch
 * Admin" to "Administrator" is exactly the kind of edit that silently changes
 * what such a test matches, so identity now hangs on the id.
 */

export const ROLE = {
  BRANCH_ADMIN: 1, // the Administrator — owner and property manager in one
  ADMIN: 2,        // retired (migration 007); kept for old sessions and history
  CASHIER: 3,
  SUPER_ADMIN: 6,
  WAITER: 8,
  KITCHEN_STAFF: 9,
};

/** Roles that carry admin power, whatever they happen to be called. */
export const ADMIN_ROLE_IDS = [ROLE.BRANCH_ADMIN, ROLE.ADMIN, ROLE.SUPER_ADMIN];

export const isAdminRole = (roleId) => ADMIN_ROLE_IDS.includes(Number(roleId));

/**
 * Who may read inventory levels — mirrors the guard on
 * GET /api/raw-materials/low-stock. Asking as anyone else earns a 403 on every
 * page load, which is what a waiter used to get from the notification bell.
 *
 * Stated as an allow-list on purpose: the old test excluded cashiers by name,
 * so every role added afterwards silently started failing.
 */
export const canSeeLowStock = (roleId) =>
  [ROLE.BRANCH_ADMIN, ROLE.ADMIN, ROLE.SUPER_ADMIN, ROLE.KITCHEN_STAFF].includes(Number(roleId));

/**
 * The roles an Administrator may hand out: floor staff only. Admin accounts are
 * created by the platform, not from inside a property. `is_assignable` comes
 * from the API and is false for retired roles — the id list narrows it further.
 */
export const isStaffAssignable = (role) =>
  role?.is_assignable !== false && !isAdminRole(role?.role_id);

export const staffRoles = (roles = []) => roles.filter(isStaffAssignable);

/**
 * The wider set offered on the company-level forms: every live role except
 * Super Admin, which belongs to the platform and is never handed out from here.
 */
export const assignableRoles = (roles = []) =>
  roles.filter(
    (role) => role?.is_assignable !== false && Number(role?.role_id) !== ROLE.SUPER_ADMIN,
  );
