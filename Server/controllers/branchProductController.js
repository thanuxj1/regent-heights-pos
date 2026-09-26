import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";
import { logActivity } from "../utils/activityLog.js";
import { availabilityFor } from "../utils/inventory.js";
import { HOTEL_TZ } from "../utils/hotelTime.js";

function fieldOrNull(value) {
  // Convert `undefined` -> null (so COALESCE keeps the existing DB value).
  // Preserve 0 for numeric fields.
  return value === undefined ? null : value;
}

function normalizeCatId(body) {
  // API: `cat_id` ; DB: `Cat_id`
  return body?.cat_id ?? body?.Cat_id;
}

function normalizeBranchId(body) {
  // API/DB: `B_id`
  return body?.B_id ?? body?.b_id;
}

function normalizeProPrice(body) {
  // API: `pro_price` ; DB may use a leading-space column name
  return body?.pro_price ?? body?.Pro_Price ?? body?.[" Pro_Price"];
}

function normalizeSpaced(body, apiKey, dbKey) {
  // Support either API keys or DB-shaped payload keys.
  return body?.[apiKey] ?? body?.[dbKey];
}

function toResponseRow(row) {
  let stations = row.stations;
  if (typeof stations === "string") {
    try {
      stations = JSON.parse(stations);
    } catch (e) {
      stations = {};
    }
  }

  return {
    Bpro_id: row.Bpro_id,
    pro_name: row.pro_name,
    pro_shortname: row.pro_shortname,
    pro_image: row.pro_image,
    pro_des: row.pro_des,
    pro_quantity: row.pro_quantity,
    pro_price: row.pro_price,
    discount_pct: row.discount_pct != null ? Number(row.discount_pct) : 0,
    cat_id: row.cat_id,
    pro_id: row.pro_id,
    B_id: row.B_id,
    cat_name: row.cat_name,
    stations: stations || {},
    // false = made to order: nothing to count, nothing to run out of.
    track_inventory: row.track_inventory !== false,
    // When the owner is told this item is running low. It is set per item on
    // the product page; ten is only what an item gets when nobody has said
    // otherwise. The screens used to decide it for themselves — the list at
    // ten, the till at five — so the field on the form changed nothing.
    low_stock: Number(row.low_stock) > 0 ? Number(row.low_stock) : 10,
    // The till reads this per line to work out the tax on a sale. It was never
    // sent, so every item quietly fell back to 5% and the Tax Group field on
    // the product form decided nothing.
    tax_group: row.tax_group != null ? Number(row.tax_group) : null,
    // What is still in the storeroom, not yet moved onto the menu. Only the list asks for it.
    storeroom_qty: row.storeroom_qty != null ? Number(row.storeroom_qty) : undefined,
  };
}

/**
 * Menu rows with what can actually be sold right now: for a dish with a recipe,
 * the portions its ingredients allow; for something counted, what is on the
 * shelf; for something made to order, nothing — `available` comes back null and
 * the screens read that as "always on the menu".
 * pro_quantity is left as stored, so an edit form never mistakes one for the other.
 *
 * `made_today` rides along because a dish cooked to order has no other number.
 * The owner cannot say in the morning how many kottu the kitchen has; what they
 * can see is how many it has made since service began, and that is this.
 */
