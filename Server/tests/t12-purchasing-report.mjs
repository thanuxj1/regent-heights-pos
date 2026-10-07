// t12-purchasing-report.mjs — the purchasing report, and the payment method that
// restaurant rows carry in the transactions ledger.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";
// The hotel's calendar day, as the server dates sales — not UTC's, which runs
// 5½ hours behind Sri Lanka and named the wrong day every evening after 18:30 UTC.
import { hotelToday } from "../utils/hotelTime.js";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = hotelToday();

let supId, rmId, poId, bproId;

section("purchasing report");
await t("setup: material, supplier, a PO of 500 with 200 paid", async () => {
  const rm = await api(owner, "POST", "/raw-materials", { rm_name: `${stamp} Rice`, unit: "kg", stock_qty: 0 });
  status(rm, 201);
  rmId = rm.data.rm_id ?? rm.data.data?.rm_id;
  const sup = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} Rice Co` });
  status(sup, 201);
  supId = sup.data.sup_id;
  const po = await api(owner, "POST", "/purchase-orders", { sup_id: supId, B_id: A.b_id });
  status(po, 201);
  poId = po.data.po_id ?? po.data.data?.po_id;
  status(await api(owner, "POST", "/purchase-items", { po_id: poId, rm_id: rmId, qty: 10, price: 500, unit_price: 50 }), 201);
  status(await api(owner, "PATCH", `/purchase-orders/${poId}/status`, { status: "received", payment: { amount: 200, method: "cash" } }), 200);
});

await t("the report lists the order with total, paid and still owed", async () => {
  const res = await api(owner, "GET", `/reports/purchases?from=${today}&to=${today}`);
  status(res, 200);
  const o = res.data.orders.find((x) => x.po_id === poId);
  ok(o, "the order should be listed");
  eq(o.supplier, `${stamp} Rice Co`, "supplier");
  eq(o.total, 500, "total");
  eq(o.paid, 200, "paid");
  eq(o.balance, 300, "still owed");
  const line = res.data.lines.find((x) => x.po_id === poId);
  ok(line && line.item === `${stamp} Rice` && line.qty === 10, "the line item should be listed");
  eq(res.data.totals.owed, 300, "total owed");
});

await t("another company cannot read it", async () => {
  const res = await api((await ctx()).B.owner.token, "GET", `/reports/purchases?b_id=${A.b_id}&from=${today}&to=${today}`);
  ok(res.status === 403 || res.status === 404 || (res.status === 200 && res.data.orders.length === 0), `got ${res.status}`);
});

section("restaurant rows carry the payment method");
await t("a cash sale shows 'cash' as its method in the ledger, not a dash", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_MethodMenu` });
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Method Dish", pro_qty: 10, pro_price: 100, cat_id: cat.data.cat_id, com_id: A.com_id });
  const bpro = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Method Dish", pro_shortname: "Dish",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 100, pro_quantity: 10,
  });
  bproId = bpro.data.Bpro_id;
  const o = await api(cashier, "POST", "/orders/with-items", {
    order: { or_tax: 0, or_totalcost: 100, or_totalCostWtax: 100, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash", client_ref: `${stamp.toLowerCase()}-m1` },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 100 }],
  });
  status(o, 201);
  const led = await api(owner, "GET", `/reports/transactions?from=${today}&to=${today}&kind=restaurant`);
  const row = led.data.transactions.find((x) => x.or_id === o.data.data.or_id);
  ok(row, "the order should be in the ledger");
  eq(row.method, "cash", "payment method");
});

section("who we owe");
await t("the received, part-paid order shows the supplier as owed 300", async () => {
  const res = await api(owner, "GET", "/reports/payables");
  status(res, 200);
  const s = res.data.suppliers.find((x) => x.sup_id === supId);
  ok(s, "supplier should be listed as owed");
  eq(s.owed, 300, "owed");
  eq(s.orders.length, 1, "one unpaid order");
  eq(s.orders[0].balance, 300, "order balance");
  ok(Array.isArray(res.data.commissions), "commissions list present");
  ok(res.data.totals.total >= 300, "total includes it");
});

await t("once paid in full the supplier drops off the list", async () => {
  status(await api(owner, "POST", "/supplier-payments", { sup_id: supId, po_id: poId, amount: 300, method: "cash", payment_date: today }), 201);
  const res = await api(owner, "GET", "/reports/payables");
  ok(!res.data.suppliers.some((x) => x.sup_id === supId), "fully paid supplier should not be listed");
});

await t("another company cannot read this branch's payables", async () => {
  const res = await api((await ctx()).B.owner.token, "GET", `/reports/payables?b_id=${A.b_id}`);
  ok(res.status === 403 || res.status === 404 || (res.status === 200 && res.data.suppliers.length === 0), `got ${res.status}`);
});

await finish("t12-purchasing-report.mjs");
