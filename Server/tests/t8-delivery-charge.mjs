// t8-delivery-charge.mjs — the flat delivery charge (0/50/100/150/200) on a
// delivery order: validated server-side, added after tax, stored on the order
// and surfaced in the reports without being counted twice.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;

const today = new Date().toISOString().slice(0, 10);
let bproId;

const order = (tag, over = {}, charge) => ({
  order: {
    or_tax: 10, or_totalcost: 1000, or_totalCostWtax: 1100 + (charge || 0), or_status: "pending",
    or_type: "delivery", u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash",
    client_ref: `${stamp.toLowerCase()}-dc-${tag}`,
    ...(charge !== undefined ? { delivery_charge: charge } : {}),
    ...over,
  },
  items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 1000 }],
});

section("setup");
await t("a menu item exists to sell", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_ChargeMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Charge Burger", pro_qty: 50, pro_price: 1000, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bpro = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Charge Burger", pro_shortname: "Burger",
    pro_image: "placeholder.png", pro_des: "A test burger", cat_id: cat.data.cat_id, pro_price: 1000, pro_quantity: 50,
  });
  status(bpro, 201);
  bproId = bpro.data.Bpro_id;
});

// Baseline before any charged order, so the assertions are deltas and survive
// other test files having already put restaurant sales in this tenant.
let before;
await t("baseline summary has a delivery_charges figure of zero", async () => {
  const res = await api(owner, "GET", `/reports/summary?from=${today}&to=${today}`);
  status(res, 200);
  before = res.data.revenue;
  ok(Number(before.delivery_charges) >= 0, "baseline delivery charges");
});

section("accepted charges");
const ids = {};
for (const charge of [0, 50, 100, 150, 200]) {
  await t(`delivery order with a LKR ${charge} charge is accepted and stored`, async () => {
    const res = await api(cashier, "POST", "/orders/with-items", order(`ok${charge}`, {}, charge));
    status(res, 201);
    ids[charge] = res.data.data.or_id;
    eq(Number(res.data.data.delivery_charge), charge, "the charge should be stored on the order");
    eq(Number(res.data.data.or_totalCostWtax), 1100 + charge, "the customer total includes the charge");
  });
}

await t("an order sent without delivery_charge defaults to zero", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", order("omitted"));
  status(res, 201);
  eq(Number(res.data.data.delivery_charge), 0, "default charge");
});

section("rejected charges");
await t("a charge outside the allowed set (75) is refused", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", order("bad75", {}, 75));
  status(res, 400);
});

await t("a negative charge is refused", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", order("neg", { or_totalCostWtax: 1050 }, -50));
  status(res, 400);
});

await t("a non-numeric charge is refused", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", order("nan", {}, "abc"));
  status(res, 400);
});

await t("a charge on a takeaway order is refused", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", order("take", { or_type: "takeaway" }, 100));
  status(res, 400);
});

await t("a total that leaves the charge out is refused (till can't under-bill)", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", order("under", { or_totalCostWtax: 1100 }, 100));
  status(res, 400);
});

await t("a total that adds the charge twice is refused", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", order("twice", { or_totalCostWtax: 1300 }, 100));
  status(res, 400);
});

section("editing a charged order");
await t("PUT can change the charge and the total together", async () => {
  const res = await api(cashier, "PUT", `/orders/${ids[100]}`, {
    or_tax: 10, or_totalcost: 1000, or_totalCostWtax: 1250, or_status: "pending", or_type: "delivery",
    u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash", delivery_charge: 150,
  });
  status(res, 200);
  eq(Number(res.data.data?.delivery_charge ?? res.data.delivery_charge), 150, "charge updated");
});

await t("PUT that changes the charge but not the total is refused", async () => {
  const res = await api(cashier, "PUT", `/orders/${ids[100]}`, {
    or_tax: 10, or_totalcost: 1000, or_totalCostWtax: 1250, or_status: "pending", or_type: "delivery",
    u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash", delivery_charge: 200,
  });
  status(res, 400);
});

section("reports");
// Orders now carry: 0, 50, 150 (edited from 100), 150, 200, and the default 0.
const expectedCharges = Number(before.delivery_charges) + (0 + 50 + 150 + 150 + 200 + 0);

await t("summary shows the delivery charges and they are inside the restaurant total", async () => {
  const res = await api(owner, "GET", `/reports/summary?from=${today}&to=${today}`);
  status(res, 200);
  const r = res.data.revenue;
  eq(Number(r.delivery_charges), expectedCharges, "delivery_charges total");
  ok(Number(r.restaurant) >= expectedCharges, "restaurant revenue should already include the charges");
  eq(Number(r.total), Number(r.hotel) + Number(r.restaurant), "total must not add the charges a second time");
});

await t("the ledger lists each order with its own delivery_charge, summing to the summary", async () => {
  const res = await api(owner, "GET", `/reports/transactions?from=${today}&to=${today}&kind=all`);
  status(res, 200);
  const rows = res.data.transactions;
  const sum = rows.reduce((s, x) => s + Number(x.delivery_charge || 0), 0);
  eq(sum, expectedCharges, "ledger charges should match the summary");
  const row = rows.find((x) => x.or_id === ids[200]);
  ok(row, "the LKR 200 order should be in the ledger");
  eq(Number(row.delivery_charge), 200, "row carries its charge");
  eq(Number(row.amount), 1300, "row amount is the full customer total");
});

await finish("t8-delivery-charge.mjs");
