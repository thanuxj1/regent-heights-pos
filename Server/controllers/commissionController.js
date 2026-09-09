import pool from "../config/database.js";
import { syncBookingCommission } from "../utils/commission.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";

// ─── Agents ──────────────────────────────────────────────────────────────────

export async function getAgents(req, res, next) {
  try {
    const params = [];
    let where = "";
    const scope = branchClause(req, "a.b_id", params);
    if (scope) where = "WHERE " + scope;

    const { rows } = await pool.query(
      `SELECT a.*,
              COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status = 'pending'), 0) AS pending_total,
              COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status = 'paid'),    0) AS paid_total,
              COALESCE(SUM(r.commission_amount), 0)                                     AS all_time_total
       FROM "COMMISSION_AGENT" a
       LEFT JOIN "COMMISSION_RECORD" r ON r.agent_id = a.agent_id
       ${where}
       GROUP BY a.agent_id
       ORDER BY a.agent_name`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getAgentById(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "COMMISSION_AGENT", idColumn: "agent_id", id });
    const { rows } = await pool.query(
      `SELECT a.*,
              COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status = 'pending'), 0) AS pending_total,
              COALESCE(SUM(r.commission_amount) FILTER (WHERE r.status = 'paid'),    0) AS paid_total,
              COALESCE(SUM(r.commission_amount), 0) AS all_time_total
       FROM "COMMISSION_AGENT" a
       LEFT JOIN "COMMISSION_RECORD" r ON r.agent_id = a.agent_id
       WHERE a.agent_id = $1
       GROUP BY a.agent_id`,
      [id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Agent not found")); }
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function createAgent(req, res, next) {
  try {
    const { agent_name, agent_phone, agent_email, commission_rate, notes } = req.body;
    const b_id = writeBranchId(req);
    if (!agent_name?.trim()) { res.status(400); return next(new Error("agent_name is required")); }
    const { rows } = await pool.query(
      `INSERT INTO "COMMISSION_AGENT" (agent_name, agent_phone, agent_email, b_id, commission_rate, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [agent_name.trim(), agent_phone||null, agent_email||null, b_id||null, commission_rate||10, notes||null]
    );
    logActivity(req, { action: "create", entity: "commission_agent", entity_id: rows[0].agent_id, b_id,
      summary: `Added commission agent ${rows[0].agent_name} at ${rows[0].commission_rate}%` });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateAgent(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "COMMISSION_AGENT", idColumn: "agent_id", id });
    const { agent_name, agent_phone, agent_email, commission_rate, notes } = req.body;
    const b_id = writeBranchId(req);
    const { rows } = await pool.query(
      `UPDATE "COMMISSION_AGENT"
       SET agent_name      = COALESCE($1, agent_name),
           agent_phone     = COALESCE($2, agent_phone),
           agent_email     = COALESCE($3, agent_email),
           b_id            = COALESCE($4, b_id),
           commission_rate = COALESCE($5, commission_rate),
           notes           = COALESCE($6, notes)
       WHERE agent_id = $7 RETURNING *`,
      [agent_name||null, agent_phone||null, agent_email||null, b_id||null, commission_rate||null, notes||null, id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Agent not found")); }

    // A new rate applies to everything not yet paid out. Records already marked
    // paid keep the figure the money was actually sent against.
    if (commission_rate != null) {
      const pending = await pool.query(
        `SELECT booking_id FROM "COMMISSION_RECORD"
         WHERE agent_id = $1 AND booking_id IS NOT NULL AND status = 'pending'`, [id]
      );
      for (const r of pending.rows) await syncBookingCommission(pool, r.booking_id);
    }

    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteAgent(req, res, next) {
  try {
    const id = Number(req.params.id);
    await assertInScope(req, res, { table: "COMMISSION_AGENT", idColumn: "agent_id", id });
    const doomed = await pool.query('SELECT agent_name, b_id FROM "COMMISSION_AGENT" WHERE agent_id = $1', [id]);
    const { rowCount } = await pool.query('DELETE FROM "COMMISSION_AGENT" WHERE agent_id = $1', [id]);
    if (!rowCount) { res.status(404); return next(new Error("Agent not found")); }
    logActivity(req, { action: "delete", entity: "commission_agent", entity_id: id,
      b_id: doomed.rows[0]?.b_id,
      summary: `Deleted commission agent ${doomed.rows[0]?.agent_name ?? id}` });
    res.status(204).send();
  } catch (err) { next(err); }
}

// ─── Commission Records ───────────────────────────────────────────────────────

export async function getRecords(req, res, next) {
  try {
    const { agent_id, month } = req.query;
    const params = [];
    const clauses = [];

    const scope = branchClause(req, "a.b_id", params);
    if (scope) clauses.push(scope);
    if (agent_id) { params.push(Number(agent_id)); clauses.push(`r.agent_id = $${params.length}`); }
    if (month)    { params.push(month);             clauses.push(`to_char(r.record_date, 'YYYY-MM') = $${params.length}`); }

    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    const { rows } = await pool.query(
      `SELECT r.*, a.agent_name, a.commission_rate,
              b.booking_ref, b.status AS booking_status,
              b.check_in_date, b.check_out_date, b.room_charges,
              g.full_name AS guest_name
       FROM "COMMISSION_RECORD" r
       JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
       LEFT JOIN "BOOKING" b ON b.booking_id = r.booking_id
       LEFT JOIN "GUEST" g   ON g.guest_id = b.guest_id
       ${where}
       ORDER BY r.record_date DESC, r.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}

export async function createRecord(req, res, next) {
  try {
    const { agent_id, order_id, commission_amount, record_date, notes, status } = req.body;
    if (!agent_id || commission_amount === undefined) {
      res.status(400); return next(new Error("agent_id and commission_amount are required"));
    }
    // A record can only hang off an agent this branch owns.
    await assertInScope(req, res, { table: "COMMISSION_AGENT", idColumn: "agent_id", id: agent_id });
    const { rows } = await pool.query(
      `INSERT INTO "COMMISSION_RECORD" (agent_id, order_id, commission_amount, record_date, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [Number(agent_id), order_id||null, Number(commission_amount), record_date||new Date().toISOString().split("T")[0], notes||null, status||"pending"]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateRecord(req, res, next) {
  try {
    const id = Number(req.params.id);
    // The record's branch comes from its agent; check that before touching it.
    const owner = await pool.query(
      'SELECT agent_id FROM "COMMISSION_RECORD" WHERE record_id = $1', [id]
    );
    if (!owner.rows.length) { res.status(404); return next(new Error("Record not found")); }
    await assertInScope(req, res, { table: "COMMISSION_AGENT", idColumn: "agent_id", id: owner.rows[0].agent_id });
    const { commission_amount, record_date, notes, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE "COMMISSION_RECORD"
       SET commission_amount = COALESCE($1, commission_amount),
           record_date       = COALESCE($2, record_date),
           notes             = COALESCE($3, notes),
           status            = COALESCE($4, status)
       WHERE record_id = $5 RETURNING *`,
      [commission_amount||null, record_date||null, notes||null, status||null, id]
    );
    if (!rows.length) { res.status(404); return next(new Error("Record not found")); }
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteRecord(req, res, next) {
  try {
    const id = Number(req.params.id);
    // The record's branch comes from its agent; check that before touching it.
    const owner = await pool.query(
      'SELECT agent_id FROM "COMMISSION_RECORD" WHERE record_id = $1', [id]
    );
    if (!owner.rows.length) { res.status(404); return next(new Error("Record not found")); }
    await assertInScope(req, res, { table: "COMMISSION_AGENT", idColumn: "agent_id", id: owner.rows[0].agent_id });
    const { rowCount } = await pool.query('DELETE FROM "COMMISSION_RECORD" WHERE record_id = $1', [id]);
    if (!rowCount) { res.status(404); return next(new Error("Record not found")); }
    res.status(204).send();
  } catch (err) { next(err); }
}

// ─── Monthly Summary ─────────────────────────────────────────────────────────

export async function getMonthlySummary(req, res, next) {
  try {
    const { agent_id } = req.query;
    const params = [];
    const clauses = [];
    const scope = branchClause(req, "a.b_id", params);
    if (scope) clauses.push(scope);
    if (agent_id) { params.push(Number(agent_id)); clauses.push(`r.agent_id = $${params.length}`); }
    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

    const { rows } = await pool.query(
      `SELECT to_char(r.record_date, 'YYYY-MM') AS month,
              SUM(r.commission_amount)                                         AS total,
              SUM(r.commission_amount) FILTER (WHERE r.status = 'paid')       AS paid,
              SUM(r.commission_amount) FILTER (WHERE r.status = 'pending')    AS pending,
              COUNT(*)                                                          AS records
       FROM "COMMISSION_RECORD" r
       JOIN "COMMISSION_AGENT" a ON a.agent_id = r.agent_id
       ${where}
       GROUP BY month
       ORDER BY month DESC
       LIMIT 12`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
}
