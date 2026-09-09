import pool from "../config/database.js";
import { writeBranchId, branchClause } from "../utils/scope.js";
import { logActivity } from "../utils/activityLog.js";
import { requireApproval } from "../utils/approval.js";
import { moneyField, textField } from "../utils/validate.js";
import {
  sessionTotals, expectedCash, varianceNeedsApproval, describeVariance, VARIANCE_LIMIT,
} from "../utils/cashDrawer.js";

/**
 * The cash drawer: opening a shift, what is in it now, and counting it down.
 *
 * Every figure a cashier is asked to trust is shown with its working, and the
 * count is taken *before* the expected figure is revealed — see closeSession.
 */

/** The caller's own open shift, if they have one. */
async function openSessionFor(u_id, b_id, db = pool) {
  const { rows } = await db.query(
    `SELECT * FROM "CASH_SESSION"
     WHERE opened_by = $1 AND b_id = $2 AND status = 'open'`,
    [Number(u_id), Number(b_id)],
  );
  return rows[0] || null;
}

/**
 * GET /api/cash/session — is a drawer open, and what is in it?
 *
 * The till calls this on load so it can prompt for a float rather than letting
 * a cashier ring up an hour of cash sales that belong to no shift.
 */
export async function getCurrentSession(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.query.b_id);
    const session = await openSessionFor(req.user.u_id, b_id);
    if (!session) {
      return res.json({ open: false, variance_limit: VARIANCE_LIMIT });
    }

    const totals = await sessionTotals(pool, session.session_id);
    const expected = expectedCash(session.opening_float, totals);

    // Sales rung up with no drawer open. Surfaced rather than swallowed: they
    // are real money that belongs to somebody's count.
    const { rows: orphan } = await pool.query(
      `SELECT COALESCE(SUM("or_totalCostWtax"), 0) AS value, COUNT(*) AS n
       FROM "ORDER"
       WHERE b_id = $1 AND u_id = $2 AND session_id IS NULL
         AND payment_method = 'cash' AND or_status <> 'cancelled'
         AND or_date >= CURRENT_DATE - 1`,
      [b_id, req.user.u_id],
    );

    res.json({
      open: true,
      session,
      totals,
      expected_cash: expected,
      variance_limit: VARIANCE_LIMIT,
      unassigned_cash: {
        value: Number(orphan[0].value),
        orders: Number(orphan[0].n),
      },
    });
  } catch (err) { next(err); }
}

/**
 * POST /api/cash/session/open — start a shift with a counted float.
 */
export async function openSession(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.body.b_id);
    if (!b_id) { res.status(400); return next(new Error("No property for this drawer")); }

    const existing = await openSessionFor(req.user.u_id, b_id);
    if (existing) {
      res.status(409);
      return next(new Error(
        "You already have a drawer open. Close it before starting another."));
    }

    const float = moneyField(req.body.opening_float ?? 0, "Opening float");
    const notes = textField(req.body.notes, "Notes", 300);

    const { rows } = await pool.query(
      `INSERT INTO "CASH_SESSION" (b_id, opened_by, opening_float, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [b_id, req.user.u_id, float, notes],
    );

    logActivity(req, {
      action: "create", entity: "cash_session", entity_id: rows[0].session_id, b_id,
      summary: `Opened the till with a float of ${Number(float).toFixed(2)}`,
      details: { opening_float: float },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

/**
 * POST /api/cash/session/movement — cash in or out that is not a sale.
 */
export async function addMovement(req, res, next) {
  try {
    const b_id = writeBranchId(req, req.body.b_id);
    const session = await openSessionFor(req.user.u_id, b_id);
    if (!session) {
      res.status(409);
      return next(new Error("No drawer is open, so there is nothing to take money out of."));
    }

    const kind = String(req.body.kind || "").trim();
    if (!["pay_in", "pay_out", "drop"].includes(kind)) {
      res.status(400);
      return next(new Error("Movement must be a pay in, a pay out, or a drop to the safe."));
    }

    const amount = moneyField(req.body.amount, "Amount");
    if (!(amount > 0)) {
      res.status(400); return next(new Error("Amount must be more than zero."));
    }

    // Required by the table, and required here so the message is a sentence a
    // cashier understands rather than a constraint violation.
    const reason = textField(req.body.reason, "Reason", 200);
    if (!reason) {
      res.status(400);
      return next(new Error("Say what the money is for — every movement needs a reason."));
    }

    // Taking out more than is in the drawer is either a mistake or a story
    // worth hearing before the money leaves.
    if (kind !== "pay_in") {
      const totals = await sessionTotals(pool, session.session_id);
      const inDrawer = expectedCash(session.opening_float, totals);
      if (amount > inDrawer + 0.01) {
        res.status(400);
        return next(new Error(
          `Only ${inDrawer.toFixed(2)} should be in the drawer; you cannot take out ${amount.toFixed(2)}.`));
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO "CASH_MOVEMENT" (session_id, kind, amount, reason, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [session.session_id, kind, amount, reason, req.user.u_id],
    );

    const verb = kind === "pay_in" ? "Put" : kind === "drop" ? "Dropped" : "Took";
    logActivity(req, {
      action: "update", entity: "cash_session", entity_id: session.session_id, b_id,
      summary: `${verb} ${amount.toFixed(2)} ${kind === "pay_in" ? "into" : "out of"} the till — ${reason}`,
      details: { kind, amount, reason },
    });

    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

/**
 * POST /api/cash/session/close — count the drawer and close the shift.
 *
 * The counted figure is required in the request. The expected figure is only
 * returned in the response — a cashier who can see the target before counting
 * is being invited to write the target down, and a drawer that always balances
 * to the rupee tells the owner nothing.
 */
export async function closeSession(req, res, next) {
  const client = await pool.connect();
  try {
    const b_id = writeBranchId(req, req.body.b_id);
    const session = await openSessionFor(req.user.u_id, b_id, client);
    if (!session) {
      res.status(409);
      return next(new Error("You have no drawer open to close."));
    }

    if (req.body.counted_cash === undefined || req.body.counted_cash === null) {
      res.status(400);
      return next(new Error("Count the drawer and enter the total before closing."));
    }
    const counted = moneyField(req.body.counted_cash, "Counted cash");
    const notes = textField(req.body.notes, "Notes", 300);

    const totals = await sessionTotals(client, session.session_id);
    const expected = expectedCash(session.opening_float, totals);
    const variance = +(counted - expected).toFixed(2);

    // A shortage past the limit is not something the person who is short gets
    // to wave through on their own.
    let approver = null;
    if (varianceNeedsApproval(variance)) {
      const approval = await requireApproval(req, {
        pin: req.body.approval_pin,
        b_id,
        what: `close a drawer that is ${variance < 0 ? "short" : "over"} by `
            + `${Math.abs(variance).toFixed(2)}`,
      });
      if (!approval.ok) {
        return res.status(approval.status).json({
          success: false,
          error: approval.message,
          // Enough for the screen to explain itself without revealing the
          // expected figure before the count was submitted — it already was.
          needs_approval: true,
          variance,
          variance_limit: VARIANCE_LIMIT,
        });
      }
      approver = approval.approver?.u_id ?? null;
    }

    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE "CASH_SESSION"
       SET status = 'closed', closed_by = $2, closed_at = NOW(),
           counted_cash = $3, expected_cash = $4, variance = $5,
           approved_by = $6, notes = COALESCE($7, notes)
       WHERE session_id = $1 AND status = 'open'
       RETURNING *`,
      [session.session_id, req.user.u_id, counted, expected, variance, approver, notes],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      res.status(409);
      return next(new Error("That drawer was closed by someone else a moment ago."));
    }
    await client.query("COMMIT");

    const verdict = describeVariance(variance);
    logActivity(req, {
      action: "update", entity: "cash_session", entity_id: session.session_id, b_id,
      summary: `Closed the till — counted ${counted.toFixed(2)}, expected ${expected.toFixed(2)}. ${verdict.text}`,
      details: {
        opening_float: Number(session.opening_float), counted, expected, variance,
        ...totals, approved_by: approver,
      },
    });

    res.json({ session: rows[0], totals, expected_cash: expected, variance, verdict });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

