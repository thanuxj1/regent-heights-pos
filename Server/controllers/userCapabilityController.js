import pool from "../config/database.js";
import {
  ROLES, CAPABILITY_LIST, invalidateUserCapabilities,
  DEFAULT_PERMISSION_LIST, invalidateUserDefaultRevocations, grantsApply,
} from "../middleware/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";
import { invalid } from "../utils/validate.js";

const VALID_KEYS = new Set(CAPABILITY_LIST.map((c) => c.key));
const VALID_DEFAULT_KEYS = new Set(DEFAULT_PERMISSION_LIST.map((d) => d.key));

function getScopedBranchId(req) {
  return req.user?.role_id === ROLES.BRANCH_ADMIN ? req.user?.b_id : null;
}

async function findTargetUser(req, id) {
  const scopedBranchId = getScopedBranchId(req);
  const params = [id];
  let branchFilter = "";
  if (scopedBranchId) {
    params.push(Number(scopedBranchId));
    branchFilter = `AND "B_id" = $2`;
  }
  const { rows } = await pool.query(
    `SELECT u_id, u_fname, u_lname, role_id FROM "User" WHERE u_id = $1 ${branchFilter}`,
    params,
  );
  return rows[0] || null;
}

// GET /api/capabilities — the fixed catalog, so the frontend never hardcodes it.
// Capabilities marked `hidden` have no frontend surface yet (granting them
// does nothing) — left out so the toggle list can't mislead an admin.
export function getCapabilityCatalog(req, res) {
  res.json(CAPABILITY_LIST.filter((c) => !c.hidden));
}

// GET /api/users/:id/capabilities
export async function getUserCapabilities(req, res, next) {
  try {
    const { id } = req.params;
    const user = await findTargetUser(req, id);
    if (!user) { res.status(404); throw new Error("User not found"); }

    const { rows } = await pool.query(
      `SELECT capability FROM "USER_CAPABILITY" WHERE u_id = $1`,
      [id],
    );
    // Say only what the server will honour, so the screens never offer a page the
    // server would then refuse (grants apply to Cashier accounts only).
    const applies = grantsApply(user.role_id);
    res.json({ u_id: Number(id), capabilities: applies ? rows.map((r) => r.capability) : [] });
  } catch (err) { next(err); }
}

