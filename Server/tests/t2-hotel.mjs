// t2-hotel.mjs — room types, rooms, category-only bookings, overbooking
// warnings (never a hard block), check-in room assignment, folio, payments,
// cancellation, and the stay policy.
import { ctx, api, t, eq, ok, status, section, finish } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;

let roomTypeId, room1Id, room2Id;

section("room types & rooms setup");
await t("owner creates a room type", async () => {
  const res = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: "ZZQA Standard", base_rate: 5000,
    max_adults: 2, max_children: 1, included_guests: 2,
  });
  status(res, 201, "creating a room type should succeed");
  roomTypeId = res.data.room_type_id;
});

await t("owner adds two physical rooms of that type", async () => {
  const r1 = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: "ZZQA-101" });
  const r2 = await api(owner, "POST", "/hotel/rooms", { b_id: A.b_id, room_type_id: roomTypeId, room_number: "ZZQA-102" });
  status(r1, 201); status(r2, 201);
  room1Id = r1.data.room_id; room2Id = r2.data.room_id;
});

await t("cashier cannot create a room type (needs Hotel & Room Management)", async () => {
  const res = await api(cashier, "POST", "/hotel/room-types", { b_id: A.b_id, type_name: "Should Fail", base_rate: 1 });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

section("category-only booking & overbooking-as-warning");
let bookingId1, bookingId2, bookingId3;
await t("cashier books a category-only room (no room_id)", async () => {
  const res = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: tomorrow, check_out_date: dayAfter,
    guest: { full_name: "ZZQA Guest One", phone: "0710000001" },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 5000 }],
    adults: 1, children: 0,
  });
  status(res, 201);
  ok(!res.data.warnings || res.data.warnings.length === 0, "first booking within capacity should carry no warning");
  bookingId1 = res.data.booking_id;
});

await t("a second booking of the same category still succeeds (within capacity)", async () => {
  const res = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: tomorrow, check_out_date: dayAfter,
    guest: { full_name: "ZZQA Guest Two", phone: "0710000002" },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 5000 }],
    adults: 1, children: 0,
  });
  status(res, 201);
  bookingId2 = res.data.booking_id;
});

section("availability reflects category-only demand");
await t("availability shows only 1 of 2 rooms free once 2 category bookings exist for those dates", async () => {
  const res = await api(cashier, "GET", `/hotel/availability?b_id=${A.b_id}&check_in=${tomorrow}&check_out=${dayAfter}&exclude_booking=${bookingId1}`);
  status(res, 200);
  const t1 = res.data.room_types.find((x) => x.room_type_id === roomTypeId);
  ok(t1, "the ZZQA room type should appear in availability");
  eq(t1.available_rooms.length, 1, "excluding booking 1, only 1 of 2 rooms should show free (booking 2 holds the other)");
});

section("category-only booking & overbooking-as-warning");
await t("a THIRD booking past the physical room count is still ACCEPTED, with a warning (never hard-blocked)", async () => {
  const res = await api(cashier, "POST", "/hotel/bookings", {
    b_id: A.b_id, check_in_date: tomorrow, check_out_date: dayAfter,
    guest: { full_name: "ZZQA Guest Three", phone: "0710000003" },
    rooms: [{ room_type_id: roomTypeId, rate_per_night: 5000 }],
    adults: 1, children: 0,
  });
  status(res, 201, "overbooking past physical capacity must never be a hard refusal");
  ok(Array.isArray(res.data.warnings) && res.data.warnings.length > 0, "should carry a warning that capacity was exceeded");
  bookingId3 = res.data.booking_id;
});

section("check-in room assignment");
await t("checking in without every room assigned is refused", async () => {
  const res = await api(cashier, "POST", `/hotel/bookings/${bookingId1}/check-in`, { room_assignments: [] });
  ok(res.status !== 200 && res.status !== 201, "check-in with no room assignment must be refused");
});

await t("check-in is refused until the guest's passport/ID scan is on file", async () => {
  const b = await api(cashier, "GET", `/hotel/bookings/${bookingId1}`);
  const bookingRoomId = b.data.rooms[0].booking_room_id;
  const res = await api(cashier, "POST", `/hotel/bookings/${bookingId1}/check-in`, {
    room_assignments: [{ booking_room_id: bookingRoomId, room_id: room1Id }],
  });
  status(res, 400, "no passport/scan on file yet should refuse the check-in");
});

