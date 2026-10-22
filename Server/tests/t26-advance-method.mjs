// t26-advance-method.mjs — a new booking's advance payment keeps how it was
// paid. It used to be recorded as cash whatever the guest paid with, so a card
// or bank-transfer deposit showed as cash in Transactions.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const sfx = Date.now().toString(36).slice(-5);
let roomTypeId;

section("setup");
await t("a room type", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `ZZQA Advance ${sfx}`, base_rate: 10000, max_adults: 2, max_children: 0,
  });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  status(await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `ADV-${sfx}` }), 201);
});

const book = (method, name) => api(cashier, "POST", "/hotel/bookings", {
  b_id: A.b_id, check_in_date: hotelDay(10), check_out_date: hotelDay(11), tax_pct: 0,
  guest: { full_name: `ZZQA ${name} ${sfx}`, phone: `0746${Math.floor(Math.random() * 1e6)}` },
  rooms: [{ room_type_id: roomTypeId, rate_per_night: 10000 }], adults: 1, children: 0,
  advance_payment: 4000, ...(method ? { advance_method: method } : {}),
});
const paymentOf = async (bookingId) => (await pool.query(
  `SELECT method, amount, kind FROM "BOOKING_PAYMENT" WHERE booking_id = $1`, [bookingId])).rows;

section("advance payment method");
for (const method of ["card", "bank_transfer", "cash"]) {
  await t(`an advance paid by ${method.replace("_", " ")} is recorded as ${method.replace("_", " ")}`, async () => {
    const res = await book(method, method);
    status(res, 201);
    const pays = await paymentOf(res.data.booking_id);
    eq(pays.length, 1, "one advance");
    eq(pays[0].method, method, "method");
    eq(Number(pays[0].amount), 4000, "amount");
  });
}
await t("left out, it is still cash (older tills)", async () => {
  const res = await book(null, "default");
  status(res, 201);
  eq((await paymentOf(res.data.booking_id))[0].method, "cash", "default");
});
await t("a method that does not exist is refused", async () => {
  const res = await book("bitcoin", "bad");
  ok(res.status === 400, `expected 400, got ${res.status}`);
});

await finish("t26-advance-method.mjs");
