-- Monthly longevity check: one row per test done. value: sit_rise score 0-10, hang seconds, cooper km in 12 minutes.
CREATE TABLE IF NOT EXISTS fitness_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  test TEXT NOT NULL CHECK (test IN ('sit_rise', 'hang', 'cooper')),
  value REAL NOT NULL CHECK (value >= 0 AND value <= 600)
);
CREATE INDEX IF NOT EXISTS fitness_tests_day ON fitness_tests (test, day);

-- Blood pressure readings at home (mmHg), with the pulse if the cuff shows it.
CREATE TABLE IF NOT EXISTS blood_pressure (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  systolic INTEGER NOT NULL CHECK (systolic BETWEEN 60 AND 260),
  diastolic INTEGER NOT NULL CHECK (diastolic BETWEEN 30 AND 160),
  pulse INTEGER CHECK (pulse IS NULL OR pulse BETWEEN 25 AND 220)
);

-- Waist at the navel, one per day (saving again replaces it). Height for the waist-to-height ratio is in settings.
CREATE TABLE IF NOT EXISTS waist (
  day TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  cm REAL NOT NULL CHECK (cm BETWEEN 40 AND 200)
);
