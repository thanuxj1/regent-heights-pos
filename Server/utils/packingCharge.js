// utils/packingCharge.js
//
// The packing charge on a takeaway or delivery order (migration 079): typed at
// the till, any amount, part of what the customer pays and — like the delivery
// charge — not taxed. A dine-in order has none.

const MAX_PACKING = 100_000;

/**
 * The charge to record for an order, or the reason it can't be.
 *
 * @param {string} orType   "delivery" | "takeaway" | "dine-in"
 * @param {*}      raw      what the request carried; undefined/null/"" means none
 * @returns {{ value: number } | { error: string }}
 */
export function resolvePackingCharge(orType, raw) {
  const none = raw === undefined || raw === null || raw === "";
  const n = none ? 0 : Number(raw);
  if (!Number.isFinite(n) || n < 0) return { error: "The packing charge must be a number, 0 or more." };
  if (n > MAX_PACKING) return { error: `The packing charge cannot exceed ${MAX_PACKING}.` };
  if (orType !== "takeaway" && orType !== "delivery") {
    return n === 0 ? { value: 0 } : { error: "A packing charge can only go on a takeaway or delivery order." };
  }
  return { value: Number(n.toFixed(2)) };
}
