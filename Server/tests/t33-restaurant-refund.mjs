// t33-restaurant-refund.mjs — money handed back on a paid restaurant sale.
// A reason always and a PIN (as for a void); never more than was paid; off
// restaurant revenue, the Sales Summary and Product Profit on the day it is
// given; out of the cash drawer when cash; in Transactions as money out.
// Unpaid, voided and room-charged orders are refused with a reason.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";
import { sessionTotals, expectedCash } from "../utils/cashDrawer.js";

const { A, B, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const PIN = "5713";
const today = hotelDay(0);
let bproId, sale, sessionId;

const sell = async (tag, order = {}) => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 2000, or_totalCostWtax: 2000, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-rf-${tag}`, payment_method: "cash", ...order,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 2, unit_price: 1000 }],
  });
  status(res, 201);
  return res.data.data.or_id;
};
const refund = (token, id, body) => api(token, "POST", `/orders/${id}/refund`, body);
const info = async (id, token = owner) => api(token, "GET", `/orders/${id}/refunds`);
const summary = async () => {
  const r = await api(owner, "GET", `/reports/summary?b_id=${A.b_id}&from=${today}&to=${today}`);
  status(r, 200);
  return r.data;
};
const dish = async () => {
  const r = await api(owner, "GET", `/reports/products?b_id=${A.b_id}&from=${today}&to=${today}`);
  status(r, 200);
  return (r.data.products || r.data.rows || []).find((p) => p.name === "ZZQA Rf Curry");
};

section("setup");
await t("a dish costing 400 that sells for 1,000, and a cashier's open drawer", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_RfMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Rf Curry", pro_qty: 100, pro_price: 1000, cost_price: 400, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Rf Curry", pro_shortname: "Curry",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 1000, pro_quantity: 100,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
  // Straight in, not through /cash/session/open: that needs a drawer PIN, and
  // t5 checks the drawer starts locked. Removed again at the end.
  const { rows: [s] } = await pool.query(
    `INSERT INTO "CASH_SESSION" (b_id, opened_by, opening_float, status) VALUES ($1, $2, 1000, 'open') RETURNING session_id`,
    [A.b_id, A.cashier.u_id]);
  sessionId = s.session_id;
  sale = await sell("main");
});

section("what can be refunded");
await t("a paid sale can be refunded in full, line by line", async () => {
  const r = await info(sale);
  status(r, 200);
  eq(r.data.refundable, 2000);
  eq(r.data.blocked, null);
  eq(r.data.lines[0].refundable_qty, 2);
  eq(r.data.lines[0].paid_each, 1000);
});
await t("an unpaid order cannot be refunded", async () => {
  const id = await sell("unpaid", { payment_method: null });
  const r = await info(id);
  ok(r.data.blocked, "says why");
  eq((await refund(owner, id, { amount: 100, method: "cash", reason: "test" })).status, 409);
});
await t("a voided order cannot be refunded", async () => {
  const id = await sell("voided");
  await pool.query(`UPDATE "ORDER" SET or_status = 'cancelled' WHERE or_id = $1`, [id]);
  eq((await refund(owner, id, { amount: 100, method: "cash", reason: "test" })).status, 409);
});
await t("another property cannot see or refund it", async () => {
  eq((await info(sale, B.owner.token)).status, 404);
  eq((await refund(B.owner.token, sale, { amount: 100, method: "cash", reason: "not ours" })).status, 404);
});

section("the gate");
await t("a reason is required", async () => {
  eq((await refund(owner, sale, { amount: 1000, method: "cash" })).status, 400);
});
await t("a cashier needs a manager's PIN", async () => {
  eq((await refund(cashier, sale, { amount: 1000, method: "cash", reason: "sent back" })).status, 403);
});
await t("never more than was paid", async () => {
  eq((await refund(owner, sale, { amount: 2500, method: "cash", reason: "too much" })).status, 409);
});
await t("never more of a dish than was sold", async () => {
  eq((await refund(owner, sale, { amount: 100, method: "cash", reason: "three back", items: [{ orderItem_id: (await info(sale)).data.lines[0].orderItem_id, qty: 3 }] })).status, 409);
});

section("a refund, and where it shows");
let before, dishBefore;
await t("with a PIN, a cashier hands back one curry in cash", async () => {
  before = await summary();
  dishBefore = await dish();
  status(await api(owner, "PUT", "/security/approval-pin", { pin: PIN }), 200);
  const line = (await info(sale)).data.lines[0];
  eq((await refund(cashier, sale, { amount: 1000, method: "cash", reason: "sent back cold", pin: "0000", items: [{ orderItem_id: line.orderItem_id, qty: 1 }] })).status, 403, "wrong PIN");
  const r = await refund(cashier, sale, { amount: 1000, method: "cash", reason: "sent back cold", pin: PIN, items: [{ orderItem_id: line.orderItem_id, qty: 1 }] });
  status(r, 201);
  eq(r.data.refund.session_id, sessionId, "from the cashier's open drawer");
  const after = (await info(sale)).data;
  eq(after.refunded, 1000);
  eq(after.refundable, 1000);
  eq(after.lines[0].refundable_qty, 1);
});
await t("restaurant revenue today is 1,000 less, and says so", async () => {
  const s = await summary();
  eq(+(before.revenue.restaurant - s.revenue.restaurant).toFixed(2), 1000);
  eq(+(s.by_department.restaurant.refunds - (before.by_department.restaurant.refunds || 0)).toFixed(2), 1000);
});
await t("the Sales Summary's restaurant column agrees with Reports", async () => {
  const r = await api(owner, "GET", `/reports/sales-summary?b_id=${A.b_id}&from=${today}&to=${today}`);
  status(r, 200);
  eq(r.data.totals.total, (await summary()).revenue.total);
});
await t("Product Profit: one curry and 1,000 of sales off, its cost kept", async () => {
  const d = await dish();
  eq(dishBefore.units - d.units, 1, "units");
  eq(+(dishBefore.sales - d.sales).toFixed(2), 1000, "sales");
  eq(d.cost, dishBefore.cost, "cost stays: it was made");
});
await t("the drawer expects 1,000 less cash", async () => {
  // The till's own arithmetic (reading it over HTTP needs the drawer PIN).
  const totals = await sessionTotals(pool, sessionId);
  eq(totals.restaurant_cash_refunds, 1000);
  eq(expectedCash(1000, totals), +(1000 + totals.cash_sales + totals.hotel_cash_in - 1000).toFixed(2));
});
await t("Transactions lists it as money out", async () => {
  const r = await api(owner, "GET", `/reports/transactions?b_id=${A.b_id}&from=${today}&to=${today}&kind=refund`);
  status(r, 200);
  const row = r.data.transactions.find((x) => Number(x.or_id) === Number(sale));
  ok(row, "listed");
  eq(row.direction, "out");
  eq(row.amount, 1000);
});
await t("the Activity Log says what, why and who approved", async () => {
  const { rows } = await pool.query(
    `SELECT summary, details FROM "ACTIVITY_LOG" WHERE entity = 'order' AND entity_id = $1 AND action = 'refund'`, [String(sale)]);
  eq(rows.length, 1);
  ok(rows[0].summary.includes("1000.00") && rows[0].summary.includes("ZZQA Rf Curry") && rows[0].summary.includes("sent back cold"), rows[0].summary);
  eq(Number(rows[0].details.approved_by), Number(A.owner.u_id));
});
await t("the rest goes back by card, and then nothing more can", async () => {
  status(await refund(owner, sale, { amount: 1000, method: "card", reason: "whole order after all", pin: PIN }), 201);
  const r = (await info(sale)).data;
  eq(r.refundable, 0);
  ok(r.blocked, "fully refunded");
  eq((await refund(owner, sale, { amount: 1, method: "cash", reason: "again", pin: PIN })).status, 409);
});

section("cleanup");
await t("the PIN and the drawer are removed", async () => {
  status(await api(owner, "DELETE", "/security/approval-pin"), 200);
  // Closed, not deleted: the sales rung up in it point at it.
  await pool.query(`UPDATE "CASH_SESSION" SET status = 'closed', closed_at = NOW(), closed_by = $2 WHERE session_id = $1`, [sessionId, A.cashier.u_id]);
});

await finish("t33-restaurant-refund.mjs");
