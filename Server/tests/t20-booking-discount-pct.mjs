// t20-booking-discount-pct.mjs — a booking's discount is a percentage of the
// whole bill before discount. It follows the bill when the booking changes, goes
// onto the guest's bill at check-in, and the reports count what was billed.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const today = hotelDay(0);
const sfx = Date.now().toString(36).slice(-5);

let roomTypeId, roomId, planId, booking;
let seq = 0;
const book = (extra = {}) => {
  seq += 1;
  return api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: today, check_out_date: hotelDay(2), tax_pct: 0,
    guest: { full_name: `ZZQA Discount Guest ${seq}`, phone: `07400000${seq}` },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 5000 }],
    adults: 2, children: 0, ...extra,
  });
};
const hotelRevenue = async () => {
  const r = await api(owner, "GET", `/reports/summary?from=${today}&to=${today}`);
  status(r, 200);
  return Number(r.data.revenue.hotel);
};

section("setup");
await t("owner sets up a room type, a room and a meal plan", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `ZZQA Discount Room ${sfx}`, base_rate: 5000, max_adults: 2, max_children: 1, included_guests: 2,
  });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  const r = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `ZZQA-D${sfx}` });
  status(r, 201);
  roomId = r.data.room_id;
  const mp = await api(owner, "POST", "/hotel/meal-plans", {
    b_id: A.b_id, plan_code: `DB${sfx}`, plan_name: "ZZQA Discount Board", supplement_per_adult: 1500, supplement_per_child: 0,
  });
  status(mp, 201);
  planId = mp.data.plan_id;
});

section("the percentage on a new booking");
await t("10% comes off the whole bill: rooms and meal plan", async () => {
  const res = await book({ discount_pct: 10, meal_plan_id: planId });
  status(res, 201);
  booking = res.data;
  // rooms 5000 x 2 nights = 10000; meal 1500 x 2 adults x 2 nights = 6000
  eq(Number(booking.discount_pct), 10);
  eq(Number(booking.discount), 1600);
  eq(Number(booking.grand_total), 14400);
});

await t("a percentage over 100 is refused", async () => {
  status(await book({ discount_pct: 150 }), 400);
});

await t("a plain amount is still accepted and keeps no percentage", async () => {
  const res = await book({ discount: 500 });
  status(res, 201);
  eq(Number(res.data.discount), 500);
  eq(res.data.discount_pct, null);
});

section("editing follows the bill");
await t("adding a night recomputes the amount from the same percentage", async () => {
  const res = await api(cashier, "PUT", `/hotel/bookings/${booking.booking_id}`, { check_out_date: hotelDay(3) });
  status(res, 200);
  // rooms 15000 + meal 9000 = 24000
  eq(Number(res.data.discount_pct), 10);
  eq(Number(res.data.discount), 2400);
  eq(Number(res.data.grand_total), 21600);
  booking = res.data;
});

await t("changing the percentage reprices; blank clears it", async () => {
  const twenty = await api(cashier, "PUT", `/hotel/bookings/${booking.booking_id}`, { discount_pct: 20 });
  status(twenty, 200);
  eq(Number(twenty.data.discount), 4800);
  const cleared = await api(cashier, "PUT", `/hotel/bookings/${booking.booking_id}`, { discount_pct: "" });
  status(cleared, 200);
  eq(Number(cleared.data.discount), 0);
  eq(Number(cleared.data.grand_total), 24000);
  const back = await api(cashier, "PUT", `/hotel/bookings/${booking.booking_id}`, { discount_pct: 10 });
  status(back, 200);
  booking = back.data;
  eq(Number(booking.discount), 2400);
});

section("the bill and the reports");
let revenueBefore;
await t("the confirmation names the percentage", async () => {
  const c = await api(cashier, "GET", `/hotel/bookings/${booking.booking_id}/confirmation`);
  status(c, 200);
  ok(String(c.data.whatsapp_text).includes("Discount (10%)"), "WhatsApp text should show the percentage");
});

await t("at check-in the discount is one bill line and the bill equals the booking total", async () => {
  revenueBefore = await hotelRevenue();
  const b = (await api(cashier, "GET", `/hotel/bookings/${booking.booking_id}`)).data;
  const ci = await api(cashier, "POST", `/hotel/bookings/${booking.booking_id}/check-in`, {
    room_assignments: [{ booking_room_id: b.rooms[0].booking_room_id, room_id: roomId }],
  });
  status(ci, 200);
  const f = await api(cashier, "GET", `/hotel/bookings/${booking.booking_id}/folio`);
  status(f, 200);
  const lines = f.data.items.filter((i) => i.source === "discount");
  eq(lines.length, 1);
  eq(lines[0].description, "Discount (10%)");
  eq(Number(lines[0].amount), -2400);
  eq(Number(f.data.total_charges), Number(booking.grand_total));
});

await t("the summary report's hotel revenue rises by the discounted bill", async () => {
  eq(+(await hotelRevenue() - revenueBefore).toFixed(2), Number(booking.grand_total));
});

await t("once checked in the percentage can't be changed from the booking", async () => {
  status(await api(cashier, "PUT", `/hotel/bookings/${booking.booking_id}`, { discount_pct: 50 }), 409);
});

await finish("t20-booking-discount-pct.mjs");
