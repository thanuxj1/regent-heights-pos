-- 035 — what the kitchen must know about an order travels with it.
--
-- The till has boxes for allergies, add-ons and special requests, but they lived only
-- in the cashier's browser: the printed KOT carried the note once per dish and never
-- the allergy, and the kitchen screen saw none of it. One line of text on the order
-- fixes both, since both read the order.
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS kitchen_note TEXT;
ALTER TABLE "ORDER" DROP CONSTRAINT IF EXISTS order_kitchen_note_len;
ALTER TABLE "ORDER" ADD CONSTRAINT order_kitchen_note_len
  CHECK (kitchen_note IS NULL OR length(kitchen_note) <= 500);
