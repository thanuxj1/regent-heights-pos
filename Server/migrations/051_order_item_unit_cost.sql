-- What the dish cost when it was sold. Copied from the product's cost price at the
-- moment of sale, so changing a cost price later does not rewrite old profit.
-- NULL = no cost price was set for the product then.
ALTER TABLE "ORDER_ITEM" ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10,2);
