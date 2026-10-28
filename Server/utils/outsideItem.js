/**
 * Outside items (migration 075): something the property does not stock, bought
 * elsewhere and sold on to the customer. The line carries no product — the
 * cashier names it, prices it and says what it cost.
 */

const MAX_COST = 1_000_000;

/** A sale line that names no product but says what it is. */
export const isOutsideLine = (it) =>
  it != null && (it.Bpro_id === undefined || it.Bpro_id === null || it.Bpro_id === "")
  && it.item_name !== undefined && it.item_name !== null;

/**
 * What an outside line says about itself, checked: { name, cost, from } or
 * { error }. Quantity and price are checked with every other line's.
 */
export function readOutsideLine(it) {
  const name = String(it.item_name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "an outside item needs a name — what was it?" };
  if (name.length > 120) return { error: "the item's name is too long (120 letters at most)" };
  const raw = it.unit_cost;
  const cost = raw === undefined || raw === null || String(raw).trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(cost) || cost < 0) {
    return { error: `say what "${name}" cost to buy (0 if it cost nothing)` };
  }
  if (cost > MAX_COST) return { error: `the cost of "${name}" cannot exceed ${MAX_COST}` };
  const from = String(it.bought_from ?? "").trim().slice(0, 120) || null;
  return { name, cost: Number(cost.toFixed(2)), from };
}

/** The name a sale line goes by, in SQL: the product's, or the outside item's. */
export const LINE_NAME = (oi = "oi", bp = "bp") => `COALESCE(${bp}.pro_name, ${oi}.item_name)`;
