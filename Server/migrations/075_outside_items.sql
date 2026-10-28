-- Outside items: something the property does not stock, bought elsewhere and
-- sold on to the customer (a pharmacy item, a brand of cigarettes the bar does
-- not carry, a cake from the bakery down the road). Different every time, so
-- it is not a menu product: the cashier types what it is, what the customer
-- pays and what it cost.
--
-- Such a line has no Bpro_id. item_name says what it was, unit_cost (051) is
-- what one cost the property, and bought_from where it came from. It takes no
-- stock, and its cost counts as money out on the day it was sold.
ALTER TABLE "ORDER_ITEM" ADD COLUMN IF NOT EXISTS item_name   VARCHAR(120);
ALTER TABLE "ORDER_ITEM" ADD COLUMN IF NOT EXISTS bought_from VARCHAR(120);

-- A line is a menu product or an outside item, never neither.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_product_or_outside') THEN
    ALTER TABLE "ORDER_ITEM" ADD CONSTRAINT order_item_product_or_outside
      CHECK ("Bpro_id" IS NOT NULL OR (item_name IS NOT NULL AND unit_cost IS NOT NULL)) NOT VALID;
  END IF;
END $$;
