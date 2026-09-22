-- 020 — ingredients are taken when a dish is SOLD.
--
-- Until now a recipe's ingredients were deducted when the owner "prepared" a
-- batch of portions, and a sale only lowered the portion count. That suits a
-- bakery, not a kitchen that cooks kottu to order. Now a sale takes exactly
-- what its recipe says, at the moment it is rung up.
--
-- Every stock change a sale makes is written here, line by line, so a void,
-- cancel or delete can put back exactly what that sale took — not what the
-- recipe says today, and never twice. Receiving a purchase order is written
-- here too, so the owner can see where stock came from as well as where it went.
--
-- Orders taken before this migration have no rows here; voiding one of them
-- returns nothing to stock, which is the safe direction (the old code clamped
-- at zero and then "returned" portions it had never taken).

CREATE TABLE IF NOT EXISTS "STOCK_MOVEMENT" (
  move_id        SERIAL PRIMARY KEY,
  b_id           INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  rm_id          INTEGER REFERENCES "Raw_Material"(rm_id) ON DELETE CASCADE,
  bpro_id        INTEGER REFERENCES "Branch_Product"("Bpro_id") ON DELETE CASCADE,
  qty            NUMERIC(12,3) NOT NULL,             -- signed: negative = taken out
  reason         VARCHAR(20) NOT NULL
                 CHECK (reason IN ('sale', 'sale_reversed', 'purchase')),
  -- Plain integers on purpose: the history outlives a deleted order.
  order_id       INTEGER,
  order_item_id  INTEGER,
  po_id          INTEGER,
  reverses       INTEGER REFERENCES "STOCK_MOVEMENT"(move_id) ON DELETE CASCADE,
  created_by     INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_movement_one_target CHECK ((rm_id IS NOT NULL) <> (bpro_id IS NOT NULL))
);

-- A sale line is put back at most once, however many paths try.
CREATE UNIQUE INDEX IF NOT EXISTS stock_movement_reversed_once
  ON "STOCK_MOVEMENT"(reverses) WHERE reverses IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movement_by_order
  ON "STOCK_MOVEMENT"(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movement_by_item
  ON "STOCK_MOVEMENT"(order_item_id) WHERE order_item_id IS NOT NULL;

-- Plenty of local suppliers have a phone number and no email address.
ALTER TABLE "SUPPLIER" ALTER COLUMN sup_email DROP NOT NULL;

-- Money paid out of the till for a bill is an expense: say what for, and link
-- the two so the owner's accounts and the drawer tell the same story.
ALTER TABLE "CASH_MOVEMENT" ADD COLUMN IF NOT EXISTS category VARCHAR(30);
ALTER TABLE "EXPENSE" ADD COLUMN IF NOT EXISTS cash_movement_id INTEGER
  REFERENCES "CASH_MOVEMENT"(movement_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expense_one_per_movement
  ON "EXPENSE"(cash_movement_id) WHERE cash_movement_id IS NOT NULL;
