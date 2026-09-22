import pool from "../config/database.js";
import { syncBookingCommission } from "../utils/commission.js";
import { branchClause, writeBranchId, assertInScope } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";
import { hotelToday } from "../utils/hotelTime.js";
import { pctField, moneyField, textField, emailField, dateField, oneOf, invalid } from "../utils/validate.js";

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

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
    const b_id = writeBranchId(req);
    const name = textField(req.body.agent_name, "Agent name", 100, { required: true });
    const phone = textField(req.body.agent_phone, "Phone", 30);
    const email = emailField(req.body.agent_email);
    // A typed 0 is a real rate. `commission_rate || 10` turned it into ten percent.
    const rate = pctField(req.body.commission_rate, "Commission rate", 0);
    const notes = textField(req.body.notes, "Notes", 500);
    const { rows } = await pool.query(
      `INSERT INTO "COMMISSION_AGENT" (agent_name, agent_phone, agent_email, b_id, commission_rate, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, phone, email, b_id||null, rate, notes]
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
    const cur = await pool.query('SELECT * FROM "COMMISSION_AGENT" WHERE agent_id = $1', [id]);
    if (!cur.rows.length) { res.status(404); return next(new Error("Agent not found")); }
    const was = cur.rows[0];
    const b_id = writeBranchId(req);

    // What is sent replaces what is there, blanks included; a 0% rate is a rate.
    // COALESCE kept the old value for both, so neither could be changed.
    const name = has(req.body, "agent_name") ? textField(req.body.agent_name, "Agent name", 100, { required: true }) : was.agent_name;
    const phone = has(req.body, "agent_phone") ? textField(req.body.agent_phone, "Phone", 30) : was.agent_phone;
    const email = has(req.body, "agent_email") ? emailField(req.body.agent_email) : was.agent_email;
    const rate = has(req.body, "commission_rate") ? pctField(req.body.commission_rate, "Commission rate", Number(was.commission_rate)) : Number(was.commission_rate);
    const notes = has(req.body, "notes") ? textField(req.body.notes, "Notes", 500) : was.notes;

    const { rows } = await pool.query(
      `UPDATE "COMMISSION_AGENT"
       SET agent_name = $1, agent_phone = $2, agent_email = $3, b_id = COALESCE($4, b_id),
           commission_rate = $5, notes = $6
       WHERE agent_id = $7 RETURNING *`,
      [name, phone, email, b_id||null, rate, notes, id]
    );

    // A new rate applies to everything not yet paid out. Records already marked
    // paid keep the figure the money was actually sent against.
    if (has(req.body, "commission_rate")) {
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
    const { agent_id, order_id } = req.body;
    if (!agent_id) { res.status(400); return next(new Error("Choose the agent this commission is for.")); }
    // A record can only hang off an agent this branch owns.
    await assertInScope(req, res, { table: "COMMISSION_AGENT", idColumn: "agent_id", id: agent_id });
    const amount = moneyField(req.body.commission_amount, "Commission amount", { min: 0.01, max: 99999999.99 });
    if (!(amount > 0)) invalid("Enter the commission amount.");
    const date = dateField(req.body.record_date, "Date") || hotelToday();
    const status = oneOf(req.body.status, "Status", ["pending", "paid"], "pending");
    const notes = textField(req.body.notes, "Notes", 500);
    const { rows } = await pool.query(
      `INSERT INTO "COMMISSION_RECORD" (agent_id, order_id, commission_amount, record_date, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [Number(agent_id), order_id||null, amount, date, notes, status]
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
    const cur = await pool.query('SELECT * FROM "COMMISSION_RECORD" WHERE record_id = $1', [id]);
    const was = cur.rows[0];
    let amount = was.commission_amount;
    if (has(req.body, "commission_amount")) {
      amount = moneyField(req.body.commission_amount, "Commission amount", { min: 0.01, max: 99999999.99 });
      if (!(amount > 0)) invalid("Enter the commission amount.");
    }
    const date = has(req.body, "record_date") ? dateField(req.body.record_date, "Date") : null;
    const status = has(req.body, "status") ? oneOf(req.body.status, "Status", ["pending", "paid"], was.status) : was.status;
    const notes = has(req.body, "notes") ? textField(req.body.notes, "Notes", 500) : was.notes;
    const { rows } = await pool.query(
      `UPDATE "COMMISSION_RECORD"
       SET commission_amount = $1, record_date = COALESCE($2, record_date), notes = $3, status = $4
       WHERE record_id = $5 RETURNING *`,
      [amount, date, notes, status, id]
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
