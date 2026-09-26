-- Protein eaten, one row per tap on the dashboard's Protein card.
CREATE TABLE IF NOT EXISTS protein (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  grams INTEGER NOT NULL CHECK (grams BETWEEN 1 AND 300)
);
CREATE INDEX IF NOT EXISTS protein_time ON protein (logged_at DESC);
