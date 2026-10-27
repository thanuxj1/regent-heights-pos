// t32-remove-charge.mjs — taking a charge off a guest's bill.
// It lowers what the guest owes, like a discount, so it is gated the same way:
// a reason always; front-desk staff need a manager's approval PIN; an
// Administrator gives the PIN once one is set. The Activity Log keeps who,
// why, what and who approved it.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A, B, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const PIN = "4826";
let bookingId;

const charge = async (description, amount) => {
  const res = await api(cashier, "POST", `/hotel/bookings/${bookingId}/folio/items`, { source: "restaurant", description, qty: 1, unit_price: amount });
  status(res, 201);
  return res.data.item_id;
};
const remove = (token, itemId, body) => api(token, "POST", `/hotel/bookings/${bookingId}/folio/items/${itemId}/delete`, body);
const onBill = async (itemId) => (await api(owner, "GET", `/hotel/bookings/${bookingId}/folio`)).data.items.some((i) => Number(i.item_id) === Number(itemId));

section("setup");
await t("a checked-in guest", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", { b_id: A.b_id, type_name: `${stamp} Rc`, base_rate: 3000, max_adults: 2, max_children: 0 });
  status(rt, 201);
  const room = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: rt.data.room_type_id, room_number: `ZZQA-R${stamp.slice(-4)}` });
  status(room, 201);
  const bk = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: hotelDay(0), check_out_date: hotelDay(1),
    guest: { full_name: "ZZQA Charge Guest", phone: "0710000032" },
    rooms: [{ room_type_id: rt.data.room_type_id, rate_per_night: 3000 }], adults: 1, children: 0,
  });
  status(bk, 201);
  bookingId = bk.data.booking_id;
  const b = await api(cashier, "GET", `/hotel/bookings/${bookingId}`);
  status(await api(cashier, "POST", `/hotel/bookings/${bookingId}/check-in`, {
    room_assignments: [{ booking_room_id: b.data.rooms[0].booking_room_id, room_id: room.data.room_id }],
  }), 200);
});

section("no PIN set at the property yet");
await t("the old delete with no reason is gone", async () => {
  const id = await charge("Tea", 650);
  const res = await api(owner, "DELETE", `/hotel/bookings/${bookingId}/folio/items/${id}`);
  ok(res.status === 404 || res.status === 405, `got ${res.status}`);
  ok(await onBill(id), "still on the bill");
});
await t("a reason is required", async () => {
  const id = await charge("Tea", 650);
  eq((await remove(owner, id, {})).status, 400);
  ok(await onBill(id), "still on the bill");
});
await t("front desk cannot remove a charge without a manager's PIN", async () => {
  const id = await charge("Tea", 650);
  eq((await remove(cashier, id, { reason: "guest cancelled" })).status, 403);
  ok(await onBill(id), "still on the bill");
});
await t("an Administrator can, with a reason, until a PIN is set", async () => {
  const id = await charge("Cancelled order", 650);
  status(await remove(owner, id, { reason: "guest cancelled the order" }), 200);
  ok(!(await onBill(id)), "off the bill");
});

section("once a PIN is set");
await t("an approval PIN is set", async () => {
  status(await api(owner, "PUT", "/security/approval-pin", { pin: PIN }), 200);
});
await t("an Administrator now needs it too", async () => {
  const id = await charge("Tea", 650);
  eq((await remove(owner, id, { reason: "guest cancelled" })).status, 403, "no PIN");
  eq((await remove(owner, id, { reason: "guest cancelled", pin: "0000" })).status, 403, "wrong PIN");
  status(await remove(owner, id, { reason: "guest cancelled", pin: PIN }), 200);
  ok(!(await onBill(id)), "off the bill");
});
let logged;
await t("front desk with a manager's PIN can", async () => {
  logged = await charge("Club sandwich", 1250);
  eq((await remove(cashier, logged, { reason: "guest cancelled", pin: "0000" })).status, 403, "wrong PIN");
  status(await remove(cashier, logged, { reason: "sent to the wrong room", pin: PIN }), 200);
  ok(!(await onBill(logged)), "off the bill");
});
await t("the Activity Log says what, why and who approved it", async () => {
  const { rows } = await pool.query(
    `SELECT summary, details FROM "ACTIVITY_LOG" WHERE entity = 'folio_item' AND entity_id = $1 AND action = 'delete'`, [String(logged)]);
  eq(rows.length, 1);
  ok(rows[0].summary.includes("Club sandwich") && rows[0].summary.includes("1250.00") && rows[0].summary.includes("sent to the wrong room"), rows[0].summary);
  eq(Number(rows[0].details.approved_by), Number(A.owner.u_id), "approved by the PIN's owner");
});
await t("another property's staff cannot touch it", async () => {
  const id = await charge("Tea", 650);
  ok((await remove(B.owner.token, id, { reason: "not ours", pin: PIN })).status >= 400);
  ok(await onBill(id), "still on the bill");
});
await t("the PIN is cleared again", async () => {
  status(await api(owner, "DELETE", "/security/approval-pin"), 200);
});

await finish("t32-remove-charge.mjs");
