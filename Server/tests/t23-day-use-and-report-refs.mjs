// t23-day-use-and-report-refs.mjs — client requests of 2026-10-17:
//  • a day-use stay (check-out on the check-in date) can be booked, is billed as
//    one night, occupies its own day for availability, and can be checked in;
//  • check-in refuses a physical room another checked-in guest is already in;
//  • a COD settlement's row in the revenue ledger carries the order numbers it
//    covers as its reference, so the export can be matched to the rider's cash.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";
import { hotelDay } from "../utils/hotelTime.js";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const sfx = Date.now().toString(36).slice(-5);

const today = hotelDay(0);
const tomorrow = hotelDay(1);
let roomTypeId, room1, room2;

section("setup");
await t("a room type with two rooms", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `ZZQA DayUse ${sfx}`, base_rate: 4000, max_adults: 2, max_children: 0,
  });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  const r1 = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `DU1-${sfx}` });
  const r2 = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: `DU2-${sfx}` });
  status(r1, 201); status(r2, 201);
  room1 = r1.data.room_id; room2 = r2.data.room_id;
});

const book = (inDate, outDate, name) => api(cashier, "POST", "/hotel/bookings", {
  b_id: A.b_id, check_in_date: inDate, check_out_date: outDate, tax_pct: 0,
  guest: { full_name: `ZZQA ${name} ${sfx}`, phone: `0745${Math.floor(Math.random() * 1e6)}` },
  rooms: [{ room_type_id: roomTypeId, rate_per_night: 4000 }], adults: 1, children: 0,
});
const checkInto = async (id, room) => {
  const b = (await api(cashier, "GET", `/hotel/bookings/${id}`)).data;
  return api(cashier, "POST", `/hotel/bookings/${id}/check-in`, {
    room_assignments: [{ booking_room_id: b.rooms[0].booking_room_id, room_id: room }],
  });
};

section("day-use stay");
let dayUse;
await t("a booking with check-out on the check-in date is accepted", async () => {
  const res = await book(today, today, "DayUse");
  status(res, 201, "same-day check-out must be allowed");
  dayUse = res.data.booking_id;
});

await t("it is billed as one night, not zero", async () => {
  const b = (await api(cashier, "GET", `/hotel/bookings/${dayUse}`)).data;
  eq(Number(b.nights), 1, "nights");
  eq(Number(b.grand_total), 4000, "one night at the room rate");
});

await t("a check-out BEFORE the check-in is still refused", async () => {
  const res = await book(tomorrow, today, "Backwards");
  status(res, 400);
});

await t("the day-use stay holds a room for its own day (same-day search shows 1 of 2 free)", async () => {
  const res = await api(cashier, "GET", `/hotel/availability?b_id=${A.b_id}&check_in=${today}&check_out=${today}`);
  status(res, 200, "a same-day availability search must be accepted");
  const type = res.data.room_types.find((x) => x.room_type_id === roomTypeId);
  eq(type.available_rooms.length, 1, "the day-use booking must claim one of the two rooms");
});

await t("an overnight search for tonight also sees the day-use claim (1 of 2 free)", async () => {
  const res = await api(cashier, "GET", `/hotel/availability?b_id=${A.b_id}&check_in=${today}&check_out=${tomorrow}`);
  const type = res.data.room_types.find((x) => x.room_type_id === roomTypeId);
  eq(type.available_rooms.length, 1, "an empty [today, today) range used to overlap nothing");
});

await t("the day-use stay can be checked in today (it used to be refused as 'already ended')", async () => {
  const res = await checkInto(dayUse, room1);
  status(res, 200);
});

await t("its folio carries one night's room charge", async () => {
  const f = await api(cashier, "GET", `/hotel/bookings/${dayUse}/folio`);
  status(f, 200);
  const room = f.data.items.filter((i) => i.source === "room").reduce((s, i) => s + Number(i.amount), 0);
  eq(room, 4000, "room charge");
});

section("check-in refuses an occupied physical room");
let overnight;
await t("an overnight booking for tonight is taken", async () => {
  const res = await book(today, tomorrow, "Overnight");
  status(res, 201);
  overnight = res.data.booking_id;
});

await t("checking it into the room the day-use guest is still in is refused", async () => {
  const res = await checkInto(overnight, room1);
  ok(res.status === 409, `expected 409 (room occupied), got ${res.status} — ${JSON.stringify(res.data)}`);
});

await t("checking it into the free room works", async () => {
  const res = await checkInto(overnight, room2);
  status(res, 200);
});

section("COD settlement reference in the revenue ledger");
let bproId, codA, codB, partnerKey;
await t("two COD delivery orders exist", async () => {
  const p = await api(owner, "POST", "/delivery-partners", { name: `ZZQA Ref ${sfx}` });
  status(p, 201);
  partnerKey = p.data.key;
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_RefMenu` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Ref Rice", pro_qty: 50, pro_price: 1000, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bpro = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Ref Rice", pro_shortname: "Rice",
    pro_image: "placeholder.png", pro_des: "A test dish", cat_id: cat.data.cat_id, pro_price: 1000, pro_quantity: 50,
  });
  status(bpro, 201);
  bproId = bpro.data.Bpro_id;
  const mk = (tag) => api(cashier, "POST", "/orders/with-items", {
    order: {
      or_tax: 0, or_totalcost: 1000, or_totalCostWtax: 1050, or_status: "pending", or_type: "delivery",
      u_id: A.cashier.u_id, b_id: A.b_id, payment_method: "cod", delivery_charge: 50, delivery_partner: partnerKey,
      client_ref: `${stamp.toLowerCase()}-ref-${tag}`,
    },
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 1000 }],
  });
  const a = await mk("a"); const b = await mk("b");
  status(a, 201); status(b, 201);
  codA = a.data.data.or_id; codB = b.data.data.or_id;
});

let settlementId;
await t("the owner settles both in one settlement", async () => {
  const res = await api(owner, "POST", "/delivery-cod/settle", {
    delivery_partner: partnerKey, amount: 2100, method: "cash", order_ids: [codA, codB],
  });
  status(res, 201);
  settlementId = res.data.settlement_id ?? res.data.data?.settlement_id;
});

await t("the ledger row for that settlement references both order numbers", async () => {
  const res = await api(owner, "GET", `/reports/transactions?b_id=${A.b_id}&kind=all&from=${today}&to=${today}`);
  status(res, 200);
  const row = res.data.transactions.find((r) => r.type === "Delivery COD Settlement"
    && (settlementId ? r.settlement_id === settlementId : true));
  ok(row, "the settlement should appear in the ledger");
  ok(row.reference.includes(`#${codA}`) && row.reference.includes(`#${codB}`),
    `reference should list #${codA} and #${codB}, got "${row.reference}"`);
});

await finish("t23-day-use-and-report-refs.mjs");
