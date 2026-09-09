-- =============================================================
-- Stay policy, per property.
--
-- Check-in and check-out times were hardcoded as 2:00 PM / 11:00 AM in four
-- places (the voucher, its terms, and the WhatsApp text), so the hotel could
-- not change its own house rules without a code edit.
--
-- Late check-out was not charged at all. Every hotel does it differently —
-- per hour, a flat fee, or a whole extra night — so the rule is data, not code.
-- =============================================================

CREATE TABLE IF NOT EXISTS "HOTEL_POLICY" (
  b_id                  INTEGER PRIMARY KEY REFERENCES "Branch"("B_id") ON DELETE CASCADE,

  check_in_time         TIME NOT NULL DEFAULT '14:00',
  check_out_time        TIME NOT NULL DEFAULT '11:00',

  -- Minutes past check-out time that are forgiven before anything is charged.
  late_grace_minutes    INTEGER NOT NULL DEFAULT 60 CHECK (late_grace_minutes >= 0),

  --  none   never charge, just show how late they were
  --  hourly a share of the nightly rate for every hour started
  --  flat   one fixed amount, however late
  --  night  a whole extra night, however late
  late_mode             VARCHAR(10) NOT NULL DEFAULT 'hourly'
                        CHECK (late_mode IN ('none','hourly','flat','night')),

  -- hourly: percent of the booking's nightly room rate, per hour started
  late_hourly_pct       NUMERIC(5,2) NOT NULL DEFAULT 25 CHECK (late_hourly_pct >= 0 AND late_hourly_pct <= 100),
  -- flat: the fixed amount
  late_flat_amount      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (late_flat_amount >= 0),
  -- hourly: past this many hours it stops being hourly and becomes a full night,
  -- so a guest who leaves at 8pm is never cheaper than one who leaves at noon.
  late_full_night_after INTEGER NOT NULL DEFAULT 6 CHECK (late_full_night_after >= 1),

  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every property starts on the defaults it was already promising in print.
INSERT INTO "HOTEL_POLICY" (b_id)
SELECT "B_id" FROM "Branch"
ON CONFLICT (b_id) DO NOTHING;
