-- 036 — a room payment taken in cash belongs to somebody's drawer, same as a sale.
--
-- The cash drawer's "what should be in it" total (utils/cashDrawer.js) only ever
-- read the ORDER table, so a guest's cash advance or settlement went into a real
-- drawer but never into the count. Every cashier who also works the front desk
-- would close their shift looking "over" by however much room cash they had
-- taken — the one direction a real shortfall never gets caught, because "over"
-- is waved through where "short" is investigated.
ALTER TABLE "BOOKING_PAYMENT" ADD COLUMN IF NOT EXISTS session_id INTEGER
  REFERENCES "CASH_SESSION"(session_id);
CREATE INDEX IF NOT EXISTS booking_payment_session_idx ON "BOOKING_PAYMENT" (session_id);
