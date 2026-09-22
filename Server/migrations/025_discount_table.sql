-- 025 — the discount table, written down at last.
--
-- `discount` has been in the running database and in the code since the
-- beginning, and in neither schema.sql nor any migration. A database built
-- from this repository had no such table, so every call to /api/discounts
-- failed on a fresh install — including the till's own discount lookup.
--
-- This is the live table as it stands, so applying it changes nothing here and
-- makes a new database match. `Bpro_id` is nullable on purpose: an order-wide
-- or loyalty discount belongs to no single menu item. It was NOT NULL once, and
-- `Server/migrate-discount-nullable.js` — a loose script in the server root —
-- was what fixed it. That script is gone; the change lives here where the rest
-- of the schema lives.

CREATE TABLE IF NOT EXISTS "discount" (
  discount_id      SERIAL PRIMARY KEY,
  discount_name    VARCHAR(255)  NOT NULL,
  discount_type    VARCHAR(50)   NOT NULL
                   CHECK (discount_type IN ('order', 'product', 'loyalty', 'combo')),
  value_type       VARCHAR(20)   NOT NULL
                   CHECK (value_type IN ('percentage', 'fixed')),
  discount_value   NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  discount_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  coupon_code      VARCHAR(50)   UNIQUE,
  start_date       DATE,
  end_date         DATE,
  start_time       TIME,
  end_time         TIME,
  apply_monday     BOOLEAN NOT NULL DEFAULT TRUE,
  apply_tuesday    BOOLEAN NOT NULL DEFAULT TRUE,
  apply_wednesday  BOOLEAN NOT NULL DEFAULT TRUE,
  apply_thursday   BOOLEAN NOT NULL DEFAULT TRUE,
  apply_friday     BOOLEAN NOT NULL DEFAULT TRUE,
  apply_saturday   BOOLEAN NOT NULL DEFAULT TRUE,
  apply_sunday     BOOLEAN NOT NULL DEFAULT TRUE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  max_uses         INTEGER,
  uses_count       INTEGER NOT NULL DEFAULT 0,
  min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  points_required  INTEGER,
  "Bpro_id"        INTEGER REFERENCES "Branch_Product"("Bpro_id") ON DELETE SET NULL,
  b_id             INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  "Com_id"         INTEGER,
  or_id            INTEGER,
  cust_id          INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Where the table already existed with the old rule.
ALTER TABLE "discount" ALTER COLUMN "Bpro_id" DROP NOT NULL;
