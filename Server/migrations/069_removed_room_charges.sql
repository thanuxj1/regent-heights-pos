-- Restaurant orders whose line was taken off a guest's bill, but which were
-- left standing.
--
-- Removing a room-charged order's line from the folio did not touch the order,
-- and check-out sweeps every room-charged order not yet on the bill back onto
-- it. So the charge came back at check-out as an outstanding balance (a
-- removed 650 on RH-2026-0810 blocked the check-out), and the check-out was
-- refused, rolled back, and the line never seen. Removing a line now cancels
-- its order (bookingController.deleteFolioItem); this does the same for the
-- ones removed before.
--
-- Only an order the Activity Log shows was taken off the bill, on a bill still
-- open, that is not on it now. Its stock is not put back here: the food may
-- well have been made, and a count will show it either way.
UPDATE "ORDER" o
   SET or_status = 'cancelled',
       void_reason = 'Removed from the guest''s bill before check-out',
       voided_at = NOW(),
       status_changed_at = NOW()
  FROM "FOLIO" f
 WHERE f.folio_id = o.folio_id
   AND f.status = 'open'
   AND o.or_status <> 'cancelled'
   AND NOT EXISTS (SELECT 1 FROM "FOLIO_ITEM" fi WHERE fi.ref_order_id = o.or_id)
   AND EXISTS (
     SELECT 1 FROM "ACTIVITY_LOG" a
      WHERE a.entity = 'folio_item' AND a.action = 'delete'
        AND a.summary ~ ('order #' || o.or_id || '([^0-9]|$)')
        AND a.summary ~ ('booking #' || f.booking_id || '([^0-9]|$)')
   );
