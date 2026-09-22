import pool from "../config/database.js";
import { logActivity } from "../utils/activityLog.js";
import { companyImpact, deleteCompanyCascade } from "../utils/companyCascade.js";

// Trim and cap name length to match typical DB column constraints
function sanitizeName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 255 ? trimmed : null;
}

export async function getCompanies(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT "com_id", "com_name", "c_status", "c_email", "reg_date", "location", "phone" FROM "Company" ORDER BY "com_id"',
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getCompanyById(req, res, next) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT "com_id", "com_name", "c_status", "c_email", "reg_date", "location", "phone" FROM "Company" WHERE "com_id" = $1',
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("Company not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createCompany(req, res, next) {
  try {
    const { com_name, c_status, c_email, reg_date, location, phone } = req.body;
    const sanitizedName = sanitizeName(com_name);

    if (!sanitizedName) {
      res.status(400);
      throw new Error("com_name is required and must be 1–255 characters");
    }

    const result = await pool.query(
      `INSERT INTO "Company" ("com_name", "c_status", "c_email", "reg_date", "location", "phone")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING "com_id", "com_name", "c_status", "c_email", "reg_date", "location", "phone"`,
      [sanitizedName, c_status ?? true, c_email ?? null, reg_date ?? new Date(), location ?? null, phone ?? null],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409);
      return next(new Error("A company with that name already exists"));
    }
    next(err);
  }
}

export async function updateCompany(req, res, next) {
  try {
    const { id } = req.params;
    const { com_name, c_status, c_email, reg_date, location, phone } = req.body;
    const sanitizedName = com_name ? sanitizeName(com_name) : null;

    // Require at least one valid field to update (simplified check)
    if (!sanitizedName && c_status === undefined && !c_email && !reg_date && !location && !phone) {
      res.status(400);
      throw new Error("At least one field is required to update");
    }

    const existing = await pool.query(
      'SELECT "com_id" FROM "Company" WHERE "com_id" = $1',
      [id],
    );
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Company not found");
    }

    const result = await pool.query(
      `UPDATE "Company"
       SET "com_name" = COALESCE($1, "com_name"),
           "c_status" = COALESCE($2, "c_status"),
           "c_email"  = COALESCE($3, "c_email"),
           "reg_date" = COALESCE($4, "reg_date"),
           "location" = COALESCE($5, "location"),
           "phone"    = COALESCE($6, "phone")
       WHERE "com_id" = $7
       RETURNING "com_id", "com_name", "c_status", "c_email", "reg_date", "location", "phone"`,
      [sanitizedName ?? null, c_status ?? null, c_email ?? null, reg_date ?? null, location ?? null, phone ?? null, id],
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409);
      return next(new Error("A company with that name already exists"));
    }
    next(err);
  }
}

/**
 * GET /api/companies/:id/impact — what would go with it.
 *
 * Shown before the Delete button does anything, because "permanently remove all
 * company data" is a sentence, and "12 rooms, 47 stays, 1,308 tickets" is a
 * decision.
 */
export async function getCompanyImpact(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400);
      throw new Error("Invalid company id");
    }
    const found = await client.query('SELECT com_name FROM "Company" WHERE com_id = $1', [id]);
    if (!found.rows.length) {
      res.status(404);
      throw new Error("Company not found");
    }
    res.json({ com_id: id, com_name: found.rows[0].com_name, ...(await companyImpact(client, id)) });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/companies/:id — the company and everything that was ever its.
 *
 * It used to be a bare DELETE, which every foreign key in the database refused:
 * the Super Admin, the only role allowed to remove a customer, was told
 * "referenced by existing records" and left with no way through. The whole
 * tenant goes now, in one transaction — see utils/companyCascade.js — or
 * nothing does. Deactivating instead keeps every record and is one toggle away
 * on the same screen.
 */
export async function deleteCompany(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400);
      throw new Error("Invalid company id");
    }

    const found = await client.query('SELECT com_name FROM "Company" WHERE com_id = $1', [id]);
    if (!found.rows.length) {
      res.status(404);
      throw new Error("Company not found");
    }
    const name = found.rows[0].com_name;

    await client.query("BEGIN");
    const impact = await companyImpact(client, id);
    const removed = await deleteCompanyCascade(client, id);
    await client.query("COMMIT");

    // The company's own audit rows went with it, so this one is written against
    // no branch — it is the platform's record, not the property's.
    logActivity(req, {
      action: "delete", entity: "company", entity_id: id, b_id: null,
      summary: `Deleted the company "${name}" and everything under it`
        + ` — ${impact.properties} propert${impact.properties === 1 ? "y" : "ies"},`
        + ` ${impact.staff} staff, ${impact.tickets} tickets, ${impact.stays} stays`,
      details: { impact, removed },
    });

    res.json({ com_id: id, com_name: name, removed });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23503") {
      res.status(409);
      return next(new Error(
        "Something still refers to this company that the removal did not cover."
        + " Nothing was deleted — please report which company this was."));
    }
    next(err);
  } finally {
    client.release();
  }
}