// PUT /api/users/:id/capabilities — replaces the full grant set for this user.
export async function setUserCapabilities(req, res, next) {
  try {
    const { id } = req.params;
    const requested = Array.isArray(req.body?.capabilities) ? req.body.capabilities : null;
    if (!requested) invalid("capabilities must be an array of capability keys.");
    const bad = requested.filter((k) => !VALID_KEYS.has(k));
    if (bad.length) invalid(`Unknown capability key(s): ${bad.join(", ")}`);
    // A hidden capability has no working page behind it — granting it would show
    // an admin a switch that does nothing.
    const hiddenKeys = requested.filter((k) => CAPABILITY_LIST.find((c) => c.key === k)?.hidden);
    if (hiddenKeys.length) invalid(`${hiddenKeys.join(", ")} cannot be granted.`);

    const user = await findTargetUser(req, id);
    if (!user) { res.status(404); throw new Error("User not found"); }
    // Removing everything is always allowed (it is how an old grant is cleaned up).
    if (requested.length && !grantsApply(user.role_id)) {
      invalid("Extra permissions can only be given to Cashier accounts. Change this person's role to Cashier first.");
    }

    const before = await pool.query(`SELECT capability FROM "USER_CAPABILITY" WHERE u_id = $1`, [id]);
    const beforeSet = new Set(before.rows.map((r) => r.capability));
    const afterSet = new Set(requested);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // This is a full replace (delete everything, insert the requested set) —
      // without a lock here, two admins saving the same user's page around the
      // same moment don't serialize: each one's DELETE only ever sees what was
      // committed before IT started, so neither sees the other's still-pending
      // INSERTs. Both deletes can find nothing to remove and both inserts land,
      // leaving a merge of the two edits rather than the second admin's save
      // cleanly overwriting the first's — confirmed by actually racing two
      // concurrent saves against this endpoint. Locking the target row first
      // makes the second writer wait for the first to finish, so it deletes
      // what the first one just committed and truly replaces it.
      await client.query(`SELECT u_id FROM "User" WHERE u_id = $1 FOR UPDATE`, [id]);
      await client.query(`DELETE FROM "USER_CAPABILITY" WHERE u_id = $1`, [id]);
      for (const key of afterSet) {
        await client.query(
          `INSERT INTO "USER_CAPABILITY" (u_id, capability, granted_by) VALUES ($1, $2, $3)`,
          [id, key, req.user?.u_id ?? null],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    invalidateUserCapabilities(id);

    const added = [...afterSet].filter((k) => !beforeSet.has(k));
    const removed = [...beforeSet].filter((k) => !afterSet.has(k));
    const label = (key) => CAPABILITY_LIST.find((c) => c.key === key)?.label || key;
    const changeParts = [];
    if (added.length) changeParts.push(`granted ${added.map(label).join(", ")}`);
    if (removed.length) changeParts.push(`revoked ${removed.map(label).join(", ")}`);

    logActivity(req, {
      action: "update",
      entity: "user_capabilities",
      entity_id: Number(id),
      b_id: getScopedBranchId(req) || undefined,
      summary: changeParts.length
        ? `${changeParts.join("; ")} for ${user.u_fname} ${user.u_lname}`
        : `No permission changes for ${user.u_fname} ${user.u_lname}`,
      details: { capabilities: [...afterSet], added, removed },
    });

    res.json({ u_id: Number(id), capabilities: [...afterSet] });
  } catch (err) { next(err); }
}

// GET /api/default-permissions — the fixed catalog of revocable defaults,
// same shape/purpose as getCapabilityCatalog above but for the other
// direction (switching a role's normal access off for one account).
export function getDefaultPermissionCatalog(req, res) {
  res.json(DEFAULT_PERMISSION_LIST);
}

// GET /api/users/:id/default-permissions — which of this user's own-role
// defaults have been switched off. Absent from the response = still on.
export async function getUserDefaultRevocations(req, res, next) {
  try {
    const { id } = req.params;
    const user = await findTargetUser(req, id);
    if (!user) { res.status(404); throw new Error("User not found"); }

    const { rows } = await pool.query(
      `SELECT default_key FROM "USER_DEFAULT_OVERRIDE" WHERE u_id = $1`,
      [id],
    );
    res.json({ u_id: Number(id), revoked: rows.map((r) => r.default_key) });
  } catch (err) { next(err); }
}

// PUT /api/users/:id/default-permissions — replaces the full revoked set for
// this user. Only keys naming that user's OWN role are accepted — revoking a
// Waiter's own default on a Cashier account would do nothing (the guard that
// reads it only ever fires for the role the key names) and would just be
// confusing to have sitting there switched off with no effect.
export async function setUserDefaultRevocations(req, res, next) {
  try {
    const { id } = req.params;
    const requested = Array.isArray(req.body?.revoked) ? req.body.revoked : null;
    if (!requested) invalid("revoked must be an array of default-permission keys.");
    const bad = requested.filter((k) => !VALID_DEFAULT_KEYS.has(k));
    if (bad.length) invalid(`Unknown default-permission key(s): ${bad.join(", ")}`);

    const user = await findTargetUser(req, id);
    if (!user) { res.status(404); throw new Error("User not found"); }

    const userRow = await pool.query(`SELECT role_id FROM "User" WHERE u_id = $1`, [id]);
    const roleId = Number(userRow.rows[0]?.role_id);
    const offRole = requested.filter((k) => {
      const perm = DEFAULT_PERMISSION_LIST.find((d) => d.key === k);
      return perm && perm.role !== roleId;
    });
    if (offRole.length) {
      const label = (key) => DEFAULT_PERMISSION_LIST.find((d) => d.key === key)?.label || key;
      invalid(`${offRole.map(label).join(", ")} doesn't apply to this account's role.`);
    }

    const before = await pool.query(`SELECT default_key FROM "USER_DEFAULT_OVERRIDE" WHERE u_id = $1`, [id]);
    const beforeSet = new Set(before.rows.map((r) => r.default_key));
    const afterSet = new Set(requested);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Same race as setUserCapabilities above — lock the row first so a
      // second admin saving this same user's page waits for the first
      // instead of the two full-replace writes merging together.
      await client.query(`SELECT u_id FROM "User" WHERE u_id = $1 FOR UPDATE`, [id]);
      await client.query(`DELETE FROM "USER_DEFAULT_OVERRIDE" WHERE u_id = $1`, [id]);
      for (const key of afterSet) {
        await client.query(
          `INSERT INTO "USER_DEFAULT_OVERRIDE" (u_id, default_key, revoked_by) VALUES ($1, $2, $3)`,
          [id, key, req.user?.u_id ?? null],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    invalidateUserDefaultRevocations(id);

    const turnedOff = [...afterSet].filter((k) => !beforeSet.has(k));
    const turnedOn = [...beforeSet].filter((k) => !afterSet.has(k));
    const label = (key) => DEFAULT_PERMISSION_LIST.find((d) => d.key === key)?.label || key;
    const changeParts = [];
    if (turnedOff.length) changeParts.push(`switched off ${turnedOff.map(label).join(", ")}`);
    if (turnedOn.length) changeParts.push(`restored ${turnedOn.map(label).join(", ")}`);

    logActivity(req, {
      action: "update",
      entity: "user_default_permissions",
      entity_id: Number(id),
      b_id: getScopedBranchId(req) || undefined,
      summary: changeParts.length
        ? `${changeParts.join("; ")} for ${user.u_fname} ${user.u_lname}`
        : `No default-permission changes for ${user.u_fname} ${user.u_lname}`,
      details: { revoked: [...afterSet], turnedOff, turnedOn },
    });

    res.json({ u_id: Number(id), revoked: [...afterSet] });
  } catch (err) { next(err); }
}
