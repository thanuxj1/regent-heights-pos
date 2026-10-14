-- Who a delivery is for, optionally: printed on the bill and the kitchen ticket
-- so the rider knows whose order it is. Not a customer account, just the name
-- and number the cashier was given.
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS customer_name  VARCHAR(120);
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(30);
