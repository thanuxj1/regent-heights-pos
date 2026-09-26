-- 046 — Who recorded a waste entry.
--
-- Same gap as 045 fixed for supplier_payment: "Waste" had no column for the
-- staff member who logged it, so the Transactions ledger's "Handled By"
-- column fell back to the wasted raw material's own name (e.g. a waste
-- record for "Tomatoes" showed "Tomatoes" as who handled it). Nullable:
-- every waste record logged before this migration has no way to know who
-- recorded it.
ALTER TABLE "Waste" ADD COLUMN IF NOT EXISTS recorded_by INTEGER REFERENCES "User"(u_id);