async function withAvailability(rows) {
  const avail = await availabilityFor(pool, rows.map((r) => ({
    Bpro_id: r.Bpro_id, pro_id: r.pro_id, B_id: r.B_id, pro_quantity: r.pro_quantity,
    track_inventory: r.track_inventory,
  })));

  const ids = [...new Set(rows.map((r) => Number(r.Bpro_id)).filter(Number.isFinite))];
  const made = new Map();
  if (ids.length) {
    const { rows: sold } = await pool.query(
      `SELECT oi."Bpro_id" AS bpro_id, COALESCE(SUM(oi.pro_quantity), 0) AS qty
         FROM "ORDER_ITEM" oi
         JOIN "ORDER" o ON o.or_id = oi.order_id
        WHERE oi."Bpro_id" = ANY($1::int[])
          AND o.or_date = (NOW() AT TIME ZONE $2)::date
          AND o.or_status <> 'cancelled'
        GROUP BY oi."Bpro_id"`, [ids, HOTEL_TZ]);
    for (const s of sold) made.set(Number(s.bpro_id), Number(s.qty));
  }

  return rows.map((r) => ({
    ...r,
    made_today: made.get(Number(r.Bpro_id)) || 0,
    ...(avail.get(Number(r.Bpro_id)) || {
      stock_mode: "count", available: Math.floor(Number(r.pro_quantity ?? 0)), limited_by: null,
    }),
  }));
}

function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function isNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

// Recipe ingredients are taken when a dish is sold, not when portions are
// "prepared" here — see utils/inventory.js.

// GET /api/branch_products
export async function getBranchProducts(req, res, next) {
  try {
    const { role_id, com_id } = req.user;
    const branchId = req.query?.b_id ?? req.query?.B_id;
    if (branchId !== undefined && !isPositiveInt(branchId)) {
      res.status(400);
      throw new Error("b_id must be a positive integer");
    }

    let query = `
      SELECT
        bp."Bpro_id",
        bp."pro_name",
        bp." pro_shortname" AS "pro_shortname",
        -- A branch that hasn't set its own image (blank, or the "N/A" placeholder
        -- rows are seeded with) falls back to the product's own image, the same
        -- way low_stock/track_inventory/tax_group already do below — editing the
        -- product's image (branch-admin/ProductDetails.jsx) would otherwise never
        -- show up here, since that screen writes Product, not Branch_Product.
        CASE
          WHEN bp." pro_image" IS NULL OR TRIM(bp." pro_image") = '' OR UPPER(TRIM(bp." pro_image")) = 'N/A'
          THEN p." pro_image"
          ELSE bp." pro_image"
        END AS "pro_image",
        bp." pro_des" AS "pro_des",
        bp."pro_quantity",
        bp." Pro_Price" AS "pro_price",
        COALESCE(bp."discount_pct", p."discount_pct", 0) AS "discount_pct",
        bp."Cat_id" AS "cat_id",
        bp."pro_id",
        bp."B_id",
        c."cat_name",
        p."stations",
        COALESCE(p."track_inventory", TRUE) AS "track_inventory",
        p."low_stock",
        p."tax_group",
        p."pro_qty" AS "storeroom_qty"
      FROM "public"."Branch_Product" bp
      LEFT JOIN "public"."category" c ON bp."Cat_id" = c."cat_id"
      LEFT JOIN "public"."Product"   p ON bp."pro_id" = p."pro_id"
    `;

    const conditions = [];
    const values = [];

    if (role_id !== ROLES.SUPER_ADMIN) {
      query += ` JOIN "public"."Branch" b ON bp."B_id" = b."B_id"`;
      conditions.push(`b."com_id" = $${conditions.length + 1}`);
      values.push(com_id);
    }

    if (branchId !== undefined) {
      conditions.push(`bp."B_id" = $${conditions.length + 1}`);
      values.push(Number(branchId));
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(" AND ");
    }

    query += ` ORDER BY bp."Bpro_id"`;

    const result = await pool.query(query, values);

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.json(await withAvailability(result.rows.map(toResponseRow)));
  } catch (err) {
    next(err);
  }
}

