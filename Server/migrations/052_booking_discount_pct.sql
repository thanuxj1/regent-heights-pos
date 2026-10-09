-- A booking's discount is given as a percentage of the bill. The amount it comes
-- to is still written to "discount", which is what the bill, the confirmation
-- and the reports read; the percentage is kept so the amount follows the bill
-- when the nights, the party or the meal plan change.
-- NULL = a booking saved before this, whose discount is a fixed amount.
ALTER TABLE "BOOKING" ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2);
