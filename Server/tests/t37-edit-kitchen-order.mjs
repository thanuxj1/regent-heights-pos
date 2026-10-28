// t37-edit-kitchen-order.mjs — changing an order the kitchen already has,
// before it is paid: lines added and removed, the total follows, the order
// stays unpaid and with whoever placed it. The till's Kitchen Orders list
// carries who placed it and its discount, so an edit keeps both. A paid order
// cannot be changed this way.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
let rice, curry, order;

section("setup");
await t("two dishes, and an unpaid dine-in order of 2 rice", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_EditMenu` });
  status(cat, 201);
  const make = async (name, price) => {
    const pro = await api(owner, "POST", "/products", { pro_name: name, pro_qty: 100, pro_price: price, cost_price: 1, cat_id: cat.data.cat_id, com_id: A.com_id });
    status(pro, 201);
    const bp = await api(owner, "POST", "/branch_products", {
      B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: name, pro_shortname: name.slice(-4),
      pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: price, pro_quantity: 100,
    });
    status(bp, 201);
    return bp.data.Bpro_id;
  };
  rice = await make("ZZQA Edit Rice", 500);
  curry = await make("ZZQA Edit Curry", 300);
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: { or_tax: 0, or_totalcost: 1000, or_totalCostWtax: 1000, or_status: "pending", or_type: "dine-in",
             u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-edit-1` },
    items: [{ Bpro_id: rice, pro_quantity: 2, unit_price: 500 }],
  });
  status(res, 201);
  order = res.data.data;
  eq(order.payment_method, null, "unpaid");
});

section("the till's list");
await t("Kitchen Orders says who placed it and its discount", async () => {
  const r = await api(cashier, "GET", "/orders/board?scope=till");
  status(r, 200);
  const o = (r.data.data || []).find((x) => x.or_id === order.or_id);
  ok(o, "listed");
  eq(o.u_id, A.cashier.u_id);
  eq(Number(o.discount_pct || 0), 0);
});

section("changing it");
await t("one rice off, a curry on: lines and total follow, still unpaid", async () => {
  const lines = (await api(cashier, "GET", `/order-items/order/${order.or_id}`)).data.data;
  status(await api(cashier, "DELETE", `/order-items/${lines[0].orderItem_id}`), 200);
  status(await api(cashier, "POST", "/order-items", { Bpro_id: rice, pro_quantity: 1, unit_price: 500, order_id: order.or_id }), 201);
  status(await api(cashier, "POST", "/order-items", { Bpro_id: curry, pro_quantity: 1, unit_price: 300, order_id: order.or_id }), 201);
  const r = await api(cashier, "PUT", `/orders/${order.or_id}`, {
    or_tax: 0, or_totalcost: 800, or_totalCostWtax: 800, or_status: "pending", or_type: "dine-in",
    u_id: A.cashier.u_id, b_id: A.b_id, table_id: null, discount_pct: 0, service_fee: 0,
  });
  status(r, 200);
  const { rows: [o] } = await pool.query(`SELECT or_status, payment_method, "or_totalCostWtax" t FROM "ORDER" WHERE or_id = $1`, [order.or_id]);
  eq(o.or_status, "pending");
  eq(o.payment_method, null);
  eq(Number(o.t), 800);
  const now = (await api(cashier, "GET", `/order-items/order/${order.or_id}`)).data.data;
  eq(now.length, 2);
});
await t("…and it can still be paid at the new total", async () => {
  status(await api(cashier, "PATCH", `/orders/${order.or_id}/status`, { status: "preparing" }), 200);
  status(await api(cashier, "PUT", `/orders/${order.or_id}`, {
    or_tax: 0, or_totalcost: 800, or_totalCostWtax: 800, or_status: "completed", or_type: "dine-in",
    u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash",
  }), 200);
});
await t("once paid, its lines cannot be changed", async () => {
  const r = await api(cashier, "POST", "/order-items", { Bpro_id: curry, pro_quantity: 1, unit_price: 300, order_id: order.or_id });
  eq(r.status, 400);
});

await finish("t37-edit-kitchen-order.mjs");
