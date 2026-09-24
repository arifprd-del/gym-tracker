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

// ---------------------------------------------------------------------------------------------------------------------
// Habit features: today's plan, the weekly checklist, "never miss twice" nudges and "beat last time" targets.

const NEXT_DAY: Record<SplitDay, SplitDay> = { push: "pull", pull: "legs", legs: "push" };

/**
 * Next workout in the push -> pull -> legs rotation, following the most recent day whose main type was a split day.
 * If that day is today, it is also returned as `doneToday`.
 */
export function todaysPlan(days: Map<string, TrainingDay>, today: string): { next: SplitDay; doneToday: SplitDay | null } {
  let lastDate = "";
  let lastDay: SplitDay | null = null;
  for (const [date, entry] of days) {
    if (entry.main === "other" || date > today) continue;
    if (date > lastDate) {
      lastDate = date;
      lastDay = entry.main;
    }
  }
  if (!lastDay) return { next: "push", doneToday: null };
  return { next: NEXT_DAY[lastDay], doneToday: lastDate === today ? lastDay : null };
}

export type ChecklistItem = { key: string; label: string; done: boolean; detail: string };

/** This week's (Monday to Sunday) goals: each split day once, the cardio minutes goal and a weigh-in. */
export function weeklyChecklist(input: {
  days: Map<string, TrainingDay>;
  cardioMinutesThisWeek: number;
  cardioGoalMinutes: number;
  weighedInThisWeek: boolean;
  today: string;
}): ChecklistItem[] {
  const thisWeek = weekStart(input.today);
  const doneOn = (day: SplitDay) =>
    [...input.days]
      .filter(([date, entry]) => date >= thisWeek && date <= input.today && entry.main === day)
      .map(([date]) => date)
      .sort()[0];
  const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const items: ChecklistItem[] = SPLIT_DAYS.map((day) => {
    const date = doneOn(day);
    return { key: day, label: day[0].toUpperCase() + day.slice(1), done: Boolean(date), detail: date ? weekday(date) : "" };
  });
  const minutes = Math.round(input.cardioMinutesThisWeek);
  items.push({
    key: "cardio",
    label: "Cardio",
    done: minutes >= input.cardioGoalMinutes,
    detail: `${minutes}/${input.cardioGoalMinutes} min`,
  });
  items.push({ key: "weigh-in", label: "Weigh-in", done: input.weighedInThisWeek, detail: "" });
  return items;
}

/**
 * A gentle "never miss twice" nudge, or null. `activeDays` are dates with any training (lifting or cardio).
 * A normal Friday-to-Monday weekend is a 3-day gap, so the nudge starts after 4 days.
 */
export function habitNudge(input: {
  activeDays: Iterable<string>;
  weekStreak: number;
  today: string;
  next: SplitDay;
}): string | null {
  const dates = [...input.activeDays].filter((d) => d <= input.today).sort();
  const last = dates[dates.length - 1];
  const label = input.next[0].toUpperCase() + input.next.slice(1);
  if (!last || last === input.today) return null;
  const gap = Math.round((Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000);
  const weekday = new Date(`${input.today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const thisWeek = weekStart(input.today);
  const lateInWeek = weekday === 0 || weekday >= 5;
  if (input.weekStreak > 0 && last < thisWeek && lateInWeek) {
    return `No session yet this week. One ${label} day keeps your ${input.weekStreak}-week streak going.`;
  }
  if (gap >= 4) return `It's been ${gap} days. Missing once is fine, never miss twice: ${label} today.`;
  return null;
}

export type LastSession = { day: string; weight: number; reps: number };

/** For each exercise, the best set (heaviest, then most reps) from the most recent day before today. */
export function lastSessionBest(sets: SetRow[], timeZone: string, today: string): Map<string, LastSession> {
  const best = new Map<string, LastSession>();
  for (const s of sets) {
    const day = localDay(s.performed_at, timeZone);
    if (day >= today) continue;
    const current = best.get(s.exercise);
    const better =
      !current ||
      day > current.day ||
      (day === current.day && (s.weight_kg > current.weight || (s.weight_kg === current.weight && s.reps > current.reps)));
    if (better) best.set(s.exercise, { day, weight: s.weight_kg, reps: s.reps });
  }
  return best;
}

/** Heavier, or the same weight for more reps. Bodyweight sets compare reps only. */
export function beats(set: { weight: number; reps: number }, previous: { weight: number; reps: number }): boolean {
  return set.weight > previous.weight || (set.weight === previous.weight && set.reps > previous.reps);
}

/** One-tap targets for beating last time: one more rep, or a small jump in weight at the same reps. */
export function beatTargets(previous: { weight: number; reps: number }): { weight: number; reps: number }[] {
  const moreReps = { weight: previous.weight, reps: previous.reps + 1 };
  if (previous.weight === 0) return [moreReps];
  const step = previous.weight >= 20 ? 2.5 : 1;
  return [moreReps, { weight: Math.round((previous.weight + step) * 10) / 10, reps: previous.reps }];
}

// ---------------------------------------------------------------------------------------------------------------------
// Steps (synced nightly from the iPhone Health app)

export type StepsRow = { day: string; steps: number };

/** Shortcuts may send 8423, 8423.0, "8423" or "8,423". Returns a whole number of steps, or null if unusable. */
export function parseSteps(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[\s,]/g, "")) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 200_000) return null;
  return Math.round(n);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** The last `days` dates up to and including `today`, oldest first, with steps or null when nothing was synced. */
