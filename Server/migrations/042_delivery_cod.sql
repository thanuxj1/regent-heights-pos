-- 042 — Delivery partner orders (PickMe/Uber Eats/foodpanda) + COD settlement.
--
-- A delivery order's payment happens away from the hotel's own till: the
-- partner's rider collects it from the customer directly, either by card
-- (settled electronically — nothing owed to the hotel) or cash on delivery,
-- where the rider holds that cash until the partner settles up in a batch
-- later. delivery_partner records which partner fulfilled the order;
-- cod_settlement_id (set only once a settlement covers this order) is what
-- makes "outstanding COD" a real, queryable fact rather than a floating
-- balance — the same discipline supplier_payment already enforces via po_id.

ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS delivery_partner VARCHAR(20);

CREATE TABLE IF NOT EXISTS "DELIVERY_COD_SETTLEMENT" (
  settlement_id     SERIAL PRIMARY KEY,
  b_id              INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  delivery_partner  VARCHAR(20) NOT NULL,
  amount            NUMERIC(10,2) NOT NULL,
  settled_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  method            VARCHAR(30) CHECK (method IN ('cash','bank_transfer','online','other')),
  note              VARCHAR(255),
  created_by        INTEGER REFERENCES "User"(u_id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS cod_settlement_id INTEGER
  REFERENCES "DELIVERY_COD_SETTLEMENT"(settlement_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_outstanding_cod
  ON "ORDER"(delivery_partner) WHERE payment_method = 'cod' AND cod_settlement_id IS NULL;