/**
 * GET /api/cash/sessions — the owner's view: every shift, and how each counted.
 */
export async function listSessions(req, res, next) {
  try {
    const params = [];
    const clauses = [];
    const scope = branchClause(req, "s.b_id", params);
    if (scope) clauses.push(scope);
    if (req.query.from) { params.push(req.query.from); clauses.push(`s.opened_at >= $${params.length}::date`); }
    if (req.query.to)   { params.push(req.query.to);   clauses.push(`s.opened_at < ($${params.length}::date + 1)`); }
    if (req.query.status) { params.push(req.query.status); clauses.push(`s.status = $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT s.*,
              TRIM(COALESCE(o.u_fname,'') || ' ' || COALESCE(o.u_lname,'')) AS opened_by_name,
              TRIM(COALESCE(a.u_fname,'') || ' ' || COALESCE(a.u_lname,'')) AS approved_by_name
       FROM "CASH_SESSION" s
       LEFT JOIN "User" o ON o.u_id = s.opened_by
       LEFT JOIN "User" a ON a.u_id = s.approved_by
       ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""}
       ORDER BY s.opened_at DESC
       LIMIT 200`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
}

/** GET /api/cash/sessions/:id — one shift with its sales and movements. */
export async function getSession(req, res, next) {
  try {
    const id = Number(req.params.id);
    const params = [id];
    const scope = branchClause(req, "s.b_id", params);
    const { rows } = await pool.query(
      `SELECT s.* FROM "CASH_SESSION" s
       WHERE s.session_id = $1 ${scope ? "AND " + scope : ""}`,
      params,
    );
    if (!rows.length) { res.status(404); return next(new Error("Not found")); }

    const session = rows[0];
    const [totals, movements, orders] = await Promise.all([
      sessionTotals(pool, id),
      pool.query(
        `SELECT m.*, TRIM(COALESCE(u.u_fname,'') || ' ' || COALESCE(u.u_lname,'')) AS by_name
         FROM "CASH_MOVEMENT" m
         LEFT JOIN "User" u ON u.u_id = m.created_by
         WHERE m.session_id = $1 ORDER BY m.created_at`, [id]),
      pool.query(
        `SELECT or_id, "or_totalCostWtax" AS total, payment_method, or_status, or_time
         FROM "ORDER" WHERE session_id = $1 ORDER BY or_id`, [id]),
    ]);

    res.json({
      session,
      totals,
      movements: movements.rows,
      orders: orders.rows,
      // A closed shift keeps the figure it was measured against; an open one is
      // worked out live.
      expected_cash: session.status === "closed"
        ? Number(session.expected_cash)
        : expectedCash(session.opening_float, totals),
    });
  } catch (err) { next(err); }
}
