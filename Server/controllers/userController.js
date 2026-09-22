import bcrypt from "bcryptjs";
import pool from "../config/database.js";
import { ROLES, invalidateUserStatus } from "../middleware/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";
import { textField, emailField, phoneField, invalid } from "../utils/validate.js";

const MIN_PASSWORD = 8;

// A login is only as good as what is typed into it: "a" as a password and "nope" as
// an email were both accepted, and the email is what the person signs in with.
function passwordField(v) {
  const s = String(v ?? "");
  if (s.length < MIN_PASSWORD) invalid(`Password must be at least ${MIN_PASSWORD} characters.`);
  if (s.length > 72) invalid("Password is too long — 72 characters is the most that can be stored safely.");
  return s;
}

// Helper to hash password when provided
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

function normalizeBranchId(body) {
  return body?.B_id ?? body?.b_id ?? body?.branch_id;
}

function getScopedBranchId(req) {
  return req.user?.role_id === ROLES.BRANCH_ADMIN ? req.user?.b_id : null;
}

function ensureBranchAdminHasBranch(req, res) {
  if (req.user?.role_id === ROLES.BRANCH_ADMIN && !req.user?.b_id) {
    res.status(403);
    throw new Error("No branch is assigned to this branch admin account.");
  }
}

// How much power each role carries. Used only to compare roles against each
// other, so the exact numbers don't matter — the ordering does.
const ROLE_RANK = {
  [ROLES.SUPER_ADMIN]:   100, // the platform, above every customer
  [ROLES.ADMIN]:          60, // company-wide (retired)
  [ROLES.BRANCH_ADMIN]:   50, // one property
  [ROLES.CASHIER]:        10,
  [ROLES.WAITER]:         10,
  [ROLES.KITCHEN_STAFF]:  10,
};

const rankOf = (roleId) => ROLE_RANK[Number(roleId)] ?? 0;

const ROLE_NAMES = {
  [ROLES.SUPER_ADMIN]: "Super Admin", [ROLES.ADMIN]: "Admin",
  [ROLES.BRANCH_ADMIN]: "Administrator", [ROLES.CASHIER]: "Cashier",
  [ROLES.WAITER]: "Waiter", [ROLES.KITCHEN_STAFF]: "Kitchen Staff",
};
const roleName = (roleId) => ROLE_NAMES[Number(roleId)] || `role ${roleId}`;

// A retired role keeps its row so old records still read correctly, but it must
// never land on a live account again. Enforced here as well as in the picker —
// the picker is a courtesy, this is the rule.
//
// The rank check is the important half: without it a property's Administrator
// could create a Super Admin and hand itself the whole platform. Nobody may
// grant a role that outranks their own.
async function ensureRoleAssignable(roleId, res, req) {
  if (roleId === undefined || roleId === null || roleId === "") return;

  const { rows } = await pool.query(
    'SELECT role_name, is_assignable FROM "Role" WHERE role_id = $1',
    [Number(roleId)],
  );

  if (!rows.length) {
    res.status(400);
    throw new Error("That role does not exist");
  }
  if (rows[0].is_assignable === false) {
    res.status(400);
    throw new Error(`The "${rows[0].role_name}" role has been retired and can no longer be assigned`);
  }

  if (rankOf(roleId) > rankOf(req?.user?.role_id)) {
    res.status(403);
    throw new Error(`You cannot assign the "${rows[0].role_name}" role — it ranks above your own`);
  }
}

function normalizeOptionalPositiveInt(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw Object.assign(new Error(`${fieldName} must be a positive integer`), { status: 400 });
  }

  return parsed;
}

