// t24-no-kitchen-screen.mjs — a property whose kitchen cooks from the printed KOT
// and never touches a kitchen screen (Regent Heights). There:
//  • a paid sale is finished as soon as it is rung up, not left "pending" for good;
//  • an unpaid open bill still waits, until it is paid;
//  • the till's Kitchen Orders keeps fresh deliveries and money to collect, and
//    is not flooded with every sale just taken;
//  • revenue screens count sales by payment, never by kitchen status — in a
//    kitchen-screen property too, where a paid sale is "pending" until cooked.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";

const { A, B, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;

let bproId, partner;
const sell = async (tag, order) => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 500, or_totalCostWtax: 500, or_status: "pending", or_type: "takeaway",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-nk-${tag}`, ...order,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 500 }],
  });
  status(res, 201);
  return res.data.data;
};
const onTill = async (id) => {
  const res = await api(cashier, "GET", "/orders/board?scope=till");
  status(res, 200);
  return res.data.data.some((o) => Number(o.or_id) === Number(id));
};
const sold = async () => {
  const res = await api(owner, "GET", "/orders?status=sold");
  status(res, 200);
  return res.data.data.map((o) => Number(o.or_id));
};

section("setup");
await t("a menu item and a rider", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_NkMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Nk Dish", pro_qty: 50, pro_price: 500, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Nk Dish", pro_shortname: "Dish",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 500, pro_quantity: 50,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
  const p = await api(owner, "POST", "/delivery-partners", { name: `${stamp} Nk Rider` });
  status(p, 201);
  partner = p.data.key;
});

section("with a kitchen screen (the default)");
let screenPaid;
await t("a paid sale waits for the kitchen, as before", async () => {
  screenPaid = await sell("screen-paid", { payment_method: "cash" });
  eq(screenPaid.or_status, "pending", "status");
});
await t("…and is still counted as a sale, though the kitchen has not finished it", async () => {
  ok((await sold()).includes(Number(screenPaid.or_id)), "paid sales are takings whatever the kitchen status");
});

section("without a kitchen screen");
await t("the property is switched to cooking from the KOT", async () => {
  await pool.query(`UPDATE "Branch" SET kitchen_screen = FALSE WHERE "B_id" = $1`, [A.b_id]);
});

let paid, tab, credit, cod;
await t("a paid sale is finished as soon as it is rung up", async () => {
  paid = await sell("paid", { payment_method: "card" });
  eq(paid.or_status, "completed", "status");
  ok(paid.status_changed_at, "finish time recorded");
});
await t("an unpaid dine-in bill is still open", async () => {
  tab = await sell("tab", { or_type: "dine-in" });
  eq(tab.or_status, "pending", "status");
});
await t("a delivery on credit and a cash-on-delivery order are finished too", async () => {
  credit = await sell("credit", { or_type: "delivery", payment_method: "credit", credit_customer: "Pickme", delivery_partner: partner });
  cod = await sell("cod", { or_type: "delivery", payment_method: "cod", delivery_partner: partner });
  eq(credit.or_status, "completed", "credit delivery");
  eq(cod.or_status, "completed", "COD delivery");
});

await t("the till's Kitchen Orders is not flooded with the paid sale", async () => {
  ok(!(await onTill(paid.or_id)), "a paid takeaway is nothing for the till to do");
});
await t("…but keeps the open bill and both deliveries", async () => {
  ok(await onTill(tab.or_id), "unpaid: money still to collect");
  ok(await onTill(credit.or_id), "a fresh delivery stays, so its bill can be printed");
  ok(await onTill(cod.or_id), "COD still with the rider");
});
await t("a delivery from hours ago drops off the till's list once its money is in", async () => {
  await pool.query(`UPDATE "ORDER" SET or_date = (NOW() - INTERVAL '30 hours')::date, or_time = (NOW() - INTERVAL '30 hours')::time WHERE or_id = $1`, [credit.or_id]);
  ok(!(await onTill(credit.or_id)), "old credit delivery");
});

await t("paying the open bill at the till finishes it", async () => {
  status(await api(cashier, "PATCH", `/orders/${tab.or_id}/status`, { status: "preparing" }), 200);
  const res = await api(cashier, "PUT", `/orders/${tab.or_id}`, {
    or_tax: 0, or_totalcost: 500, or_totalCostWtax: 500, or_status: "completed", or_type: "dine-in",
    u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cash",
  });
  status(res, 200);
  const { rows } = await pool.query(`SELECT or_status FROM "ORDER" WHERE or_id = $1`, [tab.or_id]);
  eq(rows[0].or_status, "completed", "status");
});

section("what counts as a sale");
await t("paid sales count; unpaid credit and COD still with the rider do not", async () => {
  const ids = await sold();
  ok(ids.includes(Number(paid.or_id)), "paid takeaway");
  ok(!ids.includes(Number(credit.or_id)), "credit not yet paid");
  ok(!ids.includes(Number(cod.or_id)), "COD not yet handed over");
});
await t("once the rider hands the cash over, the COD order counts", async () => {
  status(await api(owner, "POST", "/delivery-cod/settle", {
    delivery_partner: partner, amount: 500, method: "cash", order_ids: [cod.or_id],
  }), 201);
  ok((await sold()).includes(Number(cod.or_id)), "settled COD");
});
await t("a voided sale does not count", async () => {
  await pool.query(`UPDATE "ORDER" SET or_status = 'cancelled', voided_at = NOW() WHERE or_id = $1`, [paid.or_id]);
  ok(!(await sold()).includes(Number(paid.or_id)), "voided");
});
await t("another property's sales are not listed", async () => {
  const other = await pool.query(`SELECT or_id FROM "ORDER" WHERE b_id = $1`, [B.b_id]);
  const ids = await sold();
  ok(!other.rows.some((r) => ids.includes(Number(r.or_id))), "tenant B leaked into A's sales");
});

// Every test file shares tenant A, so it goes back to the default.
await t("the property is switched back to a kitchen screen", async () => {
  await pool.query(`UPDATE "Branch" SET kitchen_screen = TRUE WHERE "B_id" = $1`, [A.b_id]);
});

await finish("t24-no-kitchen-screen.mjs");
