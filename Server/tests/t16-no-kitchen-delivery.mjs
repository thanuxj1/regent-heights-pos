// t16-no-kitchen-delivery.mjs — a delivery of things that never pass through the
// kitchen: the order and its COD tracking are normal, the kitchen is never told.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const kitchen = A.kitchen.token;

let bproId, partner, plainId, skipId;

const sell = async (tag, type, extra = {}, orderExtra = {}) => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 500, or_totalCostWtax: 500, or_status: "pending", or_type: type,
      u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash", client_ref: `${stamp.toLowerCase()}-nk-${tag}`,
      ...(type === "delivery" ? { delivery_charge: 0 } : {}), ...extra,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 500 }],
    ...orderExtra,
  });
  status(res, 201);
  return res.data.data;
};
const onKitchenBoard = async (orderId) => {
  const res = await api(kitchen, "GET", "/orders/board");
  status(res, 200);
  const rows = res.data.data ?? res.data.orders ?? res.data;
  const flat = Array.isArray(rows) ? rows : Object.values(rows).flat();
  return flat.some((o) => Number(o.or_id ?? o.id) === Number(orderId));
};

section("setup");
await t("a menu item and a delivery partner", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_NkMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Water Bottle", pro_qty: 20, pro_price: 500, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Water Bottle", pro_shortname: "Water",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 500, pro_quantity: 20,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
  const p = await api(owner, "POST", "/delivery-partners", { name: `${stamp} Own Rider` });
  status(p, 201);
  partner = p.data.key;
});

section("not through the kitchen");
await t("a normal delivery order is pending and on the kitchen board", async () => {
  const o = await sell("plain", "delivery", { delivery_partner: partner, payment_method: "cod" });
  plainId = o.or_id;
  eq(o.or_status, "pending", "status");
  ok(await onKitchenBoard(plainId), "kitchen should see it");
});

await t("with skip_kitchen the delivery is recorded as handed over and the kitchen never sees it", async () => {
  const o = await sell("skip", "delivery", { delivery_partner: partner, payment_method: "cod", skip_kitchen: true });
  skipId = o.or_id;
  eq(o.or_status, "completed", "status");
  ok(!(await onKitchenBoard(skipId)), "kitchen should not see it");
});

await t("it is still cash-on-delivery money owed by the rider", async () => {
  const res = await api(cashier, "GET", "/delivery-cod/outstanding");
  status(res, 200);
  const row = res.data.byPartner.find((p) => p.delivery_partner === partner);
  ok(row, "the rider should owe money");
  eq(Number(row.total), 1000, "both orders are outstanding (500 + 500)");
});

await t("skip_kitchen is ignored on anything but a delivery", async () => {
  const o = await sell("dinein", "dine-in", { skip_kitchen: true });
  eq(o.or_status, "pending", "a dine-in sale cannot be slipped past the kitchen this way");
});

await t("the rider's cash settles it like any other COD order", async () => {
  const res = await api(owner, "POST", "/delivery-cod/settle", {
    delivery_partner: partner, amount: 500, method: "cash", order_ids: [skipId],
  });
  status(res, 201);
});

await finish("t16-no-kitchen-delivery.mjs");
