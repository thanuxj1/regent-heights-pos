// utils/deliveryCharge.js
//
// The flat charge a customer pays for delivery, on top of the food.
//
// The till offers these amounts and the server enforces them: a till that only
// ever sends one of these is not a reason to accept any number the request
// happens to carry, the same way the till is not trusted on what a dish costs.
// 0 means no charge (a partner's own order, or free delivery).
//
// To change what is offered, change this list *and* DELIVERY_CHARGES in
// Client/src/constants/deliveryCharges.js — the till shows the second, the
// server accepts the first.
export const DELIVERY_CHARGES = [0, 50, 100, 150, 200];

/**
 * The charge to record for an order, or the reason it can't be.
 *
 * @param {string} orType   "delivery" | "takeaway" | "dine-in"
 * @param {*}      raw      what the request carried; undefined/null/"" means none
 * @returns {{ value: number } | { error: string }}
 */
export function resolveDeliveryCharge(orType, raw) {
  const none = raw === undefined || raw === null || raw === "";
  const n = none ? 0 : Number(raw);
  if (!Number.isFinite(n)) return { error: "delivery_charge must be a number." };

  if (orType !== "delivery") {
    return n === 0
      ? { value: 0 }
      : { error: "A delivery charge can only go on a delivery order." };
  }
  if (!DELIVERY_CHARGES.includes(n)) {
    return { error: `The delivery charge must be one of ${DELIVERY_CHARGES.join(", ")}.` };
  }
  return { value: n };
}
