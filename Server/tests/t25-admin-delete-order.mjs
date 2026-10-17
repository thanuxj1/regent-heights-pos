// t25-admin-delete-order.mjs — an Administrator deletes an order themselves:
//  • only with an approval PIN, even though they are an Administrator (the till
//    itself is signed in as one), and never from a cashier's login;
//  • the order leaves the sales, and the Activity Log says who, why, whose PIN;
//  • money already handed over for it alone goes with it; a payment shared with
//    other orders is refused rather than split.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const PIN = "4321";

let bproId, partner;
const sell = async (tag, order = {}) => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 500, or_totalCostWtax: 500, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash", client_ref: `${stamp.toLowerCase()}-del-${tag}`, ...order,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 500 }],
  });
  status(res, 201);
  return res.data.data.or_id;
};
const del = (token, id, body) => api(token, "POST", `/orders/${id}/delete`, body);
const sold = async () => (await api(owner, "GET", "/orders?status=sold")).data.data.map((o) => Number(o.or_id));

section("setup");
await t("a menu item, a rider, and the owner's approval PIN", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_DelMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Del Dish", pro_qty: 50, pro_price: 500, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Del Dish", pro_shortname: "Dish",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 500, pro_quantity: 50,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
  const p = await api(owner, "POST", "/delivery-partners", { name: `${stamp} Del Rider` });
  status(p, 201);
  partner = p.data.key;
  status(await api(owner, "PUT", "/security/approval-pin", { pin: PIN }), 200);
});

section("who may delete");
let id;
await t("a cashier cannot delete an order, even with the PIN", async () => {
  id = await sell("a");
  const res = await del(cashier, id, { pin: PIN, reason: "placed by mistake" });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});
await t("an Administrator without the PIN is refused", async () => {
  const res = await del(owner, id, { reason: "placed by mistake" });
  eq(res.status, 403, "no PIN");
});
await t("…and with a wrong PIN", async () => {
  const res = await del(owner, id, { pin: "0000", reason: "placed by mistake" });
  eq(res.status, 403, "wrong PIN");
});
await t("a reason is required", async () => {
  const res = await del(owner, id, { pin: PIN, reason: "" });
  eq(res.status, 400, "no reason");
});

section("deleting");
await t("with the PIN and a reason, the order is deleted", async () => {
  const res = await del(owner, id, { pin: PIN, reason: "placed by mistake" });
  status(res, 200);
  eq(res.data.data.or_status, "cancelled", "kept on record as cancelled");
});
await t("it is no longer a sale", async () => {
  ok(!(await sold()).includes(Number(id)), "still counted as takings");
});
await t("the Activity Log names who deleted it, why, and whose PIN allowed it", async () => {
  const { rows } = await pool.query(
    `SELECT u_id, action, summary, details FROM "ACTIVITY_LOG" WHERE entity = 'order' AND entity_id = $1 AND action = 'delete'`,
    [String(id)]);
  eq(rows.length, 1, "one entry");
  eq(Number(rows[0].u_id), Number(A.owner.u_id), "who did it");
  ok(rows[0].summary.includes("placed by mistake"), `reason in "${rows[0].summary}"`);
  eq(Number(rows[0].details.approved_by), Number(A.owner.u_id), "whose PIN");
  ok(Array.isArray(rows[0].details.items) && rows[0].details.items.length === 1, "what was on it");
});
await t("deleting it again is refused", async () => {
  eq((await del(owner, id, { pin: PIN, reason: "again" })).status, 409, "already deleted");
});

section("money already handed over");
await t("a COD order whose cash came in alone: the payment record goes with it", async () => {
  const cod = await sell("cod", { or_type: "delivery", payment_method: "cod", delivery_partner: partner });
  const s = await api(owner, "POST", "/delivery-cod/settle", { delivery_partner: partner, amount: 500, method: "cash", order_ids: [cod] });
  status(s, 201);
  status(await del(owner, cod, { pin: PIN, reason: "never delivered" }), 200);
  const left = await pool.query(
    `SELECT 1 FROM "DELIVERY_COD_SETTLEMENT" WHERE settlement_id = (SELECT MAX(settlement_id) FROM "DELIVERY_COD_SETTLEMENT" WHERE delivery_partner = $1)`,
    [partner]);
  eq(left.rows.length, 0, "the settlement for it alone should be gone");
});
await t("a COD order paid together with another is refused, not split", async () => {
  const x = await sell("codx", { or_type: "delivery", payment_method: "cod", delivery_partner: partner });
  const y = await sell("cody", { or_type: "delivery", payment_method: "cod", delivery_partner: partner });
  status(await api(owner, "POST", "/delivery-cod/settle", { delivery_partner: partner, amount: 1000, method: "cash", order_ids: [x, y] }), 201);
  const res = await del(owner, x, { pin: PIN, reason: "never delivered" });
  eq(res.status, 409, "shared payment");
  ok(String(res.data.error).includes(`#${y}`), `names the other order: ${res.data.error}`);
});

// Every test file shares tenant A; later files expect no PIN set.
await t("the owner's PIN is removed again", async () => {
  status(await api(owner, "DELETE", "/security/approval-pin"), 200);
});

await finish("t25-admin-delete-order.mjs");
