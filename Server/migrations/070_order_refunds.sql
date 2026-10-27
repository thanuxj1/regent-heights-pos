-- Money handed back to a restaurant customer after they paid.
--
-- The hotel has always had this (a BOOKING_PAYMENT of kind 'refund'); the
-- restaurant had only a void or a delete, both all-or-nothing and both meant
-- for a sale that should never have been rung up. A refund is for a sale that
-- did happen: a dish sent back, a drink never brought, a customer overcharged.
--
-- Counted on the day the money went back (refund_date, the hotel's day), the
-- same cash basis the reports use for everything else: it comes off restaurant
-- revenue that day, out of the cash drawer of whoever handed it back if it was
-- cash, and shows in Transactions as money out. The sale itself is untouched.
CREATE TABLE IF NOT EXISTS "ORDER_REFUND" (
  refund_id    SERIAL PRIMARY KEY,
  or_id        INTEGER NOT NULL REFERENCES "ORDER"(or_id) ON DELETE CASCADE,
  b_id         INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method       VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'online')),
  reason       VARCHAR(200) NOT NULL,
  refund_date  DATE NOT NULL,
  refunded_by  INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  approved_by  INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  session_id   INTEGER REFERENCES "CASH_SESSION"(session_id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS order_refund_order ON "ORDER_REFUND" (or_id);
CREATE INDEX IF NOT EXISTS order_refund_branch_date ON "ORDER_REFUND" (b_id, refund_date);
CREATE INDEX IF NOT EXISTS order_refund_session ON "ORDER_REFUND" (session_id);

-- Which dishes were handed back, when the refund was for particular ones
-- (a refund can also be just an amount). Product Profit takes these off the
-- dish's sales; what it cost to make stays, since it was made.
CREATE TABLE IF NOT EXISTS "ORDER_REFUND_ITEM" (
  refund_id      INTEGER NOT NULL REFERENCES "ORDER_REFUND"(refund_id) ON DELETE CASCADE,
  "orderItem_id" INTEGER NOT NULL REFERENCES "ORDER_ITEM"("orderItem_id") ON DELETE CASCADE,
  qty            NUMERIC(10, 2) NOT NULL CHECK (qty > 0),
  amount         NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (refund_id, "orderItem_id")
);
