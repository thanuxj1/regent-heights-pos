// t31-sales-summary.mjs — the property's daily sales sheet, as a report.
// Every date gets a row in the sheet's columns; old sheets' days come from
// IMPORTED_SALES, every other day from the live system; and the grand total is
// always the revenue Reports shows for the same range.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A, B, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = hotelDay(0);
// Around today, not today alone: a folio line is dated by the database's
// clock, which can be a day off the hotel's in the evening.
const near = [hotelDay(-1), hotelDay(1)];

const sheet = async (from, to, token = owner, b_id = A.b_id) => {
  const res = await api(token, "GET", `/reports/sales-summary?b_id=${b_id}&from=${from}&to=${to}`);
  status(res, 200);
  return res.data;
};
const summary = async (from, to) => {
  const res = await api(owner, "GET", `/reports/summary?b_id=${A.b_id}&from=${from}&to=${to}`);
  status(res, 200);
  return res.data;
};

section("old sheets' days");
await t("each line lands in its own column, and every date has a row", async () => {
  await pool.query(`DELETE FROM "IMPORTED_SALES" WHERE b_id = $1 AND sale_date BETWEEN '2025-05-01' AND '2025-05-31'`, [A.b_id]);
  await pool.query(
    `INSERT INTO "IMPORTED_SALES" (b_id, sale_date, department, line, amount, source) VALUES
       ($1, '2025-05-01', 'hotel', 'Room revenue', 15625, 'QA'),
       ($1, '2025-05-01', 'hotel', 'Basis guest meal', 2000, 'QA'),
       ($1, '2025-05-01', 'restaurant', 'Café', 4170, 'QA'),
       ($1, '2025-05-01', 'restaurant', 'Rice & curry', 1875, 'QA'),
       ($1, '2025-05-03', 'restaurant', 'Restaurant', 110, 'QA'),
       ($1, '2025-05-03', 'hotel', 'Transport', 200, 'QA'),
       ($1, '2025-05-03', 'hotel', 'Laundry', 184.70, 'QA')`,
    [A.b_id]
  );
  const s = await sheet("2025-05-01", "2025-05-03");
  eq(s.columns.map((c) => c.label).join(", "), "Room revenue, Basis guest meal, Restaurant, Café, Rice & curry, Transport, Laundry");
  const row = (d) => s.days.find((x) => x.day === d);
  eq(s.days.map((d) => d.day).join(","), "2025-05-01,2025-05-02,2025-05-03", "a row for the quiet day too");
  const one = row("2025-05-01");
  eq([one.room, one.meal, one.restaurant, one.cafe, one.rice, one.transport, one.laundry, one.total].join(","),
    "15625,2000,0,4170,1875,0,0,23670");
  ok(one.imported, "marked as from the old sheets");
  eq(row("2025-05-02").total, 0, "nothing that day");
  ok(!row("2025-05-02").imported, "an empty day is not an old sheet's");
  const three = row("2025-05-03");
  eq([three.restaurant, three.transport, three.laundry, three.total].join(","), "110,200,184.7,494.7");
  eq(s.totals.total, 24164.7, "grand total");
  eq(s.totals.cafe, 4170, "column total");
});
await t("the grand total is Reports' revenue for the same range", async () => {
  const [s, r] = [await sheet("2025-05-01", "2025-05-03"), await summary("2025-05-01", "2025-05-03")];
  eq(s.totals.total, r.revenue.total);
});

section("live days");
let bookingId;
await t("a guest's transport and laundry charges land in those columns", async () => {
  const before = await sheet(...near);
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `${stamp} Sheet`, base_rate: 4000, max_adults: 2, max_children: 0,
  });
  status(rt, 201);
  const room = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: rt.data.room_type_id, room_number: `ZZQA-S${stamp.slice(-4)}` });
  status(room, 201);
  const bk = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: today, check_out_date: hotelDay(1),
    guest: { full_name: "ZZQA Sheet Guest", phone: "0710000031" },
    rooms: [{ room_type_id: rt.data.room_type_id, rate_per_night: 4000 }], adults: 1, children: 0,
  });
  status(bk, 201);
  bookingId = bk.data.booking_id;
  const b = await api(cashier, "GET", `/hotel/bookings/${bookingId}`);
  status(await api(cashier, "POST", `/hotel/bookings/${bookingId}/check-in`, {
    room_assignments: [{ booking_room_id: b.data.rooms[0].booking_room_id, room_id: room.data.room_id }],
  }), 200);
  status(await api(cashier, "POST", `/hotel/bookings/${bookingId}/folio/items`, { source: "transport", description: "Airport drop", qty: 1, unit_price: 2500 }), 201);
  status(await api(cashier, "POST", `/hotel/bookings/${bookingId}/folio/items`, { source: "laundry", description: "Laundry", qty: 1, unit_price: 600 }), 201);
  const after = await sheet(...near);
  const d0 = before.totals, d1 = after.totals;
  eq(+(d1.transport - d0.transport).toFixed(2), 2500, "transport");
  eq(+(d1.laundry - d0.laundry).toFixed(2), 600, "laundry");
  ok(d1.room - d0.room >= 4000, "the room night under room revenue");
});
await t("the total around today is still Reports' revenue for the same days", async () => {
  const [s, r] = [await sheet(...near), await summary(...near)];
  eq(s.totals.total, r.revenue.total);
});

section("who can see it");
await t("another tenant sees none of it", async () => {
  const s = await sheet("2025-05-01", "2025-05-03", B.owner.token, B.b_id);
  eq(s.totals.total, 0);
});
await t("nor by asking for tenant A's branch", async () => {
  const res = await api(B.owner.token, "GET", `/reports/sales-summary?b_id=${A.b_id}&from=2025-05-01&to=2025-05-03`);
  ok(res.status >= 400 || Number(res.data?.totals?.total ?? 0) === 0, `got ${res.status}`);
});
await t("a cashier without Reports access is refused", async () => {
  const res = await api(cashier, "GET", `/reports/sales-summary?b_id=${A.b_id}&from=2025-05-01&to=2025-05-03`);
  eq(res.status, 403);
});

await finish("t31-sales-summary.mjs");
