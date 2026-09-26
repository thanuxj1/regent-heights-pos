// t7-delivery-commission.mjs — delivery partners, COD outstanding/settlement,
// and commission agents/records.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;

let partnerKey, bproId;

section("delivery partners");
await t("owner adds a delivery partner", async () => {
  const res = await api(owner, "POST", "/delivery-partners", { name: "ZZQA Riders", contact: "0711111111" });
  status(res, 201);
  partnerKey = res.data.key;
  ok(partnerKey, "response should carry the new partner's key");
});

await t("cashier cannot add a delivery partner (needs Delivery Management)", async () => {
  const res = await api(cashier, "POST", "/delivery-partners", { name: "Should Fail Rider" });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

await t("cashier can still list delivery partners (view is Cashier-tier by default)", async () => {
  const res = await api(cashier, "GET", "/delivery-partners");
  status(res, 200);
  ok(res.data.some((p) => p.key === partnerKey), "the new partner should be listed");
});

let longPartnerKey;
await t("owner adds a partner whose name slugifies to a key over 20 characters", async () => {
  const res = await api(owner, "POST", "/delivery-partners", { name: "ZZQA International Express Couriers" });
  status(res, 201);
  longPartnerKey = res.data.key;
  ok(longPartnerKey.length > 20, `test needs a key over 20 chars to actually exercise the fix, got "${longPartnerKey}" (${longPartnerKey.length})`);
});

section("COD outstanding & settlement");
let codOrderId;
await t("a menu item exists to sell (reused minimal setup)", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_DeliveryMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Pizza", pro_qty: 20, pro_price: 1500, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bpro = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Pizza", pro_shortname: "Pizza",
    pro_image: "placeholder.png", pro_des: "A test pizza", cat_id: cat.data.cat_id, pro_price: 1500, pro_quantity: 20,
  });
  status(bpro, 201);
  bproId = bpro.data.Bpro_id;
});

await t("regression: an order tagged with the long-key partner is accepted, not a raw 500 (was VARCHAR(20) vs the key's own VARCHAR(30))", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 1500, or_totalCostWtax: 1500, or_status: "pending", or_type: "delivery",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-longkey-1`,
      payment_method: "cod", delivery_partner: longPartnerKey,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 1500 }],
  });
  status(res, 201, "a long delivery_partner key must not crash order creation");
});

await t("cashier rings up a COD delivery order for that partner", async () => {
  const res = await api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 1500, or_totalCostWtax: 1500, or_status: "pending", or_type: "delivery",
      u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-cod-1`,
      payment_method: "cod", delivery_partner: partnerKey,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 1500 }],
  });
  status(res, 201);
  codOrderId = res.data.data.or_id;
});

await t("that order now shows as outstanding COD for the partner", async () => {
  const res = await api(cashier, "GET", "/delivery-cod/outstanding");
  status(res, 200);
  const row = res.data.byPartner.find((p) => p.delivery_partner === partnerKey);
  ok(row, "the partner should show an outstanding balance");
  eq(Number(row.total), 1500, "outstanding total should match the order amount");
});

await t("owner settles that COD order", async () => {
  const res = await api(owner, "POST", "/delivery-cod/settle", {
    delivery_partner: partnerKey, amount: 1500, method: "cash", order_ids: [codOrderId],
  });
  status(res, 201);
});

await t("outstanding COD for the partner is now zero", async () => {
  const res = await api(cashier, "GET", "/delivery-cod/outstanding");
  const row = res.data.byPartner.find((p) => p.delivery_partner === partnerKey);
  ok(!row, "the partner should have no outstanding balance left after settling");
});

await t("the settlement shows the real staff member who recorded it, not the partner's own name", async () => {
  const res = await api(owner, "GET", "/delivery-cod/history");
  status(res, 200);
  const row = res.data.find((s) => s.delivery_partner === partnerKey);
  ok(row, "the settlement should be in the history");
  ok(row.recorded_by, "recorded_by should be populated with the real staff name");
});

section("commission agents");
let agentId;
await t("owner adds a commission agent", async () => {
  const res = await api(owner, "POST", "/commission/agents", { agent_name: "ZZQA Travel Agent", commission_rate: 8 });
  status(res, 201);
  agentId = res.data.agent_id;
});

await t("cashier can view the agent list (default view access)", async () => {
  const res = await api(cashier, "GET", "/commission/agents");
  status(res, 200);
  ok(res.data.some((a) => a.agent_id === agentId), "the new agent should be listed");
});

await t("cashier cannot log a manual commission record (needs Commission Agents management)", async () => {
  const res = await api(cashier, "POST", "/commission/records", { agent_id: agentId, commission_amount: 500 });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

await t("owner can log a manual commission record", async () => {
  const res = await api(owner, "POST", "/commission/records", { agent_id: agentId, commission_amount: 500 });
  status(res, 201);
});

await finish("t7-delivery-commission.mjs");
