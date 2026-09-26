import pool from "../config/database.js";
import { ROLES, CAPABILITY_LIST, invalidateUserCapabilities } from "../middleware/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";
import { invalid } from "../utils/validate.js";

const VALID_KEYS = new Set(CAPABILITY_LIST.map((c) => c.key));

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
    `SELECT u_id, u_fname, u_lname FROM "User" WHERE u_id = $1 ${branchFilter}`,
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
    res.json({ u_id: Number(id), capabilities: rows.map((r) => r.capability) });
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

    const user = await findTargetUser(req, id);
    if (!user) { res.status(404); throw new Error("User not found"); }

    const before = await pool.query(`SELECT capability FROM "USER_CAPABILITY" WHERE u_id = $1`, [id]);
    const beforeSet = new Set(before.rows.map((r) => r.capability));
    const afterSet = new Set(requested);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
