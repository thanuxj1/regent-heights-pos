-- A packing charge on a takeaway or delivery order: boxes, bags and the like,
-- typed in at the till. Part of what the customer pays, on top of the food and
-- (like the delivery charge) not taxed. 0 for everything else.
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS packing_charge NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "ORDER" DROP CONSTRAINT IF EXISTS order_packing_charge_nonneg;
ALTER TABLE "ORDER" ADD CONSTRAINT order_packing_charge_nonneg CHECK (packing_charge >= 0);
