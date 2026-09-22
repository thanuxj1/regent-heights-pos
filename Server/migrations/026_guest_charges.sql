-- 026 — what the rate includes, who the room holds, and what an extra guest costs.
--
-- A room type carried two occupancy numbers, "base" and "max", and neither did
-- what its name promised. `base_occupancy` was shown on the card and read by
-- nothing; `max_occupancy` was a single headcount, so a room meant for two
-- adults and a child accepted three adults without comment. Meanwhile
-- `extra_adult_rate` and `extra_child_rate` sat on the form, were saved, and
-- were read by no calculation anywhere: a property could set 1,500 a head and
-- every bill still came to the room rate.
--
-- The three now mean something:
--
--   included_guests   how many people the nightly rate covers. Blank means the
--                     rate covers whoever is in the room and nobody is charged
--                     per head.
--   max_adults        how many adults the room takes, and
--   max_children      how many children — separately, because "sleeps 3" never
--                     said whether that was three adults.
--   extra_adult_rate  charged per night for each guest past included_guests,
--   extra_child_rate  adults first, then children.
--
-- Extra-guest charges sit beside the room charge and are NOT taxed with it:
-- tax stays on the room, as it was.

-- Idempotent: a migration may be re-applied after a half-finished run, and the
-- rename is the one step that cannot say IF EXISTS for itself.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'ROOM_TYPE' AND column_name = 'base_occupancy') THEN
    ALTER TABLE "ROOM_TYPE" RENAME COLUMN base_occupancy TO included_guests;
  END IF;
END $$;

ALTER TABLE "ROOM_TYPE" ADD COLUMN IF NOT EXISTS max_adults   INTEGER;
ALTER TABLE "ROOM_TYPE" ADD COLUMN IF NOT EXISTS max_children INTEGER;

-- What "sleeps N" meant in practice: N adults, and children on top of them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'ROOM_TYPE' AND column_name = 'max_occupancy') THEN
    UPDATE "ROOM_TYPE"
       SET max_adults   = COALESCE(max_adults, max_occupancy),
           max_children = COALESCE(max_children, 0)
     WHERE max_adults IS NULL OR max_children IS NULL;
  END IF;
END $$;

ALTER TABLE "ROOM_TYPE" DROP COLUMN IF EXISTS max_occupancy;

-- Nothing is required: a property that prices by the room leaves all three
-- blank and nothing changes for it.
ALTER TABLE "ROOM_TYPE" ALTER COLUMN included_guests DROP NOT NULL;

-- The charge itself, kept apart from room, meals and the desk's own extras so a
-- bill can say where each figure came from.
ALTER TABLE "BOOKING" ADD COLUMN IF NOT EXISTS person_charges NUMERIC(12,2) NOT NULL DEFAULT 0;

-- The folio needs a line of its own for these, so a guest reading the bill can
-- see "extra guests" rather than a second room line they cannot account for.
ALTER TABLE "FOLIO_ITEM" DROP CONSTRAINT IF EXISTS "FOLIO_ITEM_source_check";
ALTER TABLE "FOLIO_ITEM" ADD CONSTRAINT "FOLIO_ITEM_source_check"
  CHECK (source IN ('room','guests','meal','restaurant','bar','laundry','minibar',
                    'tax','discount','payment','late_checkout','misc'));
