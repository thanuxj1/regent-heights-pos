// t16-delivery-stays-open.mjs — a cash-on-delivery order stays on the till's Kitchen
// Orders list until the rider has handed over the money, however long that takes,
// and drops off once it is settled. The kitchen's own board is unaffected.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const kitchen = A.kitchen.token;

let bproId, partner, orderId, plainCashId, repBefore;
const summary = async () => { const r = await api(owner, "GET", `/reports/summary?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`); status(r, 200); return r.data; };

const rows = (res) => {
  const d = res.data.data ?? res.data;
  return Array.isArray(d) ? d : Object.values(d).flat();
};
const onTill = async (id) => {
  const res = await api(cashier, "GET", "/orders/board?scope=till");
  status(res, 200);
  return rows(res).find((o) => Number(o.or_id) === Number(id));
};
const onKitchen = async (id) => {
  const res = await api(kitchen, "GET", "/orders/board");
  status(res, 200);
  return rows(res).some((o) => Number(o.or_id) === Number(id));
};
const sell = async (tag, extra) => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 500, or_totalCostWtax: 600, or_status: "pending", or_type: "delivery", delivery_charge: 100,
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-so-${tag}`, ...extra,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 500 }],
  });
  status(res, 201);
  return res.data.data.or_id;
};
const ageIt = (id) => pool.query(
  `UPDATE "ORDER" SET or_status = 'completed', status_changed_at = NOW() - INTERVAL '3 hours' WHERE or_id = $1`, [id]);

section("setup");
await t("a menu item and a rider", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_SoMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Open Dish", pro_qty: 20, pro_price: 500, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Open Dish", pro_shortname: "Dish",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 500, pro_quantity: 20,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
  const p = await api(owner, "POST", "/delivery-partners", { name: `${stamp} Own Rider` });
  status(p, 201);
  partner = p.data.key;
});

section("staying open");
await t("baseline report", async () => { repBefore = await summary(); });
await t("a COD delivery the kitchen finished hours ago is still on the till's list, with what is needed to settle it", async () => {
  orderId = await sell("cod", { delivery_partner: partner, payment_method: "cod" });
  await ageIt(orderId);
  const o = await onTill(orderId);
  ok(o, "should still be listed for the till");
  eq(o.payment_method, "cod", "payment method");
  eq(o.delivery_partner, partner, "partner is carried so it can be settled from the list");
  eq(o.cod_settlement_id, null, "not settled yet");
  eq(Number(o.total), 600, "total on the list");
  eq(Number(o.delivery_charge), 100, "delivery charge on the list");
});

await t("the kitchen's own board does not keep it", async () => {
  ok(!(await onKitchen(orderId)), "an old finished order is not the kitchen's business");
});

await t("a delivery paid by card at the door is not kept open", async () => {
  plainCashId = await sell("card", { delivery_partner: partner, payment_method: "card" });
  await ageIt(plainCashId);
  ok(!(await onTill(plainCashId)), "already paid, so it drops off once the kitchen is done");
});

await t("the cashier can take the rider's cash, and the order leaves the list", async () => {
  status(await api(cashier, "POST", "/delivery-cod/settle", {
    delivery_partner: partner, amount: 600, method: "cash", order_ids: [orderId],
  }), 201);
  ok(!(await onTill(orderId)), "settled, so no longer outstanding");
});

section("in the reports");
await t("the cash counts as revenue only now, shown as cash on delivery received, with its delivery charge", async () => {
  const after = await summary();
  const b = repBefore.by_department.restaurant, a = after.by_department.restaurant;
  const d = (x, y) => +(x - y).toFixed(2);
  eq(d(a.cod_received, b.cod_received), 600, "cash on delivery received");
  eq(d(a.cod_orders, b.cod_orders), 1, "one delivery order");
  eq(d(after.revenue.restaurant, repBefore.revenue.restaurant) >= 600, true, "restaurant revenue includes it");
  eq(d(after.revenue.delivery_charges, repBefore.revenue.delivery_charges) >= 100, true, "its delivery charge is counted");
  eq(+(a.paid_at_till + a.cod_received).toFixed(2), a.revenue, "paid at till + COD received = restaurant revenue");
});

await finish("t16-delivery-stays-open.mjs");
