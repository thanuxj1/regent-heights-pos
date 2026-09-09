-- ─────────────────────────────────────────────────────────────────────────────
-- Give categories an owner.
--
-- `category` was global: one shared list of Food / Drinks / Desserts across
-- every company on the platform. Renaming "Food" renamed it for everybody, and
-- a category one owner invented turned up in another owner's menu.
--
-- Scoped by **company**, not branch, to match `Product.Com_id` — a company's
-- menu structure should be the same in every property it runs.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "category"
  ADD COLUMN IF NOT EXISTS com_id INTEGER REFERENCES "Company"(com_id) ON DELETE CASCADE;

-- The old UNIQUE was on the name alone, which is what made the list global:
-- two companies could not both have a "Food". Uniqueness now means unique
-- *within a company*.
ALTER TABLE "category" DROP CONSTRAINT IF EXISTS category_cat_name_key;

-- Every company gets its own copy of whatever the shared list held, so nobody
-- loses a category in the split.
INSERT INTO "category" (cat_name, com_id)
SELECT c.cat_name, co.com_id
FROM "category" c
CROSS JOIN "Company" co
WHERE c.com_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "category" x
    WHERE x.com_id = co.com_id AND x.cat_name = c.cat_name
  );

-- Point each product at its own company's copy.
UPDATE "Product" p
   SET cat_id = own.cat_id
  FROM "category" old, "category" own
 WHERE p.cat_id = old.cat_id
   AND old.com_id IS NULL
   AND own.com_id = p."Com_id"
   AND own.cat_name = old.cat_name;

-- And each branch menu row, whose company comes through its branch.
UPDATE "Branch_Product" bp
   SET "Cat_id" = own.cat_id
  FROM "category" old, "category" own, "Branch" b
 WHERE bp."Cat_id" = old.cat_id
   AND old.com_id IS NULL
   AND b."B_id" = bp."B_id"
   AND own.com_id = b.com_id
   AND own.cat_name = old.cat_name;

-- The shared originals are now unreferenced; drop them so no new product can
-- accidentally be filed under a category that belongs to nobody.
DELETE FROM "category" c
 WHERE c.com_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.cat_id = c.cat_id)
   AND NOT EXISTS (SELECT 1 FROM "Branch_Product" bp WHERE bp."Cat_id" = c.cat_id);

CREATE INDEX IF NOT EXISTS category_com_id_idx ON "category" (com_id);

-- Names stay unique inside one company, so a menu cannot carry two "Drinks".
CREATE UNIQUE INDEX IF NOT EXISTS category_com_name_uniq
  ON "category" (com_id, LOWER(cat_name));
