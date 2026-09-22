-- ─── Migration 030: the owner's own terms & conditions ──────────────────────
-- The booking confirmation printed four terms. Two of them followed the stay
-- policy (the check-in/out times and the cancellation rule); the other two — the
-- ID reminder and the note about taxes — were written into the page, so the hotel
-- could neither reword them nor add its own house rules.
--
-- extra_terms holds the lines the owner controls, one per line. NULL means "the
-- standard wording"; an empty string means the owner has cleared them.

ALTER TABLE "HOTEL_POLICY"
  ADD COLUMN IF NOT EXISTS extra_terms TEXT;
