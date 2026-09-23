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

// ---------------------------------------------------------------------------------------------------------------------
// Cardio and body weight

export type CardioRow = {
  id: number;
  performed_at: string; // UTC ISO-8601
  activity: string; // normalised like exercise names
  minutes: number;
  distance_km: number | null;
};

export type BodyWeightRow = { measured_on: string; weight_kg: number }; // measured_on is a local YYYY-MM-DD

/** 25 -> "25 min", 90 -> "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const rest = total % 60;
  return rest ? `${Math.floor(total / 60)} h ${rest} min` : `${total / 60} h`;
}

/** "30 min · 4.5 km", or "30 min" without a distance. */
export function formatCardio(c: Pick<CardioRow, "minutes" | "distance_km">): string {
  return c.distance_km ? `${formatMinutes(c.minutes)} · ${formatKg(c.distance_km)} km` : formatMinutes(c.minutes);
}

/** Confirmation shown after logging cardio. */
export function cardioMessage(c: Pick<CardioRow, "activity" | "minutes" | "distance_km">, minutesToday: number): string {
  const message = `${displayName(c.activity)} ${formatCardio(c)}`;
  return minutesToday > c.minutes ? `${message} · ${formatMinutes(minutesToday)} cardio today` : message;
}

/** Cardio minutes per local date. */
export function cardioMinutesPerDay(rows: CardioRow[], timeZone: string): Map<string, number> {
  const days = new Map<string, number>();
  for (const c of rows) {
    const day = localDay(c.performed_at, timeZone);
    days.set(day, (days.get(day) ?? 0) + c.minutes);
  }
  return days;
}

/** Cardio minutes per week (Monday start) for the last `weeks` weeks, oldest first, including empty weeks. */
export function weeklyCardioMinutes(rows: CardioRow[], timeZone: string, weeks: number, now = new Date()): { week: string; minutes: number }[] {
  const thisWeek = weekStart(localDay(now, timeZone));
  const totals = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) totals.set(addDays(thisWeek, -7 * i), 0);
  for (const c of rows) {
    const week = weekStart(localDay(c.performed_at, timeZone));
    if (totals.has(week)) totals.set(week, totals.get(week)! + c.minutes);
  }
  return [...totals].map(([week, minutes]) => ({ week, minutes }));
}

/** The last weigh-in of each week for the last `weeks` weeks, oldest first; null for weeks with no weigh-in. */
export function weeklyBodyWeight(rows: BodyWeightRow[], weeks: number, today: string): { week: string; kg: number | null }[] {
  const thisWeek = weekStart(today);
  const latest = new Map<string, BodyWeightRow | null>();
  for (let i = weeks - 1; i >= 0; i--) latest.set(addDays(thisWeek, -7 * i), null);
  for (const r of rows) {
    const week = weekStart(r.measured_on);
    if (!latest.has(week)) continue;
    const current = latest.get(week);
    if (!current || r.measured_on > current.measured_on) latest.set(week, r);
  }
  return [...latest].map(([week, r]) => ({ week, kg: r ? r.weight_kg : null }));
}

/** Latest weigh-in and the change since the weigh-in closest to `days` days before it (null if there is none). */
export function bodyWeightTrend(rows: BodyWeightRow[], days = 28): { latest: BodyWeightRow | null; changeKg: number | null; since: string | null } {
  if (rows.length === 0) return { latest: null, changeKg: null, since: null };
  const sorted = [...rows].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
  const latest = sorted[sorted.length - 1];
  const target = addDays(latest.measured_on, -days);
  const earlier = sorted.filter((r) => r.measured_on <= target).pop() ?? (sorted.length > 1 ? sorted[0] : null);
  if (!earlier || earlier === latest) return { latest, changeKg: null, since: null };
  return { latest, changeKg: Math.round((latest.weight_kg - earlier.weight_kg) * 10) / 10, since: earlier.measured_on };
}
