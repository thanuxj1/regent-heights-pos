-- 041 — A stable unit cost on Raw_Material.
--
-- Until now the only per-unit price for a raw material lived on individual
-- purchase_item rows, which vary per purchase and can't be cheaply looked
-- up per waste entry or report. This adds a running "current cost" that
-- updates automatically whenever a purchase order is received (see
-- purchaseOrderController.js's updateStatus), so Waste Tracking — and
-- anything else that needs to turn a quantity into a money figure — has a
-- stable value to read.
--
-- No historical backfill: existing rows start NULL (no reliable "as of"
-- price to attribute retroactively). Consumers treat NULL as 0.

ALTER TABLE "Raw_Material" ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2);
