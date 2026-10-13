// t22-light-responses.mjs — no list may carry stored photos or grow without bound.
// Photos are stored as data URLs; a list that carried them grew with every upload
// until a shop's connection could not load it (the till's "503", "Failed to load
// products"). This keeps that from coming back, on any page.
import crypto from "node:crypto";
import { ctx, api, t, eq, ok, status, section, finish, BASE, pool } from "./lib.mjs";

const { A, stamp } = await ctx();
const owner = A.owner.token;
const cashier = A.cashier.token;
const BUDGET = 300 * 1024; // a list over this is slow on a shop connection

// A photo-sized data URL (about 6 KB), different every run.
const PHOTO = `data:image/jpeg;base64,${crypto.randomBytes(4500).toString("base64")}`;
let roomTypeId, link;

section("a photo inside a list leaves as a link");
await t("a room type's photos are links in the room type list, and the link serves the photo", async () => {
  const rt = await api(owner, "POST", "/hotel/room-types", {
    b_id: A.b_id, type_name: `ZZQA Photo Room ${stamp.slice(-6)}`, base_rate: 5000, max_adults: 2, max_children: 1,
    included_guests: 2, images: [PHOTO],
  });
  status(rt, 201);
  roomTypeId = rt.data.room_type_id;
  const list = await api(owner, "GET", `/hotel/room-types?b_id=${A.b_id}`);
  status(list, 200);
  const row = (Array.isArray(list.data) ? list.data : list.data.data).find((x) => x.room_type_id === roomTypeId);
  link = row.images[0];
  ok(/^https?:\/\/.+\/api\/images\/[0-9a-f]{32}$/.test(link), `expected a photo link, got ${String(link).slice(0, 60)}`);
  const res = await fetch(link.replace(/^https?:\/\/[^/]+\/api/, BASE));
  eq(res.status, 200);
  eq(res.headers.get("content-type"), "image/jpeg");
  ok(/max-age=31536000/.test(res.headers.get("cache-control") || ""), "cached by the browser");
  eq(Buffer.from(await res.arrayBuffer()).toString("base64"), PHOTO.split(",")[1]);
});

await t("saving the link back stores the photo itself, unchanged", async () => {
  const one = await api(owner, "GET", `/hotel/room-types/${roomTypeId}`);
  status(one, 200);
  const body = { ...one.data, images: [link] };
  status(await api(owner, "PUT", `/hotel/room-types/${roomTypeId}`, body), 200);
  const { rows } = await pool.query(`SELECT images FROM "ROOM_TYPE" WHERE room_type_id = $1`, [roomTypeId]);
  eq(rows[0].images[0], PHOTO, "the database still holds the photo, not a link");
});

await t("a single record (an edit page) still gets the photo itself", async () => {
  const one = await api(owner, "GET", `/hotel/room-types/${roomTypeId}`);
  eq(one.data.images[0], PHOTO);
});

section("responses are compressed");
await t("a list is sent gzipped when the browser accepts it", async () => {
  const res = await fetch(`${BASE}/hotel/room-types?b_id=${A.b_id}`, {
    headers: { Authorization: `Bearer ${owner}`, "Accept-Encoding": "gzip" },
  });
  eq(res.status, 200);
  eq(res.headers.get("content-encoding"), "gzip");
  ok(Array.isArray(await res.json()), "still readable JSON");
});

section("every main list stays light");
const lists = [
  [owner, `/branch_products?B_id=${A.b_id}`],
  [owner, "/products"],
  [owner, `/hotel/room-types?b_id=${A.b_id}`],
  [owner, `/hotel/availability?b_id=${A.b_id}&check_in=2030-01-01&check_out=2030-01-02`],
  [owner, "/hotel/guests"],
  [owner, "/users"],
  [owner, "/categories"],
  [cashier, "/orders/board"],
];
for (const [token, path] of lists) {
  await t(`${path.split("?")[0]} carries no stored photos and stays under ${BUDGET / 1024} KB`, async () => {
    const res = await api(token, "GET", path);
    ok(res.status === 200, `expected 200, got ${res.status}`);
    const text = JSON.stringify(res.data);
    ok(!/data:image\//.test(text), "a list must not carry photo data — send a link (utils/responseImages.js)");
    ok(text.length < BUDGET, `${Math.round(text.length / 1024)} KB is over the budget`);
  });
}

await finish("t22-light-responses.mjs");
