-- 033 — a product carries no tax unless the owner sets one.
--
-- The column defaulted to 5, so every product made without a tax figure quietly
-- charged 5% at the till — a rate nobody had chosen. New products now start at 0.
-- Existing rows are left as they are: from the row alone there is no telling a
-- 5 the owner typed from a 5 the default filled in.
ALTER TABLE "Product" ALTER COLUMN "tax_group" SET DEFAULT 0;
