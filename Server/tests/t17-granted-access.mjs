// t17-granted-access.mjs — giving a person access, end to end.
//
// For every grantable permission: a cashier holding ONLY that permission can do the
// work it is for (not just open the page), and a cashier without it is refused. Then
// the rules around granting: it takes effect at once both ways, it cannot be
// delegated or used to climb above your own rank, it applies to Cashier accounts only,
// a role change starts the person clean, and a grant beats a switched-off default
// that it depends on.
import jwt from "jsonwebtoken";
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
// The hotel's calendar day, as the server dates sales — not UTC's, which runs
// 5½ hours behind Sri Lanka and named the wrong day every evening after 18:30 UTC.
import { hotelToday } from "../utils/hotelTime.js";

const { A, B, stamp } = await ctx();
const owner = A.owner.token;
const plain = A.cashier.token; // a cashier with no grants at all

let seq = 0;
async function staff(roleId, label) {
  seq += 1;
  const email = `${stamp}_t17_${label}_${seq}@example.test`.toLowerCase();
  const r = await pool.query(
    `INSERT INTO "User" (u_fname, u_lname, u_email, u_pw, role_id, u_status, "B_id", com_id)
     VALUES ('ZZQA', $1, $2, 'x', $3, TRUE, $4, $5) RETURNING u_id`,
    [label, email, roleId, A.b_id, A.com_id],
  );
  const u_id = r.rows[0].u_id;
  const token = jwt.sign({ u_id, role_id: roleId, u_email: email, b_id: A.b_id, com_id: A.com_id },
    process.env.JWT_SECRET, { expiresIn: "2h" });
  return { u_id, token };
}
const grant = async (u_id, caps) => api(owner, "PUT", `/users/${u_id}/capabilities`, { capabilities: caps });
const holder = async (cap) => {
  const s = await staff(3, cap);
  status(await grant(s.u_id, [cap]), 200, `granting ${cap}`);
  return s;
};
const refused = (res, what) => ok(res.status === 403, `${what}: expected 403, got ${res.status}`);

// Shared fixtures, made by the owner.
let catId, rmId, productId, supplierId;
section("setup");
await t("owner makes a category, product, raw material and supplier to work on", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_T17Menu` });
  status(cat, 201); catId = cat.data.cat_id;
  const pro = await api(owner, "POST", "/products", { pro_name: `${stamp} T17 Dish`, pro_qty: 5, pro_price: 300, cat_id: catId, com_id: A.com_id });
  status(pro, 201); productId = pro.data.pro_id;
  const rm = await api(owner, "POST", "/raw-materials", { rm_name: `${stamp} T17 Salt`, unit: "kg", stock_qty: 10 });
  status(rm, 201); rmId = rm.data.rm_id ?? rm.data.data?.rm_id;
  const sup = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} T17 Supplier` });
  status(sup, 201); supplierId = sup.data.sup_id;
});

section("each permission does its job — and only for whoever holds it");

await t("Reports & Accounting: reports and recording an expense", async () => {
  const h = await holder("reports_accounting");
  status(await api(h.token, "GET", "/reports/summary"), 200, "summary");
  status(await api(h.token, "POST", "/expenses", { exp_category: "utilities", exp_amount: 10, exp_description: "t17", exp_date: hotelToday() }), 201, "expense");
  refused(await api(plain, "GET", "/reports/summary"), "plain cashier, reports");
});

await t("Supplier Management: add, change and view suppliers and their ledger", async () => {
  const h = await holder("supplier_management");
  const s = await api(h.token, "POST", "/suppliers", { sup_name: `${stamp} T17 SM Supplier` });
  status(s, 201, "add supplier");
  status(await api(h.token, "PUT", `/suppliers/${s.data.sup_id}`, { sup_address: "Kandy" }), 200, "change supplier");
  status(await api(h.token, "GET", "/suppliers/ledger"), 200, "ledger");
  refused(await api(plain, "GET", "/suppliers"), "plain cashier, suppliers");
});

