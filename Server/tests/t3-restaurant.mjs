// t3-restaurant.mjs — menu setup, orders, voiding, the manager-approval PIN
// gate on a discount/void, and the kitchen board.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const waiter = A.waiter.token;
const kitchen = A.kitchen.token;

let catId, proId, bproId;

section("menu setup");
await t("owner creates a category and a product", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_Drinks` });
  status(cat, 201);
  catId = cat.data.cat_id;
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Cola", pro_qty: 100, pro_price: 300, cat_id: catId, com_id: A.com_id });
  status(pro, 201);
  proId = pro.data.pro_id;
});

await t("owner adds it to the branch menu", async () => {
  const res = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: proId, pro_name: "ZZQA Cola", pro_shortname: "Cola", pro_image: "placeholder.png",
    pro_des: "A fizzy test drink", cat_id: catId, pro_price: 300, pro_quantity: 100,
  });
  status(res, 201);
  bproId = res.data.Bpro_id;
});

section("orders");
let orderId;
await t("cashier rings up a plain sale with no discount", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 300, or_totalCostWtax: 300, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-order-1`, payment_method: "cash",
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 300 }],
  });
  status(res, 201);
  orderId = res.data.data.or_id;
});

await t("waiter can also create an order (shared role)", async () => {
  const res = await api(waiter, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 300, or_totalCostWtax: 300, or_status: "pending", or_type: "takeaway",
      u_id: A.waiter.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-order-2`,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 300 }],
  });
  status(res, 201);
});

await t("kitchen staff cannot create an order (read-only role there)", async () => {
  const res = await api(kitchen, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 300, or_totalCostWtax: 300, or_status: "pending", or_type: "takeaway",
      u_id: A.kitchen.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-order-3`,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 300 }],
  });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

section("discount needs a manager PIN (till sale) — once a manager has set one");
let noPinOrderId;
await t("with no manager PIN set, the till is told no PIN is needed", async () => {
  const res = await api(cashier, "GET", "/security/discount-approval");
  status(res, 200);
  eq(res.data.pin_needed, false);
});

await t("with no manager PIN set, a cashier's discounted sale goes through without one", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 270, or_totalCostWtax: 270, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-order-4`, payment_method: "cash",
      discount_pct: 10,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 300 }],
  });
  status(res, 201, "no PIN exists yet, so a discount needs none");
  eq(res.data.data.discount_approved_by ?? null, null, "nobody approved it, and the sale says so");
  noPinOrderId = res.data.data.or_id;
});

await t("but a void still needs a PIN, even with none set", async () => {
  const res = await api(cashier, "POST", `/orders/${noPinOrderId}/void`, { reason: "ZZQA test void" });
  status(res, 403, "voids are never waved through");
});

await t("owner sets their approval PIN through the real endpoint", async () => {
  const res = await api(owner, "PUT", "/security/approval-pin", { pin: "135790" });
  status(res, 200);
  eq((await api(cashier, "GET", "/security/discount-approval")).data.pin_needed, true, "the till now has to ask");
});

await t("once a PIN is set, a discounted sale with no PIN is refused", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 270, or_totalCostWtax: 270, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-order-5`, payment_method: "cash",
      discount_pct: 10,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 300 }],
  });
  status(res, 403, "a discount with no approval PIN should be refused once a manager has one");
});

await t("once a PIN is set, a discounted sale with a WRONG PIN is refused", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 270, or_totalCostWtax: 270, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-order-5b`, payment_method: "cash",
      discount_pct: 10, approval_pin: "0000",
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 300 }],
  });
  status(res, 403, "a wrong PIN should be refused, not silently accepted");
});

let discountedOrderId;
await t("the SAME discount now succeeds with the owner's real PIN, and the price actually reflects the discount", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 270, or_totalCostWtax: 270, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-order-6`, payment_method: "cash",
      discount_pct: 10, approval_pin: "135790",
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 300 }],
  });
  status(res, 201);
  eq(Number(res.data.data.or_totalcost), 270, "the stored total should be the discounted amount, not the full price");
  discountedOrderId = res.data.data.or_id;
});

section("void needs the same approval");
await t("voiding a sale with no PIN is refused", async () => {
  const res = await api(cashier, "POST", `/orders/${discountedOrderId}/void`, { reason: "ZZQA test void" });
  status(res, 403, "a cashier voiding a sale needs manager approval too");
});

await t("voiding with the real PIN succeeds", async () => {
  const res = await api(cashier, "POST", `/orders/${discountedOrderId}/void`, { reason: "ZZQA test void", approval_pin: "135790" });
  status(res, 200);
});

section("kitchen board");
await t("the kitchen board shows the still-pending orders", async () => {
  const res = await api(kitchen, "GET", `/orders/board?b_id=${A.b_id}`);
  status(res, 200);
  ok(res.data.data.some((o) => o.or_id === orderId), "the plain cash sale should still be on the board (never actioned)");
});

section("manager PIN cleanup");
await t("owner removes their approval PIN again (leaves the fixture clean for later files)", async () => {
  const res = await api(owner, "DELETE", "/security/approval-pin");
  status(res, 200);
});

await finish("t3-restaurant.mjs");
