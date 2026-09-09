// utils/approval.js
//
// Some actions at the till move money in a way the cashier alone should not
// decide: voiding a paid order, or a discount past the house limit. Both are the
// classic ways cash leaves a business through the front door.
//
// A manager types their PIN on the cashier's screen. The PIN is bcrypt-hashed
// like a password and never leaves the database in the clear; what gets recorded
// is *who approved*, so "a manager said it was fine" can be checked afterwards
// rather than taken on trust.

import bcrypt from "bcryptjs";
import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";

/** Discounts above this need a manager. Below it, the cashier's own judgement. */
export const DISCOUNT_APPROVAL_PCT = 10;

/** Roles whose PIN can authorise something. */
const APPROVER_ROLES = [ROLES.BRANCH_ADMIN, ROLES.ADMIN, ROLES.SUPER_ADMIN];

/**
 * Check a PIN against the managers of this property.
 *
 * Returns the approving user, or null. Deliberately does not say *which*
 * manager's PIN was wrong — that would let a cashier test PINs one manager at
 * a time.
 */
export async function findApprover(pin, b_id) {
  const raw = String(pin ?? "").trim();
  if (!raw) return null;

  const { rows } = await pool.query(
    `SELECT u.u_id, u.u_fname, u.u_lname, u.u_approval_pin
     FROM "User" u
     WHERE u.u_approval_pin IS NOT NULL
       AND u.u_status IS NOT FALSE
       AND u.role_id = ANY($1::int[])
       AND (u."B_id" = $2 OR u.role_id = $3)`,
    [APPROVER_ROLES, Number(b_id), ROLES.SUPER_ADMIN]
  );

  for (const u of rows) {
    // Every candidate is compared, so the time taken does not reveal how many
    // managers exist or which one matched.
    if (await bcrypt.compare(raw, u.u_approval_pin)) {
      return { u_id: u.u_id, name: `${u.u_fname ?? ""} ${u.u_lname ?? ""}`.trim() };
    }
  }
  return null;
}

/**
 * Does this action need a manager, and did it get one?
 *
 * A manager doing it themselves needs no second signature — they already are
 * the approval. Anyone else must present a PIN.
 *
 * @returns {Promise<{ok:true, approver:object|null} | {ok:false, status:number, message:string}>}
 */
export async function requireApproval(req, { pin, b_id, what }) {
  const role = Number(req.user?.role_id);
  if (APPROVER_ROLES.includes(role)) {
    return { ok: true, approver: { u_id: req.user.u_id, name: "self" } };
  }

  if (!pin) {
    return {
      ok: false, status: 403,
      message: `A manager's approval PIN is required to ${what}.`,
    };
  }

  const approver = await findApprover(pin, b_id);
  if (!approver) {
    return { ok: false, status: 403, message: "That approval PIN was not recognised." };
  }
  return { ok: true, approver };
}

/** Hash a new PIN. Four digits minimum, and never stored in the clear. */
export async function hashApprovalPin(pin) {
  const raw = String(pin ?? "").trim();
  if (!/^\d{4,8}$/.test(raw)) {
    throw Object.assign(new Error("An approval PIN must be 4 to 8 digits."), { status: 400 });
  }
  return bcrypt.hash(raw, 10);
}
