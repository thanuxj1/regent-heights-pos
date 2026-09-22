-- ─── Migration 028: Allow purchase items to reference a resale Product ──────
-- Previously purchase_item only linked to Raw_Material (rm_id was NOT NULL).
-- For resale goods (e.g. Pepsi bottles bought from a supplier and sold as-is),
-- we need a purchase item to link to Product instead.
-- Exactly one of rm_id or pro_id must be set per row.

ALTER TABLE purchase_item
  ADD COLUMN IF NOT EXISTS pro_id INTEGER REFERENCES "Product"(pro_id);

-- rm_id was implicitly NOT NULL — make it explicitly nullable now
ALTER TABLE purchase_item
  ALTER COLUMN rm_id DROP NOT NULL;

-- Ensure every row still points to something.
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so drop-then-add like 034 does
-- — this landed on a live database once already outside this runner (its
-- effect was there, the migrate.js record of it was not), so re-running it
-- unconditionally failing on "already exists" would block every migration
-- after it forever.
ALTER TABLE purchase_item DROP CONSTRAINT IF EXISTS purchase_item_target_check;
ALTER TABLE purchase_item
  ADD CONSTRAINT purchase_item_target_check
  CHECK (
    (rm_id IS NOT NULL AND pro_id IS NULL)
    OR
    (rm_id IS NULL AND pro_id IS NOT NULL)
  );
