-- 037 — closing a gap between what the migration files say and what has been
-- live for a while: two changes were made directly against the database earlier
-- in development, never captured as a migration. schema.sql + 002-036 alone
-- would not reproduce the real schema — this migration makes them agree again.
--
-- Found by: restoring a full copy of the real database onto new hosting and
-- comparing it against a from-scratch build of schema.sql + every migration.
-- The mismatch surfaced immediately as a failed restore, not silently.

-- An image stored as a data: URI runs well past 500 characters; this was
-- already widened live, informally, the day that first truncated a photo.
ALTER TABLE "Product" ALTER COLUMN " pro_image" TYPE TEXT;
ALTER TABLE "Branch_Product" ALTER COLUMN " pro_image" TYPE TEXT;

-- A branch's own discount on a menu item, read by the till
-- (COALESCE(bp.discount_pct, pr.discount_pct, 0)) since early in the Accounting
-- and Sales work — the column existed live but no migration ever added it.
ALTER TABLE "Branch_Product" ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) DEFAULT 0;
