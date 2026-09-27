-- Longevity exercises: hangs and carries on Pull day (timed, in seconds), jumps first on Legs day.
INSERT OR IGNORE INTO exercises (name, day, position, target_sets, target_reps_min, target_reps_max) VALUES
  ('dead hang', 'pull', 9, 3, 20, 60),
  ('farmers carry', 'pull', 10, 3, 40, 60),
  ('pogo hops', 'legs', 0, 2, 20, 30),
  ('broad jump', 'legs', 0, 3, 5, 5);

-- The daily mobility routine on the Longevity page: one row per item done per local day.
CREATE TABLE IF NOT EXISTS mobility (
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  item TEXT NOT NULL CHECK (item IN ('squat', 'stretch', 'pogo', 'hang')),
  done_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (day, item)
);

-- A mobility reminder: rebuild the reminders table to allow the new key (SQLite can't change a CHECK in place).
CREATE TABLE reminders_new (
  key TEXT PRIMARY KEY CHECK (key IN ('gym', 'brain', 'weekly', 'mobility')),
  enabled INTEGER NOT NULL DEFAULT 1,
  time TEXT NOT NULL CHECK (time GLOB '[0-2][0-9]:[0-5][0-9]'),
  days TEXT NOT NULL,
  last_sent_day TEXT
);
INSERT INTO reminders_new (key, enabled, time, days, last_sent_day) SELECT key, enabled, time, days, last_sent_day FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_new RENAME TO reminders;
INSERT OR IGNORE INTO reminders (key, time, days) VALUES ('mobility', '08:30', '0,1,2,3,4,5,6');
