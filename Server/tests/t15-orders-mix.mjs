// t15-orders-mix.mjs — orders by type, and deliveries by partner / how paid / COD status.
// Other files share this tenant, so each figure is a change from a baseline.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = new Date().toISOString().slice(0, 10);

const mix = async () => {
  const res = await api(owner, "GET", `/reports/orders-mix?from=${today}&to=${today}`);
  status(res, 200);
  return res.data;
};
const typeRow = (m, type) => m.types.find((x) => x.type === type) ?? { orders: 0, value: 0 };
const partnerRow = (m, name) => m.delivery.by_partner.find((x) => x.partner === name) ?? { orders: 0, value: 0, delivery_charges: 0, cod_outstanding: 0, cod_settled: 0 };

let before, bproId, partnerA, partnerB;
const nameA = `${stamp} Riders A`, nameB = `${stamp} Riders B`;

section("setup");
await t("baseline, two partners, a menu item", async () => {
  before = await mix();
  const a = await api(owner, "POST", "/delivery-partners", { name: nameA });
  status(a, 201); partnerA = a.data.key;
  const b = await api(owner, "POST", "/delivery-partners", { name: nameB });
  status(b, 201); partnerB = b.data.key;
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_MixMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Mix Dish", pro_qty: 50, pro_price: 1000, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Mix Dish", pro_shortname: "Dish",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 1000, pro_quantity: 50,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
});

const sell = async (tag, type, extra = {}, charge = 0, total = 1000) => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 1000, or_totalCostWtax: total + charge, or_status: "pending", or_type: type,
      u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash", client_ref: `${stamp.toLowerCase()}-mix-${tag}`,
      ...(type === "delivery" ? { delivery_charge: charge } : {}), ...extra,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 1000 }],
  });
  status(res, 201);
  return res.data.data.or_id;
};

section("orders");
await t("two dine-in, one takeaway, three deliveries", async () => {
  await sell("d1", "dine-in");
  await sell("d2", "dine-in");
  await sell("t1", "takeaway");
  await sell("dl1", "delivery", { delivery_partner: partnerA, payment_method: "cod" }, 100);
  await sell("dl2", "delivery", { delivery_partner: partnerA, payment_method: "cod" }, 50);
  await sell("dl3", "delivery", { delivery_partner: partnerB, payment_method: "cash" }, 200);
});

section("the report");
let after;
await t("order types count correctly and shares add to 100", async () => {
  after = await mix();
  eq(typeRow(after, "dine-in").orders - typeRow(before, "dine-in").orders, 2, "dine-in orders");
  eq(typeRow(after, "takeaway").orders - typeRow(before, "takeaway").orders, 1, "takeaway orders");
  eq(typeRow(after, "delivery").orders - typeRow(before, "delivery").orders, 3, "delivery orders");
  eq(after.totals.orders - before.totals.orders, 6, "all orders");
  const pct = after.types.reduce((s, x) => s + x.orders_pct, 0);
  ok(Math.abs(pct - 100) < 0.5, `shares should add to about 100, got ${pct}`);
});

await t("deliveries split by partner with charges and COD still with the rider", async () => {
  const a = partnerRow(after, nameA), b = partnerRow(after, nameB);
  eq(a.orders, 2, "partner A orders");
  eq(a.value, 2150, "partner A value: 1100 + 1050");
  eq(a.delivery_charges, 150, "partner A delivery charges");
  eq(a.cod_outstanding, 2150, "COD not yet handed over");
  eq(b.orders, 1, "partner B orders");
  eq(b.delivery_charges, 200, "partner B delivery charges");
  eq(b.cod_outstanding, 0, "paid in cash, nothing outstanding");
});

await t("the delivery section agrees with the order-type row", async () => {
  eq(after.delivery.orders, typeRow(after, "delivery").orders, "delivery orders agree");
});

await t("another company sees none of it", async () => {
  const res = await api((await ctx()).B.owner.token, "GET", `/reports/orders-mix?b_id=${A.b_id}&from=${today}&to=${today}`);
  ok(res.status === 403 || res.status === 404 || (res.status === 200 && res.data.totals.orders === 0), `got ${res.status}`);
});

await finish("t15-orders-mix.mjs");
