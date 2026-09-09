// middleware/rateLimit.js
//
// Sign-in throttling. bcrypt already makes each guess cost ~600ms, but nothing
// stopped an attacker from spending all day on it: measured at 4.8 guesses a
// second against a real account, which is ~415,000 a day.
//
// Two limits, because either alone is easy to walk around:
//   - per IP    stops one machine grinding through many accounts
//   - per email stops a botnet spreading the same account over many machines
//
// Both count failures only (`skipSuccessfulRequests`), so ordinary staff coming
// on shift never accumulate against the limit.

import rateLimit from "express-rate-limit";
import { logFailedLogin } from "../utils/activityLog.js";

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Write one audit line the first time a key is turned away, not once per
 * blocked request — otherwise a sustained attack floods the log it is meant to
 * appear in.
 */
function noteBlock(req, summary) {
  if (req.rateLimit && req.rateLimit.used === req.rateLimit.limit + 1) {
    logFailedLogin({ req, email: req.body?.u_email, action: "login_blocked", summary });
  }
}

const tooMany = (res) =>
  res.status(429).json({
    message: "Too many sign-in attempts. Please wait 15 minutes and try again.",
  });

/**
 * The whole property sits behind one public IP, so this has to leave room for a
 * shift's worth of genuine typos before it bites.
 */
export const loginIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // No keyGenerator: the default already keys on the client IP and normalises
  // IPv6 to a /56, which a hand-written one gets wrong.
  handler: (req, res) => {
    noteBlock(req, "Sign-in blocked — too many failed attempts from this address");
    tooMany(res);
  },
});

/**
 * Ten failures per account per quarter hour: room for a forgotten password,
 * while cutting brute force to about 960 guesses a day per account.
 *
 * This does let someone lock a known address out for 15 minutes on purpose.
 * That is the accepted trade — the alternative is unbounded guessing, and the
 * lockout expires on its own without anyone having to intervene.
 */
export const loginEmailLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => !req.body?.u_email,
  keyGenerator: (req) => String(req.body.u_email).trim().toLowerCase(),
  handler: (req, res) => {
    noteBlock(req, "Sign-in blocked — too many failed attempts on this account");
    tooMany(res);
  },
});
