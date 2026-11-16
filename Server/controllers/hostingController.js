import pool from "../config/database.js";
import { hotelToday } from "../utils/hotelTime.js";
import { logActivity } from "../utils/activityLog.js";

// When the shop starts being told. Two months out, again at one month, then
// every day of the last month, and every day after if it runs out.
export const WARN_DAYS = 60;
export const DAILY_DAYS = 30;

const dayText = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export function hostingState(paidUntil, today = hotelToday()) {
  const paid_until = dayText(paidUntil);
  const days_left = daysBetween(today, paid_until);
  let stage = "ok";
  if (days_left < 0) stage = "expired";
  else if (days_left <= DAILY_DAYS) stage = "daily";
  else if (days_left <= WARN_DAYS) stage = "two_months";
  return { paid_until, today, days_left, stage };
}

async function readPlan() {
  const { rows } = await pool.query("SELECT paid_until::text AS paid_until, updated_at FROM hosting_plan WHERE id = 1");
  return rows[0] || null;
}

// GET /api/hosting — every signed-in screen asks; it is only a date.
export async function getHosting(req, res, next) {
  try {
    const plan = await readPlan();
    if (!plan) return res.json({ stage: "ok", paid_until: null, days_left: null });
    return res.json({ ...hostingState(plan.paid_until), updated_at: plan.updated_at });
  } catch (err) { return next(err); }
}

// POST /api/hosting/paid — Super Admin: one more year, counted on from the
// date it was paid up to, so paying early or late never moves the anniversary.
// { paid_until: "YYYY-MM-DD" } sets the date outright, to put a mistake right.
export async function markHostingPaid(req, res, next) {
  try {
    const asked = req.body?.paid_until;
    let sql, params;
    if (asked != null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asked)) || Number.isNaN(Date.parse(asked))) {
        return res.status(400).json({ message: "Give the date as YYYY-MM-DD." });
      }
      sql = `INSERT INTO hosting_plan (id, paid_until, updated_at, updated_by) VALUES (1, $1, NOW(), $2)
             ON CONFLICT (id) DO UPDATE SET paid_until = EXCLUDED.paid_until, updated_at = NOW(), updated_by = EXCLUDED.updated_by
             RETURNING paid_until::text AS paid_until`;
      params = [asked, req.user.u_id];
    } else {
      sql = `UPDATE hosting_plan SET paid_until = (paid_until + INTERVAL '12 months')::date, updated_at = NOW(), updated_by = $1
             WHERE id = 1 RETURNING paid_until::text AS paid_until`;
      params = [req.user.u_id];
    }
    const before = await readPlan();
    const { rows } = await pool.query(sql, params);
    if (!rows.length) return res.status(404).json({ message: "No hosting date is set yet." });
    const state = hostingState(rows[0].paid_until);
    logActivity(req, {
      action: "hosting_paid", entity: "hosting", entity_id: 1,
      summary: `Hosting paid up to ${state.paid_until}`,
      details: { from: before ? dayText(before.paid_until) : null, to: state.paid_until },
    });
    return res.json(state);
  } catch (err) { return next(err); }
}
