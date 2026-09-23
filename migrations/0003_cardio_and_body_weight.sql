-- Cardio sessions: minutes are the main measure, distance is optional.
CREATE TABLE IF NOT EXISTS cardio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  performed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  activity TEXT NOT NULL CHECK (length(activity) BETWEEN 1 AND 60),
  minutes REAL NOT NULL CHECK (minutes > 0 AND minutes <= 600),
  distance_km REAL CHECK (distance_km IS NULL OR (distance_km > 0 AND distance_km <= 200))
);
CREATE INDEX IF NOT EXISTS cardio_time ON cardio (performed_at DESC);

-- Body weight: at most one weigh-in per local date. Saving again on the same day replaces it.
CREATE TABLE IF NOT EXISTS body_weight (
  measured_on TEXT PRIMARY KEY CHECK (measured_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  weight_kg REAL NOT NULL CHECK (weight_kg BETWEEN 20 AND 400)
);
