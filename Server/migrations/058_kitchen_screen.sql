-- Does the property move its orders along on a kitchen screen?
--
-- Regent Heights does not: the kitchen cooks from the printed KOT and nobody
-- in it touches the terminal, so every paid order stayed "pending" for good.
-- Where this is off, a paid order (or one on a guest's bill) is finished as
-- soon as it is rung up — see utils/kitchenScreen.js. New properties keep the
-- kitchen-screen workflow by default.
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS kitchen_screen BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE "Branch" SET kitchen_screen = FALSE WHERE "B_name" ILIKE 'Regent Heights%';

-- The orders already left waiting there: anything paid for or charged to a
-- room is done. An unpaid open bill stays pending until it is settled.
-- or_date/or_time are the hotel's wall clock, so the finish time is read in
-- the hotel's zone.
UPDATE "ORDER" o
   SET or_status = 'completed',
       status_changed_at = COALESCE(o.status_changed_at, (o.or_date + o.or_time) AT TIME ZONE 'Asia/Colombo')
  FROM "Branch" b
 WHERE b."B_id" = o.b_id
   AND b.kitchen_screen = FALSE
   AND o.or_status IN ('pending', 'preparing')
   AND (o.payment_method IS NOT NULL OR o.folio_id IS NOT NULL);
