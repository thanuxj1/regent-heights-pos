-- 057 — Day-use stays: check-in and check-out on the same date.
--
-- A guest who uses a room for the day and leaves the same evening could not be
-- booked: the date picker refused a check-out equal to the check-in, and this
-- constraint refused it underneath. The application now treats such a stay as
-- one billable night (nightsBetween) that occupies its own date
-- (utils/occupancy.js), so the date range alone no longer has to be non-empty.
ALTER TABLE "BOOKING" DROP CONSTRAINT IF EXISTS "BOOKING_check";
ALTER TABLE "BOOKING" ADD CONSTRAINT "BOOKING_check" CHECK (check_out_date >= check_in_date);