// GET /api/branch_products/:id
export async function getBranchProductById(req, res, next) {
  try {
    const { id } = req.params;
    const { role_id, com_id } = req.user;
    if (!isPositiveInt(id)) {
      res.status(400);
      throw new Error("Invalid branch product id");
    }

    let query = `
      SELECT
        bp."Bpro_id",
        bp."pro_name",
        bp." pro_shortname" AS "pro_shortname",
        CASE
          WHEN bp." pro_image" IS NULL OR TRIM(bp." pro_image") = '' OR UPPER(TRIM(bp." pro_image")) = 'N/A'
          THEN p." pro_image"
          ELSE bp." pro_image"
        END AS "pro_image",
        bp." pro_des" AS "pro_des",
        bp."pro_quantity",
        bp." Pro_Price" AS "pro_price",
        COALESCE(bp."discount_pct", p."discount_pct", 0) AS "discount_pct",
        bp."Cat_id" AS "cat_id",
        bp."pro_id",
        bp."B_id",
        c."cat_name",
        p."stations",
        COALESCE(p."track_inventory", TRUE) AS "track_inventory",
        p."low_stock",
        p."tax_group"
      FROM "public"."Branch_Product" bp
      LEFT JOIN "public"."category" c ON bp."Cat_id" = c."cat_id"
      LEFT JOIN "public"."Product"   p ON bp."pro_id" = p."pro_id"
    `;
    let params = [id];

    if (role_id !== ROLES.SUPER_ADMIN) {
      query += ` JOIN "public"."Branch" b ON bp."B_id" = b."B_id" WHERE bp."Bpro_id" = $1 AND b."com_id" = $2`;
      params.push(com_id);
    } else {
      query += ` WHERE bp."Bpro_id" = $1`;
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("Branch product not found");
    }

    res.json(toResponseRow(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

// POST /api/branch_products
export async function createBranchProduct(req, res, next) {
  const client = await pool.connect();
  try {
    const pro_name = req.body?.pro_name;
    const pro_shortname = normalizeSpaced(req.body, "pro_shortname", " pro_shortname");
    const pro_image = normalizeSpaced(req.body, "pro_image", " pro_image");
    const pro_des = normalizeSpaced(req.body, "pro_des", " pro_des");
    const pro_quantity = req.body?.pro_quantity;
    const pro_price = normalizeProPrice(req.body);
    const Cat_id = normalizeCatId(req.body);
    const pro_id = req.body?.pro_id;
    const B_id = req.body?.B_id;

    if (
      !pro_name ||
      pro_shortname === undefined ||
      !pro_image ||
      !pro_des ||
      pro_quantity === undefined ||
      pro_price === undefined ||
      Cat_id === undefined ||
      pro_id === undefined ||
      B_id === undefined
    ) {
      res.status(400);
      throw new Error(
        "pro_name, pro_shortname, pro_image, pro_des, pro_quantity, pro_price, cat_id, pro_id and B_id are required"
      );
    }

    if (typeof pro_name !== "string" || pro_name.trim().length === 0) {
      res.status(400);
      throw new Error("pro_name must be a non-empty string");
    }
    if (typeof pro_shortname !== "string" || pro_shortname.trim().length === 0) {
      res.status(400);
      throw new Error("pro_shortname must be a non-empty string");
    }
    if (typeof pro_image !== "string" || pro_image.trim().length === 0) {
      res.status(400);
      throw new Error("pro_image must be a non-empty string");
    }
    if (typeof pro_des !== "string" || pro_des.trim().length === 0) {
      res.status(400);
      throw new Error("pro_des must be a non-empty string");
    }
    if (!isNonNegativeNumber(pro_quantity)) {
      res.status(400);
      throw new Error("pro_quantity must be a non-negative number");
    }
    if (!isNonNegativeNumber(pro_price)) {
      res.status(400);
      throw new Error("pro_price must be a non-negative number");
    }
    if (!isPositiveInt(Cat_id)) {
      res.status(400);
      throw new Error("cat_id must be a positive integer");
    }
    if (!isPositiveInt(pro_id)) {
      res.status(400);
      throw new Error("pro_id must be a positive integer");
    }
    if (!isPositiveInt(B_id)) {
      res.status(400);
      throw new Error("B_id must be a positive integer");
    }

    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      const branchCheck = await client.query('SELECT "com_id" FROM "public"."Branch" WHERE "B_id" = $1', [B_id]);
      if (branchCheck.rows.length === 0 || branchCheck.rows[0].com_id !== req.user.com_id) {
        res.status(403);
        throw new Error("You do not have permission to add products to this branch.");
      }

      const productCheck = await client.query('SELECT "Com_id" FROM "public"."Product" WHERE "pro_id" = $1', [pro_id]);
      if (productCheck.rows.length === 0 || productCheck.rows[0].Com_id !== req.user.com_id) {
        res.status(403);
        throw new Error("You do not have permission to use this base product.");
      }
    }

    await client.query("BEGIN");

    // Lock and check the base product stock
    const productStock = await client.query(
      `SELECT "pro_qty", COALESCE("track_inventory", TRUE) AS track_inventory
         FROM "public"."Product" WHERE "pro_id" = $1 FOR UPDATE`,
      [pro_id]
    );
    if (productStock.rows.length === 0) {
      res.status(404);
      throw new Error("Base product not found");
    }

    // A dish cooked to order carries no stock anywhere, so there is nothing to
    // move down from the main hotel and nothing to hold here. Without this it
    // could not be put on a menu at all: the main count is zero, and asking for
    // a single portion was refused as "Not enough in the storeroom: only 0
    // available" — a count that should never have been consulted.
    const madeToOrder = productStock.rows[0].track_inventory === false;
    const openingQty = madeToOrder ? 0 : Number(pro_quantity);

    if (!madeToOrder) {
      const currentBaseQty = Number(productStock.rows[0].pro_qty ?? 0);
      if (openingQty > currentBaseQty) {
        res.status(400);
        throw new Error(`Not enough in the storeroom: only ${currentBaseQty} available`);
      }

      // Deduct from main stock
      await client.query(
        'UPDATE "public"."Product" SET "pro_qty" = "pro_qty" - $1 WHERE "pro_id" = $2',
        [openingQty, pro_id]
      );
    }

    const result = await client.query(
      `
      WITH inserted AS (
        INSERT INTO "public"."Branch_Product"
          ("pro_name", " pro_shortname", " pro_image", " pro_des", "pro_quantity", " Pro_Price", "Cat_id", "pro_id", "B_id")
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      )
      SELECT
        i."Bpro_id",
        i."pro_name",
        i." pro_shortname" AS "pro_shortname",
        i." pro_image" AS "pro_image",
        i." pro_des" AS "pro_des",
        i."pro_quantity",
        i." Pro_Price" AS "pro_price",
        i."Cat_id" AS "cat_id",
        i."pro_id",
        i."B_id",
        p."stations"
      FROM inserted i
      LEFT JOIN "public"."Product" p ON i."pro_id" = p."pro_id"
      `,
      [pro_name, pro_shortname, pro_image, pro_des, openingQty, pro_price, Cat_id, pro_id, B_id]
    );

    await client.query("COMMIT");
    const made = toResponseRow(result.rows[0]);
    logActivity(req, { action: "create", entity: "product", entity_id: made.Bpro_id, b_id: Number(B_id),
      summary: `Added menu item "${made.pro_name ?? made.name ?? made.Bpro_id}"` });
    res.status(201).json(made);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err?.code === "23503") {
      res.status(400);
      return next(
        new Error("Invalid foreign key: cat_id, pro_id or B_id does not exist")
      );
    }
    next(err);
  } finally {
    client.release();
  }
}

// PUT /api/branch_products/:id
export async function updateBranchProduct(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) {
      res.status(400);
      throw new Error("Invalid branch product id");
    }

    const pro_name = req.body?.pro_name;
    const pro_shortname = normalizeSpaced(req.body, "pro_shortname", " pro_shortname");
    const pro_image = normalizeSpaced(req.body, "pro_image", " pro_image");
    const pro_des = normalizeSpaced(req.body, "pro_des", " pro_des");
    const pro_quantity = req.body?.pro_quantity;
    const pro_price = normalizeProPrice(req.body);
    const Cat_id = normalizeCatId(req.body);
    const pro_id = req.body?.pro_id;
    const B_id = normalizeBranchId(req.body);

    if (pro_name !== undefined && (typeof pro_name !== "string" || pro_name.trim().length === 0)) {
      res.status(400);
      throw new Error("pro_name must be a non-empty string");
    }
    if (
      pro_shortname !== undefined &&
      (typeof pro_shortname !== "string" || pro_shortname.trim().length === 0)
    ) {
      res.status(400);
      throw new Error("pro_shortname must be a non-empty string");
    }
    if (pro_image !== undefined && (typeof pro_image !== "string" || pro_image.trim().length === 0)) {
      res.status(400);
      throw new Error("pro_image must be a non-empty string");
    }
    if (pro_des !== undefined && (typeof pro_des !== "string" || pro_des.trim().length === 0)) {
      res.status(400);
      throw new Error("pro_des must be a non-empty string");
    }
    if (pro_quantity !== undefined && !isNonNegativeNumber(pro_quantity)) {
      res.status(400);
      throw new Error("pro_quantity must be a non-negative number");
    }
    if (pro_price !== undefined && !isNonNegativeNumber(pro_price)) {
      res.status(400);
      throw new Error("pro_price must be a non-negative number");
    }
    if (Cat_id !== undefined && !isPositiveInt(Cat_id)) {
      res.status(400);
      throw new Error("cat_id must be a positive integer");
    }
    if (pro_id !== undefined && !isPositiveInt(pro_id)) {
      res.status(400);
      throw new Error("pro_id must be a positive integer");
    }
    if (B_id !== undefined && !isPositiveInt(B_id)) {
      res.status(400);
      throw new Error("B_id must be a positive integer");
    }

    await client.query("BEGIN");

    let checkQuery = `
      SELECT bp."Bpro_id", bp."pro_quantity", bp."pro_id", bp."B_id"
      FROM "public"."Branch_Product" bp
    `;
    let checkParams = [id];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      checkQuery += ` JOIN "public"."Branch" b ON bp."B_id" = b."B_id" WHERE bp."Bpro_id" = $1 AND b."com_id" = $2 FOR UPDATE`;
      checkParams.push(req.user.com_id);
    } else {
      checkQuery += ` WHERE bp."Bpro_id" = $1 FOR UPDATE`;
    }
    const existing = await client.query(checkQuery, checkParams);
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Branch product not found");
    }

    const oldBranchQty = Number(existing.rows[0].pro_quantity ?? 0);
    const baseProId    = existing.rows[0].pro_id;

    // This form edits what an item is called and what it costs. What is on the
    // shelf changes only through a count, which records what was counted and
    // why. The +/− stepper used to move the figure through here with no note,
    // no ledger line and nothing in the activity log — so the count and the
    // ledger drifted apart and nobody could see who had moved it, or why.
    if (pro_quantity !== undefined && Number(pro_quantity) !== oldBranchQty) {
      // A dish with a recipe is made to order: what limits it is its
      // ingredients, counted on the Inventory page. A number typed here would
      // mean nothing, so it is refused rather than quietly stored.
      const hasRecipe = await client.query(
        'SELECT 1 FROM "public"."RECIPE" WHERE "pro_id" = $1 LIMIT 1', [baseProId]);
      if (hasRecipe.rows.length) {
        res.status(400);
        throw new Error(
          "This dish is made from its recipe, so its stock is its ingredients — update those on the Inventory page.");
      }

      // Sending them to Count would only get them refused again: there is
      // nothing on a shelf to count.
      const tracked = await client.query(
        'SELECT COALESCE("track_inventory", TRUE) AS t FROM "public"."Product" WHERE pro_id = $1', [baseProId]);
      if (tracked.rows[0]?.t === false) {
        res.status(400);
        throw new Error(
          "This one is made to order, so it carries no stock. If the kitchen has started making it in batches, set it to counted stock on the product page first.");
      }

      res.status(400);
      throw new Error(
        "Change the stock with “Count” — it records what was counted and why.");
    }

    const result = await client.query(
      `
      WITH updated AS (
        UPDATE "public"."Branch_Product"
        SET
          "pro_name" = COALESCE($1, "pro_name"),
          " pro_shortname" = COALESCE($2, " pro_shortname"),
          " pro_image" = COALESCE($3, " pro_image"),
          " pro_des" = COALESCE($4, " pro_des"),
          "pro_quantity" = COALESCE($5, "pro_quantity"),
          " Pro_Price" = COALESCE($6, " Pro_Price"),
          "Cat_id" = COALESCE($7, "Cat_id"),
          "pro_id" = COALESCE($8, "pro_id"),
          "B_id" = COALESCE($9, "B_id")
        WHERE "Bpro_id" = $10
        RETURNING *
      )
      SELECT
        u."Bpro_id",
        u."pro_name",
        u." pro_shortname" AS "pro_shortname",
        u." pro_image" AS "pro_image",
        u." pro_des" AS "pro_des",
        u."pro_quantity",
        u." Pro_Price" AS "pro_price",
        u."Cat_id" AS "cat_id",
        u."pro_id",
        u."B_id",
        p."stations"
      FROM updated u
      LEFT JOIN "public"."Product" p ON u."pro_id" = p."pro_id"
      `,
      [
        fieldOrNull(pro_name),
        fieldOrNull(pro_shortname),
        fieldOrNull(pro_image),
        fieldOrNull(pro_des),
        null, // pro_quantity: never written here — see the guard above
        fieldOrNull(pro_price),
        fieldOrNull(Cat_id),
        fieldOrNull(pro_id),
        fieldOrNull(B_id),
        id,
      ]
    );

    await client.query("COMMIT");
    const saved = toResponseRow(result.rows[0]);
    logActivity(req, { action: "update", entity: "product", entity_id: id, b_id: saved.B_id ?? saved.b_id,
      summary: `Updated menu item "${saved.pro_name ?? saved.name ?? id}"`
        + (pro_price != null ? ` — price ${saved.pro_price ?? pro_price}` : "") });
    res.json(saved);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err?.code === "23503") {
      res.status(400);
      return next(
        new Error("Invalid foreign key: cat_id, pro_id or B_id does not exist")
      );
    }
    next(err);
  } finally {
    client.release();
  }
}