export function dailySteps(rows: StepsRow[], days: number, today: string): { day: string; steps: number | null }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.steps]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i - days + 1);
    return { day, steps: byDay.get(day) ?? null };
  });
}

/** Headline numbers: today (if synced), yesterday, the average of synced days in the last 7 and this week's total. */
export function stepsSummary(rows: StepsRow[], today: string) {
  const byDay = new Map(rows.map((r) => [r.day, r.steps]));
  const last7 = Array.from({ length: 7 }, (_, i) => byDay.get(addDays(today, -i))).filter((s): s is number => s !== undefined);
  const thisWeek = weekStart(today);
  return {
    today: byDay.get(today) ?? null,
    yesterday: byDay.get(addDays(today, -1)) ?? null,
    average7: last7.length ? Math.round(last7.reduce((a, b) => a + b, 0) / last7.length) : null,
    thisWeek: rows.filter((r) => r.day >= thisWeek && r.day <= today).reduce((sum, r) => sum + r.steps, 0),
    lastSynced: rows.reduce<string | null>((latest, r) => (!latest || r.day > latest ? r.day : latest), null),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV export: sets, cardio and weigh-ins in one file, one row each, oldest first.

export const CSV_HEADER = ["type", "date", "time", "name", "weight_kg", "reps", "minutes", "distance_km", "rpe", "note"];

/** One CSV cell: quoted when needed, and text that a spreadsheet would run as a formula is made inert. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(input: { sets: SetRow[]; cardio: CardioRow[]; bodyWeight: BodyWeightRow[]; timeZone: string }): string {
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: input.timeZone });
  // Sort key: local date, then time; weigh-ins have no time and sort first on their day.
  const rows: { key: string; cells: unknown[] }[] = [
    ...input.sets.map((s) => {
      const date = localDay(s.performed_at, input.timeZone);
      return { key: `${date} ${time(s.performed_at)} ${s.performed_at}`, cells: ["set", date, time(s.performed_at), displayName(s.exercise), s.weight_kg, s.reps, null, null, s.rpe, s.note] };
    }),
    ...input.cardio.map((c) => {
      const date = localDay(c.performed_at, input.timeZone);
      return { key: `${date} ${time(c.performed_at)} ${c.performed_at}`, cells: ["cardio", date, time(c.performed_at), displayName(c.activity), null, null, c.minutes, c.distance_km, null, null] };
    }),
    ...input.bodyWeight.map((b) => ({ key: `${b.measured_on} 00:00`, cells: ["body weight", b.measured_on, null, null, b.weight_kg, null, null, null, null, null] })),
  ];
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return [CSV_HEADER.join(","), ...rows.map((r) => r.cells.map(csvCell).join(","))].join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-exercise progress

export type ExerciseSession = {
  day: string;
  sets: { weight: number; reps: number }[];
  topWeight: number;
  bestReps: number; // most reps in a set at the day's top weight
  bestE1rm: number;
  volumeKg: number;
  record: boolean; // heavier than any earlier session
};

/** One entry per local day for a single exercise's sets, oldest first, marking the days that set a weight record. */
export function exerciseSessions(sets: SetRow[], timeZone: string): ExerciseSession[] {
  const byDay = new Map<string, SetRow[]>();
  for (const s of [...sets].sort((a, b) => a.performed_at.localeCompare(b.performed_at))) {
    const day = localDay(s.performed_at, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  let bestSoFar = -1;
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, daySets]) => {
      const topWeight = Math.max(...daySets.map((s) => s.weight_kg));
      const session: ExerciseSession = {
        day,
        sets: daySets.map((s) => ({ weight: s.weight_kg, reps: s.reps })),
        topWeight,
        bestReps: Math.max(...daySets.filter((s) => s.weight_kg === topWeight).map((s) => s.reps)),
        bestE1rm: Math.max(...daySets.map((s) => estimateOneRepMax(s.weight_kg, s.reps))),
        volumeKg: volume(daySets),
        // The first session is a baseline, not a record; bodyweight moves count reps instead of weight.
        record: bestSoFar >= 0 && (topWeight > 0 ? topWeight > bestSoFar : false),
      };
      bestSoFar = Math.max(bestSoFar, topWeight);
      return session;
    });
}

/**
 * Change in the headline measure (best e1RM, or best reps for bodyweight moves) between the latest session and the
 * last session at least `days` days before it. Null when there is no such earlier session.
 */
export function progressChange(sessions: ExerciseSession[], days = 56): { change: number; since: string } | null {
  if (sessions.length < 2) return null;
  const latest = sessions[sessions.length - 1];
  const cutoff = addDays(latest.day, -days);
  const earlier = [...sessions].reverse().find((s) => s.day <= cutoff) ?? sessions[0];
  if (earlier === latest) return null;
  const bodyweight = latest.topWeight === 0 && earlier.topWeight === 0;
  const value = (s: ExerciseSession) => (bodyweight ? s.bestReps : s.bestE1rm);
  return { change: Math.round((value(latest) - value(earlier)) * 10) / 10, since: earlier.day };
}
