import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";

function normalizeComId(body) {
  return body?.com_id ?? body?.Com_id;
}

function fieldOrNull(value) {
  return value === undefined ? null : value;
}

function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

/**
 * A yes/no a form may send as a boolean, a string or a number.
 *
 * Boolean("false") is true, so a client sending the word rather than the value
 * would have turned every made-to-order dish back into a counted one — and it
 * would have looked like the toggle simply refusing to stay off.
 */
function asBool(value) {
  if (typeof value === "string") return !/^(false|0|no|off|)$/i.test(value.trim());
  return Boolean(value);
}

function isNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

const SELECT_COLS = `
  p."pro_id",
  p."pro_name",
  p."pro_qty",
  p."pro_price",
  p." pro_image"     AS "pro_image",
  p."Com_id"         AS "com_id",
  p."cat_id",
  c."cat_name",
  p."add_ons",
  p."stations",
  p."description",
  p."discount_pct",
  p."cost_price",
  p."tax_group",
  p."low_stock",
  p."track_inventory"
`;

const FROM_JOIN = `
  FROM "public"."Product" p
  LEFT JOIN "public"."category" c ON p."cat_id" = c."cat_id"
`;

// GET /api/products
export async function getProducts(req, res, next) {
  try {
    const { role_id, com_id } = req.user;
    let result;
    if (role_id === ROLES.SUPER_ADMIN) {
      result = await pool.query(
        `SELECT ${SELECT_COLS} ${FROM_JOIN} ORDER BY p."pro_id"`
      );
    } else {
      result = await pool.query(
        `SELECT ${SELECT_COLS} ${FROM_JOIN} WHERE p."Com_id" = $1 ORDER BY p."pro_id"`,
        [com_id]
      );
    }
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/products/:id
export async function getProductById(req, res, next) {
  try {
    const { id } = req.params;
    const { role_id, com_id } = req.user;
    if (!isPositiveInt(id)) {
      res.status(400);
      throw new Error("Invalid product id");
    }

    let query = `SELECT ${SELECT_COLS} ${FROM_JOIN} WHERE p."pro_id" = $1`;
    let params = [id];

    if (role_id !== ROLES.SUPER_ADMIN) {
      query += ' AND p."Com_id" = $2';
      params.push(com_id);
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("Product not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// POST /api/products
export async function createProduct(req, res, next) {
  try {
    const {
      pro_name, pro_qty, pro_price, pro_image, cat_id, add_ons, stations,
      description, discount_pct, cost_price, tax_group, low_stock, track_inventory,
    } = req.body;
    const com_id = normalizeComId(req.body);

    if (!pro_name || pro_qty === undefined || pro_price === undefined || com_id === undefined) {
      res.status(400);
      throw new Error("pro_name, pro_qty, pro_price and com_id are required");
    }

    if (typeof pro_name !== "string" || pro_name.trim().length === 0) {
      res.status(400);
      throw new Error("pro_name must be a non-empty string");
    }

    if (!isNonNegativeNumber(pro_qty)) {
      res.status(400);
      throw new Error("pro_qty must be a non-negative number");
    }

    if (!isNonNegativeNumber(pro_price)) {
      res.status(400);
      throw new Error("pro_price must be a non-negative number");
    }

    if (!isPositiveInt(com_id)) {
      res.status(400);
      throw new Error("com_id must be a positive integer");
    }

    const resolvedCatId = cat_id != null && isPositiveInt(cat_id) ? Number(cat_id) : null;
    // No invented extras. Cheese and Bacon were written onto every product
    // ever created here, on a field nothing reads.
    const finalAddOns = add_ons ? JSON.stringify(add_ons) : '{}';
    const finalStations = stations ? JSON.stringify(stations) : '{"Kitchen": true, "Bar": true}';
    const finalImage = pro_image && pro_image.trim() ? pro_image.trim() : '';
    const finalDiscountPct = discount_pct !== undefined ? Number(discount_pct) : 0;
    const finalCostPrice = cost_price !== undefined ? Number(cost_price) : 0;
    const finalTaxGroup = tax_group !== undefined ? Number(tax_group) : 0;
    const finalLowStock = low_stock !== undefined ? Number(low_stock) : 10;
    const finalTrackInventory = track_inventory !== undefined ? asBool(track_inventory) : true;

    const result = await pool.query(
      `INSERT INTO "public"."Product"
         ("pro_name", "pro_qty", "pro_price", " pro_image", "Com_id", "cat_id", "add_ons", "stations",
          "description", "discount_pct", "cost_price", "tax_group", "low_stock", "track_inventory")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING
         "pro_id","pro_name","pro_qty","pro_price"," pro_image" AS "pro_image","Com_id" AS "com_id","cat_id","add_ons","stations",
         "description","discount_pct","cost_price","tax_group","low_stock","track_inventory"`,
      [
        pro_name.trim(), Number(pro_qty), Number(pro_price), finalImage,
        Number(com_id), resolvedCatId, finalAddOns, finalStations,
        description || null, finalDiscountPct, finalCostPrice, finalTaxGroup, finalLowStock, finalTrackInventory,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(400);
      return next(new Error("Duplicate value: product already exists"));
    }
    if (err?.code === "23503") {
      res.status(400);
      return next(new Error("Invalid foreign key: com_id does not exist"));
    }
    next(err);
  }
}

// PUT /api/products/:id
export async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    const {
      pro_name, pro_qty, pro_price, pro_image, cat_id, add_ons, stations,
      description, discount_pct, cost_price, tax_group, low_stock, track_inventory,
    } = req.body;
    const com_id = normalizeComId(req.body);

    if (!isPositiveInt(id)) {
      res.status(400);
      throw new Error("Invalid product id");
    }

    if (pro_name !== undefined && (typeof pro_name !== "string" || pro_name.trim().length === 0)) {
      res.status(400);
      throw new Error("pro_name must be a non-empty string");
    }

    if (pro_qty !== undefined && !isNonNegativeNumber(pro_qty)) {
      res.status(400);
      throw new Error("pro_qty must be a non-negative number");
    }

    if (pro_price !== undefined && !isNonNegativeNumber(pro_price)) {
      res.status(400);
      throw new Error("pro_price must be a non-negative number");
    }

    if (com_id !== undefined && !isPositiveInt(com_id)) {
      res.status(400);
      throw new Error("com_id must be a positive integer");
    }

    if (cat_id !== undefined && cat_id !== null && !isPositiveInt(cat_id)) {
      res.status(400);
      throw new Error("cat_id must be a positive integer");
    }

    const { role_id, com_id: userComId } = req.user;
    if (role_id !== ROLES.SUPER_ADMIN && com_id !== undefined && com_id !== userComId) {
      res.status(403);
      throw new Error("You do not have permission to assign this product to another company.");
    }

    let checkQuery = 'SELECT "pro_id" FROM "public"."Product" WHERE "pro_id" = $1';
    let checkParams = [id];
    if (role_id !== ROLES.SUPER_ADMIN) {
      checkQuery += ' AND "Com_id" = $2';
      checkParams.push(userComId);
    }
    const existing = await pool.query(checkQuery, checkParams);
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Product not found");
    }

    const resolvedCatId = cat_id !== undefined ? (cat_id != null && isPositiveInt(cat_id) ? Number(cat_id) : null) : undefined;
    const finalAddOns = add_ons !== undefined ? (add_ons != null ? JSON.stringify(add_ons) : null) : undefined;
    const finalStations = stations !== undefined ? (stations != null ? JSON.stringify(stations) : null) : undefined;
    const finalImage = pro_image !== undefined ? (pro_image && pro_image.trim() ? pro_image.trim() : '') : undefined;
    const finalDiscountPct = discount_pct !== undefined ? Number(discount_pct) : undefined;
    const finalCostPrice = cost_price !== undefined ? Number(cost_price) : undefined;
    const finalTaxGroup = tax_group !== undefined ? Number(tax_group) : undefined;
    const finalLowStock = low_stock !== undefined ? Number(low_stock) : undefined;
    const finalTrackInventory = track_inventory !== undefined ? asBool(track_inventory) : undefined;

    const result = await pool.query(
      `UPDATE "public"."Product" SET
        "pro_name"        = COALESCE($1, "pro_name"),
        "pro_qty"         = COALESCE($2, "pro_qty"),
        "pro_price"       = COALESCE($3, "pro_price"),
        " pro_image"      = COALESCE($4, " pro_image"),
        "Com_id"          = COALESCE($5, "Com_id"),
        "cat_id"          = COALESCE($6, "cat_id"),
        "add_ons"         = COALESCE($7, "add_ons"),
        "stations"        = COALESCE($8, "stations"),
        "description"     = COALESCE($9, "description"),
        "discount_pct"    = COALESCE($10, "discount_pct"),
        "cost_price"      = COALESCE($11, "cost_price"),
        "tax_group"       = COALESCE($12, "tax_group"),
        "low_stock"       = COALESCE($13, "low_stock"),
        "track_inventory" = COALESCE($14, "track_inventory")
      WHERE "pro_id" = $15
      RETURNING
        "pro_id","pro_name","pro_qty","pro_price"," pro_image" AS "pro_image","Com_id" AS "com_id","cat_id","add_ons","stations",
        "description","discount_pct","cost_price","tax_group","low_stock","track_inventory"`,
      [
        fieldOrNull(pro_name),
        fieldOrNull(pro_qty !== undefined ? Number(pro_qty) : undefined),
        fieldOrNull(pro_price !== undefined ? Number(pro_price) : undefined),
        fieldOrNull(finalImage),
        fieldOrNull(com_id),
        fieldOrNull(resolvedCatId),
        fieldOrNull(finalAddOns),
        fieldOrNull(finalStations),
        fieldOrNull(description !== undefined ? (description || null) : undefined),
        fieldOrNull(finalDiscountPct),
        fieldOrNull(finalCostPrice),
        fieldOrNull(finalTaxGroup),
        fieldOrNull(finalLowStock),
        fieldOrNull(finalTrackInventory),
        id,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === "23503") {
      res.status(400);
      return next(new Error("Invalid foreign key: com_id does not exist"));
    }
    next(err);
  }
}

// DELETE /api/products/:id
export async function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!isPositiveInt(id)) {
      res.status(400);
      throw new Error("Invalid product id");
    }

    const { role_id, com_id } = req.user;
    let deleteQuery = 'DELETE FROM "public"."Product" WHERE "pro_id" = $1';
    let deleteParams = [id];
    if (role_id !== ROLES.SUPER_ADMIN) {
      deleteQuery += ' AND "Com_id" = $2';
      deleteParams.push(com_id);
    }
    deleteQuery += ' RETURNING "pro_id"';
    const result = await pool.query(deleteQuery, deleteParams);

    if (result.rows.length === 0) {
      res.status(404);
      throw new Error("Product not found");
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
