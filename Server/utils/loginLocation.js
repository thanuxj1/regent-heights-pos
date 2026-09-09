// utils/loginLocation.js
//
// Whether an account may sign in from where it is signing in from.
//
// The point is not to stop a determined insider — they can walk into the lobby
// and use the guest wifi. It is to remove the easy, unsupervised path: signing
// in from home at midnight to void yesterday's sales.
//
// Everything here fails OPEN by design. A misconfigured fence that locks the
// front desk out mid-service is a worse outage than the fraud it prevents, so
// no rules means no restriction, and managers are never fenced at all.

import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";

/** Roles that must always be able to get in, from anywhere. */
const NEVER_FENCED = [ROLES.BRANCH_ADMIN, ROLES.ADMIN, ROLES.SUPER_ADMIN];

/**
 * The caller's address as the server sees it.
 *
 * Behind a proxy this is only trustworthy when TRUST_PROXY is set — Express then
 * takes the left-most X-Forwarded-For entry. Without it, req.ip is the socket
 * address, which cannot be forged.
 */
export function callerIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || "";
  // ::ffff:203.0.113.7 is an IPv4 address wearing an IPv6 coat.
  return raw.replace(/^::ffff:/, "");
}

/**
 * May this user sign in from here?
 *
 * @returns {Promise<{allowed:boolean, reason?:string, ip:string}>}
 */
export async function loginAllowedFrom(req, user) {
  const ip = callerIp(req);
  const role = Number(user?.role_id);

  if (NEVER_FENCED.includes(role)) return { allowed: true, ip };

  const b_id = user?.B_id ?? user?.b_id ?? null;
  if (!b_id) return { allowed: true, ip };          // no property, nothing to fence

  let rules;
  try {
    const { rows } = await pool.query(
      `SELECT cidr, label FROM "LOGIN_LOCATION" WHERE b_id = $1 AND is_active`,
      [Number(b_id)]
    );
    rules = rows;
  } catch (err) {
    // The fence must never be the reason nobody can work.
    console.error("[login-location] check failed, allowing:", err.message);
    return { allowed: true, ip };
  }

  if (!rules.length) return { allowed: true, ip };   // opt-in: no rules, no fence

  // Localhost is always fine: it is the machine itself, and blocking it would
  // make the system impossible to set up or support.
  if (ip === "127.0.0.1" || ip === "::1" || ip === "") return { allowed: true, ip };

  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM "LOGIN_LOCATION"
       WHERE b_id = $1 AND is_active AND $2::inet <<= cidr LIMIT 1`,
      [Number(b_id), ip]
    );
    if (rows.length) return { allowed: true, ip };
  } catch (err) {
    console.error("[login-location] comparison failed, allowing:", err.message);
    return { allowed: true, ip };
  }

  return {
    allowed: false,
    ip,
    reason: "This account can only be used from the property. Please sign in from a hotel device.",
  };
}
