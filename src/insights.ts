// Sleep vs performance: compares days after short nights (under 7 hours) with days after 7+ hours.
// Each measure is taken relative to your own recent level, so steady improvement from training doesn't look like a
// sleep effect. Needs a few days of each kind before it says anything.
import { exerciseSessions, type SetRow } from "./lib";

export const SHORT_NIGHT_MINUTES = 7 * 60;
export const MIN_DAYS_EACH = 3;

export type DayValue = { day: string; value: number };
export type Relative = { day: string; pct: number }; // % above (+) or below (−) your recent level

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Each point as a % of the median of the `window` points before it; points with fewer than `minPrior` earlier are skipped. */
export function relativeToRecent(points: DayValue[], window = 7, minPrior = 3): Relative[] {
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const out: Relative[] = [];
  sorted.forEach((p, i) => {
    const prior = sorted.slice(Math.max(0, i - window), i).map((q) => q.value);
    if (prior.length < minPrior) return;
    const base = median(prior);
    if (base > 0) out.push({ day: p.day, pct: (p.value / base - 1) * 100 });
  });
  return out;
}

/**
 * Lifting strength per training day: each exercise's best estimated 1RM (best reps for bodyweight moves) against the
 * median of its previous 3 sessions, averaged over the day's exercises. Exercises with under 2 earlier sessions are skipped.
 */
export function strengthByDay(sets: SetRow[], timeZone: string): Relative[] {
  const byExercise = new Map<string, SetRow[]>();
  for (const s of sets) byExercise.set(s.exercise, [...(byExercise.get(s.exercise) ?? []), s]);
  const perDay = new Map<string, number[]>();
  for (const rows of byExercise.values()) {
    const sessions = exerciseSessions(rows, timeZone);
    sessions.forEach((s, i) => {
      const prior = sessions.slice(Math.max(0, i - 3), i);
      if (prior.length < 2) return;
      const measure = (x: typeof s) => (s.topWeight === 0 ? x.bestReps : x.bestE1rm);
      const base = median(prior.map(measure));
      if (base > 0) perDay.set(s.day, [...(perDay.get(s.day) ?? []), (measure(s) / base - 1) * 100]);
    });
  }
  return [...perDay].map(([day, pcts]) => ({ day, pct: pcts.reduce((a, b) => a + b, 0) / pcts.length })).sort((a, b) => a.day.localeCompare(b.day));
}

export type SleepComparison = {
  key: string;
  label: string;
  short: { n: number; avgPct: number };
  good: { n: number; avgPct: number };
  ready: boolean; // at least MIN_DAYS_EACH days after each kind of night
  diffPct: number | null; // how much worse (+) or better (−) after short nights, in % of your usual level
  sentence: string | null;
};

type Metric = { key: string; label: string; better: "lower" | "higher"; worse: string; improved: string; what: string };

export const METRICS = {
  speed: { key: "speed", label: "Quick Glance speed", better: "lower", worse: "slower", improved: "faster", what: "your Quick Glance flash was" },
  strength: { key: "strength", label: "Lifting strength", better: "higher", worse: "weaker", improved: "stronger", what: "your lifts were" },
  reaction: { key: "reaction", label: "Reaction time", better: "lower", worse: "slower", improved: "faster", what: "your reaction time was" },
  symbols: { key: "symbols", label: "Symbol matching", better: "higher", worse: "lower", improved: "higher", what: "your symbol score was" },
} satisfies Record<string, Metric>;

/** Days after short nights vs days after 7+ hour nights. `sleep` is keyed by the day the night ended. */
export function compareBySleep(metric: Metric, values: Relative[], sleep: Map<string, number>): SleepComparison {
  const groups = { short: [] as number[], good: [] as number[] };
  for (const v of values) {
    const minutes = sleep.get(v.day);
    if (minutes === undefined) continue;
    (minutes < SHORT_NIGHT_MINUTES ? groups.short : groups.good).push(v.pct);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const short = { n: groups.short.length, avgPct: avg(groups.short) };
  const good = { n: groups.good.length, avgPct: avg(groups.good) };
  const ready = short.n >= MIN_DAYS_EACH && good.n >= MIN_DAYS_EACH;
  if (!ready) return { key: metric.key, label: metric.label, short, good, ready, diffPct: null, sentence: null };

  // Positive = worse after short nights, whichever direction is better for this measure.
  const diff = (short.avgPct - good.avgPct) * (metric.better === "lower" ? 1 : -1);
  const size = Math.round(Math.abs(diff));
  const sentence =
    size < 2
      ? `After nights under 7 h, ${metric.what} about the same as after 7 h+ nights.`
      : `After nights under 7 h, ${metric.what} ${size}% ${diff > 0 ? metric.worse : metric.improved} than after 7 h+ nights.`;
  return { key: metric.key, label: metric.label, short, good, ready, diffPct: Math.round(diff * 10) / 10, sentence };
}

/** All four comparisons from the raw data. */
export function sleepInsights(input: {
  sleep: { day: string; minutes: number }[];
  speedDaily: DayValue[]; // best flash (ms) per day
  sets: SetRow[];
  checks: { day: string; pvtMedianMs: number; dsstCorrect: number }[];
  timeZone: string;
}): SleepComparison[] {
  const sleep = new Map(input.sleep.map((r) => [r.day, r.minutes]));
  const checkPoints = (pick: (c: (typeof input.checks)[number]) => number) => input.checks.map((c) => ({ day: c.day, value: pick(c) }));
  return [
    compareBySleep(METRICS.speed, relativeToRecent(input.speedDaily), sleep),
    compareBySleep(METRICS.strength, strengthByDay(input.sets, input.timeZone), sleep),
    compareBySleep(METRICS.reaction, relativeToRecent(checkPoints((c) => c.pvtMedianMs), 4, 2), sleep),
    compareBySleep(METRICS.symbols, relativeToRecent(checkPoints((c) => c.dsstCorrect), 4, 2), sleep),
  ];
}

