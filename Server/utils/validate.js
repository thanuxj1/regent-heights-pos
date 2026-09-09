// utils/validate.js
//
// The booking desk's rules in one place, so the same sentence comes back
// whether a booking is created, edited, or paid against — and so a typo never
// reaches Postgres, where it would surface as "numeric field overflow".
//
// Every helper throws a 400. errorHandler turns that into { message }.

/** A single money field. NUMERIC(12,2) holds far more, but past this it is a typo, not a rate. */
export const MAX_MONEY = 9999999.99;
/** Long stays happen; a year of them does not. Also keeps rate x nights inside NUMERIC(12,2). */
export const MAX_NIGHTS = 365;

export function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * A currency amount. Blank means zero — a cleared field on the form is not an error,
 * it is "nothing", which is what the front desk means by leaving it empty.
 */
export function moneyField(v, field, { min = 0, max = MAX_MONEY } = {}) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) invalid(`${field} must be a number.`);
  if (n < min) invalid(min === 0 ? `${field} cannot be negative.` : `${field} cannot be less than ${fmt(min)}.`);
  if (n > max) invalid(`${field} of ${fmt(n)} looks wrong — the most we accept is ${fmt(max)}.`);
  return Math.round(n * 100) / 100;
}

/** A whole number of people, nights, and the like. */
export function countField(v, field, { min = 0, max = 999, dflt = min } = {}) {
  if (v === undefined || v === null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n)) invalid(`${field} must be a whole number.`);
  if (n < min) invalid(`${field} must be at least ${min}.`);
  if (n > max) invalid(`${field} cannot be more than ${max}.`);
  return n;
}

/** A percentage. The column is NUMERIC(5,2); the business rule is tighter. */
export function pctField(v, field, dflt = 0) {
  if (v === undefined || v === null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) invalid(`${field} must be a number.`);
  if (n < 0 || n > 100) invalid(`${field} must be between 0 and 100.`);
  return Math.round(n * 100) / 100;
}

/** Trim, enforce the column's width, and treat blank as absent. */
export function textField(v, field, max, { required = false } = {}) {
  const s = v === undefined || v === null ? "" : String(v).trim();
  if (!s) {
    if (required) invalid(`${field} is required.`);
    return null;
  }
  if (s.length > max) invalid(`${field} is too long — ${s.length} characters, and the limit is ${max}.`);
  return s;
}

export function oneOf(v, field, allowed, dflt = null) {
  if (v === undefined || v === null || v === "") return dflt;
  const s = String(v).trim();
  if (!allowed.includes(s)) invalid(`${field} must be one of: ${allowed.join(", ")}.`);
  return s;
}

/** The values the BOOKING / BOOKING_PAYMENT CHECK constraints allow. Kept here so a
 *  bad one comes back as a sentence instead of a Postgres constraint violation. */
export const BOOKING_SOURCES  = ["phone", "walk_in", "email", "agent", "online", "ota"];
export const BOOKING_STATUSES = ["tentative", "confirmed", "checked_in", "checked_out", "cancelled", "no_show"];
export const PAYMENT_METHODS  = ["cash", "card", "bank_transfer", "online", "voucher"];
export const PAYMENT_KINDS    = ["advance", "settlement", "refund"];
export const FOLIO_SOURCES    = ["room", "meal", "restaurant", "bar", "laundry", "minibar", "tax", "discount", "payment", "late_checkout", "misc"];

const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE  = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+()\-.\s]+$/;

export function dateField(v, field, { required = false } = {}) {
  if (v === undefined || v === null || v === "") {
    if (required) invalid(`${field} is required.`);
    return null;
  }
  const s = String(v).trim();
  if (!DATE_RE.test(s)) invalid(`${field} must be a date in YYYY-MM-DD format.`);
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    invalid(`${field} is not a real date.`);
  }
  return s;
}

/**
 * Today, on the server. Colombo runs ahead of UTC, never behind, so this is at
 * worst a day generous — it will not reject a date the front desk sees as today.
 * The extra day of grace is for last night's walk-in, entered this morning.
 */
export function assertNotInThePast(dateStr, field, { graceDays = 1 } = {}) {
  const floor = new Date();
  floor.setUTCHours(0, 0, 0, 0);
  floor.setUTCDate(floor.getUTCDate() - graceDays);
  if (new Date(dateStr + "T00:00:00Z") < floor) {
    invalid(`${field} cannot be in the past.`);
  }
}

