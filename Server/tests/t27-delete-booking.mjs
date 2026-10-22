// t27-delete-booking.mjs — an Administrator deletes a booking made by mistake
// (entered twice, wrong guest). The booking and the advance taken for it leave
// the bookings list, Transactions and the reports; the Activity Log keeps who,
// why and what. A stay that has started is refused, and a cashier cannot do it.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelDay, hotelToday } from "../utils/hotelTime.js";

const { A } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const sfx = Date.now().toString(36).slice(-5);
const PIN = "4321";
let roomTypeId, roomId;

section("setup");
await t("a room type with one room", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `ZZQA DelBk ${sfx}`, base_rate: 10000, max_adults: 2, max_children: 0,
  });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  const r = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `DB-${sfx}` });
  status(r, 201);
  roomId = r.data.room_id;
});

const book = (name, inDay = 20, outDay = 21) => api(cashier, "POST", "/hotel/bookings", {
  b_id: A.b_id, check_in_date: hotelDay(inDay), check_out_date: hotelDay(outDay), tax_pct: 0,
  guest: { full_name: `ZZQA ${name} ${sfx}`, phone: `0747${Math.floor(Math.random() * 1e6)}` },
  rooms: [{ room_type_id: roomTypeId, rate_per_night: 10000 }], adults: 1, children: 0,
  advance_payment: 5000, advance_method: "cash",
});
const del = (token, id, body) => api(token, "POST", `/hotel/bookings/${id}/delete`, body);
const ledgerRefs = async () => {
  const res = await api(owner, "GET", `/reports/transactions?b_id=${A.b_id}&kind=all&from=${hotelToday()}&to=${hotelToday()}`);
  status(res, 200);
  return res.data.transactions.map((r) => String(r.reference || ""));
};

section("deleting a booking entered by mistake");
let bk, ref;
await t("a booking with a cash advance shows in Transactions", async () => {
  const res = await book("Twice");
  status(res, 201);
  bk = res.data.booking_id;
  ref = res.data.booking_ref;
  ok((await ledgerRefs()).some((r) => r.includes(ref)), `the advance for ${ref} should be in the ledger`);
});
await t("a cashier cannot delete it", async () => {
  ok((await del(cashier, bk, { reason: "entered twice" })).status === 403, "cashier refused");
});
await t("a reason is required", async () => {
  eq((await del(owner, bk, {})).status, 400, "no reason");
});
await t("with no PIN set, the Administrator deletes it with a reason", async () => {
  status(await del(owner, bk, { reason: "entered twice" }), 200);
});
await t("it is gone: the booking, and its payment from Transactions", async () => {
  eq((await api(owner, "GET", `/hotel/bookings/${bk}`)).status, 404, "booking");
  const pays = await pool.query(`SELECT 1 FROM "BOOKING_PAYMENT" WHERE booking_id = $1`, [bk]);
  eq(pays.rows.length, 0, "payments");
  ok(!(await ledgerRefs()).some((r) => r.includes(ref)), "still in the ledger");
});
await t("the Activity Log says who deleted it, why, and what was paid", async () => {
  const { rows } = await pool.query(
    `SELECT u_id, summary, details FROM "ACTIVITY_LOG" WHERE entity = 'booking' AND entity_id = $1 AND action = 'delete'`,
    [String(bk)]);
  eq(rows.length, 1, "logged");
  eq(Number(rows[0].u_id), Number(A.owner.u_id), "who");
  ok(rows[0].summary.includes(ref) && rows[0].summary.includes("entered twice"), rows[0].summary);
  ok(rows[0].summary.includes("5000.00 paid (cash) removed"), rows[0].summary);
  ok(rows[0].summary.includes(`${hotelDay(20)} to ${hotelDay(21)}`), `dates as YYYY-MM-DD: ${rows[0].summary}`);
  eq(rows[0].details.payments.length, 1, "the payment kept in the log");
});

section("what cannot be deleted");
await t("a checked-in stay is refused", async () => {
  const res = await book("InHouse", 0, 1);
  status(res, 201);
  const id = res.data.booking_id;
  const b = (await api(cashier, "GET", `/hotel/bookings/${id}`)).data;
  status(await api(cashier, "POST", `/hotel/bookings/${id}/check-in`, {
    room_assignments: [{ booking_room_id: b.rooms[0].booking_room_id, room_id: roomId }],
  }), 200);
  eq((await del(owner, id, { reason: "mistake" })).status, 409, "checked in");
});

section("once a PIN is set");
await t("the PIN is asked for, and the right one works", async () => {
  status(await api(owner, "PUT", "/security/approval-pin", { pin: PIN }), 200);
  const res = await book("WithPin", 30, 31);
  status(res, 201);
  const id = res.data.booking_id;
  eq((await del(owner, id, { reason: "entered twice" })).status, 403, "no PIN");
  eq((await del(owner, id, { reason: "entered twice", pin: "0000" })).status, 403, "wrong PIN");
  status(await del(owner, id, { reason: "entered twice", pin: PIN }), 200);
});
await t("the owner's PIN is removed again (later files expect none)", async () => {
  status(await api(owner, "DELETE", "/security/approval-pin"), 200);
});

await finish("t27-delete-booking.mjs");
