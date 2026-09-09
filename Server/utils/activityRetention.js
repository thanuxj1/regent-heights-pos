// utils/activityRetention.js
//
// ACTIVITY_LOG is append-only and had nothing trimming it, so it grew forever —
// slowly (about 1 kB an entry), but with no ceiling at all.
//
// Two rules make trimming an audit trail acceptable:
//
//   1. It never touches the records that matter financially. Bookings, folios,
//      payments and commission live in their own tables and are not pruned here.
//      This is the "who pressed what" trail, not the money.
//   2. It writes down what it removed. A trail that quietly loses entries is
//      worse than one that says "1,204 entries older than 24 months were removed
//      on this date" — the gap is then explained rather than mysterious.

import pool from "../config/database.js";

/** Two years is far past any operational need for "who checked this guest in". */
export const DEFAULT_RETENTION_MONTHS = 24;

/** Deleted in batches so a long-running DELETE never sits on the table. */
const BATCH = 5000;

export function retentionMonths() {
  const raw = process.env.ACTIVITY_RETENTION_MONTHS;
  if (raw === undefined || raw === "") return DEFAULT_RETENTION_MONTHS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_MONTHS;
  return Math.floor(n);            // 0 means keep everything, forever
}

/**
 * Remove entries older than the retention window.
 *
 * @param {object}  opts
 * @param {number}  opts.months   override the configured window
 * @param {boolean} opts.dryRun   count what would go, delete nothing
 * @returns {Promise<{removed:number, months:number, oldestRemoved:string|null, skipped?:string}>}
 */
export async function pruneActivityLog({ months, dryRun = false } = {}) {
  const keep = months ?? retentionMonths();
  if (!keep) return { removed: 0, months: 0, oldestRemoved: null, skipped: "retention disabled" };

  const cutoffSql = `NOW() - ($1 || ' months')::INTERVAL`;

  const { rows: [pending] } = await pool.query(
    `SELECT COUNT(*)::int AS n, MIN(created_at) AS oldest
     FROM "ACTIVITY_LOG" WHERE created_at < ${cutoffSql}`,
    [String(keep)]
  );
  if (!pending.n) return { removed: 0, months: keep, oldestRemoved: null };
  if (dryRun) {
    return { removed: pending.n, months: keep, oldestRemoved: pending.oldest, skipped: "dry run" };
  }

  let removed = 0;
  // ctid keeps each batch cheap; the created_at index finds the candidates.
  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM "ACTIVITY_LOG" WHERE ctid IN (
         SELECT ctid FROM "ACTIVITY_LOG" WHERE created_at < ${cutoffSql} LIMIT ${BATCH}
       )`,
      [String(keep)]
    );
    removed += rowCount;
    if (rowCount < BATCH) break;
  }

  // The trail records its own trimming, so the gap is explained.
  if (removed > 0) {
    await pool.query(
      `INSERT INTO "ACTIVITY_LOG" (actor_name, action, entity, summary, details)
       VALUES ('System', 'prune', 'activity_log', $1, $2::jsonb)`,
      [
        `Removed ${removed} activity entries older than ${keep} months`,
        JSON.stringify({ removed, retention_months: keep, oldest_removed: pending.oldest }),
      ]
    ).catch(() => { /* the prune succeeded; losing its note must not fail it */ });
  }

  return { removed, months: keep, oldestRemoved: pending.oldest };
}

/**
 * Run once shortly after boot, then daily. Deliberately not on every request:
 * this is housekeeping, and it must never sit in a guest's way.
 */
export function scheduleActivityPrune() {
  const keep = retentionMonths();
  if (!keep) {
    console.log("[activity] retention disabled — the log will grow without limit");
    return;
  }
  console.log(`[activity] retention ${keep} months; pruning daily`);

  const run = () =>
    pruneActivityLog()
      .then((r) => { if (r.removed) console.log(`[activity] pruned ${r.removed} entries older than ${r.months} months`); })
      .catch((e) => console.error("[activity] prune failed:", e.message));

  setTimeout(run, 60_000).unref?.();                  // a minute after boot
  setInterval(run, 24 * 60 * 60 * 1000).unref?.();    // and once a day
}