export function timeField(v, field) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (!TIME_RE.test(s)) invalid(`${field} must be a time like 14:30.`);
  return s;
}

export function emailField(v) {
  const s = textField(v, "Email", 150);
  if (s && !EMAIL_RE.test(s)) invalid(`"${s}" is not a valid email address.`);
  return s;
}

export function phoneField(v, field = "Phone", max = 30) {
  const s = textField(v, field, max);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (!PHONE_RE.test(s) || digits.length < 7 || digits.length > 15) {
    invalid(`"${s}" is not a valid ${field.toLowerCase()} number.`);
  }
  return s;
}

// ─── GUEST ───────────────────────────────────────────────────────────────────

const LABELS = {
  full_name: "Guest name", country: "Country / region", nationality: "Nationality",
  passport_nic: "Passport / NIC", company: "Company", guest_status: "Guest status",
  chauffeur_name: "Chauffeur name", next_destination: "Next destination",
  passport_issue_date: "Passport issue date", passport_expiry_date: "Passport expiry date",
  date_of_birth: "Date of birth",
};

const GUEST_TEXT = {
  full_name: 150, country: 80, nationality: 80, passport_nic: 50,
  company: 150, guest_status: 50, chauffeur_name: 100, next_destination: 150,
};
const GUEST_DATES = ["passport_issue_date", "passport_expiry_date", "date_of_birth"];

/**
 * Normalise a guest payload in place-ish (returns a copy). Only fields the caller
 * actually sent are touched, so this serves both create and partial update.
 */
export function cleanGuest(raw, { requireName = true } = {}) {
  const g = { ...(raw || {}) };
  const present = (f) => g[f] !== undefined;

  if (requireName || present("full_name")) {
    g.full_name = textField(g.full_name, "Guest name", GUEST_TEXT.full_name, { required: requireName });
  }
  for (const [f, max] of Object.entries(GUEST_TEXT)) {
    if (f === "full_name" || !present(f)) continue;
    g[f] = textField(g[f], LABELS[f] || f, max);
  }
  if (present("email"))           g.email = emailField(g.email);
  if (present("phone"))           g.phone = phoneField(g.phone);
  if (present("chauffeur_phone")) g.chauffeur_phone = phoneField(g.chauffeur_phone, "Chauffeur phone");
  if (present("address"))         g.address = textField(g.address, "Address", 2000);
  if (present("notes"))           g.notes   = textField(g.notes, "Notes", 2000);
  for (const f of GUEST_DATES) {
    if (present(f)) g[f] = dateField(g[f], LABELS[f] || f);
  }
  return g;
}

// ─── BOOKING TOTALS ──────────────────────────────────────────────────────────

/**
 * A discount may wipe the bill out but never invert it, and an advance may
 * settle the bill but never exceed it. Both produce a folio the hotel can
 * never balance, and both are one fat-fingered keystroke away.
 */
export function assertTotals({ totals, extras, discount, advance }) {
  const beforeDiscount = totals.room_charges + totals.tax_amount + totals.meal_charges + extras;
  if (discount > beforeDiscount) {
    invalid(`Discount of ${fmt(discount)} is more than the bill. The most you can take off is ${fmt(beforeDiscount)}.`);
  }
  if (advance > totals.grand_total) {
    invalid(`Advance payment of ${fmt(advance)} is more than the grand total of ${fmt(totals.grand_total)}.`);
  }
}

/**
 * Occupancy is a guideline, not a rule. Two small children genuinely do share
 * their parents' room, and the front desk is the one who knows whether they
 * will — so going over the nominal figure is the desk's call, cautioned on the
 * form but never refused here.
 *
 * What this still catches is a typo: more than double what the rooms hold is
 * not a family, it is a slipped keystroke, and it would silently inflate the
 * meal-plan supplement, which is charged per adult and per child per night.
 */
export function assertOccupancy(adults, children, capacity, roomCount = 1) {
  const people = adults + children;
  if (capacity > 0 && people > capacity * 2) {
    invalid(`${people} guests is far more than the selected room${roomCount === 1 ? "" : "s"} can hold (${capacity}). Check the guest count before saving.`);
  }
}
