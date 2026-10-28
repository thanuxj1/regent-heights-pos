// t38-packing-charge.mjs — a packing charge on a takeaway or delivery order:
// typed at the till, added to what the customer pays and not taxed, kept when
// the order is settled later, shown on its own in the Reports. A dine-in order
// cannot carry one, and the total is still checked with it in.
import { ctx, api, t, eq, status, section, finish, pool } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = hotelDay(0);
let bp;

const sale = (tag, order, items = [{ Bpro_id: bp, pro_quantity: 2, unit_price: 500 }]) =>
  api(cashier, "POST", "/orders/with-items", {
    order: { or_tax: 0, or_status: "pending", u_id: A.cashier.u_id, b_id: A.b_id,
             client_ref: `${stamp.toLowerCase()}-pk-${tag}`, ...order },
    items,
  });
const summary = async () => {
  const r = await api(owner, "GET", `/reports/summary?b_id=${A.b_id}&from=${today}&to=${today}`);
  status(r, 200);
  return r.data;
};
let before;

section("setup");
await t("a dish at 500", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_PkMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Pk Rice", pro_qty: 100, pro_price: 500, cost_price: 1, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const r = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Pk Rice", pro_shortname: "Rice",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 500, pro_quantity: 100,
  });
  status(r, 201);
  bp = r.data.Bpro_id;
  before = await summary();
});

section("on a sale");
await t("a takeaway with 100 packing: 1,000 food + 100 = 1,100", async () => {
  const r = await sale("ta", { or_type: "takeaway", or_totalcost: 1000, or_totalCostWtax: 1100, packing_charge: 100, payment_method: "cash" });
  status(r, 201);
  eq(Number(r.data.data.packing_charge), 100);
  eq(Number(r.data.data.or_totalCostWtax), 1100);
});
await t("not taxed: 10% tax on the food only — 1,000 + 100 tax + 50 packing", async () => {
  const r = await sale("tax", { or_type: "takeaway", or_tax: 10, or_totalcost: 1000, or_totalCostWtax: 1150, packing_charge: 50, payment_method: "cash" });
  status(r, 201);
});
await t("a total that leaves the packing out is refused", async () => {
  const r = await sale("bent", { or_type: "takeaway", or_totalcost: 1000, or_totalCostWtax: 1000, packing_charge: 100, payment_method: "cash" });
  eq(r.status, 400);
});
await t("a dine-in order cannot carry one", async () => {
  const r = await sale("dine", { or_type: "dine-in", or_totalcost: 1000, or_totalCostWtax: 1100, packing_charge: 100, payment_method: "cash" });
  eq(r.status, 400);
});
await t("with a delivery charge too: 1,000 + 100 delivery + 60 packing", async () => {
  const r = await sale("del", { or_type: "delivery", or_totalcost: 1000, or_totalCostWtax: 1160, delivery_charge: 100, packing_charge: 60, payment_method: "card" });
  status(r, 201);
});

section("settled later");
await t("sent to the kitchen unpaid with 80 packing, then paid: the charge stays", async () => {
  const r = await sale("later", { or_type: "takeaway", or_totalcost: 1000, or_totalCostWtax: 1080, packing_charge: 80 });
  status(r, 201);
  const id = r.data.data.or_id;
  status(await api(cashier, "PATCH", `/orders/${id}/status`, { status: "preparing" }), 200);
  status(await api(cashier, "PUT", `/orders/${id}`, {
    or_tax: 0, or_totalcost: 1000, or_totalCostWtax: 1080, or_status: "completed", or_type: "takeaway",
    u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash",
  }), 200);
  const { rows: [o] } = await pool.query(`SELECT packing_charge FROM "ORDER" WHERE or_id = $1`, [id]);
  eq(Number(o.packing_charge), 80);
});

section("in the reports");
await t("Reports show the packing charges on their own, inside restaurant revenue", async () => {
  const s = await summary();
  eq(+(s.by_department.restaurant.packing_charges - (before.by_department.restaurant.packing_charges || 0)).toFixed(2), 290, "100 + 50 + 60 + 80");
});

await finish("t38-packing-charge.mjs");
