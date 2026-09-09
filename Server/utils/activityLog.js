import pool from "../config/database.js";

/**
 * Append one line to the audit trail.
 *
 * Deliberately fire-and-forget and never throws: an audit write must not be able
 * to fail a check-in or a sale. If logging breaks we lose a line, not the order.
 *
 * @param {object} req     Express request — the actor is read from req.user
 * @param {object} entry   { action, entity, entity_id, summary, details }
 */
export function logActivity(req, entry) {
  const u = req?.user || {};
  const actor = [u.u_fname, u.u_lname].filter(Boolean).join(" ") || u.u_email || null;

  const ip =
    req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req?.socket?.remoteAddress ||
    null;

  pool
    .query(
      `INSERT INTO "ACTIVITY_LOG"
         (u_id, actor_name, role_id, b_id, action, entity, entity_id, summary, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [
        u.u_id ?? null,
        actor,
        u.role_id ?? null,
        entry.b_id ?? u.b_id ?? null,
        entry.action,
        entry.entity,
        entry.entity_id != null ? String(entry.entity_id) : null,
        entry.summary,
        entry.details ? JSON.stringify(entry.details) : null,
        ip,
      ]
    )
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[activity] could not write log entry:", err.message);
    });
}

/**
 * Same, but for the login route where req.user isn't populated yet.
 */
export function logAuthActivity({ user, req, action, summary }) {
  const actor = [user?.u_fname, user?.u_lname].filter(Boolean).join(" ") || user?.u_email || null;
  const ip =
    req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req?.socket?.remoteAddress ||
    null;

  pool
    .query(
      `INSERT INTO "ACTIVITY_LOG"
         (u_id, actor_name, role_id, b_id, action, entity, entity_id, summary, ip_address)
       VALUES ($1,$2,$3,$4,$5,'auth',$6,$7,$8)`,
      [
        user?.u_id ?? null,
        actor,
        user?.role_id ?? null,
        user?.B_id ?? user?.b_id ?? null,
        action,
        user?.u_id != null ? String(user.u_id) : null,
        summary,
        ip,
      ]
    )
    .catch(() => {});
}

/**
 * Record a sign-in that did not succeed.
 *
 * The email is looked up so that a failure against a real staff account lands in
 * that hotel's feed, where the owner will actually see it. An unknown address
 * belongs to no branch, so it stays visible only to the super admin rather than
 * leaking one tenant's noise into another's log.
 *
 * Never throws, and never reveals whether the account exists.
 */
export function logFailedLogin({ req, email, action = "login_failed", summary }) {
  const ip =
    req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req?.socket?.remoteAddress ||
    null;
  const addr = (email || "").trim().toLowerCase();

  pool
    .query(
      `INSERT INTO "ACTIVITY_LOG"
         (u_id, actor_name, role_id, b_id, action, entity, entity_id, summary, details, ip_address)
       SELECT u.u_id,
              COALESCE(NULLIF(TRIM(CONCAT(u.u_fname, ' ', u.u_lname)), ''), $1),
              u.role_id, u."B_id", $2, 'auth',
              CASE WHEN u.u_id IS NULL THEN NULL ELSE u.u_id::text END,
              $3, $4::jsonb, $5
       FROM (SELECT $1::text AS e) q
       LEFT JOIN "User" u ON LOWER(u.u_email) = q.e`,
      [addr || "(no address given)", action, summary, JSON.stringify({ email: addr || null }), ip]
    )
    .catch(() => {});
}
