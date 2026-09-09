-- ─────────────────────────────────────────────────────────────────────────────
-- Give GUEST a home branch.
--
-- Every other hotel table carries b_id; GUEST did not, so the guest directory
-- was one shared list across every company on the platform. Names, phone
-- numbers, passport/NIC and addresses were readable by any signed-in user of
-- any tenant. This is the schema half of that fix — the query half lives in
-- utils/scope.js.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "GUEST"
  ADD COLUMN IF NOT EXISTS b_id INTEGER REFERENCES "Branch"("B_id");

-- A guest belongs to the property that booked them.
UPDATE "GUEST" g
   SET b_id = (SELECT MIN(b.b_id) FROM "BOOKING" b WHERE b.guest_id = g.guest_id)
 WHERE g.b_id IS NULL
   AND EXISTS (SELECT 1 FROM "BOOKING" b WHERE b.guest_id = g.guest_id);

CREATE INDEX IF NOT EXISTS guest_b_id_idx ON "GUEST" (b_id);

-- Left deliberately nullable: a guest with no branch is visible to nobody
-- rather than to everybody. Failing closed is the point.
