-- =============================================================
-- Accountability at the till.
--
-- The hotel side logs who did what, with their IP. The restaurant till logged
-- nothing at all — and a cashier could delete a paid order outright, leaving no
-- record that the sale ever happened. That is the classic POS fraud: take the
-- cash, remove the sale, and the drawer still balances.
--
-- Two changes:
--   * an order is voided, never deleted — the row stays, with who, why and when
--   * money-sensitive actions can require a manager's approval PIN, recorded
--     against the action so "the manager said it was fine" is checkable
-- =============================================================

ALTER TABLE "ORDER"
  ADD COLUMN IF NOT EXISTS void_reason  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS voided_by    INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by  INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL;

-- A manager's approval PIN. bcrypt, never the PIN itself. NULL means this user
-- cannot approve anything.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS u_approval_pin VARCHAR(72);

-- Finding a stay's voided orders, and an owner reviewing today's voids, are both
-- "recent rows filtered by status" — worth an index once voids accumulate.
CREATE INDEX IF NOT EXISTS idx_order_voided ON "ORDER"(b_id, voided_at DESC)
  WHERE voided_at IS NOT NULL;
