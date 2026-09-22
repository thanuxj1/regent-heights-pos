/**
 * Each role's own screen: where it lands after signing in, and where it is sent
 * when it opens a screen that is not its own.
 *
 * Every one of these routes must let its own role in (see App.jsx). A home that
 * turned its own role away is how signing in used to loop: role 2 was sent to
 * the Administrator's dashboard, which admits role 1 only, which sent it back.
 */
const HOMES = {
  6: "/dashboard",              // Super Admin
  1: "/branch-admin/dashboard", // Administrator — the hotel's manager
  2: "/admin/dashboard",        // Admin — retired; kept for sessions issued before it was
  3: "/cashier/pos",            // Cashier
  8: "/waiter/pos",             // Waiter
  9: "/kitchen/orders",         // Kitchen staff
};

export const ROLE_HOMES = HOMES;

/** The role's own screen, or null for a role that has none. */
export const roleHome = (roleId) => HOMES[Number(roleId)] ?? null;
