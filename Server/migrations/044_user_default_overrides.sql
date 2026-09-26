-- 044 — Per-user revocable defaults.
--
-- USER_CAPABILITY (039) grants a slice of access a role does NOT have by
-- default. This is its mirror: a slice of access a role DOES have by
-- default, that an admin can switch off for one specific account without
-- touching the role itself — e.g. a cashier who should not be trusted with
-- the till this week, without demoting them off Cashier entirely.
--
-- A row means "this default is switched OFF for this user, regardless of
-- role_id". No row means the role's normal default applies. Branch Admin/
-- Owner/Super Admin are never subject to this — every default key here
-- names the one role it applies to, and the guard that checks it only ever
-- runs for that exact role_id.
CREATE TABLE IF NOT EXISTS "USER_DEFAULT_OVERRIDE" (
  u_id INTEGER NOT NULL REFERENCES "User"(u_id) ON DELETE CASCADE,
  default_key TEXT NOT NULL,
  revoked_by INTEGER REFERENCES "User"(u_id),
  revoked_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (u_id, default_key)
);
