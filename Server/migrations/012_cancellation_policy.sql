-- =============================================================
-- The cancellation terms, which were a sentence in two files.
--
-- "Free cancellation up to 48 hours before arrival; otherwise 1 night stay
-- charge applies" was printed on every voucher and sent in every WhatsApp
-- confirmation, with the numbers written into the code. A property that gives
-- 24 hours, or charges two nights, had no way to say so.
-- =============================================================

ALTER TABLE "HOTEL_POLICY"
  ADD COLUMN IF NOT EXISTS cancel_free_hours    INTEGER NOT NULL DEFAULT 48
    CHECK (cancel_free_hours >= 0 AND cancel_free_hours <= 720),
  ADD COLUMN IF NOT EXISTS cancel_charge_nights INTEGER NOT NULL DEFAULT 1
    CHECK (cancel_charge_nights >= 0 AND cancel_charge_nights <= 30);
