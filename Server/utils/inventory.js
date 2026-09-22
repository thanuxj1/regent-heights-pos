import { logActivity } from "./activityLog.js";

/**
 * Stock, taken at the moment of sale.
 *
 * Three kinds of menu item:
 *   - a dish with a recipe ("recipe") — selling one takes its ingredients out
 *     of Raw_Material, converted into the unit each ingredient is stocked in;
 *   - something counted ("count") — a bottle of water, a tray of pastries — is
 *     counted as itself on Branch_Product.pro_quantity;
 *   - something cooked to order ("made_to_order") — no recipe written down and
 *     nothing to count. Nothing is deducted and nothing runs out; how many were
 *     made is how many were sold, which is a question for the end of the day.
 *     Product.track_inventory = false is what says so.
 *
 * Every change is written to STOCK_MOVEMENT against the order line that caused
 * it, so returnStock() puts back exactly what was taken: not what the recipe
 * says today, and never twice (a unique index on `reverses` enforces that).
 *
 * The old code clamped at zero — GREATEST(0, stock - qty) — which made a sale
 * of something already at zero vanish from the count, and then "returned" a
 * portion on void that had never been taken. Nothing here clamps.
 */

// Units a recipe may be written in, and what they are worth in a base unit.
const UNITS = {
  mg: ["mass", 0.001], g: ["mass", 1], kg: ["mass", 1000],
  ml: ["volume", 1], l: ["volume", 1000],
  pcs: ["count", 1], units: ["count", 1], unit: ["count", 1], dozen: ["count", 12],
};

/** A recipe quantity in the unit the ingredient is stocked in. */
export function convertQty(qty, fromUnit, toUnit, yieldUnit, yieldAmount) {
  const from = String(fromUnit || "").toLowerCase().trim();
  const to = String(toUnit || "").toLowerCase().trim();
  if (!from || !to || from === to) return qty;
  
  // Custom yield conversion: if stock is 'bottle' and recipe uses 'ml', 
  // and yield is 'ml' / 500, then converting 'ml' to 'bottle' => qty / 500.
  // converting 'bottle' to 'ml' => qty * 500.
  if (yieldUnit && yieldAmount) {
    const yU = String(yieldUnit).toLowerCase().trim();
    if (from === yU && to !== yU) {
      return qty / Number(yieldAmount);
    } else if (to === yU && from !== yU) {
      return qty * Number(yieldAmount);
    }
  }

  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a[0] !== b[0]) return qty; // unknown or incompatible: as written
  return (qty * a[1]) / b[1];
}

const round3 = (n) => Math.round(n * 1000) / 1000;
const show = (n) => String(Number(Number(n).toFixed(3)));
const sortedUnique = (xs) => [...new Set(xs.map(Number))].sort((a, b) => a - b);

/**
 * Put a sale that went past the stock count on the owner's record. Nothing is
 * refused: the count was wrong or the kitchen had more than it knew, and either
 * way the manager needs to recount — this is how they find out.
 */
export function noteShortfall(req, { b_id, order_id, short }) {
  if (!short?.length) return;
  const what = short.map((s) => (s.missing
    ? `${s.item} needs ${s.name}, which is not stocked here`
    : `${s.name} now ${show(s.have - s.need)}${s.unit ? ` ${s.unit}` : ""}`)).join("; ");
  logActivity(req, {
    action: "update", entity: "order", entity_id: order_id, b_id,
    summary: `Sold beyond the stock count on order #${order_id} — ${what}. Worth a recount.`,
    details: { stock_shortfall: short.map((s) => s.name) },
  });
}

/** A line names a product that is not on this property's menu. */
export class NotOnMenuError extends Error {
  constructor(ids) {
    super("That item is not on this property's menu.");
    this.name = "NotOnMenuError";
    this.status = 400;
    this.ids = ids;
  }
}

export const isStockProblem = (e) => e instanceof NotOnMenuError;

