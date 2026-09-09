-- Commission Agents: tourist guides, travel agents who bring customers
CREATE TABLE IF NOT EXISTS "COMMISSION_AGENT" (
  agent_id       SERIAL PRIMARY KEY,
  agent_name     VARCHAR(100) NOT NULL,
  agent_phone    VARCHAR(20),
  agent_email    VARCHAR(100),
  b_id           INTEGER REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Commission Records: per-order or manual commission entries
CREATE TABLE IF NOT EXISTS "COMMISSION_RECORD" (
  record_id         SERIAL PRIMARY KEY,
  agent_id          INTEGER NOT NULL REFERENCES "COMMISSION_AGENT"(agent_id) ON DELETE CASCADE,
  order_id          INTEGER REFERENCES "ORDER"(or_id) ON DELETE SET NULL,
  commission_amount NUMERIC(10,2) NOT NULL CHECK (commission_amount >= 0),
  record_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  notes             TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expense Tracking
CREATE TABLE IF NOT EXISTS "EXPENSE" (
  exp_id          SERIAL PRIMARY KEY,
  b_id            INTEGER REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  exp_category    VARCHAR(50) NOT NULL,
  exp_amount      NUMERIC(10,2) NOT NULL CHECK (exp_amount > 0),
  exp_description TEXT,
  exp_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by      INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_commission_record_agent ON "COMMISSION_RECORD"(agent_id);
CREATE INDEX IF NOT EXISTS idx_commission_record_date  ON "COMMISSION_RECORD"(record_date);
CREATE INDEX IF NOT EXISTS idx_expense_branch_date     ON "EXPENSE"(b_id, exp_date);
