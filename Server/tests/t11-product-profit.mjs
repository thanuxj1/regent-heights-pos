// t11-product-profit.mjs — per-product sales, cost and profit. The cost is copied
// onto the order line at the moment of sale, so editing a cost price later must
// not rewrite what an earlier sale earned.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";
// The hotel's calendar day, as the server dates sales — not UTC's, which runs
// 5½ hours behind Sri Lanka and named the wrong day every evening after 18:30 UTC.
import { hotelToday } from "../utils/hotelTime.js";

const { A, B, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = hotelToday();

let catId, costed, uncosted;
const mkProduct = async (name, price, cost) => {
  const pro = await api(owner, "POST", "/products", {
    pro_name: name, pro_qty: 100, pro_price: price, cat_id: catId, com_id: A.com_id,
    ...(cost !== undefined ? { cost_price: cost } : {}),
  });
  status(pro, 201);
  const bpro = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: name, pro_shortname: name.slice(0, 8),
    pro_image: "placeholder.png", pro_des: "t", cat_id: catId, pro_price: price, pro_quantity: 100,
  });
  status(bpro, 201);
  return { pro_id: pro.data.pro_id, bpro_id: bpro.data.Bpro_id, price };
};

const sell = async (p, qty, tag, orderStatus = "pending") => {
  const total = p.price * qty;
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: total, or_totalCostWtax: total, or_status: orderStatus, or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash", client_ref: `${stamp.toLowerCase()}-pp-${tag}`,
    },
    items: [{ Bpro_id: p.bpro_id, pro_quantity: qty, unit_price: p.price }],
  });
  status(res, 201);
  return res.data.data.or_id;
};

const report = async () => {
  const res = await api(owner, "GET", `/reports/products?from=${today}&to=${today}`);
  status(res, 200);
  return res.data;
};
const row = (rep, name) => rep.products.find((p) => p.name === name);

section("setup");
await t("two products: one with a cost price, one without", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_ProfitMenu` });
  status(cat, 201);
  catId = cat.data.cat_id;
  costed = await mkProduct("ZZQA Costed Dish", 1000, 400);
  uncosted = await mkProduct("ZZQA Uncosted Dish", 500);
});

section("cost and profit");
await t("selling 2 of the costed dish: sales 2000, cost 800, profit 1200, margin 60%", async () => {
  await sell(costed, 2, "a");
  const r = row(await report(), "ZZQA Costed Dish");
  ok(r, "dish should be in the report");
  eq(r.units, 2, "units");
  eq(r.sales, 2000, "sales");
  eq(r.cost, 800, "cost");
  eq(r.profit, 1200, "profit");
  eq(r.margin_pct, 60, "margin");
  eq(r.no_cost_set, false, "cost is set");
});

await t("raising the cost price later does NOT change the earlier sale", async () => {
  const up = await api(owner, "PUT", `/products/${costed.pro_id}`, { cost_price: 600 });
  status(up, 200);
  await sell(costed, 1, "b");
  const r = row(await report(), "ZZQA Costed Dish");
  eq(r.units, 3, "units");
  eq(r.sales, 3000, "sales");
  eq(r.cost, 1400, "2 sold at cost 400 + 1 sold at cost 600");
  eq(r.profit, 1600, "profit");
});

section("no cost price");
await t("a product with no cost price is flagged, not silently counted as free", async () => {
  await sell(uncosted, 3, "c");
  const r = row(await report(), "ZZQA Uncosted Dish");
  ok(r, "dish should be in the report");
  eq(r.sales, 1500, "sales");
  eq(r.no_cost_set, true, "should be flagged");
  eq(r.units_no_cost, 3, "units without a cost");
});

section("what is excluded");
await t("a cancelled order is not counted", async () => {
  const before = row(await report(), "ZZQA Costed Dish");
  await sell(costed, 5, "x", "cancelled");
  const after = row(await report(), "ZZQA Costed Dish");
  eq(after.units, before.units, "units unchanged");
  eq(after.sales, before.sales, "sales unchanged");
});

section("totals and the summary");
await t("totals add up and the summary carries the same dish-profit figure", async () => {
  const rep = await report();
  const sales = rep.products.reduce((s, p) => s + p.sales, 0);
  const cost = rep.products.reduce((s, p) => s + p.cost, 0);
  eq(rep.totals.sales, sales, "total sales");
  eq(rep.totals.cost, cost, "total cost");
  eq(rep.totals.products_without_cost, 1, "one product has no cost");
  const sum = await api(owner, "GET", `/reports/summary?from=${today}&to=${today}`);
  status(sum, 200);
  eq(sum.data.product_profit.profit, rep.totals.profit, "summary matches the product report");
});

section("access");
await t("another company cannot read this branch's product report", async () => {
  const res = await api(B.owner.token, "GET", `/reports/products?b_id=${A.b_id}&from=${today}&to=${today}`);
  ok(res.status === 403 || res.status === 404 || (res.status === 200 && res.data.products.length === 0),
    `expected no data for another tenant, got ${res.status}`);
});

await finish("t11-product-profit.mjs");