/** What each line of a sale consumes, resolved to this property's stock rows. */
async function planFor(db, b_id, lines) {
  const ids = sortedUnique(lines.map((l) => l.bpro_id));
  const { rows } = await db.query(
    `SELECT bp."Bpro_id" AS bpro_id, bp.pro_name,
            COALESCE(p."track_inventory", TRUE) AS track_inventory,
            r.recipe_id, r.quantity_req, r.unit AS recipe_unit,
            rm.rm_id, rm.rm_name, rm.unit AS stock_unit, rm.b_id AS rm_b_id,
            rm.yield_unit, rm.yield_amount
       FROM "Branch_Product" bp
       LEFT JOIN "Product" p       ON p.pro_id = bp.pro_id
       LEFT JOIN "RECIPE" r        ON r.pro_id = bp.pro_id
       LEFT JOIN "Raw_Material" rm ON rm.rm_id = r."rawmaterial_ID"
      WHERE bp."Bpro_id" = ANY($1::int[]) AND bp."B_id" = $2
      ORDER BY bp."Bpro_id", r.recipe_id`,
    [ids, b_id],
  );
  const found = new Set(rows.map((r) => Number(r.bpro_id)));
  const notHere = ids.filter((id) => !found.has(id));
  if (notHere.length) throw new NotOnMenuError(notHere);

  const names = new Map();
  const counted = new Map();
  const recipes = new Map();
  for (const r of rows) {
    const bid = Number(r.bpro_id);
    names.set(bid, r.pro_name);
    counted.set(bid, r.track_inventory !== false);
    if (!r.recipe_id) continue;
    // A recipe is written against one property's ingredient. Sold at another,
    // it draws on that property's ingredient of the same name.
    let rm = { rm_id: r.rm_id, rm_name: r.rm_name, unit: r.stock_unit, yield_unit: r.yield_unit, yield_amount: r.yield_amount };
    if (r.rm_b_id == null || Number(r.rm_b_id) !== Number(b_id)) {
      const here = await db.query(
        `SELECT rm_id, rm_name, unit, yield_unit, yield_amount FROM "Raw_Material"
          WHERE b_id = $1 AND LOWER(rm_name) = LOWER($2) ORDER BY rm_id LIMIT 1`,
        [b_id, r.rm_name]);
      rm = here.rows[0] || rm;
    }
    const per = convertQty(Number(r.quantity_req), r.recipe_unit || rm.unit, rm.unit, rm.yield_unit, rm.yield_amount);
    if (!recipes.has(bid)) recipes.set(bid, []);
    recipes.get(bid).push({ rm_id: rm.rm_id, name: rm.rm_name, unit: rm.unit, per });
  }

  const plan = [];
  const missing = [];
  for (const l of lines) {
    const bid = Number(l.bpro_id);
    const qty = Number(l.qty);
    const recipe = recipes.get(bid);
    if (recipe?.length) {
      for (const ing of recipe) {
        if (!ing.rm_id) {
          missing.push({ kind: "rm", missing: true, item: names.get(bid), name: ing.name });
          continue;
        }
        const amount = round3(ing.per * qty);
        if (amount > 0) {
          plan.push({ order_item_id: l.order_item_id ?? null, kind: "rm", id: ing.rm_id,
                      name: ing.name, unit: ing.unit, amount });
        }
      }
    } else if (counted.get(bid)) {
      plan.push({ order_item_id: l.order_item_id ?? null, kind: "bp", id: bid,
                  name: names.get(bid), unit: "", amount: qty });
    }
    // else: made to order. There is no stock of it to take — the ingredients
    // are whatever the cook reached for, and the property counts those, not
    // portions of a dish nobody had made yet.
  }
  return { plan, missing };
}

