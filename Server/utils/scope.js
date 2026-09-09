import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";

/**
 * Branch scoping for every tenant-owned table.
 *
 * The rule: **the branch comes from the token, never from the query string.**
 * The hotel endpoints originally read `?b_id=` and applied no filter when it
 * was missing, so any signed-in user of any company could read every room,
 * booking and guest in the database. The UI always sent the right value, which
 * is exactly why it looked correct.
 *
 * Super Admin is the one exception: it is the platform operator, sits above all
 * companies, and may narrow to a single branch with `?b_id=`.
 */
export function branchScope(req) {
  const role = Number(req.user?.role_id);

  // Platform operator: one branch if asked for, otherwise everything.
  if (role === ROLES.SUPER_ADMIN) {
    const asked = req.query?.b_id ?? req.query?.branch_id;
    return asked ? { mode: "one", b_id: Number(asked) } : { mode: "all" };
  }

  // Retired company-wide admin (role 2): every branch its company owns. Nobody
  // holds this role, but a token issued before migration 007 stays valid.
  if (role === ROLES.ADMIN && req.user?.com_id != null) {
    return { mode: "company", com_id: Number(req.user.com_id) };
  }

  // Everyone else is pinned to the branch in their own token. A user with no
  // branch matches nothing rather than everything — fail closed, not open.
  const b = req.user?.b_id;
  return { mode: "one", b_id: b != null ? Number(b) : -1 };
}

/**
 * A SQL fragment restricting `column` to what this caller may see, pushing its
 * own bind parameters onto `params`. Returns null when no restriction applies
 * (Super Admin looking at everything), so callers can drop it from the WHERE.
 *
 *   const params = [], clauses = [];
 *   const scope = branchClause(req, "b.b_id", params);
 *   if (scope) clauses.push(scope);
 */
export function branchClause(req, column, params) {
  const s = branchScope(req);

  if (s.mode === "all") return null;

  if (s.mode === "company") {
    params.push(s.com_id);
    return `${column} IN (SELECT "B_id" FROM "Branch" WHERE com_id = $${params.length})`;
  }

  params.push(s.b_id);
  return `${column} = $${params.length}`;
}

/**
 * The branch a write belongs to. A branch-level user may only ever write into
 * its own branch, so a `b_id` in the request body is ignored for them; Super
 * Admin has no branch of its own and must state one.
 */
export function writeBranchId(req, requested) {
  const s = branchScope(req);
  if (s.mode === "one" && s.b_id > 0) return s.b_id;

  const asked = requested ?? req.body?.b_id ?? req.body?.branch_id;
  return asked != null && asked !== "" ? Number(asked) : null;
}

/**
 * Guard for endpoints addressed by record id. Confirms the row belongs to a
 * branch this caller may touch before anything is read back or changed —
 * without it, `/bookings/10` hands company 3's booking to company 1.
 *
 * Throws a 404 rather than a 403: a stranger should not learn the row exists.
 */
export async function assertInScope(req, res, { table, idColumn, id, branchColumn = "b_id" }) {
  const s = branchScope(req);
  if (s.mode === "all") return true;

  const params = [Number(id)];
  const clause = branchClause(req, `t.${branchColumn}`, params);

  const { rows } = await pool.query(
    `SELECT 1 FROM "${table}" t WHERE t.${idColumn} = $1 AND ${clause} LIMIT 1`,
    params,
  );

  if (!rows.length) {
    res.status(404);
    throw new Error("Not found");
  }
  return true;
}

/**
 * Same guard for rows that reach their branch through a parent booking
 * (folio items, payments, booking rooms).
 */
export async function assertBookingInScope(req, res, bookingId) {
  return assertInScope(req, res, {
    table: "BOOKING",
    idColumn: "booking_id",
    id: bookingId,
  });
}
