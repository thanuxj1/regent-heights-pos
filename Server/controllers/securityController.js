// controllers/securityController.js
//
// The owner's controls: which addresses staff may sign in from, and the PIN a
// manager types to approve a void or a large discount.

import pool from "../config/database.js";
import { logActivity } from "../utils/activityLog.js";
import { writeBranchId } from "../utils/scope.js";
import { callerIp } from "../utils/loginLocation.js";
import { hashApprovalPin, DISCOUNT_APPROVAL_PCT } from "../utils/approval.js";
import { textField } from "../utils/validate.js";

/** GET /api/security/login-locations */
export async function getLoginLocations(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    if (!b_id) { res.status(400); return next(new Error("No property on this account")); }
    const { rows } = await pool.query(
      `SELECT l.location_id, host(l.cidr) AS address, text(l.cidr) AS cidr, l.label,
              l.is_active, l.created_at, u.u_fname || ' ' || u.u_lname AS added_by
       FROM "LOGIN_LOCATION" l
       LEFT JOIN "User" u ON u.u_id = l.created_by
       WHERE l.b_id = $1 ORDER BY l.location_id`,
      [b_id]
    );
    res.json({
      your_current_address: callerIp(req),
      // Said plainly, because the consequence of getting this wrong is a locked-out desk.
      enforced: rows.some((r) => r.is_active),
      note: rows.some((r) => r.is_active)
        ? "Cashiers, waiters and kitchen staff can only sign in from these addresses. You are never restricted."
        : "No restriction is active — staff can sign in from anywhere. Add an address to switch it on.",
      locations: rows,
    });
  } catch (err) { next(err); }
}

/** POST /api/security/login-locations  { address, label } */
export async function addLoginLocation(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    if (!b_id) { res.status(400); return next(new Error("No property on this account")); }

    // "here" is the safe way to switch this on: you cannot fence yourself out
    // of an address you are demonstrably sitting at.
    const raw = String(req.body?.address ?? "").trim();
    const address = raw === "" || raw.toLowerCase() === "here" ? callerIp(req) : raw;
    const label = textField(req.body?.label, "Label", 80, { required: true });

    if (!address) { res.status(400); return next(new Error("Could not work out an address to allow.")); }

    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO "LOGIN_LOCATION" (b_id, cidr, label, created_by)
         VALUES ($1, $2::cidr, $3, $4)
         ON CONFLICT (b_id, cidr) DO UPDATE SET label = EXCLUDED.label, is_active = TRUE
         RETURNING location_id, host(cidr) AS address, text(cidr) AS cidr, label, is_active`,
        [b_id, address, label, req.user?.u_id ?? null]
      ));
    } catch (err) {
      if (err.code === "22P02") {                       // not an address or range
        res.status(400);
        return next(new Error(`"${address}" is not an address or range. Try 203.0.113.7 or 203.0.113.0/24.`));
      }
      throw err;
    }

    logActivity(req, {
      action: "create", entity: "login_location", entity_id: rows[0].location_id, b_id,
      summary: `Allowed staff sign-in from ${rows[0].cidr} (${label})`,
    });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

/** PUT /api/security/login-locations/:id  { is_active } */
export async function setLoginLocationActive(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    const active = req.body?.is_active !== false;
    const { rows } = await pool.query(
      `UPDATE "LOGIN_LOCATION" SET is_active = $3
       WHERE location_id = $1 AND b_id = $2
       RETURNING location_id, text(cidr) AS cidr, label, is_active`,
      [Number(req.params.id), b_id, active]
    );
    if (!rows.length) { res.status(404); return next(new Error("Not found")); }
    logActivity(req, {
      action: "update", entity: "login_location", entity_id: rows[0].location_id, b_id,
      summary: `${active ? "Enabled" : "Disabled"} sign-in from ${rows[0].cidr} (${rows[0].label})`,
    });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

/** DELETE /api/security/login-locations/:id */
export async function removeLoginLocation(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    const { rows } = await pool.query(
      `DELETE FROM "LOGIN_LOCATION" WHERE location_id = $1 AND b_id = $2
       RETURNING location_id, text(cidr) AS cidr, label`,
      [Number(req.params.id), b_id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Not found")); }
    logActivity(req, {
      action: "delete", entity: "login_location", entity_id: rows[0].location_id, b_id,
      summary: `Removed allowed sign-in address ${rows[0].cidr} (${rows[0].label})`,
    });
    res.status(204).send();
  } catch (err) { next(err); }
}

/** PUT /api/security/approval-pin  { pin } — sets the caller's own PIN. */
export async function setApprovalPin(req, res, next) {
  try {
    const hash = await hashApprovalPin(req.body?.pin);
    await pool.query('UPDATE "User" SET u_approval_pin = $1 WHERE u_id = $2',
      [hash, req.user.u_id]);
    // The PIN itself is never logged, only that one was set.
    logActivity(req, {
      action: "update", entity: "user", entity_id: req.user.u_id,
      summary: "Set their manager approval PIN",
    });
    res.json({ success: true, message: "Approval PIN saved." });
  } catch (err) { next(err); }
}

/** DELETE /api/security/approval-pin — the caller can no longer approve. */
export async function clearApprovalPin(req, res, next) {
  try {
    await pool.query('UPDATE "User" SET u_approval_pin = NULL WHERE u_id = $1', [req.user.u_id]);
    logActivity(req, {
      action: "update", entity: "user", entity_id: req.user.u_id,
      summary: "Removed their manager approval PIN",
    });
    res.json({ success: true, message: "Approval PIN removed." });
  } catch (err) { next(err); }
}

/** GET /api/security/overview — what is switched on, for the owner. */
export async function getSecurityOverview(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    const [{ rows: locs }, { rows: pins }] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int n FROM "LOGIN_LOCATION" WHERE b_id=$1 AND is_active`, [b_id]),
      pool.query(
        `SELECT COUNT(*)::int n FROM "User"
         WHERE "B_id"=$1 AND u_approval_pin IS NOT NULL AND u_status IS NOT FALSE`, [b_id]),
    ]);
    res.json({
      login_locations_active: locs[0].n,
      staff_restricted_to_property: locs[0].n > 0,
      managers_who_can_approve: pins[0].n,
      discount_needs_approval_above_pct: DISCOUNT_APPROVAL_PCT,
      your_current_address: callerIp(req),
    });
  } catch (err) { next(err); }
}
