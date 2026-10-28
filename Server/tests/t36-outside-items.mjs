// t36-outside-items.mjs — something the property does not stock, bought
// elsewhere and sold on. The cashier names it, prices it and says what it
// cost: it is sold like any line, takes no stock, and what it cost is money
// out in Reports and Accounting on the day it was sold. A voided sale's
// outside item costs nothing. Works on a fresh sale, added to an open order,
// and on room service.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = hotelDay(0);
let bproId, sale;

const ORDER = (tag, total, extra = {}) => ({
  or_tax: 0, or_totalcost: total, or_totalCostWtax: total, or_status: "pending", or_type: "takeaway",
  u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-out-${tag}`, payment_method: "cash", ...extra,
});
const PANADOL = { item_name: "ZZQA Panadol", unit_cost: 100, bought_from: "Pharmacy", pro_quantity: 2, unit_price: 150 };
const summary = async () => {
  const r = await api(owner, "GET", `/reports/summary?b_id=${A.b_id}&from=${today}&to=${today}`);
  status(r, 200);
  return r.data;
};
const accounting = async () => {
  const r = await api(owner, "GET", `/expenses/summary?year=${today.slice(0, 4)}&b_id=${A.b_id}`);
  status(r, 200);
  return r.data;
};

section("setup");
let before, accBefore;
await t("a dish on the menu, and the figures before", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_OutMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Out Rice", pro_qty: 100, pro_price: 500, cost_price: 200, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Out Rice", pro_shortname: "Rice",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 500, pro_quantity: 100,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
  before = await summary();
  accBefore = await accounting();
});

section("ringing it up");
await t("an outside item sells with its own name, price and cost, and no product", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", { order: ORDER("main", 800), items: [
    { Bpro_id: bproId, pro_quantity: 1, unit_price: 500 }, PANADOL,
  ] });
  status(res, 201);
  sale = res.data.data.or_id;
  const line = res.data.items.find((l) => l.item_name);
  eq(line.Bpro_id, null, "no product");
  eq(line.item_name, "ZZQA Panadol");
  eq(Number(line.unit_cost), 100, "cost each");
  eq(Number(line.total_price), 300, "line total");
  eq(line.bought_from, "Pharmacy");
});
await t("it takes nothing from stock", async () => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM "ORDER_ITEM" oi JOIN "STOCK_MOVEMENT" m ON m.order_item_id = oi."orderItem_id"
      WHERE oi.order_id = $1 AND oi."Bpro_id" IS NULL`, [sale]);
  eq(rows[0].n, 0);
});
await t("the order's lines name it", async () => {
  const r = await api(cashier, "GET", `/order-items/order/${sale}`);
  status(r, 200);
  ok(r.data.data.some((l) => l.pro_name === "ZZQA Panadol" && l.item_name === "ZZQA Panadol"), "named");
});
await t("without a name, or without what it cost, it is refused", async () => {
  const noName = await api(cashier, "POST", "/orders/with-items", { order: ORDER("noname", 300), items: [{ ...PANADOL, item_name: " " }] });
  eq(noName.status, 400, "no name");
  const noCost = await api(cashier, "POST", "/orders/with-items", { order: ORDER("nocost", 300), items: [{ ...PANADOL, unit_cost: "" }] });
  eq(noCost.status, 400, "no cost");
});
await t("the total is still checked against what was rung up", async () => {
  const r = await api(cashier, "POST", "/orders/with-items", { order: ORDER("bent", 100), items: [PANADOL] });
  eq(r.status, 400);
});

