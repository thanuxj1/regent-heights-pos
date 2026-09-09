-- =============================================================
-- Hotel PMS core — room types, rooms, guests, bookings, folios
-- Safe to re-run.
-- =============================================================

-- ─── ROOM_TYPE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ROOM_TYPE" (
  room_type_id     SERIAL PRIMARY KEY,
  b_id             INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  type_name        VARCHAR(100) NOT NULL,
  type_code        VARCHAR(20),
  description      TEXT,
  base_occupancy   INTEGER NOT NULL DEFAULT 2,
  max_occupancy    INTEGER NOT NULL DEFAULT 3,
  base_rate        NUMERIC(10,2) NOT NULL DEFAULT 0,
  extra_adult_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  extra_child_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  bed_config       VARCHAR(60),
  size_sqft        INTEGER,
  amenities        JSONB NOT NULL DEFAULT '[]'::jsonb,
  images           JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (max_occupancy >= base_occupancy)
);

-- ─── ROOM ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ROOM" (
  room_id      SERIAL PRIMARY KEY,
  b_id         INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES "ROOM_TYPE"(room_type_id) ON DELETE RESTRICT,
  room_number  VARCHAR(20) NOT NULL,
  floor        VARCHAR(20),
  hk_status    VARCHAR(20) NOT NULL DEFAULT 'clean'
               CHECK (hk_status IN ('clean','dirty','inspected','maintenance','out_of_order')),
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (b_id, room_number)
);

-- ─── MEAL_PLAN ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MEAL_PLAN" (
  plan_id              SERIAL PRIMARY KEY,
  b_id                 INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  plan_code            VARCHAR(10) NOT NULL,
  plan_name            VARCHAR(60) NOT NULL,
  supplement_per_adult NUMERIC(10,2) NOT NULL DEFAULT 0,
  supplement_per_child NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (b_id, plan_code)
);

-- ─── GUEST ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GUEST" (
  guest_id             SERIAL PRIMARY KEY,
  full_name            VARCHAR(150) NOT NULL,
  email                VARCHAR(150),
  phone                VARCHAR(30),
  country              VARCHAR(80),
  nationality          VARCHAR(80),
  passport_nic         VARCHAR(50),
  passport_issue_date  DATE,
  passport_expiry_date DATE,
  date_of_birth        DATE,
  address              TEXT,
  company              VARCHAR(150),
  guest_status         VARCHAR(50),
  chauffeur_name       VARCHAR(100),
  chauffeur_phone      VARCHAR(30),
  next_destination     VARCHAR(150),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── BOOKING ─────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS booking_ref_seq START 1;

CREATE TABLE IF NOT EXISTS "BOOKING" (
  booking_id       SERIAL PRIMARY KEY,
  booking_ref      VARCHAR(24) NOT NULL UNIQUE,
  b_id             INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  guest_id         INTEGER REFERENCES "GUEST"(guest_id) ON DELETE SET NULL,
  agent_id         INTEGER REFERENCES "COMMISSION_AGENT"(agent_id) ON DELETE SET NULL,
  source           VARCHAR(30) NOT NULL DEFAULT 'phone'
                   CHECK (source IN ('phone','walk_in','email','agent','online','ota')),
  check_in_date    DATE NOT NULL,
  check_out_date   DATE NOT NULL,
  nights           INTEGER NOT NULL,
  adults           INTEGER NOT NULL DEFAULT 1,
  children         INTEGER NOT NULL DEFAULT 0,
  meal_plan_id     INTEGER REFERENCES "MEAL_PLAN"(plan_id) ON DELETE SET NULL,
  arrival_time     TIME,
  special_requests TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('tentative','confirmed','checked_in','checked_out','cancelled','no_show')),
  room_charges     NUMERIC(12,2) NOT NULL DEFAULT 0,
  meal_charges     NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_pct          NUMERIC(5,2)  NOT NULL DEFAULT 10.00,
  tax_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  extra_charges    NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  advance_paid     NUMERIC(12,2) NOT NULL DEFAULT 0,
  promotion        VARCHAR(100),
  remarks          TEXT,
  taken_by         INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  checked_in_by    INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  checked_out_by   INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  checked_in_at    TIMESTAMPTZ,
  checked_out_at   TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (check_out_date > check_in_date)
);

