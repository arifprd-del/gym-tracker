-- Small key/value settings. Holds the SHA-256 hash of the steps sync key made on the dashboard (never the key itself).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
