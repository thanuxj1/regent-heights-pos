// t32-remove-charge.mjs — taking a charge off a guest's bill.
// It lowers what the guest owes, like a discount, so it is gated the same way:
// a reason always; front-desk staff need a manager's approval PIN; an
// Administrator gives the PIN once one is set. The Activity Log keeps who,
// why, what and who approved it.
import { ctx, api, t, eq, ok, status, section, finish, pool } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";
import fs from "fs";

const { A, B, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const PIN = "4826";
let bookingId, roomTypeId, bproId;

const charge = async (description, amount) => {
  const res = await api(cashier, "POST", `/hotel/bookings/${bookingId}/folio/items`, { source: "restaurant", description, qty: 1, unit_price: amount });
  status(res, 201);
  return res.data.item_id;
};
const remove = (token, itemId, body) => api(token, "POST", `/hotel/bookings/${bookingId}/folio/items/${itemId}/delete`, body);
const onBill = async (itemId) => (await api(owner, "GET", `/hotel/bookings/${bookingId}/folio`)).data.items.some((i) => Number(i.item_id) === Number(itemId));

// A guest checked into a room of their own, for one night at 3,000.
const checkedInGuest = async (n) => {
  const room = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `ZZQA-R${stamp.slice(-4)}-${n}` });
  status(room, 201);
  const bk = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: hotelDay(0), check_out_date: hotelDay(1),
    guest: { full_name: `ZZQA Charge Guest ${n}`, phone: `07100000${30 + n}` },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 3000 }], adults: 1, children: 0,
  });
  status(bk, 201);
  const b = await api(cashier, "GET", `/hotel/bookings/${bk.data.booking_id}`);
  status(await api(cashier, "POST", `/hotel/bookings/${bk.data.booking_id}/check-in`, {
    room_assignments: [{ booking_room_id: b.data.rooms[0].booking_room_id, room_id: room.data.room_id }],
  }), 200);
  return { bookingId: bk.data.booking_id, roomId: room.data.room_id };
};
const roomService = async (roomId) => {
  const res = await api(cashier, "POST", "/hotel/room-service", {
    room_id: roomId, tax_pct: 0, items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 650 }],
  });
  status(res, 201);
  return res.data.order.or_id;
};
const orderStatus = async (orId) => (await pool.query(`SELECT or_status FROM "ORDER" WHERE or_id = $1`, [orId])).rows[0].or_status;
// Pay what is owed, then check out: refused if anything is still owed.
const payAndCheckOut = async (bid) => {
  const f = await api(owner, "GET", `/hotel/bookings/${bid}/folio`);
  status(f, 200);
  const owed = Number(f.data.balance_due);
  if (owed > 0) status(await api(cashier, "POST", `/hotel/bookings/${bid}/payments`, { amount: owed, method: "card", kind: "settlement" }), 201);
  return api(cashier, "POST", `/hotel/bookings/${bid}/check-out`, {});
};

section("setup");
await t("a room type, a room-service dish and a checked-in guest", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", { b_id: A.b_id, type_name: `${stamp} Rc`, base_rate: 3000, max_adults: 2, max_children: 0 });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_RcMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Rc Tea", pro_qty: 50, pro_price: 650, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bp = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Rc Tea", pro_shortname: "Tea",
    pro_image: "placeholder.png", pro_des: "t", cat_id: cat.data.cat_id, pro_price: 650, pro_quantity: 50,
  });
  status(bp, 201);
  bproId = bp.data.Bpro_id;
  bookingId = (await checkedInGuest(1)).bookingId;
});

section("a room-service order taken off the bill does not come back at check-out");
await t("removing its line cancels the order, and check-out finds nothing more to charge", async () => {
  const g = await checkedInGuest(2);
  const orId = await roomService(g.roomId);
  const f = await api(owner, "GET", `/hotel/bookings/${g.bookingId}/folio`);
  const line = f.data.items.find((i) => Number(i.ref_order_id) === Number(orId));
  ok(line, "the order is on the bill");
  const res = await api(owner, "POST", `/hotel/bookings/${g.bookingId}/folio/items/${line.item_id}/delete`, { reason: "guest cancelled the order" });
  status(res, 200);
  eq(Number(res.data.cancelled_order), Number(orId), "says which order went with it");
  eq(await orderStatus(orId), "cancelled", "the order is cancelled");
  status(await payAndCheckOut(g.bookingId), 200, "checks out with the room paid for and nothing else");
  const after = await api(owner, "GET", `/hotel/bookings/${g.bookingId}/folio`);
  ok(!after.data.items.some((i) => Number(i.ref_order_id) === Number(orId)), "not swept back onto the closed bill");
});
await t("an order removed the old way is repaired by migration 069", async () => {
  const g = await checkedInGuest(3);
  const orId = await roomService(g.roomId);
  // What a removal did before: the line went, the order stayed, the log said so.
  const { rows: [line] } = await pool.query(`DELETE FROM "FOLIO_ITEM" WHERE ref_order_id = $1 RETURNING description, amount`, [orId]);
  await pool.query(
    `INSERT INTO "ACTIVITY_LOG" (u_id, b_id, action, entity, entity_id, summary) VALUES ($1, $2, 'delete', 'folio_item', '0', $3)`,
    [A.cashier.u_id, A.b_id, `Removed "${line.description}" (${line.amount}) from booking #${g.bookingId}`]);
  const stuck = await payAndCheckOut(g.bookingId);
  eq(stuck.status, 409, "the bug: check-out puts the 650 back and refuses");
  ok(/650.00/.test(stuck.data.message || ""), stuck.data.message);
  await pool.query(fs.readFileSync(new URL("../migrations/069_removed_room_charges.sql", import.meta.url), "utf8"));
  eq(await orderStatus(orId), "cancelled", "repaired");
  status(await api(cashier, "POST", `/hotel/bookings/${g.bookingId}/check-out`, {}), 200, "and the guest checks out");
});
await t("the repair leaves an order whose line was never removed alone", async () => {
  const g = await checkedInGuest(4);
  const orId = await roomService(g.roomId);
  await pool.query(fs.readFileSync(new URL("../migrations/069_removed_room_charges.sql", import.meta.url), "utf8"));
  eq(await orderStatus(orId) === "cancelled", false, "still charged");
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
