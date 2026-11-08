-- The bank book: money paid into and taken out of the property's bank account.
--
-- A debit (money out) is a cheque withdrawal, which carries its cheque number,
-- or a bank transfer, which is an online payment or a supplier payment.
-- A credit (money in) is filed under a category: "Sales cash deposit" and
-- "MD cash deposit" are built in; a property adds its own in BANK_CATEGORY.
-- The category is stored by name on each entry, as expense categories are.
--
-- These are movements of money already counted elsewhere (a sales deposit is
-- sales the till took), so nothing here enters revenue, expenses or profit.
CREATE TABLE IF NOT EXISTS "BANK_CATEGORY" (
  cat_id      SERIAL PRIMARY KEY,
  b_id        INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  name        VARCHAR(40) NOT NULL,
  created_by  INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_category_name ON "BANK_CATEGORY" (b_id, lower(name));

CREATE TABLE IF NOT EXISTS "BANK_TRANSACTION" (
  bt_id        SERIAL PRIMARY KEY,
  b_id         INTEGER REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  bt_date      DATE NOT NULL,
  bt_type      VARCHAR(6) NOT NULL CHECK (bt_type IN ('debit', 'credit')),
  -- Debit only: how the money left the account.
  bt_method    VARCHAR(20) CHECK (bt_method IN ('cheque_withdrawal', 'bank_transfer')),
  -- Bank transfer only: what it paid for.
  bt_transfer  VARCHAR(20) CHECK (bt_transfer IN ('online_payment', 'supplier_payment')),
  bt_cheque_no VARCHAR(30),
  -- Credit only: what was paid in.
  bt_category  VARCHAR(40),
  bt_amount    NUMERIC(12,2) NOT NULL CHECK (bt_amount > 0),
  bt_note      VARCHAR(500),
  created_by   INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_txn_shape CHECK (
    (bt_type = 'debit' AND bt_category IS NULL AND (
        (bt_method = 'cheque_withdrawal' AND bt_cheque_no IS NOT NULL AND bt_transfer IS NULL)
     OR (bt_method = 'bank_transfer' AND bt_transfer IS NOT NULL AND bt_cheque_no IS NULL)))
    OR
    (bt_type = 'credit' AND bt_category IS NOT NULL AND bt_method IS NULL AND bt_transfer IS NULL AND bt_cheque_no IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS bank_txn_branch_date ON "BANK_TRANSACTION" (b_id, bt_date DESC);
