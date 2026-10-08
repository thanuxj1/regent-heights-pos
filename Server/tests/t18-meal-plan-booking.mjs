// t18-meal-plan-booking.mjs — a meal plan can be chosen while taking the booking
// (priced per adult and per child, per night, into the grand total), shows on
// the confirmation, survives an edit, is billed at check-in, and can still be
// chosen or changed at the desk. Also: check-in no longer needs a passport/ID.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A, B } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;

const today = hotelDay(0);
const out = hotelDay(2); // 2 nights
const NIGHTS = 2;
const sfx = Date.now().toString(36).slice(-5);

let roomTypeId, hb, fb, retired, otherTenantPlan;
const roomIds = [];
let seq = 0;

const book = (extra = {}) => {
  seq += 1;
  return api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: today, check_out_date: out, tax_pct: 0,
    guest: { full_name: `ZZQA Meal Guest ${seq}`, phone: `07300000${seq}` },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 5000 }],
    adults: 2, children: 1, ...extra,
  });
};
const getBooking = async (id) => (await api(cashier, "GET", `/hotel/bookings/${id}`)).data;
const checkIn = async (id, room, extra = {}) => {
  const b = await getBooking(id);
  return api(cashier, "POST", `/hotel/bookings/${id}/check-in`, {
    room_assignments: [{ booking_room_id: b.rooms[0].booking_room_id, room_id: room }], ...extra,
  });
};
const mealItems = async (id) => {
  const f = await api(cashier, "GET", `/hotel/bookings/${id}/folio`);
  status(f, 200);
  return { folio: f.data, items: f.data.items.filter((i) => i.source === "meal") };
};

section("setup");
await t("owner creates two meal plans and one that is then retired", async () => {
  const mk = (code, name, pa, pc) => api(owner, "POST", "/hotel/meal-plans", {
    b_id: A.b_id, plan_code: code, plan_name: name, supplement_per_adult: pa, supplement_per_child: pc,
  });
  const r1 = await mk(`HB${sfx}`, "ZZQA Half Board", 1500, 800);
  const r2 = await mk(`FB${sfx}`, "ZZQA Full Board", 3000, 1500);
  const r3 = await mk(`OL${sfx}`, "ZZQA Retired Plan", 100, 50);
  status(r1, 201); status(r2, 201); status(r3, 201);
  hb = r1.data; fb = r2.data; retired = r3.data;
  const off = await api(owner, "PUT", `/hotel/meal-plans/${retired.plan_id}`, {
    plan_code: retired.plan_code, plan_name: retired.plan_name,
    supplement_per_adult: 100, supplement_per_child: 50, is_active: false,
  });
  status(off, 200);
});

await t("a plan belonging to another tenant exists (for the isolation check)", async () => {
  const r = await api(B.owner.token, "POST", "/hotel/meal-plans", {
    b_id: B.b_id, plan_code: `XT${sfx}`, plan_name: "ZZQA Other Tenant Plan", supplement_per_adult: 1, supplement_per_child: 1,
  });
  status(r, 201);
  otherTenantPlan = r.data;
});

await t("owner sets up a room type and four rooms", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `ZZQA MealPlan Room ${sfx}`, base_rate: 5000, max_adults: 2, max_children: 1, included_guests: 2,
  });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  for (let i = 1; i <= 4; i++) {
    const r = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `ZZQA-M${sfx}-${i}` });
    status(r, 201);
    roomIds.push(r.data.room_id);
  }
});

section("choosing a plan while taking the booking");
let planned;
await t("a booking with a plan stores it, prices it per adult/child per night, and adds it to the grand total", async () => {
  const res = await book({ meal_plan_id: hb.plan_id });
  status(res, 201);
  planned = res.data;
  eq(Number(planned.meal_plan_id), Number(hb.plan_id), "plan id stored on the booking");
  // (1500 x 2 adults + 800 x 1 child) x 2 nights
  eq(Number(planned.meal_charges), (1500 * 2 + 800 * 1) * NIGHTS, "meal charge");
  eq(
    Number(planned.grand_total),
    Number(planned.room_charges) + Number(planned.tax_amount) + Number(planned.person_charges) + Number(planned.meal_charges),
    "grand total includes the meal plan",
  );
});

await t("a booking with no plan is unchanged: no plan, no meal charge", async () => {
  const res = await book();
  status(res, 201);
  eq(res.data.meal_plan_id, null);
  eq(Number(res.data.meal_charges), 0);
});

await t("the booking record and the confirmation both name the plan", async () => {
  const b = await getBooking(planned.booking_id);
  eq(b.plan_name, "ZZQA Half Board");
  const c = await api(cashier, "GET", `/hotel/bookings/${planned.booking_id}/confirmation`);
  status(c, 200);
  eq(c.data.booking.plan_name, "ZZQA Half Board", "the Package / Plan column reads this");
  ok(String(c.data.whatsapp_text).includes("Meal Plan"), "WhatsApp text should carry the plan");
});

