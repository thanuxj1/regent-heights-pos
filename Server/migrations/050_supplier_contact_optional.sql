-- Only a supplier's name is required. Many local suppliers are paid in cash and
-- have no number worth recording.
ALTER TABLE "SUPPLIER" ALTER COLUMN sup_contact DROP NOT NULL;