await t("Purchase Orders: record a purchase start to finish, including the supplier list and ledger it needs", async () => {
  const h = await holder("purchase_orders");
  status(await api(h.token, "GET", "/suppliers"), 200, "supplier list");
  status(await api(h.token, "GET", "/suppliers/ledger"), 200, "ledger");
  status(await api(h.token, "GET", "/products"), 200, "products to buy for resale");
  const s = await api(h.token, "POST", "/suppliers", { sup_name: `${stamp} T17 PO Supplier` });
  status(s, 201, "add a new supplier while buying");
  const po = await api(h.token, "POST", "/purchase-orders", { sup_id: s.data.sup_id, B_id: A.b_id });
  status(po, 201, "purchase order");
  const poId = po.data.po_id ?? po.data.data?.po_id;
  status(await api(h.token, "POST", "/purchase-items", { po_id: poId, rm_id: rmId, qty: 2, price: 100, unit_price: 50 }), 201, "line");
  status(await api(h.token, "PATCH", `/purchase-orders/${poId}/status`, { status: "received" }), 200, "received");
  refused(await api(h.token, "PUT", `/suppliers/${s.data.sup_id}`, { sup_address: "x" }), "changing a supplier is Supplier Management's");
  refused(await api(plain, "POST", "/purchase-orders", { sup_id: supplierId, B_id: A.b_id }), "plain cashier, purchase order");
});

await t("Product & Menu: add, change and put a dish on the menu; manage categories", async () => {
  const h = await holder("product_menu");
  const p = await api(h.token, "POST", "/products", { pro_name: `${stamp} T17 PM Dish`, pro_qty: 4, pro_price: 250, cat_id: catId, com_id: A.com_id });
  status(p, 201, "add product");
  status(await api(h.token, "PUT", `/products/${p.data.pro_id}`, { pro_price: 260 }), 200, "change product");
  status(await api(h.token, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: p.data.pro_id, pro_name: `${stamp} T17 PM Dish`, pro_shortname: "PM", pro_image: "p.png",
    pro_des: "t", cat_id: catId, pro_price: 260, pro_quantity: 4,
  }), 201, "put on the menu");
  status(await api(h.token, "POST", "/categories", { cat_name: `${stamp}_T17PMCat` }), 201, "add category");
  refused(await api(plain, "POST", "/products", { pro_name: "nope", pro_qty: 1, pro_price: 1, cat_id: catId, com_id: A.com_id }), "plain cashier, product");
});

await t("Raw Materials & Stock: add an ingredient and count stock", async () => {
  const h = await holder("raw_materials");
  const rm = await api(h.token, "POST", "/raw-materials", { rm_name: `${stamp} T17 RM Pepper`, unit: "kg", stock_qty: 3 });
  status(rm, 201, "add ingredient");
  const id = rm.data.rm_id ?? rm.data.data?.rm_id;
  status(await api(h.token, "POST", `/raw-materials/${id}/count`, { counted: 2, note: "t17 recount" }), 200, "count");
  refused(await api(plain, "POST", "/raw-materials", { rm_name: "nope", unit: "kg" }), "plain cashier, ingredient");
});

await t("Hotel & Room Management: room types and the stay policy", async () => {
  const h = await holder("hotel_management");
  status(await api(h.token, "POST", "/hotel/room-types", { type_name: `${stamp} T17 Suite`, rt_name: `${stamp} T17 Suite`, base_rate: 10000 }), 201, "room type");
  const pol = await api(h.token, "GET", "/hotel/policy");
  status(pol, 200, "read policy");
  status(await api(h.token, "PUT", "/hotel/policy", { ...pol.data, check_in_time: pol.data.check_in_time || "14:00", check_out_time: pol.data.check_out_time || "12:00" }), 200, "save policy");
  refused(await api(plain, "POST", "/hotel/room-types", { type_name: "nope", rt_name: "nope", base_rate: 1 }), "plain cashier, room type");
});

