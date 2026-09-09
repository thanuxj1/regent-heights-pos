-- =============================================================
-- Commission on hotel bookings.
--
-- COMMISSION_RECORD could only point at a restaurant ORDER, so a booking taken
-- through an agent recorded the agent on the booking and then earned them
-- nothing: their profile stayed empty and the hotel had no idea what it owed.
--
-- Commission is calculated on room charges only — not food, not tax, not extras
-- — which is the usual basis and the one the agent's rate was agreed against.
-- =============================================================

ALTER TABLE "COMMISSION_RECORD"
  ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES "BOOKING"(booking_id) ON DELETE CASCADE;

-- One record per booking, so re-saving a booking updates its commission rather
-- than stacking up duplicates. Partial, because restaurant records have no
-- booking and must stay free to repeat.
CREATE UNIQUE INDEX IF NOT EXISTS commission_one_per_booking
  ON "COMMISSION_RECORD" (booking_id) WHERE booking_id IS NOT NULL;

-- Backfill anything already taken through an agent, so existing bookings are
-- not invisible to the people owed money for them.
INSERT INTO "COMMISSION_RECORD" (agent_id, booking_id, commission_amount, record_date, status, notes)
SELECT b.agent_id,
       b.booking_id,
       ROUND(COALESCE(b.room_charges, 0) * a.commission_rate / 100.0, 2),
       b.check_in_date,
       'pending',
       'Booking ' || b.booking_ref || ' — ' || a.commission_rate || '% of room charges'
FROM "BOOKING" b
JOIN "COMMISSION_AGENT" a ON a.agent_id = b.agent_id
WHERE b.agent_id IS NOT NULL
  AND b.status NOT IN ('cancelled', 'no_show')
ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO NOTHING;
