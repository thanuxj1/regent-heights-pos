import jwt from "jsonwebtoken";
import { logAuthActivity, logFailedLogin } from "../utils/activityLog.js";
import bcrypt from "bcryptjs";
import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";
import { loginAllowedFrom } from "../utils/loginLocation.js";

/**
 * A real bcrypt hash of a value nobody knows, compared against when the email is
 * unknown. Without it an unknown address answers in ~30ms and a real one in
 * ~600ms, and that gap alone tells an attacker which of the staff addresses
 * exist — measured at 32/sec versus 1.6/sec before this was added.
 */
const DECOY_HASH = bcrypt.hashSync("no-such-account-" + Math.random(), 10);

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
}

// POST /api/auth/login
export async function login(req, res, next) {
  try {
    //email ekai pw ekai request eken
    const { u_email, u_pw } = req.body;

    //check missed da kiyala
    if (!u_email || !u_pw) {
      res.status(400);
      throw new Error("u_email and u_pw are required");
    }
    //search user from db
    const result = await pool.query(
      'SELECT u_id, u_fname, u_lname, u_email, u_pw, u_connumber, role_id, u_status, "B_id", "com_id" FROM "User" WHERE u_email = $1',
      [u_email]
    );

    const user = result.rows[0] || null;

    // Always pay the hashing cost, even for an address that does not exist, so
    // the response time says nothing about whether the account is real.
    let passwordOk = false;
    try {
      passwordOk = await bcrypt.compare(u_pw, user ? user.u_pw : DECOY_HASH);
    } catch {
      passwordOk = false;
    }

    if (!user || !passwordOk) {
      logFailedLogin({
        req, email: u_email,
        summary: user
          ? "Failed sign-in — wrong password"
          : "Failed sign-in — no such account",
      });
      res.status(401);
      throw new Error("Invalid email or password");
    }

    if (user.u_status === false) {
      logFailedLogin({
        req, email: u_email, action: "login_blocked",
        summary: "Sign-in refused — account is deactivated",
      });
      res.status(403);
      throw new Error("This account has been deactivated. Please contact your administrator.");
    }

    // Right credentials, wrong place. Checked after the password so this never
    // becomes a way to discover which accounts exist.
    const where = await loginAllowedFrom(req, user);
    if (!where.allowed) {
      logFailedLogin({
        req, email: u_email, action: "login_blocked",
        summary: `Sign-in refused — outside the property (${where.ip})`,
      });
      res.status(403);
      throw new Error(where.reason);
    }

    if (!process.env.JWT_SECRET) {
      res.status(500);
      throw new Error("JWT_SECRET is not configured");
    }
    let b_id = user.B_id ?? null;
    let com_id = user.com_id ?? null;
 
    if (user.role_id === ROLES.SUPER_ADMIN) {
      b_id = null;
      com_id = null;
    } else if (!com_id && b_id) {
      const bRes = await pool.query('SELECT com_id FROM "Branch" WHERE "B_id" = $1', [b_id]);
      com_id = bRes.rows[0]?.com_id ?? null;
    }

    //token creation
    const token = signToken({
      u_id: user.u_id,
      role_id: user.role_id,
      u_email: user.u_email,
      ...(b_id != null ? { b_id } : {}),
      ...(com_id != null ? { com_id } : {}),
    });

    const userPayload = {
      u_id: user.u_id,
      u_fname: user.u_fname,
      u_lname: user.u_lname,
      u_email: user.u_email,
      u_connumber: user.u_connumber,
      role_id: user.role_id,
      ...(b_id != null ? { b_id } : {}),
      ...(com_id != null ? { com_id } : {}),
    };

    logAuthActivity({
      user: { ...userPayload, B_id: b_id },
      req,
      action: "login",
      // The feed prints the actor beside the summary, so naming them again
      // reads as "kavishka weerasekara kavishka weerasekara signed in".
      summary: "Signed in",
    });

    //frntend res
    res.json({
      token,
      user: userPayload,
    });
  } catch (err) {
    next(err);
  }
}