section("in the books");
await t("Reports: what it cost is money out, on the restaurant's side", async () => {
  const s = await summary();
  eq(+(s.expenses.outside_items - (before.expenses.outside_items || 0)).toFixed(2), 200, "outside items");
  eq(+(s.by_department.restaurant.costs.outside_items - (before.by_department.restaurant.costs.outside_items || 0)).toFixed(2), 200, "restaurant cost");
  eq(+(s.expenses.total - before.expenses.total).toFixed(2), 200, "money out");
  eq(+(s.revenue.restaurant - before.revenue.restaurant).toFixed(2), 800, "revenue");
});
await t("Product Profit lists it by name, under Outside items", async () => {
  const r = await api(owner, "GET", `/reports/products?b_id=${A.b_id}&from=${today}&to=${today}`);
  status(r, 200);
  const p = r.data.products.find((x) => x.name === "ZZQA Panadol");
  ok(p, "listed");
  eq(p.category, "Outside items");
  eq(p.sales, 300);
  eq(p.cost, 200);
});
await t("Accounting: counted in money out for the year", async () => {
  const a = await accounting();
  eq(+(a.outsideTotal - (accBefore.outsideTotal || 0)).toFixed(2), 200, "outside total");
  eq(+(a.moneyOut - accBefore.moneyOut).toFixed(2), 200, "money out");
});
await t("a voided sale's outside item costs nothing", async () => {
  await pool.query(`UPDATE "ORDER" SET or_status = 'cancelled' WHERE or_id = $1`, [sale]);
  const s = await summary();
  eq(+(s.expenses.outside_items || 0).toFixed(2), +(before.expenses.outside_items || 0).toFixed(2));
});

section("an open order, and room service");
await t("added to an open order, and the bill settles at the right total", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", { order: ORDER("open", 500, { payment_method: null, or_type: "dine-in" }), items: [
    { Bpro_id: bproId, pro_quantity: 1, unit_price: 500 },
  ] });
  status(res, 201);
  const id = res.data.data.or_id;
  status(await api(cashier, "POST", "/order-items", { ...PANADOL, order_id: id }), 201);
  status(await api(cashier, "PATCH", `/orders/${id}/status`, { status: "preparing" }), 200);
  const paid = await api(cashier, "PUT", `/orders/${id}`, {
    or_tax: 0, or_totalcost: 800, or_totalCostWtax: 800, or_status: "completed", or_type: "dine-in",
    u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash",
  });
  status(paid, 200);
});
await t("an outside line cannot be edited in place", async () => {
  const { rows } = await pool.query(
    `SELECT oi."orderItem_id", oi.order_id FROM "ORDER_ITEM" oi JOIN "ORDER" o ON o.or_id = oi.order_id
      WHERE o.client_ref = $1 AND oi."Bpro_id" IS NULL`, [`${stamp.toLowerCase()}-out-open`]);
  const r = await api(cashier, "PUT", `/order-items/${rows[0].orderItem_id}`, {
    Bpro_id: bproId, pro_quantity: 1, unit_price: 1, order_id: rows[0].order_id,
  });
  eq(r.status, 400);
});
await t("room service takes an outside item too, as the hotel's cost", async () => {
  const type = await api(owner, "POST", "/hotel/room-types", { b_id: A.b_id, type_name: "ZZQA Out Type", base_rate: 5000, max_adults: 2 });
  status(type, 201);
  const room = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: type.data.room_type_id, room_number: `ZZQA-OUT-${stamp.slice(-4)}` });
  status(room, 201);
  const bk = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: today, check_out_date: hotelDay(1),
    guest: { full_name: "ZZQA Out Guest", phone: "0710000036" },
    rooms: [{ room_type_id: type.data.room_type_id, rate_per_night: 5000 }], adults: 1, children: 0,
  });
  status(bk, 201);
  const detail = await api(cashier, "GET", `/hotel/bookings/${bk.data.booking_id}`);
  status(await api(cashier, "POST", `/hotel/bookings/${bk.data.booking_id}/check-in`, {
    room_assignments: [{ booking_room_id: detail.data.rooms[0].booking_room_id, room_id: room.data.room_id }],
  }), 200);
  const hotelBefore = (await summary()).by_department.hotel.costs.outside_items;
  const r = await api(cashier, "POST", "/hotel/room-service", { room_id: room.data.room_id, tax_pct: 0, items: [PANADOL] });
  status(r, 201);
  eq(Number(r.data.total), 300, "on the bill at what the guest pays");
  const { rows: lines } = await pool.query(
    `SELECT item_name, unit_cost FROM "ORDER_ITEM" WHERE order_id = $1`, [r.data.order.or_id]);
  eq(lines[0].item_name, "ZZQA Panadol");
  eq(Number(lines[0].unit_cost), 100);
  eq(+((await summary()).by_department.hotel.costs.outside_items - hotelBefore).toFixed(2), 200, "hotel's cost");
});

await finish("t36-outside-items.mjs");
