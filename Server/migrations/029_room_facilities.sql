-- ─── Migration 029: the property's own list of room facilities ──────────────
-- The room-type form used to offer fifteen facilities written into the code.
-- A hotel with a plunge pool could tick it on one room type, but the next room
-- type never heard of it, and nothing the owner removed stayed removed. The list
-- now belongs to the branch: they add to it, remove from it, and every room type
-- picks from the same one.
--
-- A branch is given the usual starting set the first time it asks for its list
-- (room_facilities_seeded), and never again, so deleting one stays deleted.

CREATE TABLE IF NOT EXISTS "ROOM_FACILITY" (
  facility_id SERIAL PRIMARY KEY,
  b_id        INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  name        VARCHAR(40) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One of each name per branch, however it is capitalised.
CREATE UNIQUE INDEX IF NOT EXISTS room_facility_branch_name
  ON "ROOM_FACILITY" (b_id, LOWER(name));

ALTER TABLE "Branch"
  ADD COLUMN IF NOT EXISTS room_facilities_seeded BOOLEAN NOT NULL DEFAULT FALSE;