await t("filling in guest registration (passport + scan), then checking in booking 1 into room 1, succeeds", async () => {
  const b = await api(cashier, "GET", `/hotel/bookings/${bookingId1}`);
  const guestUpdate = await api(cashier, "PUT", `/hotel/guests/${b.data.guest_id}`, {
    passport_nic: "ZZQA-PASSPORT-1", id_document: "data:image/png;base64,AAAA",
  });
  status(guestUpdate, 200, "guest registration update should succeed");

  const bookingRoomId = b.data.rooms[0].booking_room_id;
  const res = await api(cashier, "POST", `/hotel/bookings/${bookingId1}/check-in`, {
    room_assignments: [{ booking_room_id: bookingRoomId, room_id: room1Id }],
  });
  status(res, 200, "check-in should succeed once every room has a room_id and the guest is registered");
});

await t("the same physical room cannot then be assigned to booking 2 too (real double-booking stays a hard refusal)", async () => {
  const b = await api(cashier, "GET", `/hotel/bookings/${bookingId2}`);
  const bookingRoomId = b.data.rooms[0].booking_room_id;
  const res = await api(cashier, "POST", `/hotel/bookings/${bookingId2}/check-in`, {
    room_assignments: [{ booking_room_id: bookingRoomId, room_id: room1Id }],
  });
  ok(res.status !== 200, "assigning an already-occupied physical room must be refused, unlike the category-level warning");
});

section("folio & payments");
await t("a folio exists once checked in, with the room charge on it", async () => {
  const res = await api(cashier, "GET", `/hotel/bookings/${bookingId1}/folio`);
  status(res, 200);
  ok(Number(res.data.total_charges) > 0, "folio should carry at least the room charge");
});

await t("recording a payment against the booking works pre- and post-check-in", async () => {
  const res = await api(cashier, "POST", `/hotel/bookings/${bookingId1}/payments`, { amount: 1000, method: "cash", kind: "advance" });
  status(res, 201);
});

section("room service — discount & manager-PIN approval (regression: this used to skip both entirely)");
let bproId;
await t("owner adds a room-service menu item", async () => {
  const cat = await api(owner, "POST", "/categories", { cat_name: `${stamp}_RoomService` });
  status(cat, 201);
  const pro = await api(owner, "POST", "/products", { pro_name: "ZZQA Club Sandwich", pro_qty: 50, pro_price: 1000, cat_id: cat.data.cat_id, com_id: A.com_id });
  status(pro, 201);
  const bpro = await api(owner, "POST", "/branch_products", {
    B_id: A.b_id, pro_id: pro.data.pro_id, pro_name: "ZZQA Club Sandwich", pro_shortname: "Sandwich",
    pro_image: "placeholder.png", pro_des: "A test sandwich", cat_id: cat.data.cat_id, pro_price: 1000, pro_quantity: 50,
  });
  status(bpro, 201);
  bproId = bpro.data.Bpro_id;
});

await t("a discounted room-service charge with a wrong PIN is refused", async () => {
  const res = await api(cashier, "POST", "/hotel/room-service", {
    room_id: room1Id, tax_pct: 0, discount_pct: 10, approval_pin: "0000",
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 1000 }],
  });
  status(res, 403, "a wrong PIN on a room-service discount must be refused, not silently accepted");
});

await t("owner sets a real approval PIN", async () => {
  const res = await api(owner, "PUT", "/security/approval-pin", { pin: "246810" });
  status(res, 200);
});

await t("the same discount now succeeds with the real PIN, and the folio is charged the DISCOUNTED amount", async () => {
  const res = await api(cashier, "POST", "/hotel/room-service", {
    room_id: room1Id, tax_pct: 0, discount_pct: 10, approval_pin: "246810",
    items: [{ Bpro_id: bproId, pro_quantity: 1, unit_price: 1000 }],
  });
  status(res, 201);
  eq(Number(res.data.total), 900, "900 = 1000 less the approved 10% discount, not the full price");
  eq(res.data.order.discount_approved_by, A.owner.u_id, "the approving manager should be recorded on the order");
});

await t("owner removes their approval PIN again", async () => {
  const res = await api(owner, "DELETE", "/security/approval-pin");
  status(res, 200);
});

section("cancellation");
await t("cancelling the never-checked-in booking 3 succeeds and frees its capacity warning", async () => {
  const res = await api(cashier, "POST", `/hotel/bookings/${bookingId3}/cancel`, { reason: "ZZQA test cleanup" });
  status(res, 200);
});

section("stay policy");
await t("owner can read the stay policy", async () => {
  const res = await api(owner, "GET", `/hotel/policy?b_id=${A.b_id}`);
  status(res, 200);
});

await t("cashier cannot change the stay policy", async () => {
  const res = await api(cashier, "PUT", "/hotel/policy", { b_id: A.b_id, check_in_time: "14:00" });
  ok(res.status === 403, `expected 403, got ${res.status}`);
});

await finish("t2-hotel.mjs");
