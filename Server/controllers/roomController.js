import pool from "../config/database.js";
import { logActivity } from "../utils/activityLog.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { effectiveCheckout } from "../utils/occupancy.js";

// ─── ROOM TYPES ──────────────────────────────────────────────────────────────

const MAX_MONEY = 99_999_999.99;          // what NUMERIC(10,2) holds
const MAX_PHOTOS = 6;                     // they travel inside the record, as data: URLs
const MAX_FACILITIES = 60;

const given = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const tidy = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

const asList = (x) => {
  if (x === undefined || x === null) return [];
  if (typeof x === "string") {
    try { x = JSON.parse(x); } catch { return null; }
  }
  return Array.isArray(x) ? x : null;
};

/**
 * What a room type is allowed to be — one set of rules for create and edit.
 *
 * `base` is the row being edited, or an empty starting point for a new one. A
 * field the request leaves out keeps what `base` has; a field it sends replaces
 * it, including with nothing, so "no limit" can be put back. The edit used to
 * COALESCE every column, which read "nothing" as "keep the old value": once
 * Adults (max) or the description had been filled in, it could never be cleared.
 *
 * Returns { value } or { error, status }.
 */
function readRoomType(body, base) {
  const fail = (message, status = 400) => ({ error: message, status });
  const pick = (key) => (has(body, key) ? body[key] : base[key]);
  const v = {};

  v.type_name = tidy(pick("type_name"));
  if (!v.type_name) return fail("Give the room type a name.");
  if (v.type_name.length > 100) return fail("The name can be up to 100 characters.");

  v.type_code = tidy(pick("type_code")).toUpperCase() || null;
  if (v.type_code && v.type_code.length > 20) return fail("The code can be up to 20 characters.");

  v.description = String(pick("description") ?? "").trim() || null;
  if (v.description && v.description.length > 500) return fail("The description can be up to 500 characters.");

  // All three counts are optional: a property that prices by the room leaves
  // them blank and nobody is ever charged per head. What is filled in has to
  // make sense — these once fell back silently, and `Number(0) || 2` turned a
  // typed zero into two.
  for (const [key, label] of [["included_guests", "Included in the rate"],
                              ["max_adults", "Adults (max)"], ["max_children", "Children (max)"]]) {
    const raw = pick(key);
    if (!given(raw)) { v[key] = null; continue; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 50) {
      return fail(`${label} has to be a whole number of people (up to 50), or left blank.`);
    }
    v[key] = n;
  }
  if (v.included_guests === 0) {
    return fail("If the rate includes guests, it includes at least one. Leave it blank to price by the room.");
  }
  // Zero children is a real answer — no children in this room type. Zero adults
  // is not: that is a room nobody can sleep in.
  if (v.max_adults === 0) return fail("A room takes at least one adult. Leave Adults (max) blank for no limit.");
  if (v.max_adults != null && v.max_children != null && v.included_guests != null
      && v.included_guests > v.max_adults + v.max_children) {
    return fail(`The rate can't cover ${v.included_guests} guests when the room only holds ${v.max_adults + v.max_children}.`);
  }

  // The rate is what every booking of this type is priced from. Left out, it
  // became 0 and the whole stay was free with nothing said about it.
  const rate = pick("base_rate");
  if (!given(rate) || !Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > MAX_MONEY) {
    return fail("Set the rate per night — the amount every booking of this type starts from.");
  }
  v.base_rate = Number(rate);

  for (const [key, label] of [["extra_adult_rate", "Extra adult / night"], ["extra_child_rate", "Extra child / night"]]) {
    const raw = pick(key);
    const n = given(raw) ? Number(raw) : 0;
    if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) return fail(`${label} has to be an amount of 0 or more.`);
    v[key] = n;
  }

  v.bed_config = tidy(pick("bed_config")) || null;
  if (v.bed_config && v.bed_config.length > 60) return fail("The bed configuration can be up to 60 characters.");

  const size = pick("size_sqft");
  if (given(size) && (!Number.isFinite(Number(size)) || Number(size) < 0 || Number(size) > 100000)) {
    return fail("Size has to be a number of square feet.");
  }
  v.size_sqft = given(size) && Number(size) > 0 ? Math.round(Number(size)) : null;

  const facilities = asList(pick("amenities"));
  if (!facilities) return fail("Facilities have to be a list.");
  const seen = new Set();
  v.amenities = [];
  for (const raw of facilities) {
    const name = tidy(raw);
    if (!name || seen.has(name.toLowerCase())) continue;
    if (name.length > 40) return fail(`"${name.slice(0, 20)}…" is too long for a facility name (40 characters).`);
    seen.add(name.toLowerCase());
    v.amenities.push(name);
  }
  if (v.amenities.length > MAX_FACILITIES) return fail(`Choose up to ${MAX_FACILITIES} facilities.`);

  const photos = asList(pick("images"));
  if (!photos) return fail("Photos have to be a list.");
  v.images = photos.filter((p) => typeof p === "string" && p.trim());
  if (v.images.length > MAX_PHOTOS) return fail(`A room type can have up to ${MAX_PHOTOS} photos.`);
  if (v.images.some((p) => !/^(data:image\/|https?:\/\/)/i.test(p))) {
    return fail("Photos have to be uploaded images or web addresses (http…).");
  }

  v.is_active = has(body, "is_active") ? Boolean(body.is_active) : base.is_active !== false;
  return { value: v };
}

