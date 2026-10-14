-- Bank transfer became a till payment (053), but the Payment table only allowed
-- cash, card, mobile_pay, voucher and split, so recording a bank-transfer
-- payment at the till ("Pay now" on the bill) was refused and the bill did not
-- print.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_pay_method_check";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pay_method_check"
  CHECK (pay_method IN ('cash', 'card', 'mobile_pay', 'voucher', 'split', 'bank_transfer'));