//all users
// GET /api/users
export async function getUsers(req, res, next) {
  try {
    ensureBranchAdminHasBranch(req, res);
    const { role_id, com_id, b_id } = req.user;

    let query = `SELECT u.u_id, u.u_fname, u.u_lname, u.u_email, u.u_connumber, u.role_id, r.role_name, u.u_status, u.u_image, u."B_id" as b_id,
                        b."B_name" as branch_name,
                        COALESCE(c2.com_name, c1.com_name) as company_name,
                        COALESCE(u.com_id, b.com_id) as com_id
                 FROM "User" u
                 LEFT JOIN "Role" r ON u.role_id = r.role_id
                 LEFT JOIN "Branch" b ON b."B_id" = u."B_id"
                 LEFT JOIN "Company" c1 ON b.com_id = c1.com_id
                 LEFT JOIN "Company" c2 ON u.com_id = c2.com_id`;
    
    let params = [];

    if (role_id === ROLES.ADMIN && com_id != null) {
      query += ` WHERE COALESCE(u.com_id, b.com_id) = $1`;
      params.push(com_id);
    } else if (role_id === ROLES.BRANCH_ADMIN && b_id != null) {
      query += ` WHERE b."B_id" = $1`;
      params.push(b_id);
    }

    query += ` ORDER BY u.u_id`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
//single user by id
// GET /api/users/:id
export async function getUserById(req, res, next) {
  try {
    ensureBranchAdminHasBranch(req, res);
    const { id } = req.params;
    const scopedBranchId = getScopedBranchId(req);
    const params = [id];
    let branchFilter = "";

    if (scopedBranchId) {
      params.push(Number(scopedBranchId));
      branchFilter = `AND u."B_id" = $2`;
    }

    const result = await pool.query(
      `SELECT u.u_id, u.u_fname, u.u_lname, u.u_email, u.u_connumber,
              u.role_id, r.role_name, u.u_status, u.u_image, u."B_id" as b_id,
              b."B_name" AS branch_name,
              COALESCE(c2.com_name, c1.com_name) AS company_name,
              COALESCE(u.com_id, b.com_id) AS com_id
       FROM "User" u
       LEFT JOIN "Role" r ON u.role_id = r.role_id
       LEFT JOIN "Branch" b ON u."B_id" = b."B_id"
       LEFT JOIN "Company" c1 ON b.com_id = c1.com_id
       LEFT JOIN "Company" c2 ON u.com_id = c2.com_id
       WHERE u.u_id = $1 ${branchFilter}`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("User not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

//create user
// POST /api/users
export async function createUser(req, res, next) {
  try {
    ensureBranchAdminHasBranch(req, res);
    const { u_fname, u_lname, u_email, u_pw, u_connumber, role_id, u_status, u_image } = req.body;

    const firstName = textField(u_fname, "First name", 100, { required: true });
    const lastName = textField(u_lname, "Last name", 100, { required: true });
    const email = emailField(u_email);
    if (!email) invalid("Email is required.");
    if (!u_pw) invalid("Password is required.");
    passwordField(u_pw);
    const phone = phoneField(u_connumber, "Contact", 50);

    await ensureRoleAssignable(role_id, res, req);

    let B_id = null;
    let com_id = null;

    if (Number(role_id) === ROLES.SUPER_ADMIN) {
      // Super Admin needs no company or branch
      B_id = null;
      com_id = null;
    } else if (Number(role_id) === ROLES.ADMIN) {
      const requestedComId = req.body?.com_id ?? req.body?.company_id;
      com_id = normalizeOptionalPositiveInt(requestedComId, "com_id");
      if (!com_id) {
        res.status(400);
        throw new Error("com_id is required for Admin role");
      }
    } else {
      const requestedBranchId = normalizeBranchId(req.body);
      const scopedBranchId = getScopedBranchId(req);
      B_id = scopedBranchId
        ? Number(scopedBranchId)
        : normalizeOptionalPositiveInt(requestedBranchId, "B_id");
      
      // B_id is required for cashier, waiter, kitchen staff, but optional for branch admin
      if (!B_id && Number(role_id) !== ROLES.BRANCH_ADMIN) {
        res.status(400);
        throw new Error("B_id is required for branch-level roles");
      }

      if (B_id) {
        // Automatically look up the branch's company ID (com_id)
        const branchRes = await pool.query('SELECT com_id FROM "Branch" WHERE "B_id" = $1', [B_id]);
        com_id = branchRes.rows[0]?.com_id ?? null;
        if (!com_id) {
          res.status(400);
          throw new Error("The assigned branch does not belong to a valid company");
        }
      } else {
        const requestedComId = req.body?.com_id ?? req.body?.company_id;
        com_id = normalizeOptionalPositiveInt(requestedComId, "com_id");
        if (!com_id) {
          res.status(400);
          throw new Error("com_id is required for branch-level users when B_id is not assigned");
        }
      }
    }

    // Check for existing email
    const existing = await pool.query(
      'SELECT u_id FROM "User" WHERE LOWER(u_email) = LOWER($1)',
      [email]
    );
    if (existing.rows.length > 0) {
      res.status(400);
      throw new Error("Email already in use");
    }

    const hashedPassword = await hashPassword(u_pw);

    const insertQuery = `
      INSERT INTO "User" (u_fname, u_lname, u_email, u_pw, u_connumber, role_id, u_status, u_image, "B_id", "com_id")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING u_id, u_fname, u_lname, u_email, u_connumber, role_id, u_status, u_image, "B_id" as b_id, "com_id" as com_id
    `;

    const params = [
      firstName,
      lastName,
      email,
      hashedPassword,
      phone,
      role_id || null,
      u_status ?? true,
      u_image || null,
      B_id,
      com_id,
    ];

    const result = await pool.query(insertQuery, params);
    const created = result.rows[0];

    logActivity(req, {
      action: "create", entity: "user", entity_id: created.u_id, b_id: created.b_id,
      summary: `Added ${created.u_fname} ${created.u_lname} as ${roleName(role_id)}`,
      details: { email: created.u_email, role_id: created.role_id },
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

//update user
// PUT /api/users/:id
export async function updateUser(req, res, next) {
  try {
    ensureBranchAdminHasBranch(req, res);
    const { id } = req.params;
    const { u_fname, u_lname, u_email, u_pw, u_connumber, role_id, u_status, u_image } = req.body;
    let scopedBranchId = getScopedBranchId(req);

    // Ensure user exists
    const existingParams = [id];
    let branchFilter = "";
    if (scopedBranchId) {
      existingParams.push(Number(scopedBranchId));
      branchFilter = `AND "B_id" = $2`;
    }

    const existingUser = await pool.query(
      `SELECT u_id, u_fname, u_lname, role_id, u_status, u_email, u_connumber, "B_id", "com_id" FROM "User" WHERE u_id = $1 ${branchFilter}`,
      existingParams
    );
    if (existingUser.rows.length === 0) {
      res.status(404);
      throw new Error("User not found");
    }

    // Determine target role (use provided role_id, fallback to existing role_id)
    const targetRoleId = role_id !== undefined ? Number(role_id) : Number(existingUser.rows[0].role_id);

    // Only checked when the role is actually being changed — an account already
    // sitting on a retired role can still have its name or phone edited.
    if (role_id !== undefined && targetRoleId !== Number(existingUser.rows[0].role_id)) {
      await ensureRoleAssignable(targetRoleId, res, req);
    }

    let B_id = null;
    let com_id = null;

    if (targetRoleId === ROLES.SUPER_ADMIN) {
      // Super Admin needs no company or branch
      B_id = null;
      com_id = null;
    } else if (targetRoleId === ROLES.ADMIN) {
      const requestedComId = req.body?.com_id ?? req.body?.company_id;
      if (requestedComId !== undefined) {
        com_id = normalizeOptionalPositiveInt(requestedComId, "com_id");
      } else {
        com_id = existingUser.rows[0].com_id;
      }
      B_id = null; // force null for Admin
      if (!com_id) {
        res.status(400);
        throw new Error("com_id is required for Admin role");
      }
    } else {
      const requestedBranchId = normalizeBranchId(req.body);
      if (requestedBranchId !== undefined) {
        B_id = scopedBranchId
          ? Number(scopedBranchId)
          : normalizeOptionalPositiveInt(requestedBranchId, "B_id");
      } else {
        B_id = scopedBranchId ? Number(scopedBranchId) : existingUser.rows[0].B_id;
      }
      
      // B_id is required for cashier, waiter, kitchen staff, but optional for branch admin
      if (!B_id && targetRoleId !== ROLES.BRANCH_ADMIN) {
        res.status(400);
        throw new Error("B_id is required for branch-level roles");
      }

      if (B_id) {
        // Automatically look up the branch's company ID (com_id)
        const branchRes = await pool.query('SELECT com_id FROM "Branch" WHERE "B_id" = $1', [B_id]);
        com_id = branchRes.rows[0]?.com_id ?? null;
        if (!com_id) {
          res.status(400);
          throw new Error("The assigned branch does not belong to a valid company");
        }
      } else {
        const requestedComId = req.body?.com_id ?? req.body?.company_id;
        if (requestedComId !== undefined) {
          com_id = normalizeOptionalPositiveInt(requestedComId, "com_id");
        } else {
          com_id = existingUser.rows[0].com_id;
        }
      }
    }

    // What was sent replaces what was there — including a phone number that has been
    // cleared. What was not sent stays.
    const has = (v) => v !== undefined;
    if (Number(id) === Number(req.user?.u_id) && has(u_status) && !u_status) {
      invalid("You cannot deactivate the account you are signed in with.");
    }
    const prevRow = existingUser.rows[0];
    const firstName = has(u_fname) ? textField(u_fname, "First name", 100, { required: true }) : prevRow.u_fname;
    const lastName = has(u_lname) ? textField(u_lname, "Last name", 100, { required: true }) : prevRow.u_lname;
    let email = prevRow.u_email;
    if (has(u_email)) {
      email = emailField(u_email);
      if (!email) invalid("Email is required.");
      if (email.toLowerCase() !== String(prevRow.u_email).toLowerCase()) {
        const clash = await pool.query('SELECT 1 FROM "User" WHERE LOWER(u_email) = LOWER($1) AND u_id <> $2', [email, id]);
        if (clash.rows.length) invalid("Email already in use");
      }
    }
    const phone = has(u_connumber) ? phoneField(u_connumber, "Contact", 50) : prevRow.u_connumber;

    let hashedPassword = null;
    if (u_pw) {
      passwordField(u_pw);
      hashedPassword = await hashPassword(u_pw);
    }

    const updateQuery = `
      UPDATE "User"
      SET
        u_fname = COALESCE($1, u_fname),
        u_lname = COALESCE($2, u_lname),
        u_email = COALESCE($3, u_email),
        u_pw = COALESCE($4, u_pw),
        u_connumber = $5,
        role_id = COALESCE($6, role_id),
        u_status = COALESCE($7, u_status),
        u_image = COALESCE($11, u_image),
        "B_id" = $8,
        "com_id" = $9
      WHERE u_id = $10
      RETURNING u_id, u_fname, u_lname, u_email, u_connumber, role_id, u_status, u_image, "B_id" as b_id, "com_id" as com_id
    `;

    const params = [
      firstName,
      lastName,
      email,
      hashedPassword,
      phone,
      role_id ?? null,
      u_status ?? null,
      B_id,
      com_id,
      id,
      u_image ?? null,   // $11 — COALESCE keeps the old photo when omitted
    ];

    const result = await pool.query(updateQuery, params);

    // Drop the cached status so a deactivation or demotion bites on the very
    // next request instead of up to 30 seconds later.
    invalidateUserStatus(id);
    const saved = result.rows[0];

    // Say what actually changed — "updated user 15" tells nobody anything.
    const changed = [];
    const prev = existingUser.rows[0];
    if (role_id !== undefined && Number(role_id) !== Number(prev.role_id)) {
      changed.push(`role to ${roleName(role_id)}`);
    }
    if (u_status !== undefined && Boolean(u_status) !== Boolean(prev.u_status)) {
      changed.push(Boolean(u_status) ? "reactivated the account" : "deactivated the account");
    }
    if (u_pw) changed.push("reset the password");
    if (email !== prev.u_email) changed.push("changed the email");

    logActivity(req, {
      action: "update", entity: "user", entity_id: saved.u_id, b_id: saved.b_id,
      summary: changed.length
        ? `Changed ${saved.u_fname} ${saved.u_lname}: ${changed.join(", ")}`
        : `Edited ${saved.u_fname} ${saved.u_lname}'s details`,
      details: { email: saved.u_email, role_id: saved.role_id, active: saved.u_status },
    });

    res.json(saved);
  } catch (err) {
    next(err);
  }
}

//delete user
// DELETE /api/users/:id
export async function deleteUser(req, res, next) {
  try {
    ensureBranchAdminHasBranch(req, res);
    const { id } = req.params;
    if (Number(id) === Number(req.user?.u_id)) invalid("You cannot delete the account you are signed in with.");
    const scopedBranchId = getScopedBranchId(req);
    const params = [id];
    let branchFilter = "";

    if (scopedBranchId) {
      params.push(Number(scopedBranchId));
      branchFilter = `AND "B_id" = $2`;
    }

    // Read the row first: once it is gone there is nothing left to name in the
    // log, and "deleted user 15" is not an audit trail.
    const result = await pool.query(
      `DELETE FROM "User" WHERE u_id = $1 ${branchFilter}
       RETURNING u_id, u_fname, u_lname, u_email, role_id, "B_id" AS b_id`,
      params
    );

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("User not found");
    }

    invalidateUserStatus(id);
    const gone = result.rows[0];

    logActivity(req, {
      action: "delete", entity: "user", entity_id: gone.u_id, b_id: gone.b_id,
      summary: `Deleted ${gone.u_fname} ${gone.u_lname} (${roleName(gone.role_id)})`,
      details: { email: gone.u_email, role_id: gone.role_id },
    });

    res.status(204).send();
  } catch (err) {
    // Orders, cash sessions and table assignments belong to whoever handled them.
    // Removing that person would orphan the till history, so the database says no —
    // and "refers to a record that no longer exists" told the owner nothing.
    if (err?.code === "23503") {
      return next(Object.assign(new Error(
        "This person has orders or till records on file, so they cannot be deleted. Untick \"Account is active\" on their profile instead — they will no longer be able to sign in, and the records stay.",
      ), { status: 409 }));
    }
    next(err);
  }
}