-- ─── BOOKING_ROOM ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BOOKING_ROOM" (
  booking_room_id SERIAL PRIMARY KEY,
  booking_id      INTEGER NOT NULL REFERENCES "BOOKING"(booking_id) ON DELETE CASCADE,
  room_id         INTEGER REFERENCES "ROOM"(room_id) ON DELETE SET NULL,
  room_type_id    INTEGER NOT NULL REFERENCES "ROOM_TYPE"(room_type_id) ON DELETE RESTRICT,
  rate_per_night  NUMERIC(10,2) NOT NULL DEFAULT 0,
  adults          INTEGER NOT NULL DEFAULT 1,
  children        INTEGER NOT NULL DEFAULT 0
);

-- ─── FOLIO ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FOLIO" (
  folio_id   SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES "BOOKING"(booking_id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at  TIMESTAMPTZ
);

-- ─── FOLIO_ITEM ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FOLIO_ITEM" (
  item_id      SERIAL PRIMARY KEY,
  folio_id     INTEGER NOT NULL REFERENCES "FOLIO"(folio_id) ON DELETE CASCADE,
  source       VARCHAR(20) NOT NULL DEFAULT 'misc'
               CHECK (source IN ('room','meal','restaurant','bar','laundry','minibar','tax','discount','payment','misc')),
  ref_order_id INTEGER REFERENCES "ORDER"(or_id) ON DELETE SET NULL,
  description  VARCHAR(255) NOT NULL,
  qty          NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL,
  item_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  posted_by    INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  posted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Link restaurant orders to a room folio ──────────────────
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS folio_id INTEGER REFERENCES "FOLIO"(folio_id) ON DELETE SET NULL;
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS room_id  INTEGER REFERENCES "ROOM"(room_id)  ON DELETE SET NULL;

-- Allow room_service as an order type
ALTER TABLE "ORDER" DROP CONSTRAINT IF EXISTS "ORDER_or_type_check";
ALTER TABLE "ORDER" ADD  CONSTRAINT "ORDER_or_type_check"
  CHECK (or_type IN ('dine-in','takeaway','delivery','room_service'));

-- ─── Booking payments (advance + settlement) ─────────────────
CREATE TABLE IF NOT EXISTS "BOOKING_PAYMENT" (
  bp_id        SERIAL PRIMARY KEY,
  booking_id   INTEGER NOT NULL REFERENCES "BOOKING"(booking_id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method       VARCHAR(20) NOT NULL DEFAULT 'cash'
               CHECK (method IN ('cash','card','bank_transfer','online','voucher')),
  kind         VARCHAR(20) NOT NULL DEFAULT 'advance'
               CHECK (kind IN ('advance','settlement','refund')),
  reference    VARCHAR(100),
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by  INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL
);

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_room_branch          ON "ROOM"(b_id);
CREATE INDEX IF NOT EXISTS idx_booking_branch_dates ON "BOOKING"(b_id, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_booking_status       ON "BOOKING"(status);
CREATE INDEX IF NOT EXISTS idx_booking_room_booking ON "BOOKING_ROOM"(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_room_room    ON "BOOKING_ROOM"(room_id);
CREATE INDEX IF NOT EXISTS idx_folio_item_folio     ON "FOLIO_ITEM"(folio_id);
CREATE INDEX IF NOT EXISTS idx_order_folio          ON "ORDER"(folio_id);

-- ─── Seed default meal plans for every existing branch ───────
INSERT INTO "MEAL_PLAN" (b_id, plan_code, plan_name, supplement_per_adult, supplement_per_child)
SELECT b."B_id", v.code, v.name, v.adult, v.child
FROM "Branch" b
CROSS JOIN (VALUES
  ('RO', 'Room Only',        0,    0),
  ('BB', 'Bed & Breakfast',  1500, 750),
  ('HB', 'Half Board',       3500, 1750),
  ('FB', 'Full Board',       5000, 2500)
) AS v(code, name, adult, child)
ON CONFLICT (b_id, plan_code) DO NOTHING;
