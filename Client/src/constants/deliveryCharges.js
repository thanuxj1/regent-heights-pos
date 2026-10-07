/**
 * The flat charge a customer pays for delivery, on top of the food (LKR).
 *
 * 0 is "no charge" — a partner's own order, or free delivery. The server accepts
 * exactly this list and refuses anything else (Server/utils/deliveryCharge.js),
 * so changing what the till offers means changing both lists.
 */
export const DELIVERY_CHARGES = [0, 50, 100, 150, 200];
