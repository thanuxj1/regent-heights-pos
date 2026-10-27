-- Transport as a charge on a guest's bill.
--
-- The property's own daily sales sheet has a TRANSPORT column (airport and
-- town runs for guests), and the Sales Summary report lays live figures out in
-- that sheet's columns. With no such charge type, transport could only go on
-- the bill as "Other", and the report could not find it.
ALTER TABLE "FOLIO_ITEM" DROP CONSTRAINT IF EXISTS "FOLIO_ITEM_source_check";
ALTER TABLE "FOLIO_ITEM" ADD CONSTRAINT "FOLIO_ITEM_source_check"
  CHECK (source IN ('room','guests','meal','restaurant','bar','laundry','minibar',
                    'tax','discount','payment','late_checkout','transport','misc'));
