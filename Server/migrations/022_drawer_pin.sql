-- 022 — the cash drawer opens only with a PIN, and only the manager sets it.
--
-- Being signed in to the till used to be enough to open the drawer: take money
-- out, see what should be in it, close the shift. Now every drawer action needs
-- the property's drawer PIN as well.
--
-- The PIN is stored encrypted (AES-256-GCM, key held by the server), not hashed:
-- the manager has to be able to look it up to tell a cashier. A four-digit hash
-- would fall to 10,000 guesses anyway; without the server's key the stored value
-- is useless on its own.

CREATE TABLE IF NOT EXISTS "DRAWER_PIN" (
  b_id        INTEGER PRIMARY KEY REFERENCES "Branch"("B_id") ON DELETE CASCADE,
  pin_enc     TEXT NOT NULL,
  updated_by  INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
