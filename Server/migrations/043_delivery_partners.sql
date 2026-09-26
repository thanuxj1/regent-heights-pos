-- 043 — Delivery partners become a real, manager-editable list.
--
-- Until now the partner list (PickMe, Uber Eats, foodpanda, Other) was
-- hardcoded in JS — a manager couldn't add a new courier without a code
-- change. This makes it a real table. ORDER.delivery_partner and
-- DELIVERY_COD_SETTLEMENT.delivery_partner stay plain text (the `key`
-- below) — no FK, no backfill risk to rows already written today.
-- A partner is deactivated, never deleted, so historical orders always
-- resolve to a name.

CREATE TABLE IF NOT EXISTS "DELIVERY_PARTNER" (
  partner_id SERIAL PRIMARY KEY,
  com_id     INTEGER REFERENCES "Company"(com_id),
  key        VARCHAR(30) NOT NULL,
  name       VARCHAR(100) NOT NULL,
  contact    VARCHAR(30),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (com_id, key)
);

-- Seed today's hardcoded partners for every existing company, so orders
-- already tagged 'pickme_food' etc. keep resolving to a real row.
INSERT INTO "DELIVERY_PARTNER" (com_id, key, name)
SELECT com_id, v.key, v.name FROM "Company"
CROSS JOIN (VALUES ('pickme_food','PickMe'), ('uber_eats','Uber Eats'),
                    ('foodpanda','foodpanda'), ('other','Other')) AS v(key, name)
ON CONFLICT (com_id, key) DO NOTHING;
