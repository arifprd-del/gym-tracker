-- Sets x reps targets per exercise button, e.g. 3 x 5-8. Null means no target.
ALTER TABLE exercises ADD COLUMN target_sets INTEGER CHECK (target_sets IS NULL OR target_sets BETWEEN 1 AND 10);
ALTER TABLE exercises ADD COLUMN target_reps_min INTEGER CHECK (target_reps_min IS NULL OR target_reps_min BETWEEN 1 AND 100);
ALTER TABLE exercises ADD COLUMN target_reps_max INTEGER CHECK (target_reps_max IS NULL OR target_reps_max BETWEEN 1 AND 100);

-- Starting targets: 3 x 5-8 for the big compound lifts, 3 x 6-10 for pull-ups and dips, 3 x 8-12 for everything else.
UPDATE exercises SET target_sets = 3, target_reps_min = 8, target_reps_max = 12 WHERE target_sets IS NULL;
UPDATE exercises SET target_reps_min = 5, target_reps_max = 8
  WHERE name IN ('bench press', 'overhead press', 'barbell row', 'squat', 'romanian deadlift', 'incline dumbbell press');
UPDATE exercises SET target_reps_min = 6, target_reps_max = 10 WHERE name IN ('pull up', 'dips');
