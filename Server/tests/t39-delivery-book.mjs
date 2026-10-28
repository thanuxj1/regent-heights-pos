// t39-delivery-book.mjs — what the Record a delivery page fills itself in from:
// each supplier's balance, last delivery, payment habit, whether they usually
// come today, and the items they usually bring (with the latest quantity and
// price), from their last three deliveries to this property. Nothing else's.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";

const { A, B, stamp } = await ctx();
const owner = A.owner.token;
let supId, rice, tissue, cola, quiet;

const deliver = async (lines, paid, daysAgo) => {
  const po = await api(owner, "POST", "/purchase-orders", { sup_id: supId, B_id: A.b_id });
  status(po, 201);
  const poId = po.data.po_id ?? po.data.data?.po_id;
  for (const l of lines) status(await api(owner, "POST", "/purchase-items", { po_id: poId, ...l, price: l.qty * l.unit_price }), 201);
  status(await api(owner, "PATCH", `/purchase-orders/${poId}/status`, {
    status: "received", ...(paid ? { payment: { amount: paid, method: "cash" } } : {}),
  }), 200);
  await pool.query(`UPDATE purchase_order SET received_date = NOW() - make_interval(days => $2) WHERE po_id = $1`, [poId, daysAgo]);
  return poId;
};

section("setup");
await t("a supplier with three deliveries: rice and tissue, then rice and cola, then rice", async () => {
  const mk = async (name, unit, item_category) => {
    const r = await api(owner, "POST", "/raw-materials", { rm_name: `${stamp} ${name}`, unit, stock_qty: 0, item_category });
    status(r, 201);
    return r.data.rm_id ?? r.data.data?.rm_id;
  };
  rice = await mk("DB Rice", "kg", "ingredient");
  tissue = await mk("DB Tissue", "pack", "supply");
  const p = await api(owner, "POST", "/products", { pro_name: `${stamp} DB Cola`, pro_qty: 0, pro_price: 300, cost_price: 200, com_id: A.com_id });
  status(p, 201);
  cola = p.data.pro_id;
  const s = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} DB Grocer` });
  status(s, 201);
  supId = s.data.sup_id;
  const q = await api(owner, "POST", "/suppliers", { sup_name: `${stamp} DB Quiet` });
  status(q, 201);
  quiet = q.data.sup_id;
  // Oldest first. The first two on credit, the latest on credit too.
  await deliver([{ rm_id: rice, qty: 20, unit_price: 280 }, { rm_id: tissue, qty: 24, unit_price: 90 }], 0, 14);
  await deliver([{ rm_id: rice, qty: 25, unit_price: 285 }, { pro_id: cola, qty: 12, unit_price: 200 }], 0, 7);
  await deliver([{ rm_id: rice, qty: 30, unit_price: 290 }], 0, 0);
});

section("the delivery book");
let entry;
await t("lists the supplier with what is owed and the latest delivery", async () => {
  const r = await api(owner, "GET", "/suppliers/delivery-book");
  status(r, 200);
  entry = r.data.find((x) => x.sup_id === supId);
  ok(entry, "listed");
  eq(entry.balance_due, 20 * 280 + 24 * 90 + 25 * 285 + 12 * 200 + 30 * 290, "owed: every delivery, nothing paid");
  eq(entry.deliveries, 3);
  ok(entry.last_delivery, "has a last delivery");
});
await t("usual items: rice first (all three), with the latest quantity and price", async () => {
  eq(entry.usual[0].kind, "rm");
  eq(entry.usual[0].id, rice);
  eq(entry.usual[0].times, 3);
  eq(entry.usual[0].last_qty, 30);
  eq(entry.usual[0].last_price, 290);
  ok(entry.usual.some((u) => u.kind === "pro" && u.id === cola && u.last_qty === 12), "the resale product is there too");
  ok(entry.usual.some((u) => u.kind === "rm" && u.id === tissue), "and the hotel supply");
});
await t("habit: usually on credit", async () => {
  eq(entry.habit, "L");
});
await t("usually today: delivered today and a week ago, so yes", async () => {
  eq(entry.usually_today, true);
});
await t("a supplier who has never delivered: listed, with no usual items and no habit", async () => {
  const r = await api(owner, "GET", "/suppliers/delivery-book");
  const e = r.data.find((x) => x.sup_id === quiet);
  ok(e, "listed");
  eq(e.usual.length, 0);
  eq(e.habit, null);
});
await t("another company's owner does not see this supplier", async () => {
  const r = await api(B.owner.token, "GET", "/suppliers/delivery-book");
  status(r, 200);
  ok(!r.data.some((x) => x.sup_id === supId), "not listed");
});

await finish("t39-delivery-book.mjs");
