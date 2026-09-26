-- 047 — Real timestamp for a supplier payment.
--
-- payment_date is a plain DATE — the day the payment is attributed to for
-- accounting (backdatable, defaults to today), never a time. Two payments
-- recorded minutes apart on the same day were indistinguishable in the
-- Transactions ledger: both showed midnight. created_at is the actual moment
-- the row was written, used only for display/ordering — payment_date stays
-- the source of truth for which accounting day a payment falls in.
ALTER TABLE supplier_payment ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
