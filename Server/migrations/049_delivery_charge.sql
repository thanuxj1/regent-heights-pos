-- 049 — The delivery charge on a delivery order.
--
-- A delivery order can carry a flat charge the customer pays on top of the food
-- (LKR 50 / 100 / 150 / 200 at the till). The charge is *inside* the order's
-- total ("or_totalCostWtax") so everything that already reads that figure — the
-- revenue reports, the cash drawer, the delivery-COD tally — counts it with no
-- change. This column records it on its own as well, so the reports can show it
-- as a line of its own ("of which delivery charges") rather than leave it lost
-- inside the food sales.
--
-- 0 on every existing order and on every order that is not a delivery: no
-- charge was ever recorded for them, and none is invented.
ALTER TABLE "ORDER"
  ADD COLUMN IF NOT EXISTS delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "ORDER" DROP CONSTRAINT IF EXISTS order_delivery_charge_nonneg;
ALTER TABLE "ORDER"
  ADD CONSTRAINT order_delivery_charge_nonneg CHECK (delivery_charge >= 0);
