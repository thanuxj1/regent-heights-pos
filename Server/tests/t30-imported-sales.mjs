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

section("a day a sheet covers is the sheet's");
await t("a system sale on a sheet's restaurant day is not added; on any other day it is", async () => {
  const { stamp } = await ctx();
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_SheetDay` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Sheet Tea", pro_qty: 100, pro_price: 500, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Sheet Tea", pro_shortname: "Tea", pro_image: "placeholder.png",
    pro_des: "t", cat_id: cat.data.cat_id, pro_price: 500, pro_quantity: 100,
  });
  status(bp, 201);
  const sell = async (tag, day) => {
    const res = await api(A.cashier.token, "POST", "/orders/with-items", {
      order: {
        or_tax: 0, or_totalcost: 500, or_totalCostWtax: 500, or_status: "pending", or_type: "takeaway",
        u_id: A.cashier.u_id, b_id: A.b_id, client_ref: `${stamp.toLowerCase()}-sheet-${tag}`, payment_method: "cash",
      },
      items: [{ Bpro_id: bp.data.Bpro_id, pro_quantity: 1, unit_price: 500 }],
    });
    status(res, 201);
    // A trial sale from before go-live: dated back onto the sheet's days.
    await pool.query(`UPDATE "ORDER" SET or_date = $2 WHERE or_id = $1`, [res.data.data.or_id, day]);
  };
  await sell("covered", "2025-03-01");   // the sheet has restaurant figures that day
  await sell("uncovered", "2025-03-03"); // no sheet that day
  const s = await summary(owner, A.b_id, "2025-03-01", "2025-03-03");
  eq(s.revenue.restaurant, 6045 + 500, "the sheet's restaurant, plus only the uncovered day's sale");
  eq(s.revenue.hotel, 15809.7, "hotel untouched");
  eq(s.daily.map((d) => `${d.day} ${d.restaurant}`).join(", "), "2025-03-01 4170, 2025-03-02 1875, 2025-03-03 500");
});

await finish("t30-imported-sales.mjs");
