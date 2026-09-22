-- 034 — moving stock from the main store down to a branch's menu is on the ledger.
--
-- Adding a product to a branch took its opening quantity out of the main store, and
-- after that there was no way to bring more across: the only tool, Count, sets the
-- branch's figure without touching the main store. A restock is a transfer, so it
-- is written down as one.
ALTER TABLE "STOCK_MOVEMENT" DROP CONSTRAINT IF EXISTS "STOCK_MOVEMENT_reason_check";
ALTER TABLE "STOCK_MOVEMENT" ADD CONSTRAINT "STOCK_MOVEMENT_reason_check"
  CHECK (reason IN ('sale', 'sale_reversed', 'purchase', 'adjust',
                    'meal_plan', 'meal_plan_reversed', 'transfer'));
