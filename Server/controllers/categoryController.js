import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";

/**
 * Categories belong to a company, not to the platform. The company comes from
 * the token — a caller cannot ask for someone else's menu structure by putting
 * a different id in the query string.
 *
 * Super Admin is the exception: it sits above every company and sees the lot.
 */
function companyScope(req, params, column = "com_id") {
  const role = Number(req.user?.role_id);
  if (role === ROLES.SUPER_ADMIN) return null;

  const comId = req.user?.com_id;
  // No company on the token means no categories, rather than everyone's.
  params.push(comId != null ? Number(comId) : -1);
  return `${column} = $${params.length}`;
}

// GET /api/categories
export async function getCategories(req, res, next) {
  try {
    const params = [];
    const scope = companyScope(req, params);
    const where = scope ? `WHERE ${scope}` : "";

    const result = await pool.query(
      `SELECT "cat_id", "cat_name", "com_id",
              (SELECT COUNT(*)::int FROM "Product" p WHERE p.cat_id = c.cat_id) AS product_count
         FROM "public"."category" c
         ${where}
        ORDER BY "cat_name"`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/categories/:id
export async function getCategoryById(req, res, next) {
  try {
    const params = [req.params.id];
    const scope = companyScope(req, params);

    const result = await pool.query(
      `SELECT "cat_id", "cat_name", "com_id" FROM "public"."category"
        WHERE "cat_id" = $1 ${scope ? `AND ${scope}` : ""}`,
      params,
    );

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("Category not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// POST /api/categories
export async function createCategory(req, res, next) {
  try {
    const name = String(req.body?.cat_name ?? "").trim();

    if (!name) {
      res.status(400);
      throw new Error("A category name is required");
    }
    if (name.length > 50) {
      res.status(400);
      throw new Error("A category name must be 50 characters or fewer");
    }

    // Super Admin has no company of its own, so it must say which one.
    const comId =
      Number(req.user?.role_id) === ROLES.SUPER_ADMIN
        ? (req.body?.com_id ?? null)
        : (req.user?.com_id ?? null);

    if (!comId) {
      res.status(400);
      throw new Error("No company is linked to this account");
    }

    const result = await pool.query(
      `INSERT INTO "public"."category" ("cat_name", "com_id")
       VALUES ($1, $2) RETURNING "cat_id", "cat_name", "com_id"`,
      [name, comId],
    );

    logActivity(req, {
      action: "create",
      entity: "category",
      entity_id: result.rows[0].cat_id,
      summary: `Added menu category "${name}"`,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409);
      return next(new Error("You already have a category with that name"));
    }
    next(err);
  }
}

// PUT /api/categories/:id
export async function updateCategory(req, res, next) {
  try {
    const { id } = req.params;
    const name = String(req.body?.cat_name ?? "").trim();

    if (!name) {
      res.status(400);
      throw new Error("A category name is required");
    }

    const params = [id];
    const scope = companyScope(req, params);

    const existing = await pool.query(
      `SELECT "cat_id", "cat_name" FROM "public"."category"
        WHERE "cat_id" = $1 ${scope ? `AND ${scope}` : ""}`,
      params,
    );
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Category not found");
    }

    const result = await pool.query(
      `UPDATE "public"."category" SET "cat_name" = $1
        WHERE "cat_id" = $2 RETURNING "cat_id", "cat_name", "com_id"`,
      [name, id],
    );

    logActivity(req, {
      action: "update",
      entity: "category",
      entity_id: id,
      summary: `Renamed menu category "${existing.rows[0].cat_name}" to "${name}"`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409);
      return next(new Error("You already have a category with that name"));
    }
    next(err);
  }
}

// DELETE /api/categories/:id
export async function deleteCategory(req, res, next) {
  try {
    const { id } = req.params;
    const params = [id];
    const scope = companyScope(req, params);

    const existing = await pool.query(
      `SELECT "cat_id", "cat_name" FROM "public"."category"
        WHERE "cat_id" = $1 ${scope ? `AND ${scope}` : ""}`,
      params,
    );
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Category not found");
    }

    // Refuse rather than orphan a product. The owner should move the items
    // first, so nothing silently loses the group it was sold under.
    const inUse = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM "Product" WHERE cat_id = $1)          AS products,
         (SELECT COUNT(*)::int FROM "Branch_Product" WHERE "Cat_id" = $1) AS menu_items`,
      [id],
    );
    const { products, menu_items } = inUse.rows[0];
    if (products > 0 || menu_items > 0) {
      res.status(409);
      throw new Error(
        `"${existing.rows[0].cat_name}" still has ${products || menu_items} item(s) in it. ` +
        "Move them to another category first.",
      );
    }

    await pool.query('DELETE FROM "public"."category" WHERE "cat_id" = $1', [id]);

    logActivity(req, {
      action: "delete",
      entity: "category",
      entity_id: id,
      summary: `Deleted menu category "${existing.rows[0].cat_name}"`,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
