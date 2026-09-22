-- 027 — what a meal plan actually feeds people, and where that food comes from.
--
-- A meal plan was money and nothing else: "bed and breakfast, 1,000 a head a
-- night" went on the bill, the kitchen cooked the breakfasts, and not one egg
-- ever left the store. Stock drifted by exactly the amount of breakfast served,
-- and the food cost of a BB rate was invisible.
--
-- A plan now lists what it covers — the menu items, and how many of each per
-- adult and per child, per night — so the ingredients behind those items move
-- like any other sale.
--
-- Each item says how it reaches the guest, because the two are genuinely
-- different:
--
--   auto     a buffet. The kitchen lays it out whether one guest comes down or
--            all of them, so the food is used by cooking it. Deducted per
--            person per night at check-in, and nobody has to ring anything.
--   ordered  cooked when somebody asks. Nothing is used until it is rung up on
--            the guest's room, where the plan pays for it — the line shows 0.00
--            and the ingredients come out then.
--
-- Beyond what the plan covers, a guest pays the menu price like anyone else.

CREATE TABLE IF NOT EXISTS "MEAL_PLAN_ITEM" (
  item_id        SERIAL PRIMARY KEY,
  plan_id        INTEGER NOT NULL REFERENCES "MEAL_PLAN"(plan_id) ON DELETE CASCADE,
  "Bpro_id"      INTEGER NOT NULL REFERENCES "Branch_Product"("Bpro_id") ON DELETE CASCADE,
  qty_per_adult  NUMERIC(6,2) NOT NULL DEFAULT 1,
  qty_per_child  NUMERIC(6,2) NOT NULL DEFAULT 1,
  serve_mode     VARCHAR(10)  NOT NULL DEFAULT 'auto'
                 CHECK (serve_mode IN ('auto', 'ordered')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, "Bpro_id")
);

CREATE INDEX IF NOT EXISTS meal_plan_item_plan_idx ON "MEAL_PLAN_ITEM"(plan_id);

-- Stock taken for a plan is not a sale: nobody paid at the till, the guest paid
-- it in their room rate. It is written to the same ledger so the count still
-- reconciles, with its own reason so a report can tell the two apart.
ALTER TABLE "STOCK_MOVEMENT" DROP CONSTRAINT IF EXISTS "STOCK_MOVEMENT_reason_check";
ALTER TABLE "STOCK_MOVEMENT" ADD CONSTRAINT "STOCK_MOVEMENT_reason_check"
  CHECK (reason IN ('sale', 'sale_reversed', 'purchase', 'adjust',
                    'meal_plan', 'meal_plan_reversed'));

-- Which stay it fed. A plain integer like order_id above it: the history
-- outlives a deleted booking.
ALTER TABLE "STOCK_MOVEMENT" ADD COLUMN IF NOT EXISTS booking_id INTEGER;
CREATE INDEX IF NOT EXISTS stock_movement_by_booking
  ON "STOCK_MOVEMENT"(booking_id) WHERE booking_id IS NOT NULL;

-- What a stay has already been given, so a second helping is charged and the
-- allowance is not spent twice. One row per item per day.
CREATE TABLE IF NOT EXISTS "MEAL_ALLOWANCE_USE" (
  use_id      SERIAL PRIMARY KEY,
  booking_id  INTEGER NOT NULL REFERENCES "BOOKING"(booking_id) ON DELETE CASCADE,
  plan_id     INTEGER REFERENCES "MEAL_PLAN"(plan_id) ON DELETE SET NULL,
  "Bpro_id"   INTEGER NOT NULL REFERENCES "Branch_Product"("Bpro_id") ON DELETE CASCADE,
  used_date   DATE    NOT NULL,
  qty         NUMERIC(8,2) NOT NULL,
  order_id    INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS meal_allowance_lookup
  ON "MEAL_ALLOWANCE_USE"(booking_id, "Bpro_id", used_date);