/**
 * Lock the stock rows a change will touch, always in the same order, so two
 * tills selling from the same ingredients queue behind each other instead of
 * deadlocking. Returns what is on hand.
 *
 * NO KEY UPDATE rather than UPDATE, and the difference is not academic. A sale
 * writes its lines first, and every ORDER_ITEM row references Branch_Product,
 * so that insert quietly holds a KEY SHARE lock on the very row this wants.
 * Two tills selling the same item each held that share and each asked to
 * upgrade it: Postgres called it a deadlock and one of them lost the sale — 32
 * of them in a 45-second load run. NO KEY UPDATE does not conflict with KEY
 * SHARE, and since nothing here changes a primary key it is the right lock as
 * well as the one that does not deadlock. Two sales of the same item still
 * queue behind each other, which is the point.
 */
async function lockStock(db, rmIds, bpIds) {
  const have = new Map();
  if (rmIds.length) {
    const { rows } = await db.query(
      `SELECT rm_id, stock_qty FROM "Raw_Material"
        WHERE rm_id = ANY($1::int[]) ORDER BY rm_id FOR NO KEY UPDATE`, [rmIds]);
    for (const r of rows) have.set(`rm:${r.rm_id}`, Number(r.stock_qty));
  }
  if (bpIds.length) {
    const { rows } = await db.query(
      `SELECT "Bpro_id", pro_quantity FROM "Branch_Product"
        WHERE "Bpro_id" = ANY($1::int[]) ORDER BY "Bpro_id" FOR NO KEY UPDATE`, [bpIds]);
    for (const r of rows) have.set(`bp:${r.Bpro_id}`, Number(r.pro_quantity ?? 0));
  }
  return have;
}

/**
 * Take the stock a sale needs. Must run inside the sale's own transaction.
 *
 * lines: [{ bpro_id, qty, order_item_id }]
 *
 * A sale is never refused because the count says there is not enough. Counts
 * drift — a delivery not yet entered, a sack miscounted — and a kitchen that has
 * the food must be able to sell it. Stock goes below zero instead, which is the
 * honest figure: it tells the manager to recount, where clamping at zero (the old
 * code) hid it. What ran short is returned so the caller can note it.
 *
 * `reason` is 'sale' for anything rung up at a till. Food a guest's room rate
 * already paid for goes out as 'meal_plan' against their booking: the same
 * ledger, so the count still reconciles, but a report can tell the breakfast the
 * hotel owed them from the one they bought.
 */
export async function takeStock(db, {
  b_id, order_id = null, booking_id = null, lines, u_id = null, reason = "sale",
}) {
  const { plan, missing } = await planFor(db, b_id, lines);
  const have = await lockStock(
    db,
    sortedUnique(plan.filter((p) => p.kind === "rm").map((p) => p.id)),
    sortedUnique(plan.filter((p) => p.kind === "bp").map((p) => p.id)),
  );

  // Two lines of kottu and one of chicken rice may all want the same flour.
  const need = new Map();
  for (const p of plan) {
    const k = `${p.kind}:${p.id}`;
    const cur = need.get(k) || { kind: p.kind, name: p.name, unit: p.unit, need: 0 };
    cur.need = round3(cur.need + p.amount);
    need.set(k, cur);
  }
  const short = [...missing];
  for (const [k, n] of need) {
    const h = have.get(k) ?? 0;
    if (n.need > h + 1e-9) short.push({ ...n, have: h });
  }

  for (const p of plan) {
    if (p.kind === "rm") {
      await db.query(
        `UPDATE "Raw_Material" SET stock_qty = stock_qty - $1::numeric WHERE rm_id = $2`,
        [p.amount, p.id]);
    } else {
      await db.query(
        `UPDATE "Branch_Product" SET pro_quantity = pro_quantity - $1::numeric WHERE "Bpro_id" = $2`,
        [p.amount, p.id]);
    }
    await db.query(
      `INSERT INTO "STOCK_MOVEMENT"
         (b_id, rm_id, bpro_id, qty, reason, order_id, order_item_id, booking_id, created_by)
       VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9)`,
      [b_id, p.kind === "rm" ? p.id : null, p.kind === "bp" ? p.id : null,
       -p.amount, reason, order_id, p.order_item_id, booking_id, u_id]);
  }
  return { short };
}

