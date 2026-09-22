import crypto from "crypto";
import pool from "../config/database.js";
import { writeBranchId } from "./scope.js";
import { logActivity } from "./activityLog.js";

/*
 * The cash drawer's PIN.
 *
 * Being signed in to the till used to be enough to open the drawer — take money
 * out, see what should be in it, close the shift. Now every drawer action also
 * needs the property's drawer PIN, which only the manager sets, changes and can
 * look up.
 *
 * It is stored encrypted, not hashed, for exactly that reason: the manager has
 * to be able to tell a cashier what it is. A four-digit hash would fall to
 * 10,000 guesses anyway; without the server's key the stored value is useless on
 * its own. If that key ever changes, the saved PIN can no longer be read and the
 * manager simply sets a new one.
 */

let key = null;
function pinKey() {
  // Derived on first use, not at import, so it never runs before .env is loaded.
  if (!key) {
    const secret = process.env.DRAWER_PIN_KEY || process.env.JWT_SECRET;
    if (!secret) throw new Error("No DRAWER_PIN_KEY or JWT_SECRET to protect the drawer PIN with");
    key = crypto.createHash("sha256").update(`drawer-pin|${secret}`).digest();
  }
  return key;
}

export function sealPin(pin) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", pinKey(), iv);
  const ct = Buffer.concat([c.update(String(pin), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

/** The PIN, or null if the stored value was tampered with or the key has changed. */
export function openPin(sealed) {
  try {
    const [v, iv, tag, ct] = String(sealed || "").split(".");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", pinKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const validPin = (p) => /^\d{4,8}$/.test(String(p ?? ""));

export async function readDrawerPin(b_id, db = pool) {
  const { rows } = await db.query(
    `SELECT d.pin_enc, d.updated_at,
            NULLIF(TRIM(COALESCE(u.u_fname, '') || ' ' || COALESCE(u.u_lname, '')), '') AS updated_by
       FROM "DRAWER_PIN" d
       LEFT JOIN "User" u ON u.u_id = d.updated_by
      WHERE d.b_id = $1`,
    [b_id],
  );
  if (!rows.length) return { set: false, pin: null, updated_at: null, updated_by: null };
  return {
    set: true,
    pin: openPin(rows[0].pin_enc),
    updated_at: rows[0].updated_at,
    updated_by: rows[0].updated_by,
  };
}

export async function writeDrawerPin(b_id, pin, u_id, db = pool) {
  await db.query(
    `INSERT INTO "DRAWER_PIN" (b_id, pin_enc, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (b_id) DO UPDATE
       SET pin_enc = EXCLUDED.pin_enc, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [b_id, sealPin(pin), u_id],
  );
  // A new PIN is a fresh start for anyone locked out guessing the old one.
  forgetFailures(b_id);
}

// ── Wrong guesses ─────────────────────────────────────────────────────
// Five per person per quarter of an hour, then a quarter of an hour locked out.
// A four-digit PIN is 10,000 guesses: at this rate that is weeks of trying, and
// every lock-out is on the owner's activity log long before then.
const MAX_TRIES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const tries = new Map(); // `${b_id}:${u_id}` -> { n, first, lockedUntil }

function lockedFor(k) {
  const t = tries.get(k);
  if (!t) return 0;
  const now = Date.now();
  if (t.lockedUntil > now) return t.lockedUntil - now;
  if (now - t.first > WINDOW_MS) tries.delete(k);
  return 0;
}

function recordFailure(k) {
  const now = Date.now();
  let t = tries.get(k);
  if (!t || now - t.first > WINDOW_MS || (t.lockedUntil && t.lockedUntil <= now)) {
    t = { n: 0, first: now, lockedUntil: 0 };
  }
  t.n += 1;
  if (t.n >= MAX_TRIES) t.lockedUntil = now + WINDOW_MS;
  tries.set(k, t);
  return t;
}

function forgetFailures(b_id) {
  for (const k of tries.keys()) if (k.startsWith(`${b_id}:`)) tries.delete(k);
}

function samePin(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Guard for the drawer's routes. Every change to the drawer needs the PIN, sent
 * as the X-Drawer-Pin header — a header, so it never lands in a URL or a log.
 *
 * `soft` is for reading the drawer: without the PIN the caller learns only
 * whether a drawer is open (the till labels its button with that), never a
 * figure. The controller checks res.locals.drawerUnlocked.
 *
 * Deliberately never 401: the till treats 401 as "signed out" and would throw a
 * cashier back to the login screen for a mistyped PIN.
 */
export function requireDrawerPin({ soft = false } = {}) {
  return async (req, res, next) => {
    try {
      const b_id = writeBranchId(req, req.query?.b_id ?? req.body?.b_id);
      const stored = await readDrawerPin(b_id);
      res.locals.drawerPinSet = stored.set;
      res.locals.drawerUnlocked = false;
      const given = req.get("X-Drawer-Pin");

      if (!stored.set) {
        if (soft) return next();
        return res.status(423).json({
          message: "The drawer is locked: the manager has not set a drawer PIN yet. "
                 + "They set it on the Hotel Profile page.",
          pin_set: false,
        });
      }
      if (!given) {
        if (soft) return next();
        return res.status(403).json({ message: "Enter the drawer PIN.", pin_required: true });
      }

      const k = `${b_id}:${req.user.u_id}`;
      const wait = lockedFor(k);
      if (wait > 0) {
        return res.status(429).json({
          message: `Too many wrong PINs. The drawer is locked for ${Math.ceil(wait / 60000)} more minute(s).`,
        });
      }

      if (!stored.pin || !samePin(given, stored.pin)) {
        const t = recordFailure(k);
        if (t.lockedUntil) {
          logActivity(req, {
            action: "login_blocked", entity: "cash_drawer", entity_id: b_id, b_id,
            summary: `The cash drawer was locked after ${MAX_TRIES} wrong PINs`,
          });
          return res.status(429).json({ message: "Too many wrong PINs. The drawer is locked for 15 minutes." });
        }
        const left = MAX_TRIES - t.n;
        return res.status(403).json({
          message: `That PIN is not right. ${left} ${left === 1 ? "try" : "tries"} left.`,
          wrong_pin: true,
        });
      }

      tries.delete(k);
      res.locals.drawerUnlocked = true;
      next();
    } catch (err) {
      next(err);
    }
  };
}
