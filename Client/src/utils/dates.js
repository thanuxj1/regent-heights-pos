/**
 * Calendar days, read the way the hotel reads them.
 *
 * Two mistakes were everywhere. `date.toISOString().slice(0, 10)` gives the UTC
 * date, so between midnight and 05:30 in Sri Lanka it is still "yesterday". And a
 * DATE column reaches the browser as a timestamp ("2026-09-20T18:30:00.000Z" is
 * the 21st in Kandy), so `.slice(0, 10)` on it names the day before. Every chart
 * that grouped by day was a day out, and an expense saved on the 21st was shown —
 * and, once edited, saved — as the 20th.
 *
 * These read a timestamp in the local calendar, which is the hotel's.
 */

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for a Date, a timestamp, or a plain date string; "" if it is none of those. */
export function dayKey(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM" of the same. */
export const monthKey = (value) => dayKey(value).slice(0, 7);

/** Today, by the clock on this machine. Call it when you need it: a module-level constant goes stale overnight. */
export const todayKey = () => dayKey(new Date());

/** A day some number of days from today. */
export const dayOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dayKey(d);
};