await t("an unknown, retired or another tenant's plan is refused", async () => {
  status(await book({ meal_plan_id: 99999999 }), 400);
  status(await book({ meal_plan_id: retired.plan_id }), 400);
  status(await book({ meal_plan_id: otherTenantPlan.plan_id }), 400);
});

section("editing a booking keeps its plan and reprices it");
await t("adding an adult reprices the plan; clearing it takes the charge off; it can be set again", async () => {
  const more = await api(cashier, "PUT", `/hotel/bookings/${planned.booking_id}`, { adults: 3 });
  status(more, 200);
  eq(Number(more.data.meal_plan_id), Number(hb.plan_id), "an edit that does not mention the plan keeps it");
  eq(Number(more.data.meal_charges), (1500 * 3 + 800 * 1) * NIGHTS);

  const cleared = await api(cashier, "PUT", `/hotel/bookings/${planned.booking_id}`, { meal_plan_id: "" });
  status(cleared, 200);
  eq(cleared.data.meal_plan_id, null);
  eq(Number(cleared.data.meal_charges), 0);
  ok(Number(cleared.data.grand_total) < Number(more.data.grand_total), "grand total drops when the plan is removed");

  const reset = await api(cashier, "PUT", `/hotel/bookings/${planned.booking_id}`, { meal_plan_id: fb.plan_id });
  status(reset, 200);
  eq(Number(reset.data.meal_charges), (3000 * 3 + 1500 * 1) * NIGHTS);
});

await t("editing to an unavailable plan is refused", async () => {
  status(await api(cashier, "PUT", `/hotel/bookings/${planned.booking_id}`, { meal_plan_id: retired.plan_id }), 400);
});

section("billing at check-in");
let bookedWithPlan, bookedWithPlan2, noPlanA, noPlanB;
await t("a plan taken with the booking is posted to the folio at check-in, once, at the quoted price", async () => {
  const res = await book({ meal_plan_id: hb.plan_id });
  status(res, 201);
  bookedWithPlan = res.data;
  const ci = await checkIn(bookedWithPlan.booking_id, roomIds[0]);
  status(ci, 200, "check-in with no passport/ID on file and no plan sent");
  const { folio, items } = await mealItems(bookedWithPlan.booking_id);
  eq(items.length, 1, "exactly one meal line");
  eq(Number(items[0].amount), Number(bookedWithPlan.meal_charges));
  eq(Number(folio.total_charges), Number(bookedWithPlan.grand_total), "folio total equals the quoted grand total");
});

await t("a plan chosen at the desk replaces the one taken with the booking, priced per night", async () => {
  const res = await book({ meal_plan_id: hb.plan_id });
  status(res, 201);
  bookedWithPlan2 = res.data;
  const ci = await checkIn(bookedWithPlan2.booking_id, roomIds[1], { meal_plan_id: fb.plan_id });
  status(ci, 200);
  const { items } = await mealItems(bookedWithPlan2.booking_id);
  eq(items.length, 1);
  eq(Number(items[0].amount), (3000 * 2 + 1500 * 1) * NIGHTS, "full board x party x nights");
  eq(Number((await getBooking(bookedWithPlan2.booking_id)).meal_plan_id), Number(fb.plan_id));
});

await t("a plan picked only at check-in (none on the booking) is billed per night too", async () => {
  const res = await book();
  status(res, 201);
  noPlanA = res.data;
  const ci = await checkIn(noPlanA.booking_id, roomIds[2], { meal_plan_id: fb.plan_id });
  status(ci, 200);
  const { items } = await mealItems(noPlanA.booking_id);
  eq(items.length, 1);
  eq(Number(items[0].amount), (3000 * 2 + 1500 * 1) * NIGHTS);
});

await t("no plan anywhere means no meal line", async () => {
  const res = await book();
  status(res, 201);
  noPlanB = res.data;
  status(await checkIn(noPlanB.booking_id, roomIds[3]), 200);
  eq((await mealItems(noPlanB.booking_id)).items.length, 0);
});

section("once checked in, the plan is part of the open bill");
await t("changing the plan on an in-house booking is refused; re-sending the same one is fine", async () => {
  const other = await api(cashier, "PUT", `/hotel/bookings/${bookedWithPlan.booking_id}`, { meal_plan_id: fb.plan_id });
  status(other, 409);
  const same = await api(cashier, "PUT", `/hotel/bookings/${bookedWithPlan.booking_id}`, {
    meal_plan_id: hb.plan_id, special_requests: "ZZQA late arrival",
  });
  status(same, 200);
  eq(Number(same.data.meal_charges), Number(bookedWithPlan.meal_charges), "the billed charge is untouched");
});

await finish("t18-meal-plan-booking.mjs");