/** A second room type with the same name — or the same code — in this branch. */
async function roomTypeClash(b_id, v, exceptId = 0) {
  const { rows } = await pool.query(
    `SELECT type_name, type_code FROM "ROOM_TYPE"
      WHERE b_id = $1 AND room_type_id <> $2
        AND (LOWER(type_name) = LOWER($3) OR ($4::text IS NOT NULL AND LOWER(type_code) = LOWER($4)))
      LIMIT 1`,
    [b_id, exceptId, v.type_name, v.type_code],
  );
  if (!rows.length) return null;
  const other = rows[0];
  return other.type_name.toLowerCase() === v.type_name.toLowerCase()
    ? `There is already a room type called "${other.type_name}".`
    : `The code "${other.type_code}" is already used by "${other.type_name}".`;
}

export async function getRoomTypes(req, res, next) {
  try {
    const { active } = req.query;
    const params = [];
    const clauses = [];
    const scope = branchClause(req, "rt.b_id", params);
    if (scope) clauses.push(scope);
    if (active === "true") clauses.push(`rt.is_active = TRUE`);
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    const { rows } = await pool.query(
      `SELECT rt.*,
              COUNT(r.room_id)                                        AS room_count,
              COUNT(r.room_id) FILTER (WHERE r.is_active) AS active_room_count
       FROM "ROOM_TYPE" rt
       LEFT JOIN "ROOM" r ON r.room_type_id = rt.room_type_id
       ${where}
       GROUP BY rt.room_type_id
       ORDER BY rt.type_name`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getRoomTypeById(req, res, next) {
  try {
    await assertInScope(req, res, { table: "ROOM_TYPE", idColumn: "room_type_id", id: req.params.id });
    const { rows } = await pool.query(
      'SELECT * FROM "ROOM_TYPE" WHERE room_type_id = $1', [Number(req.params.id)]
    );
    if (!rows.length) { res.status(404); return next(new Error("Room type not found")); }
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function createRoomType(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    if (!b_id) { res.status(400); return next(new Error("Choose the branch this room type belongs to.")); }

    const read = readRoomType(req.body || {}, { is_active: true });
    if (read.error) { res.status(read.status); return next(new Error(read.error)); }
    const v = read.value;

    const clash = await roomTypeClash(b_id, v);
    if (clash) { res.status(409); return next(new Error(clash)); }

    const { rows } = await pool.query(
      `INSERT INTO "ROOM_TYPE"
        (b_id, type_name, type_code, description, included_guests, max_adults, max_children,
         base_rate, extra_adult_rate, extra_child_rate, bed_config, size_sqft, amenities, images, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15)
       RETURNING *`,
      [Number(b_id), v.type_name, v.type_code, v.description,
       v.included_guests, v.max_adults, v.max_children,
       v.base_rate, v.extra_adult_rate, v.extra_child_rate, v.bed_config, v.size_sqft,
       JSON.stringify(v.amenities), JSON.stringify(v.images), v.is_active]
    );
    logActivity(req, { action: "create", entity: "room_type", entity_id: rows[0].room_type_id, b_id,
      summary: `Added room type "${rows[0].type_name}" at ${rows[0].base_rate}/night` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateRoomType(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "ROOM_TYPE", idColumn: "room_type_id", id });

    const current = await pool.query('SELECT * FROM "ROOM_TYPE" WHERE room_type_id = $1', [id]);
    if (!current.rows.length) { res.status(404); return next(new Error("Room type not found")); }

    const read = readRoomType(req.body || {}, current.rows[0]);
    if (read.error) { res.status(read.status); return next(new Error(read.error)); }
    const v = read.value;

    const clash = await roomTypeClash(current.rows[0].b_id, v, id);
    if (clash) { res.status(409); return next(new Error(clash)); }

    const { rows } = await pool.query(
      `UPDATE "ROOM_TYPE" SET
         type_name = $1, type_code = $2, description = $3,
         included_guests = $4, max_adults = $5, max_children = $6,
         base_rate = $7, extra_adult_rate = $8, extra_child_rate = $9,
         bed_config = $10, size_sqft = $11,
         amenities = $12::jsonb, images = $13::jsonb, is_active = $14
       WHERE room_type_id = $15
       RETURNING *`,
      [v.type_name, v.type_code, v.description,
       v.included_guests, v.max_adults, v.max_children,
       v.base_rate, v.extra_adult_rate, v.extra_child_rate,
       v.bed_config, v.size_sqft,
       JSON.stringify(v.amenities), JSON.stringify(v.images), v.is_active, id]
    );
    logActivity(req, { action: "update", entity: "room_type", entity_id: id, b_id: rows[0].b_id,
      summary: `Updated room type "${rows[0].type_name}" (rate ${rows[0].base_rate}/night)` });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteRoomType(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "ROOM_TYPE", idColumn: "room_type_id", id });
    const inUse = await pool.query('SELECT 1 FROM "ROOM" WHERE room_type_id = $1 LIMIT 1', [id]);
    if (inUse.rows.length) {
      res.status(409);
      return next(new Error("Cannot delete: rooms of this type still exist. Deactivate it instead."));
    }
    const doomed = await pool.query('SELECT type_name FROM "ROOM_TYPE" WHERE room_type_id = $1', [id]);
    const { rowCount } = await pool.query('DELETE FROM "ROOM_TYPE" WHERE room_type_id = $1', [id]);
    if (!rowCount) { res.status(404); return next(new Error("Room type not found")); }
    logActivity(req, { action: "delete", entity: "room_type", entity_id: id,
      summary: `Deleted room type "${doomed.rows[0]?.type_name ?? id}"` });
    res.status(204).send();
  } catch (err) { next(err); }
}

// ─── ROOM FACILITIES — the property's own list, shared by every room type ────

// What a branch starts with, the first time it asks. After that the list is
// the owner's: nothing here is re-added once they take it out.
const STARTER_FACILITIES = [
  "Air Conditioning", "Free WiFi", "Flat-screen TV", "Minibar", "Safe",
  "Balcony", "Mountain View", "City View", "Bathtub", "Shower",
  "Hair Dryer", "Tea/Coffee Maker", "Room Service", "Work Desk", "Wardrobe",
];

function facilityBranch(req, res) {
  const b_id = writeBranchId(req, req.query?.b_id);
  if (!b_id) { res.status(400); throw new Error("Choose the branch these facilities belong to."); }
  return b_id;
}

export async function getRoomFacilities(req, res, next) {
  try {
    const b_id = facilityBranch(req, res);
    const branch = await pool.query('SELECT room_facilities_seeded FROM "Branch" WHERE "B_id" = $1', [b_id]);
    if (!branch.rows.length) { res.status(404); return next(new Error("Branch not found")); }

    if (!branch.rows[0].room_facilities_seeded) {
      // The starter set, plus anything this branch's room types already carry.
      await pool.query(
        `INSERT INTO "ROOM_FACILITY" (b_id, name)
         SELECT $1::int, name FROM unnest($2::text[]) WITH ORDINALITY AS s(name, n) ORDER BY n
         ON CONFLICT DO NOTHING`,
        [b_id, STARTER_FACILITIES],
      );
      await pool.query(
        `INSERT INTO "ROOM_FACILITY" (b_id, name)
         SELECT DISTINCT $1::int, trim(a) FROM "ROOM_TYPE" rt, jsonb_array_elements_text(rt.amenities) a
          WHERE rt.b_id = $1::int AND length(trim(a)) BETWEEN 1 AND 40
         ON CONFLICT DO NOTHING`,
        [b_id],
      );
      await pool.query('UPDATE "Branch" SET room_facilities_seeded = TRUE WHERE "B_id" = $1', [b_id]);
    }

    const { rows } = await pool.query(
      'SELECT facility_id, name FROM "ROOM_FACILITY" WHERE b_id = $1 ORDER BY facility_id', [b_id]);
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createRoomFacility(req, res, next) {
  try {
    const b_id = facilityBranch(req, res);
    const name = tidy(req.body?.name);
    if (!name) { res.status(400); return next(new Error("Type the facility's name.")); }
    if (name.length > 40) { res.status(400); return next(new Error("A facility name can be up to 40 characters.")); }

    const made = await pool.query(
      `INSERT INTO "ROOM_FACILITY" (b_id, name) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING facility_id, name`, [b_id, name]);
    if (made.rows.length) return res.status(201).json(made.rows[0]);

    // Already on the list (in some capitalisation): hand that one back.
    const existing = await pool.query(
      'SELECT facility_id, name FROM "ROOM_FACILITY" WHERE b_id = $1 AND LOWER(name) = LOWER($2)', [b_id, name]);
    res.json(existing.rows[0]);
  } catch (err) { next(err); }
}

export async function deleteRoomFacility(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "ROOM_FACILITY", idColumn: "facility_id", id });
    await pool.query('DELETE FROM "ROOM_FACILITY" WHERE facility_id = $1', [id]);
    res.status(204).send();
  } catch (err) { next(err); }
}

// ─── ROOMS ───────────────────────────────────────────────────────────────────

export async function getRooms(req, res, next) {
  try {
    const { hk_status, room_type_id } = req.query;
    const params = [];
    const clauses = [];
    const scope = branchClause(req, "r.b_id", params);
    if (scope) clauses.push(scope);
    if (hk_status)    { params.push(hk_status);            clauses.push(`r.hk_status = $${params.length}`); }
    if (room_type_id) { params.push(Number(room_type_id)); clauses.push(`r.room_type_id = $${params.length}`); }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    // Pick ONE booking per room — the in-house guest if there is one, otherwise the
    // next arrival. LATERAL keeps it to a single row; a plain join against
    // BOOKING_ROOM would repeat the room once per booking it has ever had.
    const { rows } = await pool.query(
      `SELECT r.*,
              rt.type_name, rt.type_code, rt.base_rate, rt.max_adults, rt.max_children, rt.amenities,
              b.booking_id     AS current_booking_id,
              b.booking_ref    AS current_booking_ref,
              b.status         AS current_booking_status,
              b.check_in_date  AS current_check_in,
              b.check_out_date AS current_check_out,
              g.full_name      AS current_guest,
              CASE
                WHEN b.status = 'checked_in' THEN 'occupied'
                WHEN b.booking_id IS NOT NULL THEN 'reserved'
                ELSE 'vacant'
              END AS occupancy
       FROM "ROOM" r
       JOIN "ROOM_TYPE" rt ON rt.room_type_id = r.room_type_id
       LEFT JOIN LATERAL (
         SELECT bk.booking_id, bk.booking_ref, bk.status,
                bk.check_in_date, bk.check_out_date, bk.guest_id
         FROM "BOOKING_ROOM" br
         JOIN "BOOKING" bk ON bk.booking_id = br.booking_id
         WHERE br.room_id = r.room_id
           AND bk.status IN ('checked_in','confirmed','tentative')
           AND ${effectiveCheckout("bk")} > CURRENT_DATE
         ORDER BY CASE WHEN bk.status = 'checked_in' THEN 0 ELSE 1 END,
                  bk.check_in_date
         LIMIT 1
       ) b ON TRUE
       LEFT JOIN "GUEST" g ON g.guest_id = b.guest_id
       ${where}
       ORDER BY r.room_number`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createRoom(req, res, next) {
  try {
    const { room_type_id, room_number, floor, hk_status, notes } = req.body;
    const b_id = writeBranchId(req);
    if (!b_id || !room_type_id || !room_number?.trim()) {
      res.status(400); return next(new Error("b_id, room_type_id and room_number are required"));
    }
    const { rows } = await pool.query(
      `INSERT INTO "ROOM" (b_id, room_type_id, room_number, floor, hk_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [Number(b_id), Number(room_type_id), room_number.trim(), floor || null, hk_status || "clean", notes || null]
    );
    logActivity(req, { action: "create", entity: "room", entity_id: rows[0].room_id, b_id,
      summary: `Added room ${rows[0].room_number}` });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409); return next(new Error("A room with that number already exists in this branch"));
    }
    next(err);
  }
}

export async function updateRoom(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "ROOM", idColumn: "room_id", id });
    const { room_type_id, room_number, floor, hk_status, notes, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE "ROOM" SET
         room_type_id = COALESCE($1, room_type_id),
         room_number  = COALESCE($2, room_number),
         floor        = COALESCE($3, floor),
         hk_status    = COALESCE($4, hk_status),
         notes        = COALESCE($5, notes),
         is_active    = COALESCE($6, is_active)
       WHERE room_id = $7 RETURNING *`,
      [room_type_id != null ? Number(room_type_id) : null, room_number || null,
       floor || null, hk_status || null, notes || null,
       is_active !== undefined ? Boolean(is_active) : null, id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Room not found")); }
    logActivity(req, { action: "update", entity: "room", entity_id: id, b_id: rows[0].b_id,
      summary: `Updated room ${rows[0].room_number}`
        + (hk_status ? ` — housekeeping set to ${hk_status}` : "") });
    res.json(rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409); return next(new Error("A room with that number already exists in this branch"));
    }
    next(err);
  }
}

export async function deleteRoom(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "ROOM", idColumn: "room_id", id });
    const inUse = await pool.query(
      `SELECT 1 FROM "BOOKING_ROOM" br
       JOIN "BOOKING" b ON b.booking_id = br.booking_id
       WHERE br.room_id = $1 AND b.status IN ('confirmed','tentative','checked_in') LIMIT 1`,
      [id]
    );
    if (inUse.rows.length) {
      res.status(409);
      return next(new Error("Cannot delete: this room has active bookings. Deactivate it instead."));
    }
    const doomed = await pool.query('SELECT room_number FROM "ROOM" WHERE room_id = $1', [id]);
    const { rowCount } = await pool.query('DELETE FROM "ROOM" WHERE room_id = $1', [id]);
    if (!rowCount) { res.status(404); return next(new Error("Room not found")); }
    logActivity(req, { action: "delete", entity: "room", entity_id: id,
      summary: `Deleted room ${doomed.rows[0]?.room_number ?? id}` });
    res.status(204).send();
  } catch (err) { next(err); }
}

// Meal plan CRUD removed — meal plan module has been retired.