await t("Waste Tracking: record waste", async () => {
  const h = await holder("waste_tracking");
  status(await api(h.token, "POST", "/waste", { rm_id: rmId, waste_qty: 1, reason: "t17 spilled" }), 201, "record waste");
  refused(await api(plain, "POST", "/waste", { rm_id: rmId, waste_qty: 1, reason: "nope" }), "plain cashier, waste");
});

await t("Cash Drawer Administration: see the drawer PIN setting and past drawers", async () => {
  const h = await holder("cash_drawer_admin");
  status(await api(h.token, "GET", "/cash/pin"), 200, "pin setting");
  status(await api(h.token, "GET", "/cash/sessions"), 200, "drawer history");
  refused(await api(plain, "GET", "/cash/sessions"), "plain cashier, drawer history");
});

await t("Activity Log: read the log", async () => {
  const h = await holder("activity_log");
  status(await api(h.token, "GET", "/activity"), 200, "activity");
  refused(await api(plain, "GET", "/activity"), "plain cashier, activity");
});

await t("Branch Settings: change the property's details", async () => {
  const h = await holder("branch_settings");
  status(await api(h.token, "PUT", `/branches/${A.b_id}`, { B_address: "1 Temple Road, Kandy" }), 200, "branch details");
  refused(await api(plain, "PUT", `/branches/${A.b_id}`, { B_address: "nope" }), "plain cashier, branch");
});

await t("Delivery Management: add a delivery partner", async () => {
  const h = await holder("delivery_management");
  status(await api(h.token, "POST", "/delivery-partners", { name: `${stamp} T17 Riders` }), 201, "partner");
  refused(await api(plain, "POST", "/delivery-partners", { name: "nope" }), "plain cashier, partner");
});

await t("Commission Agents: add an agent", async () => {
  const h = await holder("commission_agents");
  status(await api(h.token, "POST", "/commission/agents", { agent_name: `${stamp} T17 Agent`, commission_rate: 5 }), 201, "agent");
  refused(await api(plain, "POST", "/commission/agents", { agent_name: "nope", commission_rate: 5 }), "plain cashier, agent");
});

let um;
await t("User Management: list staff and add a cashier", async () => {
  um = await holder("user_management");
  status(await api(um.token, "GET", "/users"), 200, "list");
  status(await api(um.token, "GET", "/roles"), 200, "roles for the form");
  status(await api(um.token, "POST", "/users", {
    u_fname: "New", u_lname: "Cashier", u_email: `${stamp}_t17_new@example.test`.toLowerCase(),
    u_pw: "Str0ng!Passw0rd", role_id: 3, u_status: true,
  }), 201, "add cashier");
  refused(await api(plain, "GET", "/users"), "plain cashier, users");
});

section("granting cannot be used to climb");
await t("a User Management cashier cannot create an Administrator", async () => {
  const r = await api(um.token, "POST", "/users", {
    u_fname: "Sneaky", u_lname: "Admin", u_email: `${stamp}_t17_sneaky@example.test`.toLowerCase(),
    u_pw: "Str0ng!Passw0rd", role_id: 1, u_status: true,
  });
  refused(r, "creating an Administrator");
});

await t("…cannot promote themselves to Administrator", async () => {
  refused(await api(um.token, "PUT", `/users/${um.u_id}`, { role_id: 1 }), "self-promotion");
});

await t("…cannot change or switch off the owner's account", async () => {
  refused(await api(um.token, "PUT", `/users/${A.owner.u_id}`, { u_status: false }), "deactivating the owner");
});

await t("…cannot grant permissions to anyone, themselves included", async () => {
  refused(await api(um.token, "PUT", `/users/${um.u_id}/capabilities`, { capabilities: ["reports_accounting"] }), "self-grant");
  refused(await api(um.token, "PUT", `/users/${A.cashier.u_id}/capabilities`, { capabilities: ["reports_accounting"] }), "granting a colleague");
});

