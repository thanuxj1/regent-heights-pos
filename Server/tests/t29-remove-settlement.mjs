// t29-remove-settlement.mjs — an Administrator undoes a restaurant payment
// recorded by mistake: a rider's cash-on-delivery hand-over ("Mark as paid") or
// a credit customer's payment. The orders it covered become unpaid again (owed,
// and out of the takings); the Activity Log keeps who, why and what. A cashier
// cannot, a reason is required, and each page removes only its own kind.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelToday } from "../utils/hotelTime.js";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
let bproId, partner;

const sell = async (tag, order) => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 500, or_totalCostWtax: 500, or_status: "pending", or_type: "delivery",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-rs-${tag}`, ...order,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 500 }],
  });
  status(res, 201);
  return res.data.data.or_id;
};
const restaurantRevenue = async () => {
  const r = await api(owner, "GET", `/reports/summary?from=${hotelToday()}&to=${hotelToday()}`);
  status(r, 200);
  return Number(r.data.revenue.restaurant);
};
const codOwed = async (id) => (await api(owner, "GET", "/delivery-cod/outstanding")).data.orders.some((o) => Number(o.or_id) === Number(id));
const creditOwed = async (id) => (await api(owner, "GET", "/credit/outstanding")).data.orders.some((o) => Number(o.or_id) === Number(id));

section("setup");
await t("a menu item and a rider", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_RsMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Rs Dish", pro_qty: 50, pro_price: 500, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Rs Dish", pro_shortname: "Dish",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 500, pro_quantity: 50,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
  const p = await api(owner, "POST", "/delivery-partners", { name: `${stamp} Rs Rider` });
  status(p, 201);
  partner = p.data.key;
});

section("a COD hand-over recorded by mistake");
let x, y, codSettlement, before;
await t("two COD orders are marked paid in one hand-over", async () => {
  x = await sell("x", { payment_method: "cod", delivery_partner: partner });
  y = await sell("y", { payment_method: "cod", delivery_partner: partner });
  before = await restaurantRevenue();
  const s = await api(cashier, "POST", "/delivery-cod/settle", { delivery_partner: partner, amount: 1000, method: "cash", order_ids: [x, y] });
  status(s, 201);
  codSettlement = s.data.settlement_id;
  ok(!(await codOwed(x)) && !(await codOwed(y)), "no longer outstanding");
  eq(+((await restaurantRevenue()) - before).toFixed(2), 1000, "in the takings");
});
await t("the history lists which orders it covered", async () => {
  const h = (await api(owner, "GET", "/delivery-cod/history")).data.find((r) => r.settlement_id === codSettlement);
  eq(h.orders, `#${x}, #${y}`, "orders column");
});
await t("a cashier cannot remove it", async () => {
  ok((await api(cashier, "POST", `/delivery-cod/settlements/${codSettlement}/delete`, { reason: "rider had not paid" })).status === 403, "cashier refused");
});
await t("a reason is required", async () => {
  eq((await api(owner, "POST", `/delivery-cod/settlements/${codSettlement}/delete`, {})).status, 400, "no reason");
});
await t("the Credit Sales page cannot remove a COD record", async () => {
  eq((await api(owner, "POST", `/credit/settlements/${codSettlement}/delete`, { reason: "wrong page" })).status, 404, "other kind");
});
await t("the Administrator removes it: both orders are owed by the rider again, and out of the takings", async () => {
  const r = await api(owner, "POST", `/delivery-cod/settlements/${codSettlement}/delete`, { reason: "rider had not paid yet" });
  status(r, 200);
  eq(r.data.orders_unpaid_again.sort().join(","), [x, y].sort().join(","), "orders unpaid again");
  ok(await codOwed(x) && await codOwed(y), "outstanding again");
  eq(await restaurantRevenue(), before, "back out of the takings");
});
await t("it is in the Activity Log with the reason and the orders", async () => {
  const { rows } = await pool.query(
    `SELECT u_id, summary FROM "ACTIVITY_LOG" WHERE entity = 'delivery_cod_settlement' AND entity_id = $1 AND action = 'delete'`,
    [String(codSettlement)]);
  eq(rows.length, 1, "logged");
  eq(Number(rows[0].u_id), Number(A.owner.u_id), "who");
  ok(rows[0].summary.includes("rider had not paid yet") && rows[0].summary.includes(`#${x}`), rows[0].summary);
});
await t("the rider's real hand-over can then be recorded again", async () => {
  status(await api(cashier, "POST", "/delivery-cod/settle", { delivery_partner: partner, amount: 1000, method: "cash", order_ids: [x, y] }), 201);
});

section("a credit payment recorded by mistake");
let c, creditSettlement;
await t("a credit order is paid", async () => {
  c = await sell("credit", { or_type: "takeaway", payment_method: "credit", credit_customer: "ZZQA Tab" });
  const s = await api(cashier, "POST", "/credit/settle", { order_ids: [c], method: "card" });
  status(s, 201);
  creditSettlement = s.data.settlement_id;
  ok(!(await creditOwed(c)), "no longer owed");
});
await t("the Administrator removes the payment: the bill is owed again", async () => {
  status(await api(owner, "POST", `/credit/settlements/${creditSettlement}/delete`, { reason: "paid by the wrong customer" }), 200);
  ok(await creditOwed(c), "owed again");
  const gone = await pool.query(`SELECT 1 FROM "DELIVERY_COD_SETTLEMENT" WHERE settlement_id = $1`, [creditSettlement]);
  eq(gone.rows.length, 0, "record removed");
});

section("once a PIN is set");
await t("the PIN is asked for", async () => {
  status(await api(owner, "PUT", "/security/approval-pin", { pin: "4321" }), 200);
  const s = await api(cashier, "POST", "/credit/settle", { order_ids: [c], method: "cash" });
  status(s, 201);
  eq((await api(owner, "POST", `/credit/settlements/${s.data.settlement_id}/delete`, { reason: "test" })).status, 403, "no PIN");
  status(await api(owner, "POST", `/credit/settlements/${s.data.settlement_id}/delete`, { reason: "test", pin: "4321" }), 200);
  status(await api(owner, "DELETE", "/security/approval-pin"), 200);
});

await finish("t29-remove-settlement.mjs");
