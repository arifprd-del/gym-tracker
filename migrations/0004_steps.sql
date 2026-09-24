-- Daily step totals from the iPhone Health app, sent by a nightly Shortcuts automation.
-- One row per local date; syncing again replaces the total.
CREATE TABLE IF NOT EXISTS steps (
  day TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  steps INTEGER NOT NULL CHECK (steps BETWEEN 0 AND 200000),
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
