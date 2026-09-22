-- The floor's view of the kitchen.
--
-- When an order last changed status. The waiter's Kitchen Status board keeps a
-- "Ready" order on screen for a while after the kitchen marks it ready and then
-- lets it go; without a time there was no telling a dish plated a minute ago
-- from one served last week. Orders already finished keep NULL and stay off the
-- board.
ALTER TABLE "ORDER" ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- The board reads a property's open orders and its recently-ready ones on every
-- change in the kitchen, from every floor screen. Small partial indexes keep
-- that cheap however long the order history grows.
CREATE INDEX IF NOT EXISTS order_open_idx
  ON "ORDER" (b_id) WHERE or_status IN ('pending', 'preparing');
CREATE INDEX IF NOT EXISTS order_ready_idx
  ON "ORDER" (b_id, status_changed_at) WHERE or_status = 'completed';

-- A property's orders by day: the till's history, the reports, the day's close.
CREATE INDEX IF NOT EXISTS order_branch_day_idx ON "ORDER" (b_id, or_date DESC);

-- An order's dishes. There was no index here at all, so every lookup of an
-- order's lines — the board, the kitchen, putting stock back — read the whole
-- table.
CREATE INDEX IF NOT EXISTS order_item_order_idx ON "ORDER_ITEM" (order_id);
