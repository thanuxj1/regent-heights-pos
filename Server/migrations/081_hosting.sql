-- 081 — the hosting is paid up to a date, and the system says so as it nears.
--
-- One row. The developer's Super Admin login marks a year paid; nobody at the
-- property can, so the reminder cannot be switched off from inside the shop.
CREATE TABLE IF NOT EXISTS hosting_plan (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  paid_until  DATE NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  INTEGER
);
-- Regent Heights is paid up to 1 Oct 2027.
INSERT INTO hosting_plan (id, paid_until) VALUES (1, '2027-10-01') ON CONFLICT (id) DO NOTHING;
