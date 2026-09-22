-- 021 — the manager can correct the stock count, and every correction says why.
--
-- Sales are no longer refused when the count says there is not enough: counts
-- drift, and a kitchen that has the food must be able to sell it. The count
-- goes below zero instead, and the manager puts it right by counting what is
-- actually on the shelf. That correction is written to the same ledger as the
-- sales and deliveries, with who made it and why.

ALTER TABLE "STOCK_MOVEMENT" DROP CONSTRAINT IF EXISTS "STOCK_MOVEMENT_reason_check";
ALTER TABLE "STOCK_MOVEMENT" ADD CONSTRAINT "STOCK_MOVEMENT_reason_check"
  CHECK (reason IN ('sale', 'sale_reversed', 'purchase', 'adjust'));

ALTER TABLE "STOCK_MOVEMENT" ADD COLUMN IF NOT EXISTS note VARCHAR(200);

-- "Counted on Monday", "a sack split in the store room" — a correction with no
-- reason is indistinguishable from someone hiding a loss.
ALTER TABLE "STOCK_MOVEMENT" DROP CONSTRAINT IF EXISTS stock_movement_adjust_has_note;
ALTER TABLE "STOCK_MOVEMENT" ADD CONSTRAINT stock_movement_adjust_has_note
  CHECK (reason <> 'adjust' OR (note IS NOT NULL AND length(trim(note)) >= 3));
