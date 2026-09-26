-- 039 — Per-user grantable permissions.
--
-- Access control was purely role_id-based until now: a cashier could never
-- get a single Branch-Admin-tier capability (Supplier Management, Reports,
-- ...) without being promoted to Branch Admin outright, which hands them
-- everything at once. The client wants the admin to grant (and later revoke)
-- individual capabilities to a specific cashier without changing their role.
--
-- This is a plain grant table, not a role — Branch Admin/Owner/Super Admin
-- already bypass every check and need no rows here. A row means "this user
-- has this capability regardless of role_id".
CREATE TABLE IF NOT EXISTS "USER_CAPABILITY" (
  u_id INTEGER NOT NULL REFERENCES "User"(u_id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  granted_by INTEGER REFERENCES "User"(u_id),
  granted_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (u_id, capability)
);
