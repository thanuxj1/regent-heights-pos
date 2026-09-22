-- ─── Migration 031: tell "the hotel chose this" from "the system's starting value" ─
-- Every property is given a HOTEL_POLICY row of working defaults (check-in 2:00 PM,
-- check-out 11:00 AM, free cancellation for 48 hours…) so the desk always has some
-- rule to price a late check-out by. But the confirmation printed those same values
-- to guests as though the hotel had written them.
--
-- policy_saved becomes TRUE the first time the owner saves the stay policy. Until
-- then the times, the cancellation rule and the terms are left off anything a guest
-- reads, rather than quoting numbers nobody chose.

ALTER TABLE "HOTEL_POLICY"
  ADD COLUMN IF NOT EXISTS policy_saved BOOLEAN NOT NULL DEFAULT FALSE;
