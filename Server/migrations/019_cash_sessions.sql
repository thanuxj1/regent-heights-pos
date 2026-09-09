-- =============================================================
-- 019_cash_sessions.sql — the drawer.
--
-- Everything built so far records what the system *thinks* happened: the sale,
-- who rang it, what was voided and by whose approval. Nothing ever counted the
-- money. A cashier could be a thousand rupees short every evening and no screen
-- in this system would notice, because nothing compared the drawer to the till.
--
-- Two tables and two columns:
--
--   CASH_SESSION   a shift at the till: opened with a declared float, closed
--                  with a physical count, and the difference between what
--                  should be there and what is.
--   CASH_MOVEMENT  cash in or out that is not a sale — paying a supplier from
--                  the drawer, a bank drop, putting change in.
--
-- The sale itself gains its tender and its shift, because a drawer count means
-- nothing unless you know which sales were cash and which shift they belong to.
-- =============================================================

CREATE TABLE IF NOT EXISTS "CASH_SESSION" (
  session_id     SERIAL PRIMARY KEY,
  b_id           INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,

  opened_by      INTEGER NOT NULL REFERENCES "User"(u_id),
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- What the cashier says is in the drawer at the start. Counted, not assumed.
  opening_float  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),

  closed_by      INTEGER REFERENCES "User"(u_id),
  closed_at      TIMESTAMPTZ,
  -- What was physically counted at the end.
  counted_cash   NUMERIC(12,2) CHECK (counted_cash >= 0),
  -- What the system says should have been there. Stored, not recomputed on
  -- read: a later refund or void must never quietly change what a closed shift
  -- was measured against.
  expected_cash  NUMERIC(12,2),
  -- counted - expected. Negative is short, positive is over. Both matter:
  -- a drawer that is always exactly right is itself worth a second look.
  variance       NUMERIC(12,2),

  -- A manager signs off a variance past the house limit, the same way a void
  -- is signed off.
  approved_by    INTEGER REFERENCES "User"(u_id),
  notes          VARCHAR(300),

  status         VARCHAR(10) NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'closed'))
);

-- One open drawer per person per property. Two open shifts for one cashier
-- means sales land in whichever the code happened to find, and neither count
-- can be trusted.
CREATE UNIQUE INDEX IF NOT EXISTS cash_session_one_open_per_user
  ON "CASH_SESSION" (b_id, opened_by) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_cash_session_branch_opened
  ON "CASH_SESSION" (b_id, opened_at DESC);


CREATE TABLE IF NOT EXISTS "CASH_MOVEMENT" (
  movement_id  SERIAL PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES "CASH_SESSION"(session_id) ON DELETE CASCADE,
  -- pay_in  : money put into the drawer (change float topped up)
  -- pay_out : money taken out to spend (a supplier paid in cash)
  -- drop    : money removed for safekeeping (taken to the safe or the bank)
  kind         VARCHAR(10) NOT NULL CHECK (kind IN ('pay_in', 'pay_out', 'drop')),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  -- Never optional. "Cash out 5,000" with no reason is indistinguishable from
  -- theft, and that is the whole point of writing it down.
  reason       VARCHAR(200) NOT NULL,
  created_by   INTEGER REFERENCES "User"(u_id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_movement_session
  ON "CASH_MOVEMENT" (session_id, created_at);


-- How the sale was paid. Until now the tender was recorded only if the cashier
-- happened to press "Pay" on the invoice screen afterwards — an optional step
-- on a different page, and the Payment table was empty in practice. Without
-- this, no drawer can ever be reconciled: you cannot separate the cash sales
-- from the card ones.
ALTER TABLE "ORDER"
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);

-- Which shift the sale belongs to. NULL means it was rung up with no drawer
-- open; the close-out surfaces those rather than letting them vanish.
ALTER TABLE "ORDER"
  ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES "CASH_SESSION"(session_id);

CREATE INDEX IF NOT EXISTS idx_order_session ON "ORDER" (session_id)
  WHERE session_id IS NOT NULL;
