-- 040 — Waste Tracking table.
--
-- The API and the "Waste Tracking" grantable capability were both built
-- earlier (see 039_user_capabilities.sql for the capability system this
-- reuses), but the table itself was never migrated anywhere — the
-- controller has been querying a relation that doesn't exist. This
-- creates it, matching exactly what Server/controllers/wasteController.js
-- already expects.

CREATE TABLE IF NOT EXISTS "Waste" (
  waste_id     SERIAL PRIMARY KEY,
  rm_id        INTEGER NOT NULL REFERENCES "Raw_Material"(rm_id) ON DELETE CASCADE,
  waste_qty    NUMERIC(10,3) NOT NULL,
  reason       VARCHAR(255),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS waste_by_rm ON "Waste"(rm_id);
