-- 024 — a dish cooked to order has no number to count.
--
-- Until now every menu item had to carry a quantity. That suits a rack of
-- pastries: twenty come out of the oven, twenty go on the shelf, and the count
-- goes down as they sell. It does not suit kottu. Nobody can say in the morning
-- how many kottu the property "has"; the kitchen makes one when somebody asks
-- for one, and only at the end of the day is there a number — how many were
-- made, not how many were left.
--
-- Forced to answer anyway, the owner typed 0, and the till then showed the dish
-- in amber with "0 in stock" all service; or typed 999, and the count meant
-- nothing for anything else either.
--
-- So a menu item is now stocked in one of three ways:
--
--   recipe        — it has ingredients. What can be sold is what the ingredients
--                   allow, and a sale takes them out of the store.
--   counted       — track_inventory = true, no recipe. The number on the shelf,
--                   counted down by sales and put right by a stock count.
--   made to order — track_inventory = false, no recipe. Nothing is counted and
--                   nothing is deducted; how many were made is what was sold.
--
-- track_inventory has been on Product all along, with a toggle on the product
-- form, and nothing ever read it. Now it is the switch between the second and
-- the third.

-- The column exists in the running database but was never written into
-- schema.sql or any migration, so a database built from scratch had none of it
-- and every product query failed. Same for the rest of the product fields the
-- controllers read. IF NOT EXISTS makes this a no-op where they are already
-- there.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "description"     TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "discount_pct"    NUMERIC(5,2)  DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "cost_price"      NUMERIC(10,2) DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "tax_group"       NUMERIC(5,2)  DEFAULT 5;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "low_stock"       NUMERIC(10,2) DEFAULT 10;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "track_inventory" BOOLEAN       DEFAULT TRUE;

-- Nothing may be neither counted nor not-counted: the stock logic asks this
-- column a yes/no question on every sale.
UPDATE "Product" SET "track_inventory" = TRUE WHERE "track_inventory" IS NULL;
ALTER TABLE "Product" ALTER COLUMN "track_inventory" SET DEFAULT TRUE;
ALTER TABLE "Product" ALTER COLUMN "track_inventory" SET NOT NULL;

-- "How many did we make today" is a question about order lines, asked per menu
-- item. There was no index for that: it read every order line ever written.
CREATE INDEX IF NOT EXISTS order_item_bpro_idx ON "ORDER_ITEM" ("Bpro_id");
