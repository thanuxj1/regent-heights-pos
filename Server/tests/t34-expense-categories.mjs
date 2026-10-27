// t34-expense-categories.mjs — a property's own expense categories, and how
// each expense was paid. A category says whose cost it is, and Reports' profit
// by department follows it; a rename carries its expenses along; one in use
// cannot be removed; the till can read the list but not change it.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, B } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const DAY = "2025-07-01"; // nothing else on this day
let gas, spare, gasExpense;

const summary = async () => {
  const r = await api(owner, "GET", `/reports/summary?b_id=${A.b_id}&from=${DAY}&to=${DAY}`);
  status(r, 200);
  return r.data;
};

section("adding categories");
await t("an owner adds Gas (the restaurant's) and Spare (the whole property's)", async () => {
  const g = await api(owner, "POST", "/expenses/categories", { b_id: A.b_id, name: "Gas", department: "restaurant" });
  status(g, 201);
  gas = g.data;
  const s = await api(owner, "POST", "/expenses/categories", { b_id: A.b_id, name: "Spare", department: "shared" });
  status(s, 201);
  spare = s.data;
});
await t("the same name twice, or a standard one, is refused", async () => {
  eq((await api(owner, "POST", "/expenses/categories", { b_id: A.b_id, name: "gas" })).status, 409);
  eq((await api(owner, "POST", "/expenses/categories", { b_id: A.b_id, name: "Raw materials" })).status, 400);
});
await t("the till can read the list, but not change it", async () => {
  const r = await api(cashier, "GET", `/expenses/categories?b_id=${A.b_id}`);
  status(r, 200);
  ok(r.data.custom.some((c) => c.name === "Gas"), "Gas listed");
  eq((await api(cashier, "POST", "/expenses/categories", { b_id: A.b_id, name: "Tips" })).status, 403);
});
await t("another property neither sees nor changes them", async () => {
  const r = await api(B.owner.token, "GET", `/expenses/categories?b_id=${B.b_id}`);
  ok(!r.data.custom.some((c) => c.name === "Gas"), "not listed");
  ok((await api(B.owner.token, "PUT", `/expenses/categories/${gas.cat_id}`, { name: "Mine" })).status >= 400);
});

section("expenses under them, with how they were paid");
await t("an expense under gas (any case), paid by card", async () => {
  const r = await api(owner, "POST", "/expenses", { b_id: A.b_id, exp_category: "gas", exp_amount: 4500, exp_date: DAY, exp_method: "card", exp_description: "Two cylinders" });
  status(r, 201);
  gasExpense = r.data;
  eq(r.data.exp_category, "Gas", "stored as the category was named");
  eq(r.data.exp_method, "card");
});
await t("an unknown category or way of paying is refused", async () => {
  eq((await api(owner, "POST", "/expenses", { b_id: A.b_id, exp_category: "Tips", exp_amount: 10, exp_date: DAY })).status, 400);
  eq((await api(owner, "POST", "/expenses", { b_id: A.b_id, exp_category: "other", exp_amount: 10, exp_date: DAY, exp_method: "barter" })).status, 400);
});
await t("Reports counts Gas as the restaurant's cost", async () => {
  const s = await summary();
  eq(s.by_department.restaurant.costs.raw_materials_packaging_delivery, 4500);
  eq(s.by_department.shared.total, 0);
});
await t("Transactions says it was paid by card", async () => {
  const r = await api(owner, "GET", `/reports/transactions?b_id=${A.b_id}&from=${DAY}&to=${DAY}&kind=expense`);
  status(r, 200);
  eq(r.data.transactions.find((x) => Number(x.exp_id) === Number(gasExpense.exp_id))?.method, "card");
});
await t("moving Gas to the whole property moves its cost there in Reports", async () => {
  status(await api(owner, "PUT", `/expenses/categories/${gas.cat_id}`, { department: "shared" }), 200);
  const s = await summary();
  eq(s.by_department.restaurant.costs.raw_materials_packaging_delivery, 0);
  eq(s.by_department.shared.total, 4500);
});

section("renaming and removing");
await t("renaming Gas carries its expense along", async () => {
  status(await api(owner, "PUT", `/expenses/categories/${gas.cat_id}`, { name: "LP Gas" }), 200);
  const r = await api(owner, "GET", `/expenses?b_id=${A.b_id}&from=${DAY}&to=${DAY}`);
  eq(r.data.find((e) => Number(e.exp_id) === Number(gasExpense.exp_id))?.exp_category, "LP Gas");
});
await t("a category in use cannot be removed; an unused one can", async () => {
  eq((await api(owner, "DELETE", `/expenses/categories/${gas.cat_id}`)).status, 409);
  status(await api(owner, "DELETE", `/expenses/categories/${spare.cat_id}`), 204);
});
await t("cleanup", async () => {
  status(await api(owner, "DELETE", `/expenses/${gasExpense.exp_id}`), 204);
  status(await api(owner, "DELETE", `/expenses/categories/${gas.cat_id}`), 204);
});

await finish("t34-expense-categories.mjs");
