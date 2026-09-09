import pool from "../config/database.js";
import { logActivity } from "../utils/activityLog.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { effectiveCheckout } from "../utils/occupancy.js";

const asJson = (v, fallback = []) => {
  if (v === undefined || v === null) return JSON.stringify(fallback);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
};

// ─── ROOM TYPES ──────────────────────────────────────────────────────────────

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
    const {
      type_name, type_code, description, base_occupancy, max_occupancy,
      base_rate, extra_adult_rate, extra_child_rate, bed_config, size_sqft, amenities, images,
    } = req.body;
    const b_id = writeBranchId(req);

    if (!b_id || !type_name?.trim()) {
      res.status(400); return next(new Error("b_id and type_name are required"));
    }
    const baseOcc = Number(base_occupancy) || 2;
    const maxOcc  = Number(max_occupancy)  || baseOcc;
    if (maxOcc < baseOcc) {
      res.status(400); return next(new Error("max_occupancy cannot be less than base_occupancy"));
    }

    const { rows } = await pool.query(
      `INSERT INTO "ROOM_TYPE"
        (b_id, type_name, type_code, description, base_occupancy, max_occupancy,
         base_rate, extra_adult_rate, extra_child_rate, bed_config, size_sqft, amenities, images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
       RETURNING *`,
      [Number(b_id), type_name.trim(), type_code || null, description || null,
       baseOcc, maxOcc, Number(base_rate) || 0, Number(extra_adult_rate) || 0,
       Number(extra_child_rate) || 0, bed_config || null, size_sqft ? Number(size_sqft) : null,
       asJson(amenities), asJson(images)]
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
    const {
      type_name, type_code, description, base_occupancy, max_occupancy,
      base_rate, extra_adult_rate, extra_child_rate, bed_config, size_sqft,
      amenities, images, is_active,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE "ROOM_TYPE" SET
         type_name        = COALESCE($1,  type_name),
         type_code        = COALESCE($2,  type_code),
         description      = COALESCE($3,  description),
         base_occupancy   = COALESCE($4,  base_occupancy),
         max_occupancy    = COALESCE($5,  max_occupancy),
         base_rate        = COALESCE($6,  base_rate),
         extra_adult_rate = COALESCE($7,  extra_adult_rate),
         extra_child_rate = COALESCE($8,  extra_child_rate),
         bed_config       = COALESCE($9,  bed_config),
         size_sqft        = COALESCE($10, size_sqft),
         amenities        = COALESCE($11::jsonb, amenities),
         images           = COALESCE($12::jsonb, images),
         is_active        = COALESCE($13, is_active)
       WHERE room_type_id = $14
       RETURNING *`,
      [type_name || null, type_code || null, description || null,
       base_occupancy != null ? Number(base_occupancy) : null,
       max_occupancy  != null ? Number(max_occupancy)  : null,
       base_rate        != null ? Number(base_rate)        : null,
       extra_adult_rate != null ? Number(extra_adult_rate) : null,
       extra_child_rate != null ? Number(extra_child_rate) : null,
       bed_config || null, size_sqft != null ? Number(size_sqft) : null,
       amenities !== undefined ? asJson(amenities) : null,
       images    !== undefined ? asJson(images)    : null,
       is_active !== undefined ? Boolean(is_active) : null,
       id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Room type not found")); }
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
              rt.type_name, rt.type_code, rt.base_rate, rt.max_occupancy, rt.amenities,
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

// ─── MEAL PLANS ──────────────────────────────────────────────────────────────

export async function getMealPlans(req, res, next) {
  try {

    const params = [];
    let where = "";
    const scope = branchClause(req, "b_id", params);
    if (scope) where = "WHERE " + scope;
    const { rows } = await pool.query(
      `SELECT * FROM "MEAL_PLAN" ${where} ORDER BY plan_id`, params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createMealPlan(req, res, next) {
  try {
    const { plan_code, plan_name, supplement_per_adult, supplement_per_child } = req.body;
    const b_id = writeBranchId(req);
    if (!b_id || !plan_code || !plan_name) {
      res.status(400); return next(new Error("b_id, plan_code and plan_name are required"));
    }
    const { rows } = await pool.query(
      `INSERT INTO "MEAL_PLAN" (b_id, plan_code, plan_name, supplement_per_adult, supplement_per_child)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [Number(b_id), plan_code.toUpperCase(), plan_name,
       Number(supplement_per_adult) || 0, Number(supplement_per_child) || 0]
    );
    logActivity(req, { action: "create", entity: "meal_plan", entity_id: rows[0].plan_id, b_id,
      summary: `Added meal plan "${rows[0].plan_name}"` });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409); return next(new Error("That meal plan code already exists for this branch"));
    }
    next(err);
  }
}

export async function updateMealPlan(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "MEAL_PLAN", idColumn: "plan_id", id });
    const { plan_name, supplement_per_adult, supplement_per_child, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE "MEAL_PLAN" SET
         plan_name            = COALESCE($1, plan_name),
         supplement_per_adult = COALESCE($2, supplement_per_adult),
         supplement_per_child = COALESCE($3, supplement_per_child),
         is_active            = COALESCE($4, is_active)
       WHERE plan_id = $5 RETURNING *`,
      [plan_name || null,
       supplement_per_adult != null ? Number(supplement_per_adult) : null,
       supplement_per_child != null ? Number(supplement_per_child) : null,
       is_active !== undefined ? Boolean(is_active) : null, id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Meal plan not found")); }
    logActivity(req, { action: "update", entity: "meal_plan", entity_id: id, b_id: rows[0].b_id,
      summary: `Updated meal plan "${rows[0].plan_name}"` });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteMealPlan(req, res, next) {
  try {
    await assertInScope(req, res, { table: "MEAL_PLAN", idColumn: "plan_id", id: req.params.id });
    const doomed = await pool.query('SELECT plan_name, b_id FROM "MEAL_PLAN" WHERE plan_id = $1', [Number(req.params.id)]);
    const { rowCount } = await pool.query('DELETE FROM "MEAL_PLAN" WHERE plan_id = $1', [Number(req.params.id)]);
    if (!rowCount) { res.status(404); return next(new Error("Meal plan not found")); }
    logActivity(req, { action: "delete", entity: "meal_plan", entity_id: req.params.id,
      b_id: doomed.rows[0]?.b_id,
      summary: `Deleted meal plan "${doomed.rows[0]?.plan_name ?? req.params.id}"` });
    res.status(204).send();
  } catch (err) { next(err); }
}