// DELETE /api/branch_products/:id
export async function deleteBranchProduct(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) {
      res.status(400);
      throw new Error("Invalid branch product id");
    }

    await client.query("BEGIN");

    let checkQuery = `
      SELECT bp."Bpro_id", bp."pro_quantity", bp."pro_id", bp."B_id"
      FROM "public"."Branch_Product" bp
    `;
    let checkParams = [id];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      checkQuery += ` JOIN "public"."Branch" b ON bp."B_id" = b."B_id" WHERE bp."Bpro_id" = $1 AND b."com_id" = $2 FOR UPDATE`;
      checkParams.push(req.user.com_id);
    } else {
      checkQuery += ` WHERE bp."Bpro_id" = $1 FOR UPDATE`;
    }
    const existing = await client.query(checkQuery, checkParams);
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Branch product not found");
    }

    const remainingQty = Number(existing.rows[0].pro_quantity ?? 0);
    const baseProId    = existing.rows[0].pro_id;
    const branchBId    = existing.rows[0].B_id;

    if (remainingQty > 0) {
      // Return remaining stock to the base product
      await client.query(
        'UPDATE "public"."Product" SET "pro_qty" = "pro_qty" + $1 WHERE "pro_id" = $2',
        [remainingQty, baseProId]
      );
    }

    // Read the name before it is gone — an audit line needs to say what went.
    const named = await client.query(
      'SELECT p."pro_name" FROM "public"."Product" p WHERE p."pro_id" = $1', [baseProId]
    );

    const result = await client.query(
      'DELETE FROM "public"."Branch_Product" WHERE "Bpro_id" = $1 RETURNING "Bpro_id"',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("Branch product not found");
    }

    await client.query("COMMIT");
    logActivity(req, { action: "delete", entity: "product", entity_id: id, b_id: branchBId,
      summary: `Deleted menu item "${named.rows[0]?.pro_name ?? id}"`
        + (remainingQty > 0 ? ` (${remainingQty} in stock returned)` : "") });
    res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /api/branch_products/:id/restock — bring more of a counted item down from
 * the main store to this branch's shelf. It is a transfer: the main store goes
 * down by what the branch goes up by, so the two never disagree, and the move is
 * written to the stock ledger and the activity log.
 */
