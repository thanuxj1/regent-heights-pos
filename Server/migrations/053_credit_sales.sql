-- Credit sales: food given to someone the house knows, who pays later. Like cash
-- on delivery, the order is not money in the drawer and counts as revenue only
-- on the day it is paid. Who owes it is written on the order.
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS credit_customer VARCHAR(120);
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS credit_phone    VARCHAR(30);

-- A credit payment is written to the same settlement table as a delivery
-- partner's COD hand-over, so every report that already reads settlements
-- counts it. "kind" tells the two apart; a credit payment has a customer, not
-- a delivery partner, and may be paid by card.
ALTER TABLE "DELIVERY_COD_SETTLEMENT" ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'cod';
ALTER TABLE "DELIVERY_COD_SETTLEMENT" ADD COLUMN IF NOT EXISTS customer_name VARCHAR(120);
ALTER TABLE "DELIVERY_COD_SETTLEMENT" ALTER COLUMN delivery_partner DROP NOT NULL;
ALTER TABLE "DELIVERY_COD_SETTLEMENT" DROP CONSTRAINT IF EXISTS "DELIVERY_COD_SETTLEMENT_kind_check";
ALTER TABLE "DELIVERY_COD_SETTLEMENT" ADD CONSTRAINT "DELIVERY_COD_SETTLEMENT_kind_check"
  CHECK (kind IN ('cod', 'credit'));
ALTER TABLE "DELIVERY_COD_SETTLEMENT" DROP CONSTRAINT IF EXISTS "DELIVERY_COD_SETTLEMENT_method_check";
ALTER TABLE "DELIVERY_COD_SETTLEMENT" ADD CONSTRAINT "DELIVERY_COD_SETTLEMENT_method_check"
  CHECK (method IN ('cash', 'card', 'bank_transfer', 'online', 'other'));

CREATE INDEX IF NOT EXISTS order_outstanding_credit
  ON "ORDER"(b_id) WHERE payment_method = 'credit' AND cod_settlement_id IS NULL;
