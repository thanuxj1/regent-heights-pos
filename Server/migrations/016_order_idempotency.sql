-- 016_order_idempotency.sql
--
-- A till on a hotel's wifi loses the network mid-request. The order reaches the
-- server, the reply does not, and the cashier — seeing an error — rings it up
-- again. The customer is charged twice and the kitchen cooks twice.
--
-- The client stamps each sale with a key it generates before sending. A repeat
-- of the same key returns the order that already exists instead of making a
-- second one, so retrying is always safe. This is what lets the POS queue
-- sales offline and flush them later without risking duplicates.

ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64);

-- Scoped per branch: two properties generating the same random key must not
-- collide into one another's sales. Partial, so the many historical rows with
-- no key do not all fight over NULL.
CREATE UNIQUE INDEX IF NOT EXISTS order_client_ref_unique
  ON "ORDER" (b_id, client_ref)
  WHERE client_ref IS NOT NULL;
