-- =============================================================
-- Activity log — who did what, and when.
--
-- The owner runs the property alone and wants a Facebook-style
-- feed: logins, deletions, price changes, check-ins. Rows are
-- append-only; nothing in the app updates or deletes them, so
-- the trail can't be quietly rewritten.
-- =============================================================

CREATE TABLE IF NOT EXISTS "ACTIVITY_LOG" (
  log_id      SERIAL PRIMARY KEY,

  -- Kept even if the staff member is later removed, so the trail survives.
  u_id        INTEGER REFERENCES "User"(u_id) ON DELETE SET NULL,
  actor_name  VARCHAR(150),
  role_id     INTEGER,
  b_id        INTEGER REFERENCES "Branch"("B_id") ON DELETE SET NULL,

  action      VARCHAR(30)  NOT NULL,   -- login, logout, create, update, delete, check_in, ...
  entity      VARCHAR(40)  NOT NULL,   -- product, booking, room, expense, order, user, ...
  entity_id   VARCHAR(40),
  summary     VARCHAR(300) NOT NULL,   -- human sentence shown in the feed
  details     JSONB,                   -- before/after, or anything worth keeping
  ip_address  VARCHAR(64),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON "ACTIVITY_LOG"(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_branch  ON "ACTIVITY_LOG"(b_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user    ON "ACTIVITY_LOG"(u_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity  ON "ACTIVITY_LOG"(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_action  ON "ACTIVITY_LOG"(action);
