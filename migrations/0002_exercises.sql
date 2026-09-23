-- Exercise buttons on the /log page, grouped into a push / pull / legs split. Names are normalised like sets.exercise.
CREATE TABLE IF NOT EXISTS exercises (
  name TEXT PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 80),
  day TEXT NOT NULL CHECK (day IN ('push', 'pull', 'legs')),
  position INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO exercises (name, day, position) VALUES
  ('bench press', 'push', 1),
  ('incline dumbbell press', 'push', 2),
  ('overhead press', 'push', 3),
  ('lateral raise', 'push', 4),
  ('chest fly', 'push', 5),
  ('tricep pushdown', 'push', 6),
  ('overhead tricep extension', 'push', 7),
  ('dips', 'push', 8),
  ('pull up', 'pull', 1),
  ('barbell row', 'pull', 2),
  ('lat pulldown', 'pull', 3),
  ('seated cable row', 'pull', 4),
  ('face pull', 'pull', 5),
  ('rear delt fly', 'pull', 6),
  ('bicep curl', 'pull', 7),
  ('hammer curl', 'pull', 8),
  ('squat', 'legs', 1),
  ('romanian deadlift', 'legs', 2),
  ('leg press', 'legs', 3),
  ('leg extension', 'legs', 4),
  ('leg curl', 'legs', 5),
  ('walking lunge', 'legs', 6),
  ('calf raise', 'legs', 7),
  ('hip thrust', 'legs', 8);
