-- 038 — RESERVATION was missing the columns its own controller has required
-- on every create since the very first commit: reserv_time, duration_minutes,
-- pay_date, branch_id. schema.sql only ever gave it reserv_id, table_id,
-- cust_id, reserv_date — no migration before this one added the rest, so
-- POST /api/reservations has been a guaranteed 500 in every environment.
--
-- Found by: writing the first real test coverage for table reservations
-- (they were never part of any QA pass this project has run) and hitting
-- "column reserv_time does not exist" on the very first create.
ALTER TABLE "RESERVATION" ADD COLUMN IF NOT EXISTS reserv_time TIME;
ALTER TABLE "RESERVATION" ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "RESERVATION" ADD COLUMN IF NOT EXISTS pay_date DATE;
ALTER TABLE "RESERVATION" ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES "Branch"("B_id");

-- Backfill any row that already existed before this migration (there should
-- be none — the feature could not previously complete a create — but a
-- backfill costs nothing and makes the NOT NULL below safe either way).
UPDATE "RESERVATION" r SET branch_id = t.branch_id
  FROM "TABLES" t WHERE r.table_id = t.table_id AND r.branch_id IS NULL;
UPDATE "RESERVATION" SET reserv_time = '00:00:00' WHERE reserv_time IS NULL;

ALTER TABLE "RESERVATION" ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE "RESERVATION" ALTER COLUMN reserv_time SET NOT NULL;
