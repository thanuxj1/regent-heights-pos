// t28-no-overpayment.mjs — a booking can never be paid more than its bill.
// On 2026-10-24 a 5,990 balance was paid three times within a minute (card,
// cash, card) and every payment was accepted, so the bill showed the guest in
// credit and the reports counted 17,970. Now: a payment past the balance is
// refused, two submits at once take only one, and a payment entered by
// mistake is removed by an Administrator (logged) rather than "corrected" by
// adding another.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const sfx = Date.now().toString(36).slice(-5);
let roomTypeId, roomId, bk;

section("setup");
await t("a checked-in stay of 10,000 with 4,010 paid, leaving 5,990 owed", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `ZZQA Overpay ${sfx}`, base_rate: 10000, max_adults: 2, max_children: 0,
  });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  const r = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `OP-${sfx}` });
  status(r, 201);
  roomId = r.data.room_id;
  const b = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: hotelDay(0), check_out_date: hotelDay(1), tax_pct: 0,
    guest: { full_name: `ZZQA Overpay ${sfx}`, phone: `0749${Math.floor(Math.random() * 1e6)}` },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 10000 }], adults: 1, children: 0,
    advance_payment: 4010, advance_method: "bank_transfer",
  });
  status(b, 201);
  bk = b.data.booking_id;
  const full = (await api(cashier, "GET", `/hotel/bookings/${bk}`)).data;
  status(await api(cashier, "POST", `/hotel/bookings/${bk}/check-in`, {
    room_assignments: [{ booking_room_id: full.rooms[0].booking_room_id, room_id: roomId }],
  }), 200);
  const f = await api(cashier, "GET", `/hotel/bookings/${bk}/folio`);
  eq(Number(f.data.balance_due), 5990, "balance due");
});

const pay = (amount, method, kind = "settlement") =>
  api(cashier, "POST", `/hotel/bookings/${bk}/payments`, { amount, method, kind });
const balance = async () => Number((await api(cashier, "GET", `/hotel/bookings/${bk}/folio`)).data.balance_due);
const payments = async () => (await pool.query(
  `SELECT bp_id, amount, method, kind FROM "BOOKING_PAYMENT" WHERE booking_id = $1 ORDER BY bp_id`, [bk])).rows;

section("no paying past the bill");
await t("more than the balance is refused", async () => {
  const res = await pay(6000, "card");
  eq(res.status, 409, "over the balance");
  ok(/5990\.00 is owed/.test(res.data.message), res.data.message);
});
await t("the exact balance is taken", async () => {
  status(await pay(5990, "card"), 201);
  eq(await balance(), 0, "paid in full");
});
await t("paying it again (the 24 Oct incident) is refused, with how to fix a wrong method", async () => {
  const again = await pay(5990, "cash");
  eq(again.status, 409, "fully paid");
  ok(/already fully paid/.test(again.data.message) && /remove it/.test(again.data.message), again.data.message);
  eq((await payments()).length, 2, "still only the advance and one settlement");
});
await t("a refund is still allowed", async () => {
  status(await pay(10, "cash", "refund"), 201);
  eq(await balance(), 10, "10 owed again after the refund");
  status(await pay(10, "cash"), 201);
});

section("two submits at once");
await t("only one of two simultaneous payments for the balance gets through", async () => {
  const card = (await payments()).find((p) => p.kind === "settlement" && p.method === "card");
  // Free 5,990 again by removing the card settlement, then submit twice at once.
  status(await api(owner, "POST", `/hotel/bookings/${bk}/payments/${card.bp_id}/delete`, { reason: "test double submit" }), 200);
  const [a, b] = await Promise.all([pay(5990, "card"), pay(5990, "card")]);
  const codes = [a.status, b.status].sort();
  eq(codes.join(","), "201,409", "one taken, one refused");
  eq(await balance(), 0, "paid once");
});

section("removing a payment entered by mistake");
let wrong;
await t("a cashier cannot remove a payment", async () => {
  wrong = (await payments()).filter((p) => p.kind === "settlement" && p.method === "card").pop();
  ok((await api(cashier, "POST", `/hotel/bookings/${bk}/payments/${wrong.bp_id}/delete`, { reason: "wrong method" })).status === 403, "cashier refused");
});
await t("a reason is required", async () => {
  eq((await api(owner, "POST", `/hotel/bookings/${bk}/payments/${wrong.bp_id}/delete`, {})).status, 400, "no reason");
});
await t("the Administrator removes it; the balance comes back, and it can be entered again with the right method", async () => {
  status(await api(owner, "POST", `/hotel/bookings/${bk}/payments/${wrong.bp_id}/delete`, { reason: "wrong method, was cash" }), 200);
  eq(await balance(), 5990, "owed again");
  status(await pay(5990, "cash"), 201);
  eq(await balance(), 0, "paid in full, by cash");
});
await t("the removal is in the Activity Log, with the payment and the reason", async () => {
  const { rows } = await pool.query(
    `SELECT u_id, summary, details FROM "ACTIVITY_LOG" WHERE entity = 'payment' AND entity_id = $1 AND action = 'delete'`,
    [String(wrong.bp_id)]);
  eq(rows.length, 1, "logged");
  eq(Number(rows[0].u_id), Number(A.owner.u_id), "who");
  ok(rows[0].summary.includes("5990.00 by card") && rows[0].summary.includes("wrong method, was cash"), rows[0].summary);
});

section("check-out");
await t("check-out with a settlement on a fully paid stay is refused, without one it goes through", async () => {
  const res = await api(cashier, "POST", `/hotel/bookings/${bk}/check-out`, { settle_amount: 5990, method: "card" });
  eq(res.status, 409, "settling a paid stay");
  status(await api(cashier, "POST", `/hotel/bookings/${bk}/check-out`, {}), 200);
});

await finish("t28-no-overpayment.mjs");
