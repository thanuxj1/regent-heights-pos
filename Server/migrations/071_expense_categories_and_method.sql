-- A property's own expense categories, and how each expense was paid.
--
-- The nine built-in categories (utilities, salary, raw materials, ...) were a
-- fixed list, so a property's own headings — gas, staff meals, water bowser —
-- all went under "Other" and the split was lost. A category added here is the
-- property's own, says whose cost it is (the hotel's, the restaurant's, or the
-- whole property's), and is stored on each expense by its name, so every page
-- that shows a category name shows it as written.
CREATE TABLE IF NOT EXISTS "EXPENSE_CATEGORY" (
  cat_id      SERIAL PRIMARY KEY,
  b_id        INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  name        VARCHAR(40) NOT NULL,
  department  VARCHAR(12) NOT NULL DEFAULT 'shared' CHECK (department IN ('hotel', 'restaurant', 'shared')),
  created_by  INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_category_name ON "EXPENSE_CATEGORY" (b_id, lower(name));

-- Cash, card, bank transfer, cheque or online. Blank on expenses entered
-- before this: nobody was asked. Cash paid out of the till is cash.
ALTER TABLE "EXPENSE" ADD COLUMN IF NOT EXISTS exp_method VARCHAR(20);
ALTER TABLE "EXPENSE" DROP CONSTRAINT IF EXISTS expense_method_check;
ALTER TABLE "EXPENSE" ADD CONSTRAINT expense_method_check
  CHECK (exp_method IS NULL OR exp_method IN ('cash', 'card', 'bank_transfer', 'cheque', 'online'));
UPDATE "EXPENSE" SET exp_method = 'cash' WHERE cash_movement_id IS NOT NULL AND exp_method IS NULL;