section("the rules of granting");
await t("a grant works on the very next request, and so does taking it away", async () => {
  const s = await staff(3, "immediate");
  refused(await api(s.token, "GET", "/activity"), "before");
  status(await grant(s.u_id, ["activity_log"]), 200);
  status(await api(s.token, "GET", "/activity"), 200, "right after granting");
  status(await grant(s.u_id, []), 200);
  refused(await api(s.token, "GET", "/activity"), "right after revoking");
});

await t("a person can read their own grants (the screens use this to build their menu)", async () => {
  const s = await staff(3, "own");
  await grant(s.u_id, ["waste_tracking"]);
  const r = await api(s.token, "GET", `/users/${s.u_id}/capabilities`);
  status(r, 200);
  eq(JSON.stringify(r.data.capabilities), JSON.stringify(["waste_tracking"]), "own grants");
});

await t("extra permissions are for Cashier accounts: a waiter or kitchen account is refused, clearly", async () => {
  const w = await staff(8, "waiter");
  const k = await staff(9, "kitchen");
  const rw = await grant(w.u_id, ["reports_accounting"]);
  status(rw, 400, "waiter");
  ok(/Cashier/.test(rw.data?.message || rw.data?.error || ""), "the message says why");
  status(await grant(k.u_id, ["raw_materials"]), 400, "kitchen");
  status(await grant(w.u_id, []), 200, "clearing is always allowed");
});

await t("a permission with no working page behind it cannot be granted", async () => {
  const s = await staff(3, "hidden");
  status(await grant(s.u_id, ["cashier_pos_access"]), 400);
  const cat = await api(owner, "GET", "/capabilities");
  ok(!cat.data.some((c) => c.key === "cashier_pos_access"), "not offered in the list either");
});

await t("changing someone's role starts their permissions clean", async () => {
  const s = await staff(3, "rolechange");
  await grant(s.u_id, ["reports_accounting"]);
  status(await api(owner, "PUT", `/users/${s.u_id}`, { role_id: 8 }), 200, "made a waiter");
  const after = await pool.query(`SELECT COUNT(*)::int AS n FROM "USER_CAPABILITY" WHERE u_id = $1`, [s.u_id]);
  eq(after.rows[0].n, 0, "grants removed");
  status(await api(owner, "PUT", `/users/${s.u_id}`, { role_id: 3 }), 200, "made a cashier again");
  const again = await api(owner, "GET", `/users/${s.u_id}/capabilities`);
  eq(again.data.capabilities.length, 0, "nothing comes back on its own");
});

await t("a grant beats a switched-off default it depends on", async () => {
  const s = await staff(3, "dependent");
  status(await api(owner, "PUT", `/users/${s.u_id}/default-permissions`, { revoked: ["default_view_directory"] }), 200);
  refused(await api(s.token, "GET", "/commission/agents"), "viewing agents switched off, nothing granted");
  await grant(s.u_id, ["commission_agents"]);
  status(await api(s.token, "GET", "/commission/agents"), 200, "managing agents granted: may list them");
  await grant(s.u_id, ["delivery_management"]);
  status(await api(s.token, "GET", "/delivery-partners"), 200, "delivery partners for the Delivery page");
  status(await api(s.token, "GET", "/delivery-cod/outstanding"), 200, "and what riders owe");
});

await t("an owner cannot see or change another company's staff", async () => {
  const bOwner = B.owner.token;
  status(await api(bOwner, "GET", `/users/${A.cashier.u_id}/capabilities`), 404, "read");
  status(await api(bOwner, "PUT", `/users/${A.cashier.u_id}/capabilities`, { capabilities: ["activity_log"] }), 404, "write");
});

await finish("t17-granted-access.mjs");
