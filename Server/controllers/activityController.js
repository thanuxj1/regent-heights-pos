import pool from "../config/database.js";
import { branchClause, writeBranchId } from "../utils/scope.js";
import { pruneActivityLog, retentionMonths } from "../utils/activityRetention.js";

/**
 * GET /api/activity?b_id=&action=&entity=&u_id=&from=&to=&search=&limit=&cursor=
 * The feed. Keyset-paginated on log_id so it stays fast as the table grows.
 */
export async function getActivity(req, res, next) {
  try {
    const { action, entity, u_id, from, to, search, cursor } = req.query;
    const limit = Math.min(Number(req.query.limit) || 60, 200);

    const params = [];
    const clauses = [];

    const scope = branchClause(req, "b_id", params);
    if (scope) clauses.push(scope);
    if (action) { params.push(action);       clauses.push(`action = $${params.length}`); }
    if (entity) { params.push(entity);       clauses.push(`entity = $${params.length}`); }
    if (u_id)   { params.push(Number(u_id)); clauses.push(`u_id = $${params.length}`); }
    if (from)   { params.push(from);         clauses.push(`created_at >= $${params.length}::date`); }
    if (to)     { params.push(to);           clauses.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`); }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      clauses.push(`(summary ILIKE $${params.length} OR actor_name ILIKE $${params.length})`);
    }
    if (cursor) { params.push(Number(cursor)); clauses.push(`log_id < $${params.length}`); }

    params.push(limit);

    const { rows } = await pool.query(
      `SELECT * FROM "ACTIVITY_LOG"
       ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""}
       ORDER BY log_id DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({
      entries: rows,
      next_cursor: rows.length === limit ? rows[rows.length - 1].log_id : null,
    });
  } catch (err) { next(err); }
}

/** GET /api/activity/summary?b_id=&days= — counts for the filter chips */
export async function getActivitySummary(req, res, next) {
  try {
    const days = Math.min(Number(req.query.days) || 7, 365);
    const params = [days];
    let branch = "";
    const scope = branchClause(req, "b_id", params);
    if (scope) branch = "AND " + scope;

    const [byAction, byUser, total] = await Promise.all([
      pool.query(
        `SELECT action, COUNT(*) AS n FROM "ACTIVITY_LOG"
         WHERE created_at > NOW() - ($1 || ' days')::INTERVAL ${branch}
         GROUP BY action ORDER BY n DESC`, params
      ),
      pool.query(
        `SELECT u_id, actor_name, COUNT(*) AS n FROM "ACTIVITY_LOG"
         WHERE created_at > NOW() - ($1 || ' days')::INTERVAL ${branch}
         GROUP BY u_id, actor_name ORDER BY n DESC LIMIT 10`, params
      ),
      pool.query(
        `SELECT COUNT(*) AS n FROM "ACTIVITY_LOG"
         WHERE created_at > NOW() - ($1 || ' days')::INTERVAL ${branch}`, params
      ),
    ]);

    res.json({
      days,
      total: Number(total.rows[0].n),
      by_action: byAction.rows,
      by_user: byUser.rows,
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/activity/retention — how long the trail is kept, and how much of it
 * is currently past that line. Read-only; the owner should be able to see the
 * policy without having to trust that a timer is running.
 */
export async function getRetention(req, res, next) {
  try {
    const months = retentionMonths();
    const { rows: [stat] } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              MIN(created_at) AS oldest,
              COUNT(*) FILTER (
                WHERE $1::int > 0 AND created_at < NOW() - ($1 || ' months')::INTERVAL
              )::int AS past_retention
       FROM "ACTIVITY_LOG"`,
      [months]
    );
    res.json({
      retention_months: months,
      keeps_everything: months === 0,
      total_entries: stat.total,
      oldest_entry: stat.oldest,
      past_retention: stat.past_retention,
    });
  } catch (err) { next(err); }
}

/**
 * POST /api/activity/retention/prune — run the trim now. Owner only: this
 * removes history, so it is not something a till should be able to trigger.
 * Pass { dry_run: true } to see what would go without touching anything.
 */
export async function runPrune(req, res, next) {
  try {
    const result = await pruneActivityLog({ dryRun: req.body?.dry_run === true });
    res.json(result);
  } catch (err) { next(err); }
}
