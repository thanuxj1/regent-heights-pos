// t4-stock.mjs — raw materials, suppliers, purchase orders, the
// supplier-payment "who recorded it" fix, and waste tracking's own version
// of the same fix.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;

let rmId, supId, poId;

section("raw materials & suppliers setup");
await t("owner creates a raw material", async () => {
  const res = await api(owner, "POST", "/raw-materials", { rm_name: `${stamp} Flour`, unit: "kg", stock_qty: 100 });
  status(res, 201);
  rmId = res.data.rm_id ?? res.data.data?.rm_id;
  ok(rmId, "response should carry the new rm_id");
});

await t("cashier cannot create a raw material (needs Raw Materials & Stock)", async () => {
  const res = await api(cashier, "POST", "/raw-materials", { rm_name: "Should Fail", unit: "kg" });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

await t("owner creates a supplier", async () => {
  const res = await api(owner, "POST", "/suppliers", {
    sup_name: `${stamp} Supplies Co`, sup_email: `${stamp}@example.test`, sup_contact: "0710000000",
  });
  status(res, 201);
  supId = res.data.sup_id ?? res.data.data?.sup_id;
  ok(supId, "response should carry the new sup_id");
});

section("purchase order lifecycle");
await t("owner creates a purchase order", async () => {
  const res = await api(owner, "POST", "/purchase-orders", { sup_id: supId, B_id: A.b_id });
  status(res, 201);
  poId = res.data.po_id ?? res.data.data?.po_id;
  ok(poId, "response should carry the new po_id");
});

await t("owner adds a line item to it", async () => {
  const res = await api(owner, "POST", "/purchase-items", { po_id: poId, rm_id: rmId, qty: 10, price: 500, unit_price: 50 });
  status(res, 201);
});

section("marking received + paying — the recorded_by fix");
await t("marking the order received with a payment records who did it", async () => {
  const res = await api(owner, "PATCH", `/purchase-orders/${poId}/status`, {
    status: "received", payment: { amount: 500, method: "cash" },
  });
  status(res, 200);
});

await t("the transactions ledger shows the OWNER's name as who handled the payment, not the supplier's", async () => {
  const from = "2000-01-01", to = "2100-12-31";
  const res = await api(owner, "GET", `/reports/transactions?b_id=${A.b_id}&kind=all&from=${from}&to=${to}`);
  status(res, 200);
  const row = res.data.transactions.find((r) => r.type === "Supplier payment" && r.reference === `PO#${poId}`);
  ok(row, "the supplier payment should appear in the ledger");
  eq(row.party, `${stamp} Supplies Co`, "party should be the supplier's name");
  ok(row.handled_by && row.handled_by !== row.party, "handled_by should be the recording manager, not fall back to the supplier's name");
});

section("waste tracking — the same recorded_by fix");
let wasteId;
await t("owner logs a waste entry against the raw material", async () => {
  const res = await api(owner, "POST", "/waste", { rm_id: rmId, waste_qty: 2, reason: "ZZQA test spoilage" });
  status(res, 201);
  wasteId = res.data.waste_id ?? res.data.data?.waste_id;
});

await t("the raw material's stock actually decreased by the wasted amount", async () => {
  const res = await api(owner, "GET", `/raw-materials/${rmId}`);
  status(res, 200);
  const qty = Number(res.data.stock_qty ?? res.data.data?.stock_qty);
  eq(qty, 10 + 100 - 2, "stock should be starting 100 + 10 purchased - 2 wasted = 108");
});

await t("the ledger shows the waste entry with a real handled_by, not the ingredient's own name", async () => {
  const from = "2000-01-01", to = "2100-12-31";
  const res = await api(owner, "GET", `/reports/transactions?b_id=${A.b_id}&kind=all&from=${from}&to=${to}`);
  const row = res.data.transactions.find((r) => r.type === "Waste");
  ok(row, "the waste entry should appear in the ledger");
  eq(row.party, `${stamp} Flour`, "party should be the wasted item's name");
  ok(row.handled_by && row.handled_by !== row.party, "handled_by should be a real staff name, not the ingredient's own name");
});

await t("cashier cannot log waste (needs Waste Tracking)", async () => {
  const res = await api(cashier, "POST", "/waste", { rm_id: rmId, waste_qty: 1, reason: "should fail" });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

await finish("t4-stock.mjs");
