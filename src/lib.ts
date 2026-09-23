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

/** Drops a trailing ".0" so Siri says "80 kilos", not "80.0 kilos". */
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

/** Sentence for Siri to speak after "how's my workout going?". */
export function describeDay(summary: DaySummary): string {
  if (summary.sets === 0) return "No sets logged today yet.";
  const parts = summary.exercises.map(
    (e) =>
      `${displayName(e.exercise)}: ${e.sets} ${e.sets === 1 ? "set" : "sets"}` +
      (e.topKg > 0 ? `, top ${formatKg(e.topKg)} kilos` : ""),
  );
  return `${summary.sets} ${summary.sets === 1 ? "set" : "sets"} today, ${Math.round(summary.volumeKg)} kilos of volume. ${parts.join(". ")}.`;
}

/** "80 kilos for 5", or "12 reps" for bodyweight sets. */
export function spokenLoad(set: Pick<SetRow, "weight_kg" | "reps">): string {
  return set.weight_kg > 0 ? `${formatKg(set.weight_kg)} kilos for ${set.reps}` : `${set.reps} reps`;
}

/** Sentence for Siri to speak after logging a set. */
export function describeLoggedSet(
  set: Pick<SetRow, "exercise" | "weight_kg" | "reps">,
  previousBestKg: number | null,
  setNumberToday: number,
): string {
  let message = `${displayName(set.exercise)}, ${spokenLoad(set)}. Set ${setNumberToday} logged.`;
  if (previousBestKg !== null && set.weight_kg > previousBestKg) message += " New personal best!";
  return message;
}

/** Total volume per week (Monday start) for the last `weeks` weeks, oldest first, including empty weeks. */
export function weeklyVolume(sets: SetRow[], timeZone: string, weeks: number, now = new Date()): { week: string; volumeKg: number }[] {
  const thisWeek = weekStart(localDay(now, timeZone));
  const totals = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) totals.set(addDays(thisWeek, -7 * i), 0);
  for (const s of sets) {
    const week = weekStart(localDay(s.performed_at, timeZone));
    if (totals.has(week)) totals.set(week, totals.get(week)! + s.weight_kg * s.reps);
  }
  return [...totals].map(([week, volumeKg]) => ({ week, volumeKg }));
}

/** Days (YYYY-MM-DD, local) with at least one set, mapped to how many sets were done. */
export function setsPerDay(sets: SetRow[], timeZone: string): Map<string, number> {
  const days = new Map<string, number>();
  for (const s of sets) {
    const day = localDay(s.performed_at, timeZone);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
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
