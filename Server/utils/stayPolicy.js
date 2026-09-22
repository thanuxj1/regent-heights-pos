// utils/stayPolicy.js
//
// House rules for a stay: when the guest may arrive, when they must leave, and
// what a late departure costs. Kept pure so the front desk can be shown the fee
// before check-out and charged exactly the same number a moment later.

export const POLICY_DEFAULTS = {
  check_in_time: "14:00",
  check_out_time: "11:00",
  late_grace_minutes: 60,
  late_mode: "hourly",
  late_hourly_pct: 25,
  late_flat_amount: 0,
  late_full_night_after: 6,
  cancel_free_hours: 48,
  cancel_charge_nights: 1,
  // No tax is added to a booking until the hotel sets a rate.
  default_tax_pct: 0,
};

/**
 * Wording the owner can drop into their terms with one click. It is a suggestion
 * only: nothing here is printed on a confirmation unless the owner keeps it, so a
 * hotel is never made to say something it did not write.
 */
export const SUGGESTED_TERMS =
  "Please present a printed copy of this confirmation voucher along with a valid ID card or Passport upon arrival.\n"
  + "All rates are inclusive of local service fees and government taxes unless indicated otherwise.";

/** The owner's terms as a list of lines, blanks dropped. */
export const termsLines = (text) =>
  String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The cancellation terms as one sentence, so the voucher and the WhatsApp
 *  message can never drift apart. */
export function cancellationLine(policy = {}) {
  const hours  = Number(policy.cancel_free_hours ?? POLICY_DEFAULTS.cancel_free_hours);
  const nights = Number(policy.cancel_charge_nights ?? POLICY_DEFAULTS.cancel_charge_nights);
  if (!hours && !nights) return "Cancellation terms: please ask the front desk.";
  const free = hours
    ? `Free cancellation up to ${hours} hour${hours === 1 ? "" : "s"} before arrival`
    : "Cancellations are accepted at any time";
  const charge = nights
    ? `; otherwise a ${nights} night stay charge applies.`
    : "; no cancellation charge applies.";
  return free + charge;
}

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** "14:00" / "14:00:00" -> "2:00 PM", for anything a guest reads. */
export function prettyTime(t) {
  const [hRaw, m = "00"] = String(t || "").split(":");
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return String(t || "");
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** The moment the guest was due out: their check-out date at the house time. */
export function dueOutAt(checkOutDate, checkOutTime) {
  // Read back with local getters, not .toISOString() (UTC). A DATE column
  // reaches Node as a Date object built from local-time parts (year, month,
  // day) — reading it back through UTC can name the day before. Same story as
  // utils/hotelTime.js, kept local instead of importing it so this stays the
  // pure function the rest of the file promises.
  const day = checkOutDate instanceof Date
    ? `${checkOutDate.getFullYear()}-${String(checkOutDate.getMonth() + 1).padStart(2, "0")}-${String(checkOutDate.getDate()).padStart(2, "0")}`
    : String(checkOutDate).slice(0, 10);
  const [h = "11", m = "00"] = String(checkOutTime || "11:00").split(":");
  // Built in local server time, which is the clock the front desk is reading.
  const d = new Date(`${day}T00:00:00`);
  d.setHours(Number(h), Number(m), 0, 0);
  return d;
}

/**
 * What a departure at `at` costs, given the house rules.
 *
 * `nightlyRate` is the booking's own rate — the sum of its rooms' per-night
 * rates — so a suite's late fee is bigger than a single's, which is what the
 * percentage is for.
 *
 * Returns the shape the desk needs to explain the charge, not just a number.
 */
export function lateCheckoutFee({ checkOutDate, nightlyRate, policy = {}, at = new Date() }) {
  const p = { ...POLICY_DEFAULTS, ...policy };
  const due = dueOutAt(checkOutDate, p.check_out_time);
  const graceEnds = new Date(due.getTime() + num(p.late_grace_minutes, 0) * 60000);

  const minutesLate = Math.max(0, Math.round((at - due) / 60000));
  const billableMs = at - graceEnds;

  const base = {
    due_at: due.toISOString(),
    check_out_time: p.check_out_time,
    pretty_time: prettyTime(p.check_out_time),
    minutes_late: minutesLate,
    hours_late: Math.floor(minutesLate / 60),
    grace_minutes: num(p.late_grace_minutes, 0),
    mode: p.late_mode,
    amount: 0,
    hours_charged: 0,
    reason: null,
  };

  if (minutesLate <= 0) return { ...base, late: false };
  if (billableMs <= 0) {
    return { ...base, late: true, reason: `Within the ${base.grace_minutes}-minute grace period` };
  }
  if (p.late_mode === "none") {
    return { ...base, late: true, reason: "Late check-out is not charged at this property" };
  }

  const rate = num(nightlyRate);
  const hours = Math.ceil(billableMs / 3600000);      // any part of an hour counts
  const fullNight = +rate.toFixed(2);

  if (p.late_mode === "night") {
    return { ...base, late: true, hours_charged: hours, amount: fullNight,
             reason: "A full extra night is charged for any late departure" };
  }
  if (p.late_mode === "flat") {
    return { ...base, late: true, hours_charged: hours, amount: +num(p.late_flat_amount).toFixed(2),
             reason: "Fixed late check-out fee" };
  }

  // hourly, tipping into a whole night once it stops being worth counting hours
  const cutoff = num(p.late_full_night_after, 6);
  if (hours >= cutoff) {
    return { ...base, late: true, hours_charged: hours, amount: fullNight,
             reason: `${hours} hours past the grace period — charged as a full night` };
  }
  const perHour = +(rate * num(p.late_hourly_pct) / 100).toFixed(2);
  const amount = +Math.min(perHour * hours, fullNight).toFixed(2);
  return {
    ...base, late: true, hours_charged: hours, per_hour: perHour, amount,
    reason: `${hours} hour${hours === 1 ? "" : "s"} past ${prettyTime(p.check_out_time)}`
          + (base.grace_minutes ? ` plus ${base.grace_minutes} min grace` : "")
          + ` at ${num(p.late_hourly_pct)}% of the nightly rate`,
  };
}
