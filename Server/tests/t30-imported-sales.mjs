// t30-imported-sales.mjs — days from the old summary sheets (migration 060).
// Reports adds them to the hotel or restaurant side and says how much of each
// figure they are; nothing else (Transactions, room rates, order counts, the
// other tenant) sees them.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";

const { A, B } = await ctx();
const owner = A.owner.token;
// Long before any other test's sales, so the two days hold nothing else.
const FROM = "2025-03-01", TO = "2025-03-02";

const summary = async (token, b_id, from = FROM, to = TO) => {
  const res = await api(token, "GET", `/reports/summary?b_id=${b_id}&from=${from}&to=${to}`);
  status(res, 200);
  return res.data;
};

section("setup");
await t("two old days for tenant A", async () => {
  await pool.query(`DELETE FROM "IMPORTED_SALES" WHERE b_id = $1`, [A.b_id]);
  await pool.query(
    `INSERT INTO "IMPORTED_SALES" (b_id, sale_date, department, line, amount, source) VALUES
       ($1, '2025-03-01', 'hotel', 'Room revenue', 15625, 'QA'),
       ($1, '2025-03-01', 'hotel', 'Laundry', 184.70, 'QA'),
       ($1, '2025-03-01', 'restaurant', 'Café', 4170, 'QA'),
       ($1, '2025-03-02', 'restaurant', 'Rice & curry', 1875, 'QA')`,
    [A.b_id]
  );
});

section("Reports");
await t("revenue includes them, on the side the sheet's column says", async () => {
  const s = await summary(owner, A.b_id);
  eq(s.revenue.hotel, 15809.7, "hotel");
  eq(s.revenue.restaurant, 6045, "restaurant");
  eq(s.revenue.total, 21854.7, "total");
  eq(s.profit.net, 21854.7, "no costs on those days");
  eq(s.by_department.hotel.revenue, 15809.7, "hotel department");
  eq(s.by_department.restaurant.revenue, 6045, "restaurant department");
});
await t("and says how much of it came from the old sheets, line by line", async () => {
  const s = await summary(owner, A.b_id);
  eq(s.imported.total, 21854.7, "imported total");
  eq(s.imported.days, 2, "days");
  eq(s.by_department.hotel.imported, 15809.7, "hotel imported");
  eq(s.by_department.restaurant.imported, 6045, "restaurant imported");
  eq(s.imported.by_line.map((l) => `${l.department}:${l.line}:${l.total}`).join(", "),
    "hotel:Room revenue:15625, hotel:Laundry:184.7, restaurant:Café:4170, restaurant:Rice & curry:1875");
});
await t("the daily breakdown has both days, marked as imported", async () => {
  const s = await summary(owner, A.b_id);
  eq(s.daily.map((d) => `${d.day} ${d.hotel}/${d.restaurant}${d.imported ? " imported" : ""}`).join(", "),
    "2025-03-01 15809.7/4170 imported, 2025-03-02 0/1875 imported");
});
await t("not orders, not money at the till, not room rates", async () => {
  const s = await summary(owner, A.b_id);
  eq(s.restaurant_orders, 0, "orders");
  eq(s.by_department.restaurant.paid_at_till, 0, "paid at the till");
  eq(s.occupancy.adr, 0, "no room-nights behind the room revenue");
  eq(s.occupancy.revpar, 0, "revpar");
});
await t("a range without them shows none", async () => {
  const s = await summary(owner, A.b_id, "2025-02-01", "2025-02-28");
  eq(s.imported.total, 0);
  eq(s.revenue.total, 0);
});

section("kept apart");
await t("Transactions does not list them", async () => {
  const res = await api(owner, "GET", `/reports/transactions?b_id=${A.b_id}&from=${FROM}&to=${TO}`);
  status(res, 200);
  eq((res.data.transactions || []).length, 0, "no transactions");
});
await t("the other tenant does not see them", async () => {
  const s = await summary(B.owner.token, B.b_id);
  eq(s.imported.total, 0);
  eq(s.revenue.total, 0);
});
await t("nor can it read them by asking for tenant A's branch", async () => {
  const res = await api(B.owner.token, "GET", `/reports/summary?b_id=${A.b_id}&from=${FROM}&to=${TO}`);
  ok(res.status >= 400 || Number(res.data?.imported?.total ?? 0) === 0, `got ${res.status}`);
});

await finish("t30-imported-sales.mjs");