export async function restockBranchProduct(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      res.status(400);
      throw new Error("Invalid branch product id");
    }
    const qty = Number(req.body?.qty);
    if (req.body?.qty === "" || req.body?.qty == null || !Number.isInteger(qty) || qty < 1 || qty > 1000000) {
      res.status(400);
      throw new Error("Enter how many to bring across — a whole number, 1 or more.");
    }

    await client.query("BEGIN");
    let q = `SELECT bp."Bpro_id", bp.pro_name, bp.pro_quantity, bp.pro_id, bp."B_id"
               FROM "public"."Branch_Product" bp`;
    const p = [id];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      q += ` JOIN "public"."Branch" b ON b."B_id" = bp."B_id" WHERE bp."Bpro_id" = $1 AND b."com_id" = $2`;
      p.push(req.user.com_id);
      if (req.user.b_id) {
        q += ` AND bp."B_id" = $3`;
        p.push(req.user.b_id);
      }
    } else {
      q += ` WHERE bp."Bpro_id" = $1`;
    }
    const found = await client.query(q + " FOR UPDATE OF bp", p);
    if (!found.rows.length) {
      res.status(404);
      throw new Error("Branch product not found");
    }
    const item = found.rows[0];

    const recipe = await client.query(
      'SELECT 1 FROM "public"."RECIPE" WHERE "pro_id" = $1 LIMIT 1', [item.pro_id]);
    if (recipe.rows.length) {
      res.status(400);
      throw new Error("This dish is made from its recipe, so its stock is its ingredients — restock those on the Inventory page.");
    }
    const main = await client.query(
      `SELECT pro_qty, COALESCE(track_inventory, TRUE) AS t FROM "public"."Product" WHERE pro_id = $1 FOR UPDATE`,
      [item.pro_id]);
    if (!main.rows.length) {
      res.status(404);
      throw new Error("Base product not found");
    }
    if (main.rows[0].t === false) {
      res.status(400);
      throw new Error("This one is made to order, so it carries no stock to bring across.");
    }
    const inMain = Number(main.rows[0].pro_qty ?? 0);
    if (qty > inMain) {
      res.status(400);
      throw new Error(`The storeroom only has ${inMain}. Receive more from a supplier first (Inventory → Add Inventory Item).`);
    }

    const before = Number(item.pro_quantity ?? 0);
    await client.query('UPDATE "public"."Product" SET "pro_qty" = "pro_qty" - $1 WHERE "pro_id" = $2', [qty, item.pro_id]);
    await client.query('UPDATE "public"."Branch_Product" SET "pro_quantity" = "pro_quantity" + $1 WHERE "Bpro_id" = $2', [qty, id]);
    await client.query(
      `INSERT INTO "STOCK_MOVEMENT" (b_id, bpro_id, qty, reason, note, created_by)
       VALUES ($1, $2, $3, 'transfer', 'From the storeroom', $4)`,
      [item.B_id, id, qty, req.user?.u_id ?? null]);
    await client.query("COMMIT");

    logActivity(req, {
      action: "update", entity: "product", entity_id: id, b_id: item.B_id,
      summary: `Brought ${qty} ${item.pro_name} across from the storeroom (${before} → ${before + qty} on the shelf)`,
      details: { qty, before, after: before + qty, main_before: inMain, main_after: inMain - qty },
    });
    res.json({ Bpro_id: id, pro_name: item.pro_name, pro_quantity: before + qty, main_qty: inMain - qty });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /api/branch_products/:id/count — the manager counts a counted item on
 * the shelf. It sets the figure; unlike the +/− buttons it moves nothing from
 * main stock, because a correction is not a transfer. A dish made from a recipe
 * has no count of its own — its stock is its ingredients, counted on the
 * Inventory page.
 */
