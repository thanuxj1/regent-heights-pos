// t14-profit-by-department.mjs — hotel and restaurant profit separately. Costs are
// split only where the books say whose they are; the rest is shared; and the three
// always add up to the single net-profit figure.
//
// Other test files share this tenant, so every figure is a change from a baseline
// taken before this file adds anything.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";
// The hotel's calendar day, as the server dates sales — not UTC's, which runs
// 5½ hours behind Sri Lanka and named the wrong day every evening after 18:30 UTC.
import { hotelToday } from "../utils/hotelTime.js";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = hotelToday();

const summary = async () => {
  const res = await api(owner, "GET", `/reports/summary?from=${today}&to=${today}`);
  status(res, 200);
  return res.data;
};
const expense = async (cat, amount) =>
  status(await api(owner, "POST", "/expenses", { exp_category: cat, exp_amount: amount, exp_description: `${stamp} ${cat}`, exp_date: today }), 201);

let before, supId;

section("setup");
await t("baseline, then a restaurant sale of 1000 and expenses of each kind", async () => {
  before = await summary();

  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_DeptMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Dept Dish", pro_qty: 10, pro_price: 1000, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Dept Dish", pro_shortname: "Dish",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 1000, pro_quantity: 10,
  });
  status(bp, 201);
  status(await api(cashier, "POST", "/orders/with-items", {
    order: { or_tax: 0, or_totalcost: 1000, or_totalCostWtax: 1000, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash", client_ref: `${stamp.toLowerCase()}-dept` },
    items: [{ Bpro_id: bp.data.Bpro_id, pro_quantity: 1, unit_price: 1000 }],
  }), 201);

  await expense("raw_materials", 100);   // restaurant
  await expense("commission", 30);       // hotel
  await expense("utilities", 200);       // shared
  await expense("salary", 300);          // shared

  const sup = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} Dept Supplies` });
  status(sup, 201);
  supId = sup.data.sup_id;
});

await t("a hotel-supplies purchase of 80, paid, and a food purchase of 120, paid", async () => {
  const mk = async (name, category) => {
    const rm = await api(owner, "POST", "/raw-materials", { rm_name: `${stamp} Dept ${name}`, unit: "kg", stock_qty: 0, item_category: category });
    status(rm, 201);
    return rm.data.rm_id ?? rm.data.data?.rm_id;
  };
  const buy = async (rmId, amount) => {
    const po = await api(owner, "POST", "/purchase-orders", { sup_id: supId, B_id: A.b_id });
    status(po, 201);
    const poId = po.data.po_id ?? po.data.data?.po_id;
    status(await api(owner, "POST", "/purchase-items", { po_id: poId, rm_id: rmId, qty: 1, price: amount, unit_price: amount }), 201);
    status(await api(owner, "PATCH", `/purchase-orders/${poId}/status`, { status: "received", payment: { amount, method: "cash" } }), 200);
  };
  await buy(await mk("Soap", "supply"), 80);
  await buy(await mk("Rice", "ingredient"), 120);
});

section("the split");
let d0, d1, after;
await t("each side gets only its own costs; the rest is shared", async () => {
  after = await summary();
  d0 = before.by_department; d1 = after.by_department;
  const change = (a, b) => +(a - b).toFixed(2);
  eq(change(d1.hotel.costs.commissions, d0.hotel.costs.commissions), 30, "hotel commission");
  eq(change(d1.hotel.costs.supplies_bought, d0.hotel.costs.supplies_bought), 80, "hotel supplies bought");
  eq(change(d1.hotel.cost_total, d0.hotel.cost_total), 110, "hotel costs");
  eq(change(d1.restaurant.costs.raw_materials_packaging_delivery, d0.restaurant.costs.raw_materials_packaging_delivery), 100, "restaurant recorded expenses");
  eq(change(d1.restaurant.costs.food_and_drink_bought, d0.restaurant.costs.food_and_drink_bought), 120, "food bought");
  eq(change(d1.restaurant.cost_total, d0.restaurant.cost_total), 220, "restaurant costs");
  eq(change(d1.shared.total, d0.shared.total), 500, "utilities + salary");
});

await t("profit per department moves by its revenue less its own costs", async () => {
  const change = (a, b) => +(a - b).toFixed(2);
  eq(change(d1.restaurant.revenue, d0.restaurant.revenue), 1000, "restaurant revenue");
  eq(change(d1.restaurant.profit, d0.restaurant.profit), 780, "1000 - 220");
  eq(change(d1.hotel.profit, d0.hotel.profit), -110, "hotel: costs only");
});

await t("hotel profit + restaurant profit - shared costs equals net profit exactly", async () => {
  for (const r of [before, after]) {
    const d = r.by_department;
    eq(+(d.hotel.profit + d.restaurant.profit - d.shared.total).toFixed(2), r.profit.net, "reconciles to net profit");
  }
  eq(+(after.profit.net - before.profit.net).toFixed(2), 170, "net moved by 1000 - (110 + 220 + 500)");
});

await finish("t14-profit-by-department.mjs");
