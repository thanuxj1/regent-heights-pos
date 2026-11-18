// t40-late-check-in.mjs — client request of 2026-11-18: the desk forgot to check
// a guest in on arrival; the next morning (the stay's last day) the booking could
// not be checked in at all, so the guest could not be checked out either.
//  • a stay ending today that began earlier asks to be confirmed (late_check_in);
//  • confirmed, it checks in and bills the full stay;
//  • a stay that ended before today is still refused, even when confirmed.
import { ctx, api, pool, t, eq, ok, status, section, finish } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const sfx = Date.now().toString(36).slice(-5);

const today = hotelDay(0);
const tomorrow = hotelDay(1);
const yesterday = hotelDay(-1);
const twoAgo = hotelDay(-2);
let roomTypeId, room1, room2;

section("setup");
await t("a room type with two rooms", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `ZZQA Late ${sfx}`, base_rate: 5000, max_adults: 2, max_children: 0,
  });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  const r1 = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `LC1-${sfx}` });
  const r2 = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `LC2-${sfx}` });
  status(r1, 201); status(r2, 201);
  room1 = r1.data.room_id; room2 = r2.data.room_id;
});

// Bookings can't be taken for past dates, so take one for tonight and move it back.
const bookPast = async (inDate, outDate, name) => {
  const res = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: today, check_out_date: tomorrow, tax_pct: 0,
    guest: { full_name: `ZZQA ${name} ${sfx}`, phone: `0746${Math.floor(Math.random() * 1e6)}` },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 5000 }], adults: 1, children: 0,
  });
  status(res, 201);
  await pool.query(`UPDATE "BOOKING" SET check_in_date=$2, check_out_date=$3 WHERE booking_id=$1`,
    [res.data.booking_id, inDate, outDate]);
  return res.data.booking_id;
};
const checkInto = async (id, room, extra = {}) => {
  const b = (await api(cashier, "GET", `/hotel/bookings/${id}`)).data;
  return api(cashier, "POST", `/hotel/bookings/${id}/check-in`, {
    room_assignments: [{ booking_room_id: b.rooms[0].booking_room_id, room_id: room }], ...extra,
  });
};

section("a stay ending today that was never checked in");
let forgot;
await t("without confirming, check-in asks for it (409 + late_check_in)", async () => {
  forgot = await bookPast(yesterday, today, "Forgot");
  const res = await checkInto(forgot, room1);
  status(res, 409);
  eq(res.data.late_check_in, true, "late_check_in flag");
  ok(/ends today/.test(res.data.message), "message explains the stay ends today");
});

await t("nothing changed on the refused attempt", async () => {
  const b = (await api(cashier, "GET", `/hotel/bookings/${forgot}`)).data;
  eq(b.status, "confirmed", "status");
  const { rows } = await pool.query(`SELECT 1 FROM "FOLIO" WHERE booking_id=$1`, [forgot]);
  eq(rows.length, 0, "no folio opened");
});

await t("confirmed, it checks in", async () => {
  const res = await checkInto(forgot, room1, { late_check_in: true });
  status(res, 200);
  const b = (await api(cashier, "GET", `/hotel/bookings/${forgot}`)).data;
  eq(b.status, "checked_in", "status");
});

await t("the folio bills the full stay (one night)", async () => {
  const f = await api(cashier, "GET", `/hotel/bookings/${forgot}/folio`);
  status(f, 200);
  const room = f.data.items.filter((i) => i.source === "room").reduce((s, i) => s + Number(i.amount), 0);
  eq(room, 5000, "room charge");
});

await t("the activity log records it as a late check-in", async () => {
  const { rows } = await pool.query(
    `SELECT summary FROM "ACTIVITY_LOG" WHERE entity='booking' AND entity_id=$1 AND action='check_in'`, [String(forgot)]);
  ok(rows.some((r) => /late/.test(r.summary)), `summary: ${rows.map((r) => r.summary).join(" | ")}`);
});

section("a stay already over is still refused");
await t("a stay that ended yesterday cannot be checked in, even confirmed", async () => {
  const over = await bookPast(twoAgo, yesterday, "Over");
  const res = await checkInto(over, room2, { late_check_in: true });
  status(res, 409);
  ok(!res.data.late_check_in, "no late check-in offered for a finished stay");
});

await t("a normal stay starting today still checks in without confirming", async () => {
  const res = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: today, check_out_date: tomorrow, tax_pct: 0,
    guest: { full_name: `ZZQA Normal ${sfx}`, phone: `0747${Math.floor(Math.random() * 1e6)}` },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 5000 }], adults: 1, children: 0,
  });
  status(res, 201);
  const ci = await checkInto(res.data.booking_id, room2);
  status(ci, 200);
});

await finish("t40-late-check-in.mjs");
