import pool from "../config/database.js";
import { ROLES } from "../middleware/authMiddleware.js";
import { branchClause } from "../utils/scope.js";

/*
 * The delivery partners a "delivery" order can be attributed to
 * (PickMe, Uber Eats, foodpanda, or whatever else a manager adds). Real
 * rows now, not a hardcoded list — see migrations/043_delivery_partners.sql
 * for why, and for the seed that keeps today's four working unchanged.
 */

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 25) || "partner";
}

async function uniqueKey(com_id, name) {
  const base = slugify(name);
  let key = base;
  let n = 2;
  // Small table, small company — a loop here is cheap and never the
  // difference between fast and slow.
  while (true) {
    const { rows } = await pool.query(
      `SELECT 1 FROM "DELIVERY_PARTNER" WHERE com_id = $1 AND key = $2`,
      [com_id, key],
    );
    if (rows.length === 0) return key;
    key = `${base}_${n++}`;
  }
}

// GET /api/delivery-partners?active=1
export async function getDeliveryPartners(req, res, next) {
  try {
    const { role_id, com_id } = req.user;
    const params = [];
    const conditions = [];
    if (role_id !== ROLES.SUPER_ADMIN) {
      params.push(com_id);
      conditions.push(`com_id = $${params.length}`);
    }
    if (req.query.active === "1") conditions.push(`active = TRUE`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT partner_id, key, name, contact, active FROM "DELIVERY_PARTNER" ${where} ORDER BY name ASC`,
      params,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// POST /api/delivery-partners — { name, contact }
export async function createDeliveryPartner(req, res, next) {
  try {
    const { name, contact } = req.body || {};
    const trimmed = String(name || "").trim();
    if (!trimmed || trimmed.length < 2) {
      res.status(400);
      throw new Error("name must be at least 2 characters");
    }
    const com_id = req.user.com_id;
    if (!com_id) {
      res.status(400);
      throw new Error("Your account has no company to add a partner to");
    }
    const key = await uniqueKey(com_id, trimmed);

    const { rows } = await pool.query(
      `INSERT INTO "DELIVERY_PARTNER" (com_id, key, name, contact)
       VALUES ($1, $2, $3, $4)
       RETURNING partner_id, key, name, contact, active`,
      [com_id, key, trimmed, contact?.trim() || null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// PATCH /api/delivery-partners/:id — { name?, contact?, active? }
export async function updateDeliveryPartner(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400);
      throw new Error("Invalid partner id");
    }
    const { role_id, com_id } = req.user;
    const { name, contact, active } = req.body || {};

    const params = [
      name !== undefined ? (String(name).trim() || null) : null,
      contact !== undefined ? (String(contact).trim() || null) : null,
      typeof active === "boolean" ? active : null,
      id,
    ];
    let scope = "";
    if (role_id !== ROLES.SUPER_ADMIN) {
      params.push(com_id);
      scope = ` AND com_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `UPDATE "DELIVERY_PARTNER"
         SET name    = COALESCE($1, name),
             contact = COALESCE($2, contact),
             active  = COALESCE($3, active)
       WHERE partner_id = $4${scope}
       RETURNING partner_id, key, name, contact, active`,
      params,
    );
    if (rows.length === 0) {
      res.status(404);
      throw new Error("Partner not found");
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/delivery-partners/:id
export async function deleteDeliveryPartner(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400);
      throw new Error("Invalid partner id");
    }
    const { role_id, com_id } = req.user;

    const params = [id];
    let scope = "";
    if (role_id !== ROLES.SUPER_ADMIN) {
      params.push(com_id);
      scope = ` AND com_id = $${params.length}`;
    }

    const existing = await pool.query(
      `SELECT partner_id, key, name FROM "DELIVERY_PARTNER" WHERE partner_id = $1${scope}`,
      params,
    );
    if (existing.rows.length === 0) {
      res.status(404);
      throw new Error("Partner not found");
    }
    const { key, name } = existing.rows[0];

    // Refuse rather than orphan an order or settlement's reference to this
    // partner. The owner should keep the partner (just deactivate it) if
    // it has real history — deleting it should only ever clear a mistake.
    const inUse = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM "ORDER" WHERE delivery_partner = $1) AS orders,
         (SELECT COUNT(*)::int FROM "DELIVERY_COD_SETTLEMENT" WHERE delivery_partner = $1) AS settlements`,
      [key],
    );
    const { orders, settlements } = inUse.rows[0];
    if (orders > 0 || settlements > 0) {
      res.status(409);
      throw new Error(
        `"${name}" still has ${orders} order(s) and ${settlements} settlement(s) against it. ` +
        "Deactivate it instead of deleting it.",
      );
    }

    await pool.query(`DELETE FROM "DELIVERY_PARTNER" WHERE partner_id = $1`, [id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// GET /api/delivery-partners/:key/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function getDeliveryPartnerAnalytics(req, res, next) {
  try {
    const key = req.params.key;

    const parseDate = (s) => {
      const d = s ? new Date(`${s}T00:00:00`) : null;
      return d && !Number.isNaN(d.getTime()) ? d : null;
    };
    const fmtDate = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    let from = parseDate(req.query.from) || startOfMonth;
    let to = parseDate(req.query.to) || today;
    if (from > to) [from, to] = [to, from];
    // A custom range still can't ask for a decade of daily rows.
    const MAX_DAYS = 366;
    if (Math.round((to - from) / 86400000) > MAX_DAYS) {
      from = new Date(to.getTime() - MAX_DAYS * 86400000);
    }
    const fromStr = fmtDate(from);
    const toStr = fmtDate(to);

    const totalsParams = [key];
    const totalsScope = branchClause(req, "b_id", totalsParams);
    const { rows: totalsRows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE or_status <> 'cancelled') AS total_orders,
         COALESCE(SUM("or_totalCostWtax") FILTER (WHERE payment_method = 'cod' AND or_status <> 'cancelled'), 0) AS lifetime_cod,
         COALESCE(SUM("or_totalCostWtax") FILTER (WHERE payment_method = 'cod' AND cod_settlement_id IS NULL AND or_status <> 'cancelled'), 0) AS outstanding
       FROM "ORDER"
       WHERE or_type = 'delivery' AND delivery_partner = $1${totalsScope ? ` AND ${totalsScope}` : ""}`,
      totalsParams,
    );

    const settledParams = [key];
    const settledScope = branchClause(req, "b_id", settledParams);
    const { rows: settledRows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS lifetime_settled
       FROM "DELIVERY_COD_SETTLEMENT"
       WHERE delivery_partner = $1${settledScope ? ` AND ${settledScope}` : ""}`,
      settledParams,
    );

    const trendParams = [key, fromStr, toStr];
    const trendScope = branchClause(req, "b_id", trendParams);
    const { rows: trendRows } = await pool.query(
      `SELECT to_char(date_trunc('day', or_date), 'YYYY-MM-DD') AS day,
              COALESCE(SUM("or_totalCostWtax"), 0) AS total
       FROM "ORDER"
       WHERE or_type = 'delivery' AND delivery_partner = $1 AND payment_method = 'cod'
         AND or_status <> 'cancelled'
         AND or_date >= $2::date AND or_date < ($3::date + INTERVAL '1 day')
         ${trendScope ? ` AND ${trendScope}` : ""}
       GROUP BY 1 ORDER BY 1`,
      trendParams,
    );

    // Zero-fill every day in range — a quiet day should read as 0, not vanish.
    const byDay = new Map(trendRows.map((r) => [r.day, Number(r.total)]));
    const trend = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dayKey = fmtDate(d);
      trend.push({ day: dayKey, total: byDay.get(dayKey) || 0 });
    }

    res.json({
      total_orders: Number(totalsRows[0].total_orders),
      lifetime_cod: Number(totalsRows[0].lifetime_cod),
      outstanding: Number(totalsRows[0].outstanding),
      lifetime_settled: Number(settledRows[0].lifetime_settled),
      from: fromStr,
      to: toStr,
      trend,
    });
  } catch (err) {
    next(err);
  }
}
