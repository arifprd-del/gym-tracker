// Pure helpers shared by the API and the dashboard. Nothing here touches the database, so it is easy to test.

export type SetRow = {
  id: number;
  performed_at: string; // UTC ISO-8601
  exercise: string; // normalised: lower case, single spaces
  weight_kg: number;
  reps: number;
  rpe: number | null;
  note: string | null;
};

/** "  Bench   Press " -> "bench press", so voice input and list picks land on the same exercise. */
export function normalizeExercise(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "bench press" -> "Bench Press" for speaking and display. */
export function displayName(exercise: string): string {
  return exercise.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Estimated one-rep max (Epley). A single rep is its own max. */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** 80 -> "80", 82.5 -> "82.5", 80.04 -> "80". */
export function formatKg(kg: number): string {
  return String(Math.round(kg * 10) / 10);
}

/** Calendar day (YYYY-MM-DD) of a UTC timestamp in the given time zone. */
export function localDay(iso: string | Date, timeZone: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Adds whole days to a YYYY-MM-DD string. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing the given YYYY-MM-DD. */
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export function volume(sets: Pick<SetRow, "weight_kg" | "reps">[]): number {
  return sets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0);
}

export type DaySummary = { sets: number; volumeKg: number; exercises: { exercise: string; sets: number; topKg: number }[] };

export function summarizeSets(sets: SetRow[]): DaySummary {
  const byExercise = new Map<string, { exercise: string; sets: number; topKg: number }>();
  for (const s of sets) {
    const entry = byExercise.get(s.exercise) ?? { exercise: s.exercise, sets: 0, topKg: 0 };
    entry.sets += 1;
    entry.topKg = Math.max(entry.topKg, s.weight_kg);
    byExercise.set(s.exercise, entry);
  }
  return { sets: sets.length, volumeKg: volume(sets), exercises: [...byExercise.values()] };
}

/** "82.5 kg × 5", or "12 reps" for bodyweight sets. */
export function formatLoad(set: Pick<SetRow, "weight_kg" | "reps">): string {
  return set.weight_kg > 0 ? `${formatKg(set.weight_kg)} kg × ${set.reps}` : `${set.reps} reps`;
}

/** Confirmation shown after logging a set. */
export function loggedSetMessage(
  set: Pick<SetRow, "exercise" | "weight_kg" | "reps">,
  setNumberToday: number,
  personalBest: boolean,
): string {
  const message = `${displayName(set.exercise)} ${formatLoad(set)} · set ${setNumberToday}`;
  return personalBest ? `${message} · new personal best!` : message;
}

/**
 * Consecutive weeks, ending this week, with at least one training day. The current week counts only once it has a
 * session, but an empty current week does not break a streak that ran up to last week.
 */
export function weekStreak(trainingDays: Iterable<string>, today: string): number {
  const weeks = new Set([...trainingDays].map(weekStart));
  let week = weekStart(today);
  if (!weeks.has(week)) week = addDays(week, -7);
  let streak = 0;
  while (weeks.has(week)) {
    streak += 1;
    week = addDays(week, -7);
  }
  return streak;
}

// ---------------------------------------------------------------------------------------------------------------------
// Push / pull / legs split. An exercise's day comes from the exercises table; anything not in it counts as "other".

export const SPLIT_DAYS = ["push", "pull", "legs"] as const;
export type SplitDay = (typeof SPLIT_DAYS)[number];
export type WorkoutDay = SplitDay | "other";
export const WORKOUT_DAYS: readonly WorkoutDay[] = [...SPLIT_DAYS, "other"];

export type DayOf = (exercise: string) => WorkoutDay;

export function dayLookup(exercises: { name: string; day: SplitDay }[]): DayOf {
  const map = new Map(exercises.map((e) => [e.name, e.day]));
  return (exercise) => map.get(exercise) ?? "other";
}

function emptyByDay(): Record<WorkoutDay, number> {
  return { push: 0, pull: 0, legs: 0, other: 0 };
}

/** Volume per week split by workout day, oldest week first, including empty weeks. */
export function weeklyVolumeByDay(
  sets: SetRow[],
  dayOf: DayOf,
  timeZone: string,
  weeks: number,
  now = new Date(),
): { week: string; byDay: Record<WorkoutDay, number>; volumeKg: number }[] {
  const thisWeek = weekStart(localDay(now, timeZone));
  const totals = new Map<string, Record<WorkoutDay, number>>();
  for (let i = weeks - 1; i >= 0; i--) totals.set(addDays(thisWeek, -7 * i), emptyByDay());
  for (const s of sets) {
    const week = totals.get(weekStart(localDay(s.performed_at, timeZone)));
    if (week) week[dayOf(s.exercise)] += s.weight_kg * s.reps;
  }
  return [...totals].map(([week, byDay]) => ({
    week,
    byDay,
    volumeKg: WORKOUT_DAYS.reduce((sum, d) => sum + byDay[d], 0),
  }));
}

export type TrainingDay = { sets: number; byDay: Record<WorkoutDay, number>; main: WorkoutDay };

/** Each local date with sets, how many of each workout type, and the type with the most sets (the day's colour). */
export function trainingDaysByType(sets: SetRow[], dayOf: DayOf, timeZone: string): Map<string, TrainingDay> {
  const days = new Map<string, TrainingDay>();
  for (const s of sets) {
    const date = localDay(s.performed_at, timeZone);
    const entry = days.get(date) ?? { sets: 0, byDay: emptyByDay(), main: "other" as WorkoutDay };
    entry.sets += 1;
    entry.byDay[dayOf(s.exercise)] += 1;
    days.set(date, entry);
  }
  for (const entry of days.values()) {
    // Ties go to the earlier type in push, pull, legs, other order.
    entry.main = WORKOUT_DAYS.reduce((best, d) => (entry.byDay[d] > entry.byDay[best] ? d : best), WORKOUT_DAYS[0]);
  }
  return days;
}

/** Most recent date each split day was the main workout, or null if not in the window. */
export function lastTrained(days: Map<string, TrainingDay>): Record<SplitDay, string | null> {
  const last: Record<SplitDay, string | null> = { push: null, pull: null, legs: null };
  for (const [date, entry] of days) {
    if (entry.main === "other") continue;
    const current = last[entry.main];
    if (!current || date > current) last[entry.main] = date;
  }
  return last;
}

/** "Today", "Yesterday", "3 days ago". */
export function daysAgo(date: string, today: string): string {
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return `${diff} days ago`;
}
