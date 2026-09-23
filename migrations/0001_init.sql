-- One row per logged set. Times are UTC ISO-8601 strings so they sort and compare as text.
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  performed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  exercise TEXT NOT NULL CHECK (length(exercise) BETWEEN 1 AND 80),
  weight_kg REAL NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  reps INTEGER NOT NULL CHECK (reps BETWEEN 1 AND 200),
  rpe REAL CHECK (rpe BETWEEN 1 AND 10),
  note TEXT
);
CREATE INDEX IF NOT EXISTS sets_exercise_time ON sets (exercise, performed_at DESC);
CREATE INDEX IF NOT EXISTS sets_time ON sets (performed_at DESC);