/**
 * Put back what a sale took — a whole order, or one line of it. Replays the
 * recorded movements, so it returns exactly what was taken even if the recipe
 * has changed since, and skips anything already returned.
 */
export async function returnStock(db, {
  order_id = null, order_item_id = null, booking_id = null, u_id = null,
}) {
  if (order_id == null && order_item_id == null && booking_id == null) return [];
  const col = booking_id != null ? "booking_id"
    : order_item_id != null ? "order_item_id" : "order_id";
  const reason = booking_id != null ? "meal_plan" : "sale";
  const { rows } = await db.query(
    `SELECT m.move_id, m.b_id, m.rm_id, m.bpro_id, m.qty, m.order_id, m.order_item_id, m.booking_id
       FROM "STOCK_MOVEMENT" m
      WHERE m.${col} = $1 AND m.reason = $2
        AND NOT EXISTS (SELECT 1 FROM "STOCK_MOVEMENT" x WHERE x.reverses = m.move_id)
      ORDER BY m.move_id`,
    [booking_id ?? order_item_id ?? order_id, reason]);
  if (!rows.length) return [];

  await lockStock(
    db,
    sortedUnique(rows.filter((r) => r.rm_id).map((r) => r.rm_id)),
    sortedUnique(rows.filter((r) => r.bpro_id).map((r) => r.bpro_id)),
  );
  for (const m of rows) {
    if (m.rm_id) {
      await db.query(
        `UPDATE "Raw_Material" SET stock_qty = stock_qty - $1::numeric WHERE rm_id = $2`,
        [m.qty, m.rm_id]);
    } else {
      await db.query(
        `UPDATE "Branch_Product" SET pro_quantity = pro_quantity - $1::numeric WHERE "Bpro_id" = $2`,
        [m.qty, m.bpro_id]);
    }
    await db.query(
      `INSERT INTO "STOCK_MOVEMENT"
         (b_id, rm_id, bpro_id, qty, reason, order_id, order_item_id, booking_id, reverses, created_by)
       VALUES ($1, $2, $3, -($4::numeric), $5, $6, $7, $8, $9, $10)`,
      [m.b_id, m.rm_id, m.bpro_id, m.qty,
       reason === "meal_plan" ? "meal_plan_reversed" : "sale_reversed",
       m.order_id, m.order_item_id, m.booking_id, m.move_id, u_id]);
  }
  return rows;
}

/** A purchase order line arriving, written to the same ledger. */
export async function recordPurchase(db, { b_id, po_id, rm_id, qty, u_id = null }) {
  await db.query(
    `INSERT INTO "STOCK_MOVEMENT" (b_id, rm_id, qty, reason, po_id, created_by)
     VALUES ($1, $2, $3::numeric, 'purchase', $4, $5)`,
    [b_id, rm_id, qty, po_id, u_id]);
}

/**
 * How many of each menu item can be sold right now.
 *   recipe items        — the fewest portions any one ingredient allows
 *   counted items       — what is on the shelf
 *   made-to-order items — no answer, and none is wanted: `available` is null,
 *                         which every screen reads as "always on the menu"
 * items: rows with Bpro_id, pro_id, B_id, pro_quantity and, where the caller
 * has it, track_inventory; otherwise it is read here.
 * Returns Map(Bpro_id -> { stock_mode, available, limited_by }).
 */
