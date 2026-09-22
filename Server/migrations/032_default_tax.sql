-- ─── Migration 032: no tax unless the hotel says so ─────────────────────────
-- New bookings started with 10% tax whether or not the hotel charges any: the form
-- opened on 10, and both the server and the BOOKING column fell back to 10.00.
-- A hotel that does not charge tax was quietly billing it until someone noticed and
-- typed 0 on every booking.
--
-- The hotel's own rate now lives with its other house rules and defaults to 0, so
-- nothing is added until the owner sets it. Bookings already made keep the rate
-- they were saved with.

ALTER TABLE "HOTEL_POLICY"
  ADD COLUMN IF NOT EXISTS default_tax_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (default_tax_pct >= 0 AND default_tax_pct <= 100);

ALTER TABLE "BOOKING" ALTER COLUMN tax_pct SET DEFAULT 0;
