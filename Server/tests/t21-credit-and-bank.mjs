// t21-credit-and-bank.mjs — two more ways to pay at the till. A bank transfer is
// an ordinary sale. A credit sale is food given to someone the house knows who
// pays later: it needs their name, is not revenue until paid, is listed as owed,
// and counts on the day it is paid.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = hotelDay(0);
const tag = stamp.toLowerCase();

let bproId, otherBproId;
let n = 0;
const sale = (extra = {}, price = 300, bpro = () => bproId) => {
  n += 1;
  return api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: price, or_totalCostWtax: price, or_status: "completed", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${tag}-t21-${n}`, ...extra,
    },
    items: [{ Bpro_id: bpro(), pro_quantity: 1, unit_price: price }],
  });
};
const summary = async () => {
  const r = await api(owner, "GET", `/reports/summary?from=${today}&to=${today}`);
  status(r, 200);
  return r.data;
};

section("setup");
await t("owner puts two items on the menu", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_T21` });
  status(cat, 201);
  for (const [name, price] of [["ZZQA T21 Rice", 300], ["ZZQA T21 Juice", 200]]) {
    const pro = await api(owner, "POST", "/products", { pro_name: name, pro_qty: 50, pro_price: price, cat_id: cat.data.cat_id, com_id: A.com_id });
    status(pro, 201);
    const bp = await api(owner, "POST", "/branch_products", {
      B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: name, pro_shortname: "T21", pro_image: "placeholder.png",
      pro_des: "t21", cat_id: cat.data.cat_id, pro_price: price, pro_quantity: 30,
    });
    status(bp, 201);
    if (!bproId) bproId = bp.data.Bpro_id; else otherBproId = bp.data.Bpro_id;
  }
});

let before;
await t("baseline of today's restaurant revenue and credit owed", async () => { before = await summary(); });

section("bank transfer");
let bankOrder;
await t("a sale paid by bank transfer is stored as such and counted at once", async () => {
  const res = await sale({ payment_method: "bank_transfer" });
  status(res, 201);
  bankOrder = res.data.data;
  eq(bankOrder.payment_method, "bank_transfer");
  const s = await summary();
  eq(+(s.revenue.restaurant - before.revenue.restaurant).toFixed(2), 300);
});

section("credit");
await t("a credit sale without the customer's name is refused", async () => {
  const res = await sale({ payment_method: "credit" });
  status(res, 400);
  ok(/name/i.test(res.data.error || res.data.message), "the reason should ask for the name");
});

let creditA, creditB, creditOther;
await t("a credit sale with a name is taken, and is not revenue yet", async () => {
  const mid = await summary();
  const a = await sale({ payment_method: "credit", credit_customer: "ZZQA Mr Perera", credit_phone: "0771234567" });
  status(a, 201);
  creditA = a.data.data;
  eq(creditA.credit_customer, "ZZQA Mr Perera");
  eq(creditA.credit_phone, "0771234567");
  const b = await sale({ payment_method: "credit", credit_customer: "ZZQA Mr Perera", credit_phone: "0771234567" }, 200, () => otherBproId);
  status(b, 201);
  creditB = b.data.data;
  const o = await sale({ payment_method: "credit", credit_customer: "ZZQA Ms Silva" });
  status(o, 201);
  creditOther = o.data.data;
  const s = await summary();
  eq(+(s.revenue.restaurant - mid.revenue.restaurant).toFixed(2), 0, "credit is not revenue until paid");
  eq(+(s.receivables.credit_outstanding - mid.receivables.credit_outstanding).toFixed(2), 800, "but it is owed");
});

await t("Credit Sales lists who owes what", async () => {
  const res = await api(cashier, "GET", "/credit/outstanding");
  status(res, 200);
  const perera = res.data.by_customer.find((c) => c.customer === "ZZQA Mr Perera");
  ok(perera, "Mr Perera should be listed");
  eq(perera.count, 2);
  eq(perera.total, 500);
});

await t("one payment can't cover two different customers' bills", async () => {
  const res = await api(cashier, "POST", "/credit/settle", { order_ids: [creditA.or_id, creditOther.or_id], method: "cash" });
  status(res, 400);
});

await t("a bill that isn't credit can't be settled as credit", async () => {
  status(await api(cashier, "POST", "/credit/settle", { order_ids: [bankOrder.or_id], method: "cash" }), 409);
});