export async function availabilityFor(db, items) {
  const out = new Map();
  if (!items.length) return out;

  const proIds = sortedUnique(items.map((i) => i.pro_id).filter((x) => x != null));

  // Whether each product is counted at all. The caller usually has it on the
  // row already; anything it did not bring is read here, so no call site can
  // quietly turn a made-to-order dish back into one that runs out.
  const tracked = new Map();
  for (const i of items) {
    if (i.track_inventory !== undefined && i.pro_id != null) {
      tracked.set(Number(i.pro_id), i.track_inventory !== false);
    }
  }
  const unknown = proIds.filter((id) => !tracked.has(id));
  if (unknown.length) {
    const { rows: ps } = await db.query(
      `SELECT pro_id, COALESCE("track_inventory", TRUE) AS track_inventory
         FROM "Product" WHERE pro_id = ANY($1::int[])`, [unknown]);
    for (const p of ps) tracked.set(Number(p.pro_id), p.track_inventory !== false);
  }

  const { rows } = proIds.length
    ? await db.query(
      `SELECT r.pro_id, r.quantity_req, r.unit AS recipe_unit,
              rm.rm_name, rm.unit AS stock_unit, rm.b_id AS rm_b_id, rm.stock_qty,
              rm.yield_unit, rm.yield_amount
         FROM "RECIPE" r JOIN "Raw_Material" rm ON rm.rm_id = r."rawmaterial_ID"
        WHERE r.pro_id = ANY($1::int[])`, [proIds])
    : { rows: [] };
  const byPro = new Map();
  for (const r of rows) {
    const k = Number(r.pro_id);
    if (!byPro.has(k)) byPro.set(k, []);
    byPro.get(k).push(r);
  }

  // Same-named ingredients at each property, for recipes written against another one.
  const branches = sortedUnique(items.map((i) => i.B_id).filter((x) => x != null));
  const local = new Map();
  if (rows.some((r) => r.rm_b_id != null && branches.some((b) => b !== Number(r.rm_b_id)))) {
    const { rows: rms } = await db.query(
      `SELECT b_id, LOWER(rm_name) AS nm, stock_qty, unit, yield_unit, yield_amount FROM "Raw_Material"
        WHERE b_id = ANY($1::int[]) ORDER BY rm_id`, [branches]);
    for (const x of rms) {
      const k = `${x.b_id}:${x.nm}`;
      if (!local.has(k)) local.set(k, x);
    }
  }

  for (const it of items) {
    const recipe = byPro.get(Number(it.pro_id)) || [];
    if (!recipe.length) {
      const isCounted = tracked.get(Number(it.pro_id)) !== false;
      out.set(Number(it.Bpro_id), isCounted
        ? {
          stock_mode: "count",
          available: Math.floor(Number(it.pro_quantity ?? 0)),
          limited_by: null,
        }
        : {
          // Made to order: there is nothing to be out of.
          stock_mode: "made_to_order",
          available: null,
          limited_by: null,
        });
      continue;
    }
    let best = Infinity;
    let limitedBy = null;
    for (const r of recipe) {
      let stock = Number(r.stock_qty);
      let unit = r.stock_unit;
      let yUnit = r.yield_unit;
      let yAmount = r.yield_amount;
      if (r.rm_b_id != null && Number(r.rm_b_id) !== Number(it.B_id)) {
        const l = local.get(`${it.B_id}:${String(r.rm_name).toLowerCase()}`);
        if (!l) { best = 0; limitedBy = r.rm_name; break; }
        stock = Number(l.stock_qty);
        unit = l.unit;
        yUnit = l.yield_unit;
        yAmount = l.yield_amount;
      }
      const per = convertQty(Number(r.quantity_req), r.recipe_unit || unit, unit, yUnit, yAmount);
      if (!(per > 0)) continue;
      const n = Math.floor((Math.max(0, stock) + 1e-9) / per);
      if (n < best) { best = n; limitedBy = r.rm_name; }
    }
    out.set(Number(it.Bpro_id), {
      stock_mode: "recipe",
      available: best === Infinity ? 0 : best,
      limited_by: limitedBy,
    });
  }
  return out;
}
