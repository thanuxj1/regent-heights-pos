-- =============================================================
-- Where staff are allowed to sign in from.
--
-- A cashier signing in from home is unsupervised, and the account is the same
-- one that can void sales. A hotel has one internet connection, so the property
-- itself is a usable fence.
--
-- Three deliberate safety choices, because the failure mode here is locking the
-- whole front desk out during service:
--
--   * OPT-IN. A property with no rows in this table allows every address. The
--     feature does nothing until someone adds a rule on purpose.
--   * OWNERS ARE NEVER FENCED. Branch Admin, Admin and Super Admin can always
--     sign in, from anywhere. Otherwise a changed ISP address locks out the one
--     person who could fix it.
--   * Rules can be switched off without deleting them, so a bad rule is undone
--     in one click rather than retyped under pressure.
-- =============================================================

CREATE TABLE IF NOT EXISTS "LOGIN_LOCATION" (
  location_id  SERIAL PRIMARY KEY,
  b_id         INTEGER NOT NULL REFERENCES "Branch"("B_id") ON DELETE CASCADE,

  -- An address or a range: 203.0.113.7, or 203.0.113.0/24 for the whole office.
  cidr         CIDR NOT NULL,
  label        VARCHAR(80) NOT NULL,

  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (b_id, cidr)
);

CREATE INDEX IF NOT EXISTS idx_login_location_branch
  ON "LOGIN_LOCATION"(b_id) WHERE is_active;