export async function countBranchProduct(req, res, next) {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!isPositiveInt(id)) {
      res.status(400);
      throw new Error("Invalid branch product id");
    }
    const counted = Number(req.body?.counted);
    const note = String(req.body?.note ?? "").trim();
    if (req.body?.counted === "" || req.body?.counted == null
        || !Number.isInteger(counted) || counted < 0 || counted > 1000000) {
      res.status(400);
      throw new Error("Enter what you counted — a whole number, zero or more.");
    }
    if (note.length < 3 || note.length > 200) {
      res.status(400);
      throw new Error("Say why the count changed (3–200 characters) — it is kept on the record.");
    }

    await client.query("BEGIN");
    let q = `SELECT bp."Bpro_id", bp.pro_name, bp.pro_quantity, bp.pro_id, bp."B_id"
               FROM "public"."Branch_Product" bp`;
    const p = [id];
    if (req.user.role_id !== ROLES.SUPER_ADMIN) {
      q += ` JOIN "public"."Branch" b ON b."B_id" = bp."B_id" WHERE bp."Bpro_id" = $1 AND b."com_id" = $2`;
      p.push(req.user.com_id);
      if (req.user.b_id) {
        q += ` AND bp."B_id" = $3`;
        p.push(req.user.b_id);
      }
    } else {
      q += ` WHERE bp."Bpro_id" = $1`;
    }
    const found = await client.query(q + " FOR UPDATE OF bp", p);
    if (!found.rows.length) {
      res.status(404);
      throw new Error("Branch product not found");
    }
    const item = found.rows[0];
    const recipe = await client.query(
      'SELECT 1 FROM "public"."RECIPE" WHERE "pro_id" = $1 LIMIT 1', [item.pro_id]);
    if (recipe.rows.length) {
      res.status(400);
      throw new Error(
        "This dish is made from its recipe, so its stock is its ingredients — count those on the Inventory page.");
    }
    const tracked = await client.query(
      'SELECT COALESCE("track_inventory", TRUE) AS t FROM "public"."Product" WHERE pro_id = $1', [item.pro_id]);
    if (tracked.rows[0]?.t === false) {
      res.status(400);
      throw new Error(
        "This one is made to order, so there is nothing on a shelf to count. If it is something you make in batches, set it to counted on the product page.");
    }

    const before = Number(item.pro_quantity ?? 0);
    const change = counted - before;
    await client.query(
      'UPDATE "public"."Branch_Product" SET "pro_quantity" = $1 WHERE "Bpro_id" = $2', [counted, id]);
    if (change !== 0) {
      await client.query(
        `INSERT INTO "STOCK_MOVEMENT" (b_id, bpro_id, qty, reason, note, created_by)
         VALUES ($1, $2, $3, 'adjust', $4, $5)`,
        [item.B_id, id, change, note, req.user?.u_id ?? null]);
    }
    await client.query("COMMIT");

    logActivity(req, {
      action: "update", entity: "product", entity_id: id, b_id: item.B_id,
      summary: `Counted ${item.pro_name}: ${counted} on the shelf (the system said ${before}) — ${note}`,
      details: { before, after: counted, change, note },
    });
    res.json({ Bpro_id: id, pro_name: item.pro_name, pro_quantity: counted, before, change });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}
