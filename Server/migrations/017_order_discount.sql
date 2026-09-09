-- 017_order_discount.sql
--
-- The till let a cashier type any discount they liked, and the server never
-- learned about it. Only the reduced total arrived, so a 90%-off sale and a
-- genuinely cheap one looked identical in the database: no record that a
-- discount was applied, by whom, or how much.
--
-- That is a cleaner way to take cash than voiding ever was — charge the guest
-- the full price, ring it up at 90% off, keep the difference, and the books
-- balance. These columns put the discount on the record and give the approval
-- check something to hang on.

ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS service_fee NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Who signed off a discount past the house limit. NULL when none was needed.
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS discount_approved_by INTEGER;

ALTER TABLE "ORDER" DROP CONSTRAINT IF EXISTS order_discount_pct_sane;
ALTER TABLE "ORDER" ADD CONSTRAINT order_discount_pct_sane
  CHECK (discount_pct >= 0 AND discount_pct <= 100);
