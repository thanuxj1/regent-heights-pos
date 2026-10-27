// t35-held-expenses.mjs — an expense held for checking (a possible duplicate
// from an imported sheet). Listed with its note, but in no total: not Reports,
// not Accounting's summary, not Transactions. Counting it brings it in;
// a duplicate is deleted like any expense. Another property cannot touch it.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";

const { A, B } = await ctx();
const owner = A.owner.token;
const DAY = "2025-07-02"; // nothing else on this day
let held, dup;

const summary = async () => {
  const r = await api(owner, "GET", `/reports/summary?b_id=${A.b_id}&from=${DAY}&to=${DAY}`);
  status(r, 200);
  return r.data;
};
const yearOut = async () => {
  const r = await api(owner, "GET", `/expenses/summary?b_id=${A.b_id}&year=2025`);
  status(r, 200);
  return Number(r.data.totalExpenses || 0);
};
const listed = async () => {
  const r = await api(owner, "GET", `/reports/transactions?b_id=${A.b_id}&from=${DAY}&to=${DAY}&kind=expense`);
  status(r, 200);
  return r.data.transactions;
};

section("two lines held for checking");
let yearBefore;
await t("as an import leaves them: a note says what each may repeat", async () => {
  yearBefore = await yearOut();
  const ins = (amount, note) => pool.query(
    `INSERT INTO "EXPENSE" (b_id, exp_category, exp_amount, exp_description, exp_date, exp_review_note, exp_source)
     VALUES ($1, 'raw_materials', $2, 'Haira', $3, $4, 'test') RETURNING exp_id`, [A.b_id, amount, DAY, note]);
  held = (await ins(7770, "Possible duplicate of: Haira (08/08, 7,770.00)")).rows[0].exp_id;
  dup = (await ins(2275, "Possible duplicate of: Wash Hub (09/08, 2,275.00)")).rows[0].exp_id;
});
await t("the Accounting list shows them, with the note", async () => {
  const r = await api(owner, "GET", `/expenses?b_id=${A.b_id}&from=${DAY}&to=${DAY}`);
  status(r, 200);
  ok(r.data.find((e) => e.exp_id === held)?.exp_review_note.includes("Haira"), "note");
});
await t("but no total counts them", async () => {
  eq((await summary()).expenses.recorded, 0, "Reports");
  eq(await yearOut(), yearBefore, "Accounting's year");
  eq((await listed()).length, 0, "Transactions");
});

section("checked against the bills");
await t("a separate bill: counted from now on, everywhere", async () => {
  status(await api(owner, "POST", `/expenses/${held}/count`), 200);
  eq(+((await yearOut()) - yearBefore).toFixed(2), 7770);
  eq((await listed()).length, 1);
  eq((await summary()).expenses.recorded, 7770, "Reports");
  const { rows } = await pool.query(
    `SELECT summary FROM "ACTIVITY_LOG" WHERE entity = 'expense' AND entity_id = $1 AND action = 'update'`, [String(held)]);
  ok(rows.some((x) => x.summary.includes("separate bill")), "logged");
});
await t("counting it twice is refused", async () => {
  eq((await api(owner, "POST", `/expenses/${held}/count`)).status, 409);
});
await t("another property cannot count one", async () => {
  ok((await api(B.owner.token, "POST", `/expenses/${dup}/count`)).status >= 400);
});
await t("a duplicate is deleted, and never counted", async () => {
  status(await api(owner, "DELETE", `/expenses/${dup}`), 204);
  eq(+((await yearOut()) - yearBefore).toFixed(2), 7770);
});
await t("cleanup", async () => {
  status(await api(owner, "DELETE", `/expenses/${held}`), 204);
});

await finish("t35-held-expenses.mjs");
