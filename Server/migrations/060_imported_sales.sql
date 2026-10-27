-- Sales from before the system went live, typed in from the property's old
-- daily summary sheets.
--
-- Those sheets hold one total per department per day, with no orders, guests,
-- items or payment methods behind them. They are kept here, apart from the
-- live tables, so they never turn into made-up orders or bookings: the cash
-- drawer, Transactions, stock, guests and the Activity Log never see them.
-- Only Reports reads them, adding each day's figures to the hotel or
-- restaurant side as the sheet's column says (reportController.getSummary).
--
-- line is the sheet's own column name ("Room revenue", "Café", ...), so the
-- original split is kept even where the live system has no such line.
CREATE TABLE IF NOT EXISTS "IMPORTED_SALES" (
  id          SERIAL PRIMARY KEY,
  b_id        INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  sale_date   DATE NOT NULL,
  department  VARCHAR(20) NOT NULL CHECK (department IN ('hotel', 'restaurant')),
  line        VARCHAR(60) NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  source      VARCHAR(120) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (b_id, sale_date, line)
);

CREATE INDEX IF NOT EXISTS imported_sales_branch_date ON "IMPORTED_SALES" (b_id, sale_date);
