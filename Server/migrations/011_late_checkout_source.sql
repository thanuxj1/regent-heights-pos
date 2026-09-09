-- =============================================================
-- A folio line for a late departure.
--
-- FOLIO_ITEM.source is a closed list, and it had no value for this. It gets its
-- own rather than borrowing 'room' or 'misc' so the owner can see what late
-- check-outs actually earn, and so check-out can tell whether it has already
-- charged this stay.
-- =============================================================

ALTER TABLE "FOLIO_ITEM" DROP CONSTRAINT IF EXISTS "FOLIO_ITEM_source_check";

ALTER TABLE "FOLIO_ITEM" ADD CONSTRAINT "FOLIO_ITEM_source_check"
  CHECK (source IN ('room','meal','restaurant','bar','laundry','minibar',
                    'tax','discount','payment','late_checkout','misc'));
