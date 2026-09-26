import pool from "../config/database.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";

/**
 * Meal plan categories (Room Only, Bed & Breakfast, Half Board, Full
 * Board, or whatever else a property wants — RO/BB/HB/FB are just the
 * seeded defaults). The table (`MEAL_PLAN`) and the booking's FK to it
 * already existed; this is the CRUD nobody had ever built for it. Scoped
 * per branch, same as Room Types, since different properties in the same
 * company may want different plans and supplements.
 */

function readMealPlan(body, fallback = {}) {
  const plan_code = String(body.plan_code ?? fallback.plan_code ?? "").trim().toUpperCase();
  const plan_name = String(body.plan_name ?? fallback.plan_name ?? "").trim();
  const supplement_per_adult = body.supplement_per_adult !== undefined ? Number(body.supplement_per_adult) : Number(fallback.supplement_per_adult ?? 0);
  const supplement_per_child = body.supplement_per_child !== undefined ? Number(body.supplement_per_child) : Number(fallback.supplement_per_child ?? 0);
  const is_active = body.is_active !== undefined ? Boolean(body.is_active) : (fallback.is_active ?? true);

  if (!plan_code || plan_code.length > 10) {
    return { error: "plan_code is required and must be 10 characters or fewer", status: 400 };
  }
  if (!plan_name || plan_name.length > 60) {
    return { error: "plan_name is required and must be 60 characters or fewer", status: 400 };
  }
  if (!Number.isFinite(supplement_per_adult) || supplement_per_adult < 0) {
    return { error: "supplement_per_adult must be a non-negative number", status: 400 };
  }
  if (!Number.isFinite(supplement_per_child) || supplement_per_child < 0) {
    return { error: "supplement_per_child must be a non-negative number", status: 400 };
  }
  return { value: { plan_code, plan_name, supplement_per_adult, supplement_per_child, is_active } };
}

// GET /api/hotel/meal-plans?active=1
export async function getMealPlans(req, res, next) {
  try {
    const params = [];
    const clauses = [];
    const scope = branchClause(req, "b_id", params);
    if (scope) clauses.push(scope);
    if (req.query.active === "1" || req.query.active === "true") clauses.push(`is_active = TRUE`);
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    const { rows } = await pool.query(
      `SELECT * FROM "MEAL_PLAN" ${where} ORDER BY plan_name`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// POST /api/hotel/meal-plans
export async function createMealPlan(req, res, next) {
  try {
    const b_id = writeBranchId(req);
    if (!b_id) { res.status(400); return next(new Error("Choose the branch this meal plan belongs to.")); }

    const read = readMealPlan(req.body || {});
    if (read.error) { res.status(read.status); return next(new Error(read.error)); }
    const v = read.value;

    const { rows } = await pool.query(
      `INSERT INTO "MEAL_PLAN" (b_id, plan_code, plan_name, supplement_per_adult, supplement_per_child, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [Number(b_id), v.plan_code, v.plan_name, v.supplement_per_adult, v.supplement_per_child, v.is_active],
    );
    logActivity(req, {
      action: "create", entity: "meal_plan", entity_id: rows[0].plan_id, b_id,
      summary: `Added meal plan "${rows[0].plan_name}" (${rows[0].plan_code})`,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409);
      return next(new Error("This branch already has a meal plan with that code"));
    }
    next(err);
  }
}

// GET /api/hotel/meal-plans/:id/stats
export async function getMealPlanStats(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "MEAL_PLAN", idColumn: "plan_id", id });

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS bookings_count, COALESCE(SUM(meal_charges), 0) AS total_revenue
       FROM "BOOKING" WHERE meal_plan_id = $1`,
      [id],
    );
    res.json({
      bookings_count: rows[0].bookings_count,
      total_revenue: Number(rows[0].total_revenue),
    });
  } catch (err) { next(err); }
}

// PUT /api/hotel/meal-plans/:id
export async function updateMealPlan(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "MEAL_PLAN", idColumn: "plan_id", id });

    const current = await pool.query(`SELECT * FROM "MEAL_PLAN" WHERE plan_id = $1`, [id]);
    if (!current.rows.length) { res.status(404); return next(new Error("Meal plan not found")); }

    const read = readMealPlan(req.body || {}, current.rows[0]);
    if (read.error) { res.status(read.status); return next(new Error(read.error)); }
    const v = read.value;

    const { rows } = await pool.query(
      `UPDATE "MEAL_PLAN" SET
         plan_code = $1, plan_name = $2,
         supplement_per_adult = $3, supplement_per_child = $4, is_active = $5
       WHERE plan_id = $6
       RETURNING *`,
      [v.plan_code, v.plan_name, v.supplement_per_adult, v.supplement_per_child, v.is_active, id],
    );
    logActivity(req, {
      action: "update", entity: "meal_plan", entity_id: id, b_id: current.rows[0].b_id,
      summary: `Updated meal plan "${rows[0].plan_name}" (${rows[0].plan_code})`,
    });
    res.json(rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      res.status(409);
      return next(new Error("This branch already has a meal plan with that code"));
    }
    next(err);
  }
}