let paidSettlement;
await t("recording Mr Perera's card payment counts both bills as revenue today", async () => {
  const mid = await summary();
  const res = await api(cashier, "POST", "/credit/settle", {
    order_ids: [creditA.or_id, creditB.or_id], method: "card", note: "ZZQA paid at counter",
  });
  status(res, 201);
  paidSettlement = res.data;
  eq(Number(res.data.amount), 500, "the amount is what the bills add up to");
  eq(res.data.customer_name, "ZZQA Mr Perera");
  const s = await summary();
  eq(+(s.revenue.restaurant - mid.revenue.restaurant).toFixed(2), 500);
  eq(+(s.by_department.restaurant.credit_received - mid.by_department.restaurant.credit_received).toFixed(2), 500);
  eq(+(mid.receivables.credit_outstanding - s.receivables.credit_outstanding).toFixed(2), 500, "no longer owed");
});

await t("paying the same bill twice is refused", async () => {
  status(await api(cashier, "POST", "/credit/settle", { order_ids: [creditA.or_id], method: "cash" }), 409);
});

await t("the payment is in the history and in the transactions ledger, not on Delivery COD", async () => {
  const h = await api(cashier, "GET", "/credit/history");
  status(h, 200);
  ok(h.data.some((x) => x.settlement_id === paidSettlement.settlement_id && x.order_count === 2), "credit history");
  const tx = await api(owner, "GET", `/reports/transactions?from=${today}&to=${today}`);
  status(tx, 200);
  const row = tx.data.transactions.find((x) => x.settlement_id === paidSettlement.settlement_id);
  ok(row, "transactions should list the credit payment");
  eq(row.type, "Credit payment");
  eq(row.party, "ZZQA Mr Perera");
  ok(!tx.data.transactions.some((x) => x.or_id === creditA.or_id), "the credit bill itself is not listed as a sale (its money is the payment row)");
  ok(tx.data.transactions.some((x) => x.or_id === bankOrder.or_id && x.method === "bank_transfer"), "the bank sale is listed");
  const cod = await api(owner, "GET", "/delivery-cod/history");
  status(cod, 200);
  ok(!cod.data.some((x) => x.settlement_id === paidSettlement.settlement_id), "Delivery COD shows only COD hand-overs");
});

await t("the other customer still owes, on their own", async () => {
  const res = await api(cashier, "GET", "/credit/outstanding");
  ok(!res.data.by_customer.some((c) => c.customer === "ZZQA Mr Perera"), "Mr Perera is paid up");
  ok(res.data.by_customer.some((c) => c.customer === "ZZQA Ms Silva" && c.total === 300));
});

section("delivery paid by bank transfer or on credit");
const delivery = (extra) => {
  n += 1;
  return api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 300, or_totalCostWtax: 400, or_status: "pending", or_type: "delivery",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${tag}-t21-${n}`, delivery_charge: 100, ...extra,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 300 }],
  });
};

await t("a delivery on credit needs the customer's name", async () => {
  status(await delivery({ payment_method: "credit" }), 400);
});

let creditDelivery;
await t("a delivery on credit is owed, not revenue; a bank-transfer delivery is revenue at once", async () => {
  const mid = await summary();
  const c = await delivery({ payment_method: "credit", credit_customer: "ZZQA Mrs Fernando", credit_phone: "0712223334" });
  status(c, 201);
  creditDelivery = c.data.data;
  eq(creditDelivery.credit_customer, "ZZQA Mrs Fernando");
  const b = await delivery({ payment_method: "bank_transfer" });
  status(b, 201);
  eq(b.data.data.payment_method, "bank_transfer");
  const s = await summary();
  eq(+(s.revenue.restaurant - mid.revenue.restaurant).toFixed(2), 400, "only the bank-transfer delivery counts today");
  eq(+(s.receivables.credit_outstanding - mid.receivables.credit_outstanding).toFixed(2), 400, "the credit delivery is owed");
});

await t("when the credit delivery is paid it counts as revenue", async () => {
  const mid = await summary();
  const res = await api(cashier, "POST", "/credit/settle", { order_ids: [creditDelivery.or_id], method: "cash" });
  status(res, 201);
  eq(Number(res.data.amount), 400, "the delivery charge is part of what is paid");
  const s = await summary();
  eq(+(s.revenue.restaurant - mid.revenue.restaurant).toFixed(2), 400);
});

await finish("t21-credit-and-bank.mjs");
