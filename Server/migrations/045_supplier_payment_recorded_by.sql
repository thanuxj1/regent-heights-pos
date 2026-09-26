-- 045 — Who actually recorded a supplier payment.
--
-- supplier_payment had no column at all for the staff member who took it, so
-- the Transactions ledger's "Handled By" column had nothing to show for a
-- supplier payment except the supplier's own name (falling back to `party`)
-- — reading as if the supplier "handled" their own payment, and giving no
-- way to audit which cashier/manager actually recorded it. Nullable: every
-- payment recorded before this migration has no way to know who took it.
ALTER TABLE supplier_payment ADD COLUMN IF NOT EXISTS recorded_by INTEGER REFERENCES "User"(u_id);
