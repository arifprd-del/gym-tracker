-- Phones that turned on notifications (Web Push subscriptions). The endpoint is the push service URL for one device.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Reminder settings. time is local HH:MM (TIMEZONE), days a comma list of weekdays (0 = Sunday).
-- last_sent_day stops a reminder going out twice in a day.
CREATE TABLE IF NOT EXISTS reminders (
  key TEXT PRIMARY KEY CHECK (key IN ('gym', 'brain', 'weekly')),
  enabled INTEGER NOT NULL DEFAULT 1,
  time TEXT NOT NULL CHECK (time GLOB '[0-2][0-9]:[0-5][0-9]'),
  days TEXT NOT NULL,
  last_sent_day TEXT
);

INSERT OR IGNORE INTO reminders (key, time, days) VALUES
  ('gym', '17:30', '1,2,3,4,5'),
  ('brain', '20:00', '0,1,2,3,4,5,6'),
  ('weekly', '10:00', '0');
