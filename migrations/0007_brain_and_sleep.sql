-- Quick Glance speed-training rounds. final_ms carries the difficulty over to the next round.
CREATE TABLE IF NOT EXISTS speed_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  performed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  best_ms REAL CHECK (best_ms IS NULL OR best_ms BETWEEN 1 AND 2000),
  final_ms REAL NOT NULL CHECK (final_ms BETWEEN 1 AND 2000),
  hits INTEGER NOT NULL CHECK (hits >= 0),
  trials INTEGER NOT NULL CHECK (trials BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS speed_rounds_time ON speed_rounds (performed_at DESC);

-- Weekly Brain Check: a reaction-time test (PVT) and a symbol-matching test (DSST).
CREATE TABLE IF NOT EXISTS brain_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  performed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  pvt_median_ms REAL NOT NULL CHECK (pvt_median_ms BETWEEN 50 AND 5000),
  pvt_lapses INTEGER NOT NULL CHECK (pvt_lapses >= 0),
  pvt_false_starts INTEGER NOT NULL CHECK (pvt_false_starts >= 0),
  dsst_correct INTEGER NOT NULL CHECK (dsst_correct >= 0),
  dsst_errors INTEGER NOT NULL CHECK (dsst_errors >= 0)
);
CREATE INDEX IF NOT EXISTS brain_checks_time ON brain_checks (performed_at DESC);

-- Sleep per night, keyed by the local date the night ended (the morning you woke up).
CREATE TABLE IF NOT EXISTS sleep (
  day TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
