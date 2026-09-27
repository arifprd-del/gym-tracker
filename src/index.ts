import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  bearerToken,
  createSession,
  newSyncKey,
  sha256Hex,
  isValidSession,
  safeEqual,
  safeNextPath,
  sessionNeedsRefresh,
} from "./auth";
import {
  SPLIT_DAYS,
  addDays,
  bodyWeightTrend,
  cardioMessage,
  cardioMinutesPerDay,
  formatCardio,
  beatTargets,
  habitNudge,
  isIsoDate,
  sleepMinutes,
  formatSleep,
  dayStreak,
  brainCheckDue,
  type SpeedRound,
  type BrainCheck,
  type SleepRow,
  parseSteps,
  dailySteps,
  exportCsv,
  exerciseSessions,
  progressChange,
  detectStall,
  stallsByExercise,
  recapWeekFor,
  weekRecap,
  workoutSummary,
  parseTarget,
  formatTarget,
  type Target,
  type WeekRecap,
  stepsSummary,
  lastSessionBest,
  todaysPlan,
  weeklyChecklist,
  BRAIN_DAYS_GOAL,
  isTimed,
  LONGEVITY_EXERCISES,
  MOBILITY_DAYS_GOAL,
  TIMED_PATTERN,
  PROTEIN_FALLBACK_G,
  proteinByDay,
  proteinTarget,
  type ProteinRow,
  dayLookup,
  displayName,
  formatLoad,
  lastTrained,
  localDay,
  loggedSetMessage,
  normalizeExercise,
  summarizeSets,
  trainingDaysByType,
  weekStart,
  weekStreak,
  weeklyBodyWeight,
  weeklyCardioMinutes,
  weeklyVolumeByDay,
  type BodyWeightRow,
  type CardioRow,
  type SetRow,
  type StepsRow,
} from "./lib";
import { brainPage } from "./brain-page";
import { sleepInsights } from "./insights";
import { INTERVAL_WALK, INTERVAL_WALKS_GOAL, MOBILITY_ITEMS, mobilityDays, type MobilityItem } from "./longevity";
import { longevityPage } from "./longevity-page";
import { isPushEndpoint, loadVapidKeys, sendPush, type PushSubscription } from "./push";
import { dueRules, isTime, localClock, REMINDER_KEYS, reminderMessage, type ReminderKey, type ReminderRule, type ReminderState } from "./reminders";
import { remindersPage } from "./reminders-page";
import { logPage, type ExerciseButton } from "./log-page";
import { dashboardPage, exercisePage, loginPage, recapPage, stepsKeyPage, summaryPage, type ExerciseRecord } from "./views";

type Env = {
  DB: D1Database;
  DASHBOARD_PASSWORD: string;
  TIMEZONE: string;
  CARDIO_WEEKLY_MINUTES?: string;
  /** Protein target in grams per kg of body weight (default 1.6). */
  PROTEIN_G_PER_KG?: string;
  STEPS_DAILY_GOAL?: string;
  /** Token the nightly iPhone Shortcuts automation sends to /sync/steps. It can only write step totals. */
  STEPS_TOKEN?: string;
};

function stepsGoal(env: Env): number {
  const goal = Number(env.STEPS_DAILY_GOAL);
  return Number.isFinite(goal) && goal > 0 ? goal : 8000;
}

function proteinPerKg(env: Env): number {
  const perKg = Number(env.PROTEIN_G_PER_KG);
  return Number.isFinite(perKg) && perKg > 0 ? perKg : 1.6;
}

function cardioGoal(env: Env): number {
  const goal = Number(env.CARDIO_WEEKLY_MINUTES);
  return Number.isFinite(goal) && goal > 0 ? goal : 90;
}

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------------------------------------------------
// Database helpers

const RECORD_E1RM = "MAX(CASE WHEN reps = 1 THEN weight_kg ELSE weight_kg * (1 + reps / 30.0) END)";

/** Sets from the last 36 hours that fall on today's local date. */
async function setsToday(db: D1Database, timeZone: string, exercise?: string): Promise<SetRow[]> {
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const today = localDay(new Date(), timeZone);
  const query = exercise
    ? db.prepare("SELECT * FROM sets WHERE performed_at >= ? AND exercise = ? ORDER BY performed_at").bind(since, exercise)
    : db.prepare("SELECT * FROM sets WHERE performed_at >= ? ORDER BY performed_at").bind(since);
  const { results } = await query.all<SetRow>();
  return results.filter((s) => localDay(s.performed_at, timeZone) === today);
}

/** Cardio from the last 36 hours that falls on today's local date. */
async function cardioToday(db: D1Database, timeZone: string): Promise<CardioRow[]> {
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const today = localDay(new Date(), timeZone);
  const { results } = await db.prepare("SELECT * FROM cardio WHERE performed_at >= ? ORDER BY performed_at").bind(since).all<CardioRow>();
  return results.filter((r) => localDay(r.performed_at, timeZone) === today);
}

/** Everything a weekly recap needs, for the Monday-to-Sunday week starting `week`. */
async function loadRecap(env: Env, week: string): Promise<WeekRecap> {
  const utc = (day: string) => new Date(`${day}T00:00:00Z`).toISOString();
  // A day of margin either side covers time zones; records compare against the year before.
  const from = utc(addDays(week, -366));
  const to = utc(addDays(week, 8));
  const [sets, cardio, bodyWeight, steps, exercises] = await Promise.all([
    env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ? AND performed_at < ?").bind(from, to).all<SetRow>(),
    env.DB.prepare("SELECT * FROM cardio WHERE performed_at >= ? AND performed_at < ?").bind(utc(addDays(week, -1)), to).all<CardioRow>(),
    env.DB.prepare("SELECT * FROM body_weight WHERE measured_on <= ?").bind(addDays(week, 6)).all<BodyWeightRow>(),
    env.DB.prepare("SELECT day, steps FROM steps WHERE day >= ? AND day <= ?").bind(week, addDays(week, 6)).all<StepsRow>(),
    env.DB.prepare("SELECT name, day FROM exercises").all<ExerciseButton>(),
  ]);
  const [rounds, sleep, protein] = await Promise.all([
    env.DB.prepare("SELECT performed_at FROM speed_rounds WHERE performed_at >= ? AND performed_at < ?").bind(utc(addDays(week, -1)), to).all<{ performed_at: string }>(),
    env.DB.prepare("SELECT day, minutes FROM sleep WHERE day >= ? AND day <= ?").bind(week, addDays(week, 6)).all<SleepRow>(),
    env.DB.prepare("SELECT * FROM protein WHERE logged_at >= ? AND logged_at < ?").bind(utc(addDays(week, -1)), to).all<ProteinRow>(),
  ]);
  const [mobilityRows, walks] = await Promise.all([
    env.DB.prepare("SELECT day, item FROM mobility WHERE day >= ? AND day <= ?").bind(week, addDays(week, 6)).all<{ day: string; item: string }>(),
    env.DB.prepare("SELECT performed_at FROM cardio WHERE activity = ? AND performed_at >= ? AND performed_at < ?").bind(INTERVAL_WALK, utc(addDays(week, -1)), to).all<{ performed_at: string }>(),
  ]);
  const mobilityDayCount = mobilityDays(mobilityRows.results).size;
  const intervalWalks = walks.results.filter((w) => { const d = localDay(w.performed_at, env.TIMEZONE); return d >= week && d <= addDays(week, 6); }).length;
  const proteinDays = [...proteinByDay(protein.results, env.TIMEZONE)].filter(([d]) => d >= week && d <= addDays(week, 6)).map(([, g]) => g);
  const latestWeight = [...bodyWeight.results].sort((a, b) => b.measured_on.localeCompare(a.measured_on))[0];
  const weekProteinTarget = proteinTarget(latestWeight?.weight_kg, proteinPerKg(env));
  const brainDays = new Set(rounds.results.map((r) => localDay(r.performed_at, env.TIMEZONE)).filter((d) => d >= week && d <= addDays(week, 6))).size;
  const sleepTotal = sleep.results.reduce((sum, r) => sum + r.minutes, 0);
  const recap = weekRecap({
    week,
    sets: sets.results,
    cardio: cardio.results,
    bodyWeight: bodyWeight.results,
    steps: steps.results,
    dayOf: dayLookup(exercises.results),
    timeZone: env.TIMEZONE,
    cardioGoal: cardioGoal(env),
    stepsGoal: stepsGoal(env),
  });
  return {
    ...recap,
    complete: recap.complete && brainDays >= BRAIN_DAYS_GOAL && mobilityDayCount >= MOBILITY_DAYS_GOAL,
    longevity: { mobilityDays: mobilityDayCount, mobilityGoal: MOBILITY_DAYS_GOAL, intervalWalks, intervalWalksGoal: INTERVAL_WALKS_GOAL },
    brain: { days: brainDays, goal: BRAIN_DAYS_GOAL },
    sleep: { averageMinutes: sleep.results.length ? Math.round(sleepTotal / sleep.results.length) : null, nights: sleep.results.length },
    protein: {
      averageG: proteinDays.length ? Math.round(proteinDays.reduce((a, b) => a + b, 0) / proteinDays.length) : null,
      daysLogged: proteinDays.length,
      daysAtTarget: proteinDays.filter((g) => g >= (weekProteinTarget ?? PROTEIN_FALLBACK_G)).length,
      target: weekProteinTarget,
    },
  };
}

type ExerciseRow = { name: string; day: SplitDayName; target_sets: number | null; target_reps_min: number | null; target_reps_max: number | null };
type SplitDayName = "push" | "pull" | "legs";

/** Exercise buttons with their sets x reps targets. */
async function loadExercises(db: D1Database): Promise<ExerciseButton[]> {
  const { results } = await db
    .prepare("SELECT name, day, target_sets, target_reps_min, target_reps_max FROM exercises ORDER BY day, position, name")
    .all<ExerciseRow>();
  return results.map((r) => ({
    name: r.name,
    day: r.day,
    target: r.target_sets && r.target_reps_min && r.target_reps_max ? { sets: r.target_sets, repsMin: r.target_reps_min, repsMax: r.target_reps_max } : null,
  }));
}

async function setSessionCookie(c: Context<{ Bindings: Env }>) {
  setCookie(c, SESSION_COOKIE, await createSession(c.env.DASHBOARD_PASSWORD), {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON API used by the /log page. It needs the signed-in session, and every response has a `message` to show.

app.use("/api/*", async (c, next) => {
  if (!(await isValidSession(getCookie(c, SESSION_COOKIE), c.env.DASHBOARD_PASSWORD))) {
    return c.json({ message: "You're signed out." }, 401);
  }
  // Only the page's own fetch() calls send JSON; a form on another site cannot, which blocks cross-site posts.
  if (!c.req.header("content-type")?.includes("application/json")) {
    return c.json({ message: "Expected JSON." }, 415);
  }
  await next();
});

async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => ({}));
}

const logSchema = z.object({
  exercise: z.string().trim().min(1).max(80),
  weight: z.number().min(0).max(1000),
  reps: z.number().int().min(1).max(200),
});

app.post("/api/log", async (c) => {
  const parsed = logSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ message: "Check the exercise, weight and reps." }, 400);
  const exercise = normalizeExercise(parsed.data.exercise);
  const previous = await c.env.DB.prepare("SELECT MAX(weight_kg) AS best FROM sets WHERE exercise = ?")
    .bind(exercise)
    .first<{ best: number | null }>();
  const set = await c.env.DB.prepare("INSERT INTO sets (exercise, weight_kg, reps) VALUES (?, ?, ?) RETURNING *")
    .bind(exercise, parsed.data.weight, parsed.data.reps)
    .first<SetRow>();
  if (!set) throw new Error("Insert returned no row");
  const setNumber = (await setsToday(c.env.DB, c.env.TIMEZONE, exercise)).length;
  const previousBest = previous?.best ?? null;
  const personalBest = previousBest !== null && set.weight_kg > previousBest;
  return c.json({ message: loggedSetMessage(set, setNumber, personalBest), personalBest, set });
});

const idSchema = z.object({ id: z.number().int().positive() });

// Undo on the log page: deletes the exact set it just logged.
app.post("/api/sets/delete", async (c) => {
  const parsed = idSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ message: "Nothing to undo." }, 400);
  const removed = await c.env.DB.prepare("DELETE FROM sets WHERE id = ? RETURNING *").bind(parsed.data.id).first<SetRow>();
  if (!removed) return c.json({ message: "That set was already removed." }, 404);
  return c.json({ message: `Removed ${displayName(removed.exercise)} ${formatLoad(removed)}`, removed });
});

const cardioSchema = z.object({
  activity: z.string().trim().min(1).max(60),
  minutes: z.number().positive().max(600),
  // 0 or missing means no distance was recorded.
  distance: z.number().min(0).max(200).optional(),
});

app.post("/api/cardio", async (c) => {
  const parsed = cardioSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ message: "Check the activity and minutes." }, 400);
  const activity = normalizeExercise(parsed.data.activity);
  const distance = parsed.data.distance ? parsed.data.distance : null;
  const row = await c.env.DB.prepare("INSERT INTO cardio (activity, minutes, distance_km) VALUES (?, ?, ?) RETURNING *")
    .bind(activity, parsed.data.minutes, distance)
    .first<CardioRow>();
  if (!row) throw new Error("Insert returned no row");
  const minutesToday = (await cardioToday(c.env.DB, c.env.TIMEZONE)).reduce((sum, r) => sum + r.minutes, 0);
  return c.json({ message: cardioMessage(row, minutesToday), cardio: row });
});

app.post("/api/cardio/delete", async (c) => {
  const parsed = idSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ message: "Nothing to undo." }, 400);
  const removed = await c.env.DB.prepare("DELETE FROM cardio WHERE id = ? RETURNING *").bind(parsed.data.id).first<CardioRow>();
  if (!removed) return c.json({ message: "That session was already removed." }, 404);
  return c.json({ message: `Removed ${displayName(removed.activity)} ${formatCardio(removed)}`, removed });
});

const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  day: z.enum(SPLIT_DAYS),
});

// Adds an exercise button to a day on the /log page (or moves it there if it already exists).
app.post("/api/exercises", async (c) => {
  const parsed = exerciseSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ message: "Enter an exercise name." }, 400);
  const name = normalizeExercise(parsed.data.name);
  await c.env.DB.prepare(
    `INSERT INTO exercises (name, day, position)
     VALUES (?1, ?2, (SELECT COALESCE(MAX(position), 0) + 1 FROM exercises WHERE day = ?2))
     ON CONFLICT (name) DO UPDATE SET day = excluded.day, position = excluded.position`,
  )
    .bind(name, parsed.data.day)
    .run();
  return c.json({ message: `Added ${displayName(name)}`, exercise: { name, day: parsed.data.day } });
});

const speedRoundSchema = z.object({
  bestMs: z.number().min(1).max(2000).nullable(),
  finalMs: z.number().min(1).max(2000),
  hits: z.number().int().min(0).max(200),
  trials: z.number().int().min(1).max(200),
});

app.post("/api/brain/speed", async (c) => {
  const parsed = speedRoundSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ message: "That round couldn't be saved." }, 400);
  const r = parsed.data;
  const row = await c.env.DB.prepare("INSERT INTO speed_rounds (best_ms, final_ms, hits, trials) VALUES (?, ?, ?, ?) RETURNING *")
    .bind(r.bestMs === null ? null : Math.round(r.bestMs), Math.round(r.finalMs), r.hits, r.trials)
    .first<SpeedRound>();
  return c.json({ message: "Round saved", round: row });
});

const brainCheckSchema = z.object({
  pvtMedianMs: z.number().min(50).max(5000),
  pvtLapses: z.number().int().min(0).max(500),
  pvtFalseStarts: z.number().int().min(0).max(500),
  dsstCorrect: z.number().int().min(0).max(500),
  dsstErrors: z.number().int().min(0).max(500),
});

app.post("/api/brain/check", async (c) => {
  const parsed = brainCheckSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ message: "That check couldn't be saved." }, 400);
  const b = parsed.data;
  const row = await c.env.DB.prepare(
    "INSERT INTO brain_checks (pvt_median_ms, pvt_lapses, pvt_false_starts, dsst_correct, dsst_errors) VALUES (?, ?, ?, ?, ?) RETURNING *",
  )
    .bind(Math.round(b.pvtMedianMs), b.pvtLapses, b.pvtFalseStarts, b.dsstCorrect, b.dsstErrors)
    .first<BrainCheck>();
  return c.json({ message: "Brain Check saved", check: row });
});

// Sets or clears an exercise's sets x reps target, e.g. { name, target: "3x8-12" } or { name, target: "" }.
// Web Push: the phone's subscription from the Reminders page, a test, and turning it off.
const subscriptionSchema = z.object({
  endpoint: z.string().max(2000).refine(isPushEndpoint, "Not a push service"),
  keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(40) }),
});
app.post("/api/push/subscribe", async (c) => {
  const parsed = subscriptionSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "This phone's push subscription wasn't accepted." }, 400);
  const { endpoint, keys } = parsed.data;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
    ).bind(endpoint, keys.p256dh, keys.auth),
    // The VAPID "subject" push services may contact: this site's own address.
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('push_subject', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(new URL(c.req.url).origin),
  ]);
  return c.json({ message: "Subscribed" });
});

app.post("/api/push/unsubscribe", async (c) => {
  const parsed = z.object({ endpoint: z.string().max(2000) }).safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "Missing endpoint" }, 400);
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(parsed.data.endpoint).run();
  return c.json({ message: "Unsubscribed" });
});

app.post("/api/push/test", async (c) => {
  const r = await pushToAll(c.env, { title: "Arif Gym ✓", body: "Notifications are working. Reminders will look like this.", url: "/reminders", tag: "test" });
  if (r.phones === 0) return c.json({ message: "No phone is signed up yet. Tap Turn on notifications." });
  if (r.sent === 0 && r.removed > 0) return c.json({ message: "This phone's sign-up had expired. Tap Turn off, then Turn on notifications again." });
  if (r.sent === 0) return c.json({ message: `Couldn't send (${r.errors.join("; ")}).` });
  return c.json({ message: `Sent ✓ It should appear in a few seconds.${r.errors.length ? ` (${r.errors.length} phone failed.)` : ""}` });
});

// Protein: taps on the dashboard's Protein card, and undo of today's last one.
const PROTEIN_DAYS = 14;

function proteinData(rows: ProteinRow[], weightKg: number | null, perKg: number, today: string, timeZone: string) {
  const byDay = proteinByDay(rows, timeZone);
  const todays = rows.filter((r) => localDay(r.logged_at, timeZone) === today);
  const last = todays.at(-1);
  return {
    today: byDay.get(today) ?? 0,
    target: proteinTarget(weightKg, perKg),
    fallback: PROTEIN_FALLBACK_G,
    perKg,
    weightKg,
    last: last
      ? { grams: last.grams, time: new Date(last.logged_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }) }
      : null,
    daily: Array.from({ length: PROTEIN_DAYS }, (_, i) => {
      const day = addDays(today, i - PROTEIN_DAYS + 1);
      return { day, grams: byDay.get(day) ?? 0 };
    }),
  };
}

app.post("/api/protein", async (c) => {
  const parsed = z.object({ grams: z.number().int().min(1).max(300) }).safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "Enter 1 to 300 grams." }, 400);
  await c.env.DB.prepare("INSERT INTO protein (grams) VALUES (?)").bind(parsed.data.grams).run();
  return c.json({ message: `Added ${parsed.data.grams} g` });
});

app.post("/api/protein/undo", async (c) => {
  const today = localDay(new Date(), c.env.TIMEZONE);
  const since = new Date(`${addDays(today, -1)}T00:00:00Z`).toISOString();
  const { results } = await c.env.DB.prepare("SELECT * FROM protein WHERE logged_at >= ? ORDER BY logged_at DESC LIMIT 5").bind(since).all<ProteinRow>();
  const last = results.find((r) => localDay(r.logged_at, c.env.TIMEZONE) === today);
  if (!last) return c.json({ error: "Nothing logged today." }, 404);
  await c.env.DB.prepare("DELETE FROM protein WHERE id = ?").bind(last.id).run();
  return c.json({ message: `Removed ${last.grams} g` });
});

// Longevity page: tick or untick one item of today's mobility routine.
app.post("/api/mobility", async (c) => {
  const parsed = z.object({ item: z.enum(MOBILITY_ITEMS as [MobilityItem, ...MobilityItem[]]), done: z.boolean() }).safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "Unknown item" }, 400);
  const today = localDay(new Date(), c.env.TIMEZONE);
  const { item, done } = parsed.data;
  if (done) await c.env.DB.prepare("INSERT OR IGNORE INTO mobility (day, item) VALUES (?, ?)").bind(today, item).run();
  else await c.env.DB.prepare("DELETE FROM mobility WHERE day = ? AND item = ?").bind(today, item).run();
  return c.json({ message: "Saved" });
});

// Sleep typed on the Brain page: replaces that night's value (and the sync won't overwrite it); 0 clears the night.
const sleepEntrySchema = z.object({ day: z.string(), minutes: z.number().int().min(0).max(1440) });
app.post("/api/brain/sleep", async (c) => {
  const parsed = sleepEntrySchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "Enter hours and minutes." }, 400);
  const { day, minutes } = parsed.data;
  const today = localDay(new Date(), c.env.TIMEZONE);
  if (!isIsoDate(day) || day > today || day < addDays(today, -7)) return c.json({ error: "Pick a night in the last week." }, 400);
  if (minutes === 0) {
    await c.env.DB.prepare("DELETE FROM sleep WHERE day = ?").bind(day).run();
    return c.json({ message: "Cleared" });
  }
  await c.env.DB.prepare(
    `INSERT INTO sleep (day, minutes, source) VALUES (?, ?, 'manual')
     ON CONFLICT (day) DO UPDATE SET minutes = excluded.minutes, source = 'manual', synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  )
    .bind(day, minutes)
    .run();
  return c.json({ message: `Saved ${formatSleep(minutes)}` });
});

app.post("/api/exercises/target", async (c) => {
  const body = (await readJson(c)) as { name?: unknown; target?: unknown };
  if (typeof body.name !== "string" || typeof body.target !== "string") return c.json({ message: "Enter a target like 3x8-12." }, 400);
  const target = parseTarget(body.target);
  if (target === undefined) return c.json({ message: "Use sets x reps, like 3x8-12 or 5x5." }, 400);
  const name = normalizeExercise(body.name);
  const result = await c.env.DB.prepare(
    "UPDATE exercises SET target_sets = ?, target_reps_min = ?, target_reps_max = ? WHERE name = ?",
  )
    .bind(target?.sets ?? null, target?.repsMin ?? null, target?.repsMax ?? null, name)
    .run();
  if (!result.meta.changes) return c.json({ message: "That exercise isn't in your list." }, 404);
  return c.json({ message: target ? `${displayName(name)}: ${formatTarget(target)}` : `Removed the target for ${displayName(name)}`, target });
});

// Removes an exercise button. Logged sets for it are kept.
app.post("/api/exercises/remove", async (c) => {
  const parsed = exerciseSchema.pick({ name: true }).safeParse(await readJson(c));
  if (!parsed.success) return c.json({ message: "Enter an exercise name." }, 400);
  const name = normalizeExercise(parsed.data.name);
  await c.env.DB.prepare("DELETE FROM exercises WHERE name = ?").bind(name).run();
  return c.json({ message: `Removed ${displayName(name)} from the list` });
});

// ---------------------------------------------------------------------------------------------------------------------
// Web pages

// Lets "Add to Home Screen" open the log page full screen, like an app.
app.get("/manifest.webmanifest", (c) =>
  c.json(
    {
      name: "Arif Gym Tracker",
      short_name: "Arif Gym",
      start_url: "/log",
      display: "standalone",
      background_color: "#0f1115",
      theme_color: "#0f1115",
    },
    200,
    { "content-type": "application/manifest+json" },
  ),
);

// Service worker for notifications only: it shows pushed reminders and opens the right page when tapped.
// It has no fetch handler, so pages always load from the network as before.
const SERVICE_WORKER = `
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Arif Gym", { body: data.body || "", tag: data.tag, data: { url: data.url || "/" } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const w of windows) if ("navigate" in w) return w.focus().then(() => w.navigate(url));
    return self.clients.openWindow(url);
  }));
});
`;
app.get("/sw.js", (c) => c.body(SERVICE_WORKER, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" }));

app.get("/login", (c) => c.html(loginPage(undefined, safeNextPath(c.req.query("next")))));

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  const next = safeNextPath(body.next);
  if (!c.env.DASHBOARD_PASSWORD || !(await safeEqual(password, c.env.DASHBOARD_PASSWORD))) {
    return c.html(loginPage("That password is not right.", next), 401);
  }
  await setSessionCookie(c);
  return c.redirect(next);
});

app.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.redirect("/login");
});

// Nightly steps sync from an iPhone Shortcuts automation. It sits outside the signed-in area and uses its own token,
// which can only save step totals: { "steps": 8423 } for today, or add "date": "YYYY-MM-DD" for another day.
/**
 * Checks the Shortcut's sync key (made on the dashboard and stored as a hash, or the STEPS_TOKEN secret). Returns an
 * error response to send back, or null when the key is right. The same key syncs steps and sleep.
 */
async function syncKeyError(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const stored = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'steps_key_sha256'").first<{ value: string }>();
  if (!stored && !c.env.STEPS_TOKEN) {
    return c.json({ message: "Sync isn't set up yet. Create a sync key on the dashboard's Steps card." }, 503);
  }
  const header = c.req.header("authorization");
  const token = bearerToken(header);
  if (!token) {
    // Say what arrived (never the value itself) so a wrong header name or missing "Bearer " is easy to spot.
    return c.json(
      { message: header ? "The Authorization header must start with \"Bearer \" followed by the key." : "No Authorization header arrived. Check the header name is Authorization." },
      401,
    );
  }
  const matchesKey = stored ? await safeEqual(await sha256Hex(token), stored.value) : false;
  const matchesSecret = c.env.STEPS_TOKEN ? await safeEqual(token, c.env.STEPS_TOKEN.trim()) : false;
  if (!matchesKey && !matchesSecret) {
    return c.json({ message: `Wrong sync key (received ${token.length} characters; a dashboard key has 48). Copy it again from the dashboard.` }, 401);
  }
  return null;
}

// Steps for a day: { "steps": 8423 }, optionally with "date": "YYYY-MM-DD" (up to 7 days back).
app.post("/sync/steps", async (c) => {
  const denied = await syncKeyError(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const steps = parseSteps(body.steps);
  if (steps === null) return c.json({ message: "Send the day's step count as a number." }, 400);
  const today = localDay(new Date(), c.env.TIMEZONE);
  const day = body.date === undefined || body.date === "" ? today : body.date;
  // Allow today and up to a week back (for a missed night), never the future.
  if (!isIsoDate(day) || day > today || day < addDays(today, -7)) {
    return c.json({ message: "The date must be YYYY-MM-DD, within the last 7 days." }, 400);
  }
  const row = await c.env.DB.prepare(
    `INSERT INTO steps (day, steps) VALUES (?, ?)
     ON CONFLICT (day) DO UPDATE SET steps = MAX(steps, excluded.steps), synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING steps`,
  )
    .bind(day, steps)
    .first<{ steps: number }>();
  // A day's total only goes up, so keep the higher count. A run while the iPhone is locked can't read Health data and
  // sends 0, which must not wipe out an earlier, real total.
  const saved = row?.steps ?? steps;
  const message =
    saved > steps
      ? `Kept ${saved.toLocaleString("en-GB")} steps for ${day} (this sync sent ${steps.toLocaleString("en-GB")}, lower than already saved).`
      : `Saved ${saved.toLocaleString("en-GB")} steps for ${day}.`;
  return c.json({ message, day, steps: saved });
});

// Last night's sleep: { "sleep": <hours, minutes or seconds> }, recorded against the morning the night ended (today),
// or "date": "YYYY-MM-DD" for another night. The higher value is kept, like steps.
app.post("/sync/sleep", async (c) => {
  const denied = await syncKeyError(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const minutes = sleepMinutes(body.sleep ?? body.minutes ?? body.hours);
  if (minutes === null) return c.json({ message: "Send last night's sleep as a number (hours, minutes or seconds)." }, 400);
  if (minutes === 0) {
    // Usually no sleep samples matched (no sleep tracked, or the phone was locked), so don't record a night of 0.
    return c.json({ message: "No sleep arrived (0), so nothing was saved. Check that Health → Sleep has last night's sleep." });
  }
  const today = localDay(new Date(), c.env.TIMEZONE);
  const day = body.date === undefined || body.date === "" ? today : body.date;
  if (!isIsoDate(day) || day > today || day < addDays(today, -7)) {
    return c.json({ message: "The date must be YYYY-MM-DD, within the last 7 days." }, 400);
  }
  const row = await c.env.DB.prepare(
    `INSERT INTO sleep (day, minutes) VALUES (?, ?)
     ON CONFLICT (day) DO UPDATE SET
       minutes = CASE WHEN source = 'manual' THEN minutes ELSE MAX(minutes, excluded.minutes) END,
       synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING minutes, source`,
  )
    .bind(day, minutes)
    .first<{ minutes: number; source: string }>();
  const saved = row?.minutes ?? minutes;
  if (row?.source === "manual") {
    return c.json({ message: `Kept the ${formatSleep(saved)} you typed for the night ending ${day}.`, day, minutes: saved });
  }
  return c.json({ message: `Saved ${formatSleep(saved)} of sleep for the night ending ${day}.`, day, minutes: saved });
});

// Everything below needs a signed-in session.
app.use("*", async (c, next) => {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (!cookie || !(await isValidSession(cookie, c.env.DASHBOARD_PASSWORD))) {
    const url = new URL(c.req.url);
    const path = url.pathname + url.search; // keep e.g. ?tab=legs through sign-in
    return c.redirect(path === "/" ? "/login" : `/login?next=${encodeURIComponent(path)}`);
  }
  // Keep people who use the app regularly signed in.
  if (sessionNeedsRefresh(cookie)) await setSessionCookie(c);
  await next();
});

// Touch-friendly logging screen.
app.get("/log", async (c) => {
  const timeZone = c.env.TIMEZONE;
  const historySince = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const [buttons, lastSets, today, lastCardio, cardio, history] = await Promise.all([
    loadExercises(c.env.DB),
    c.env.DB.prepare(
      "SELECT s.* FROM sets s JOIN (SELECT MAX(id) AS id FROM sets GROUP BY exercise) latest ON s.id = latest.id",
    ).all<SetRow>(),
    setsToday(c.env.DB, timeZone),
    c.env.DB.prepare(
      "SELECT c.* FROM cardio c JOIN (SELECT MAX(id) AS id FROM cardio GROUP BY activity) latest ON c.id = latest.id ORDER BY c.id DESC",
    ).all<CardioRow>(),
    cardioToday(c.env.DB, timeZone),
    c.env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ?").bind(historySince).all<SetRow>(),
  ]);
  const todayDate = localDay(new Date(), timeZone);
  const trained = trainingDaysByType(history.results, dayLookup(buttons), timeZone);
  const plan = todaysPlan(trained, todayDate);
  return c.html(
    logPage({
      exercises: buttons,
      last: Object.fromEntries(lastSets.results.map((s) => [s.exercise, { weight: s.weight_kg, reps: s.reps }])),
      today: today.map((s) => ({ id: s.id, exercise: s.exercise, weight: s.weight_kg, reps: s.reps, at: s.performed_at })),
      plan: plan.next,
      doneToday: plan.doneToday,
      timedPattern: TIMED_PATTERN,
      longevity: LONGEVITY_EXERCISES,
      stalls: Object.fromEntries(stallsByExercise(history.results, timeZone, todayDate)),
      previous: Object.fromEntries(
        [...lastSessionBest(history.results, timeZone, todayDate)].map(([name, best]) => [
          name,
          { ...best, targets: beatTargets(best, buttons.find((b) => b.name === name)?.target, isTimed(name)) },
        ]),
      ),
      cardio: {
        last: Object.fromEntries(lastCardio.results.map((r) => [r.activity, { minutes: r.minutes, distance: r.distance_km }])),
        today: cardio.map((r) => ({ id: r.id, activity: r.activity, minutes: r.minutes, distance: r.distance_km, at: r.performed_at })),
      },
    }),
  );
});

const HEATMAP_WEEKS = 16;
const VOLUME_WEEKS = 12;
const RECENT_SETS = 40;
const RECENT_CARDIO = 10;
const BODY_WEIGHT_WEEKS = 26;
const STEPS_DAYS = 30;

app.get("/", async (c) => {
  const timeZone = c.env.TIMEZONE;
  const now = new Date();
  const today = localDay(now, timeZone);
  const heatmapStart = addDays(weekStart(today), -7 * (HEATMAP_WEEKS - 1));
  // One extra day covers time zones ahead of UTC.
  const since = new Date(`${addDays(heatmapStart, -1)}T00:00:00Z`).toISOString();

  const [window, records, exercises, cardioWindow, bodyWeight, stepRows] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ? ORDER BY performed_at DESC").bind(since).all<SetRow>(),
    c.env.DB.prepare(
      `SELECT exercise, MAX(weight_kg) AS best_kg, ${RECORD_E1RM} AS best_e1rm, COUNT(*) AS sets, MAX(performed_at) AS last
       FROM sets GROUP BY exercise ORDER BY last DESC`,
    ).all<ExerciseRecord>(),
    c.env.DB.prepare("SELECT name, day FROM exercises").all<ExerciseButton>(),
    c.env.DB.prepare("SELECT * FROM cardio WHERE performed_at >= ? ORDER BY performed_at DESC").bind(since).all<CardioRow>(),
    c.env.DB.prepare("SELECT * FROM body_weight ORDER BY measured_on DESC").all<BodyWeightRow>(),
    c.env.DB.prepare("SELECT day, steps FROM steps WHERE day >= ? ORDER BY day").bind(addDays(today, -STEPS_DAYS)).all<StepsRow>(),
  ]);
  const proteinRows = await c.env.DB.prepare("SELECT * FROM protein WHERE logged_at >= ? ORDER BY logged_at")
    .bind(new Date(`${addDays(today, -PROTEIN_DAYS - 1)}T00:00:00Z`).toISOString())
    .all<ProteinRow>();
  const mobilityRows = await c.env.DB.prepare("SELECT day, item FROM mobility WHERE day >= ?").bind(weekStart(today)).all<{ day: string; item: string }>();
  const brainRounds = await c.env.DB.prepare("SELECT performed_at FROM speed_rounds WHERE performed_at >= ?")
    .bind(new Date(`${addDays(weekStart(today), -1)}T00:00:00Z`).toISOString())
    .all<{ performed_at: string }>();
  const hasSyncKey = Boolean(await c.env.DB.prepare("SELECT 1 AS ok FROM settings WHERE key = 'steps_key_sha256'").first());

  const sets = window.results;
  const cardio = cardioWindow.results;
  const dayOf = dayLookup(exercises.results);
  const days = trainingDaysByType(sets, dayOf, timeZone);
  const cardioDays = cardioMinutesPerDay(cardio, timeZone);
  const activeDays = new Set([...days.keys(), ...cardioDays.keys()]);
  const thisWeek = weekStart(today);
  const streak = weekStreak(activeDays, today);
  const plan = todaysPlan(days, today);
  const cardioThisWeek = [...cardioDays].filter(([d]) => d >= thisWeek).reduce((sum, [, m]) => sum + m, 0);
  const weighedInThisWeek = bodyWeight.results.some((r) => r.measured_on >= thisWeek && r.measured_on <= today);
  const lastOfNext = lastTrained(days)[plan.next];
  const recap = await loadRecap(c.env, recapWeekFor(today));

  return c.html(
    dashboardPage({
      recap,
      habits: {
        plan: plan.next,
        doneToday: plan.doneToday,
        lastOfNext,
        nudge: habitNudge({ activeDays, weekStreak: streak, today, next: plan.next }),
        checklist: weeklyChecklist({
          days,
          cardioMinutesThisWeek: cardioThisWeek,
          cardioGoalMinutes: cardioGoal(c.env),
          weighedInThisWeek,
          brainDaysThisWeek: new Set(brainRounds.results.map((r) => localDay(r.performed_at, timeZone)).filter((d) => d >= weekStart(today))).size,
          mobilityDaysThisWeek: mobilityDays(mobilityRows.results).size,
          today,
        }),
      },
      today,
      todaySummary: summarizeSets(sets.filter((s) => localDay(s.performed_at, timeZone) === today).reverse()),
      weekStreak: streak,
      sessionsThisWeek: [...activeDays].filter((d) => d >= thisWeek).length,
      weekly: weeklyVolumeByDay(sets, dayOf, timeZone, VOLUME_WEEKS, now),
      heatmap: { start: heatmapStart, weeks: HEATMAP_WEEKS, days, cardioDays },
      cardio: {
        thisWeekMinutes: cardioThisWeek,
        weekly: weeklyCardioMinutes(cardio, timeZone, VOLUME_WEEKS, now),
        recent: cardio.slice(0, RECENT_CARDIO).map((r) => ({
          ...r,
          day: localDay(r.performed_at, timeZone),
          time: new Date(r.performed_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }),
        })),
      },
      steps: {
        daily: dailySteps(stepRows.results, STEPS_DAYS, today),
        summary: stepsSummary(stepRows.results, today),
        goal: stepsGoal(c.env),
        hasSyncKey,
      },
      protein: proteinData(proteinRows.results, bodyWeight.results[0]?.weight_kg ?? null, proteinPerKg(c.env), today, timeZone),
      bodyWeight: {
        weekly: weeklyBodyWeight(bodyWeight.results, BODY_WEIGHT_WEEKS, today),
        trend: bodyWeightTrend(bodyWeight.results),
        recent: bodyWeight.results.slice(0, 6),
        loggedThisWeek: weighedInThisWeek,
      },
      lastTrained: lastTrained(days),
      dayOf,
      stalled: new Set(stallsByExercise(sets, timeZone, today).keys()),
      records: records.results.map((r) => ({ ...r, last: localDay(r.last, timeZone) })),
      recent: sets.slice(0, RECENT_SETS).map((s) => ({
        ...s,
        day: localDay(s.performed_at, timeZone),
        time: new Date(s.performed_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }),
      })),
    }),
  );
});

// Progress for one exercise: best sets, strength over time and every session.
app.get("/exercise/:name", async (c) => {
  const name = normalizeExercise(c.req.param("name"));
  const [sets, button] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM sets WHERE exercise = ? ORDER BY performed_at").bind(name).all<SetRow>(),
    c.env.DB.prepare("SELECT name, day FROM exercises WHERE name = ?").bind(name).first<ExerciseButton>(),
  ]);
  const sessions = exerciseSessions(sets.results, c.env.TIMEZONE);
  return c.html(
    exercisePage({
      name,
      day: button?.day ?? "other",
      sessions,
      change: progressChange(sessions),
      stall: detectStall(sessions, localDay(new Date(), c.env.TIMEZONE)),
      today: localDay(new Date(), c.env.TIMEZONE),
    }),
    sets.results.length || button ? 200 : 404,
  );
});

// Summary of one day's workout: ?day=YYYY-MM-DD, today by default.
app.get("/summary", async (c) => {
  const today = localDay(new Date(), c.env.TIMEZONE);
  const asked = c.req.query("day");
  const day = isIsoDate(asked) && asked <= today ? asked : today;
  const utc = (d: string) => new Date(`${d}T00:00:00Z`).toISOString();
  const [sets, cardio, exercises, buttons] = await Promise.all([
    // A year of history for "vs last time" and records; a day of margin covers time zones.
    c.env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ? AND performed_at < ?").bind(utc(addDays(day, -366)), utc(addDays(day, 2))).all<SetRow>(),
    c.env.DB.prepare("SELECT * FROM cardio WHERE performed_at >= ? AND performed_at < ?").bind(utc(addDays(day, -1)), utc(addDays(day, 2))).all<CardioRow>(),
    c.env.DB.prepare("SELECT name, day FROM exercises").all<ExerciseButton>(),
    loadExercises(c.env.DB),
  ]);
  const targets = Object.fromEntries(buttons.map((b) => [b.name, b.target]));
  const summary = workoutSummary({ day, sets: sets.results, cardio: cardio.results, dayOf: dayLookup(exercises.results), timeZone: c.env.TIMEZONE });
  return c.html(summaryPage(summary, today, targets));
});

// Weekly recap: ?week=YYYY-MM-DD (any day in the week); defaults to the same week as the dashboard card.
app.get("/recap", async (c) => {
  const today = localDay(new Date(), c.env.TIMEZONE);
  const asked = c.req.query("week");
  const week = isIsoDate(asked) && asked <= today ? weekStart(asked) : recapWeekFor(today);
  return c.html(recapPage(await loadRecap(c.env, week), today));
});

// Longevity: the daily mobility routine, this week's longevity training and how to progress.
app.get("/longevity", async (c) => {
  const timeZone = c.env.TIMEZONE;
  const today = localDay(new Date(), timeZone);
  const thisWeek = weekStart(today);
  const since = new Date(`${addDays(thisWeek, -1)}T00:00:00Z`).toISOString();
  const [mobilityRows, cardio, sets, bestHang] = await Promise.all([
    c.env.DB.prepare("SELECT day, item FROM mobility WHERE day >= ?").bind(addDays(today, -61)).all<{ day: string; item: string }>(),
    c.env.DB.prepare("SELECT * FROM cardio WHERE performed_at >= ?").bind(since).all<CardioRow>(),
    c.env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ?").bind(since).all<SetRow>(),
    c.env.DB.prepare("SELECT MAX(reps) AS s FROM sets WHERE exercise = 'dead hang'").first<{ s: number | null }>(),
  ]);
  const inWeek = (iso: string) => { const d = localDay(iso, timeZone); return d >= thisWeek && d <= today; };
  const weekCardio = cardio.results.filter((r) => inWeek(r.performed_at));
  const walks = weekCardio.filter((r) => r.activity === INTERVAL_WALK);
  const weekSets = sets.results.filter((s) => inWeek(s.performed_at));
  const sessionDays = (match: RegExp) => new Set(weekSets.filter((s) => match.test(s.exercise)).map((s) => localDay(s.performed_at, timeZone))).size;
  const days = mobilityDays(mobilityRows.results);
  return c.html(
    longevityPage({
      today,
      done: mobilityRows.results.filter((r) => r.day === today).map((r) => r.item as MobilityItem),
      hangLoggedToday: sets.results.some((s) => /\bhang\b/.test(s.exercise) && localDay(s.performed_at, timeZone) === today),
      streak: dayStreak(days, today),
      mobilityDaysThisWeek: [...days].filter((d) => d >= thisWeek).length,
      week: {
        intervalWalks: walks.length,
        intervalMinutes: Math.round(walks.reduce((sum, r) => sum + r.minutes, 0)),
        cardioMinutes: Math.round(weekCardio.reduce((sum, r) => sum + r.minutes, 0)),
        cardioGoal: cardioGoal(c.env),
        hangCarrySessions: sessionDays(/\b(hang|carry)\b/),
        jumpSessions: sessionDays(/\b(pogo|jump|jumps|hops)\b/),
      },
      bestHangSeconds: bestHang?.s ?? null,
    }),
  );
});

const INSIGHT_DAYS = 180;

// Brain training: Quick Glance speed rounds, the weekly Brain Check and last night's sleep.
app.get("/brain", async (c) => {
  const timeZone = c.env.TIMEZONE;
  const today = localDay(new Date(), timeZone);
  // About six months: the charts show the last 60 days, the sleep insights use it all.
  const since = new Date(`${addDays(today, -INSIGHT_DAYS)}T00:00:00Z`).toISOString();
  const [rounds, checks, sleep, sets] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM speed_rounds WHERE performed_at >= ? ORDER BY performed_at").bind(since).all<SpeedRound>(),
    c.env.DB.prepare("SELECT * FROM brain_checks ORDER BY performed_at DESC LIMIT 26").all<BrainCheck>(),
    c.env.DB.prepare("SELECT day, minutes, source FROM sleep WHERE day >= ? ORDER BY day").bind(addDays(today, -INSIGHT_DAYS)).all<SleepRow>(),
    c.env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ?").bind(since).all<SetRow>(),
  ]);

  const bestByDay = new Map<string, number>();
  for (const r of rounds.results) {
    const day = localDay(r.performed_at, timeZone);
    const ms = r.best_ms ?? r.final_ms;
    bestByDay.set(day, Math.min(bestByDay.get(day) ?? Infinity, ms));
  }
  const lastRound = rounds.results.at(-1);
  const checkRows = checks.results.reverse().map((r) => ({
    day: localDay(r.performed_at, timeZone),
    pvtMedianMs: r.pvt_median_ms,
    pvtLapses: r.pvt_lapses,
    dsstCorrect: r.dsst_correct,
  }));

  const sleepByDay = new Map(sleep.results.map((r) => [r.day, r.minutes]));
  const typed = new Set(sleep.results.filter((r) => r.source === "manual").map((r) => r.day));
  const nights = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, i - 13);
    return { day, minutes: sleepByDay.get(day) ?? null, typed: typed.has(day) };
  });
  const week = nights.slice(-7).flatMap((n) => (n.minutes === null ? [] : [n.minutes]));

  return c.html(
    brainPage({
      today,
      startMs: lastRound?.final_ms ?? 500,
      roundsToday: rounds.results.filter((r) => localDay(r.performed_at, timeZone) === today).length,
      streak: dayStreak(bestByDay.keys(), today),
      daily: [...bestByDay].filter(([day]) => day >= addDays(today, -60)).map(([day, bestMs]) => ({ day, bestMs })),
      checks: checkRows,
      insights: sleepInsights({
        sleep: sleep.results,
        speedDaily: [...bestByDay].map(([day, value]) => ({ day, value })),
        sets: sets.results,
        checks: checkRows,
        timeZone,
      }),
      checkDue: brainCheckDue(checkRows.at(-1)?.day ?? null, today),
      sleep: {
        nights,
        lastNight: sleepByDay.get(today) ?? null,
        average7: week.length ? Math.round(week.reduce((a, b) => a + b, 0) / week.length) : null,
        syncedNights: week.length,
      },
    }),
  );
});

app.post("/sets/:id/delete", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isInteger(id)) await c.env.DB.prepare("DELETE FROM sets WHERE id = ?").bind(id).run();
  return c.redirect("/");
});

// Makes a new steps sync key and shows it once, ready to copy into the Shortcut. Making another replaces the old one.
app.post("/steps-key", async (c) => {
  const key = newSyncKey();
  await c.env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('steps_key_sha256', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  )
    .bind(await sha256Hex(key))
    .run();
  c.header("cache-control", "no-store");
  return c.html(stepsKeyPage(key, new URL("/sync/steps", c.req.url).toString()));
});

app.post("/cardio/:id/delete", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isInteger(id)) await c.env.DB.prepare("DELETE FROM cardio WHERE id = ?").bind(id).run();
  return c.redirect("/#cardio");
});

// Saves today's weigh-in from the dashboard form. Saving again on the same day replaces it.
app.post("/body-weight", async (c) => {
  const body = await c.req.parseBody();
  const weight = Number(String(body.weight ?? "").trim().replace(",", "."));
  if (Number.isFinite(weight) && weight >= 20 && weight <= 400) {
    await c.env.DB.prepare(
      "INSERT INTO body_weight (measured_on, weight_kg) VALUES (?, ?) ON CONFLICT (measured_on) DO UPDATE SET weight_kg = excluded.weight_kg",
    )
      .bind(localDay(new Date(), c.env.TIMEZONE), Math.round(weight * 10) / 10)
      .run();
  }
  return c.redirect("/#body-weight");
});

app.post("/body-weight/:date/delete", async (c) => {
  await c.env.DB.prepare("DELETE FROM body_weight WHERE measured_on = ?").bind(c.req.param("date")).run();
  return c.redirect("/#body-weight");
});

// Reminder settings and this phone's notifications.
app.get("/reminders", async (c) => {
  const [rules, keys, devices] = await Promise.all([
    loadReminderRules(c.env.DB),
    loadVapidKeys(c.env.DB),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first<{ n: number }>(),
  ]);
  return c.html(remindersPage({ rules, publicKey: keys.publicKey, devices: devices?.n ?? 0, saved: c.req.query("saved") === "1" }));
});

app.post("/reminders", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const updates = REMINDER_KEYS.map((key) => {
    const time = body[`${key}_time`];
    const days = [...new Set(list(body[`${key}_days`]))].sort();
    return c.env.DB.prepare("UPDATE reminders SET enabled = ?, time = ?, days = ? WHERE key = ?").bind(
      body[`${key}_enabled`] ? 1 : 0,
      isTime(time) ? time : key === "brain" ? "20:00" : key === "gym" ? "17:30" : "10:00",
      days.join(","),
      key,
    );
  });
  await c.env.DB.batch(updates);
  return c.redirect("/reminders?saved=1", 303);
});

// Everything in one file: sets, cardio and weigh-ins, with a "type" column to filter on in a spreadsheet.
app.get("/export.csv", async (c) => {
  const [sets, cardio, bodyWeight, protein] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM sets").all<SetRow>(),
    c.env.DB.prepare("SELECT * FROM cardio").all<CardioRow>(),
    c.env.DB.prepare("SELECT * FROM body_weight").all<BodyWeightRow>(),
    c.env.DB.prepare("SELECT * FROM protein").all<ProteinRow>(),
  ]);
  const csv = exportCsv({ sets: sets.results, cardio: cardio.results, bodyWeight: bodyWeight.results, protein: protein.results, timeZone: c.env.TIMEZONE });
  return c.body(csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="arif-gym-${localDay(new Date(), c.env.TIMEZONE)}.csv"`,
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Reminders (cron every 15 minutes, see wrangler.jsonc)

type ReminderRow = { key: ReminderKey; enabled: number; time: string; days: string; last_sent_day: string | null };

async function loadReminderRules(db: D1Database): Promise<ReminderRule[]> {
  const { results } = await db.prepare("SELECT * FROM reminders").all<ReminderRow>();
  return results.map((r) => ({
    key: r.key,
    enabled: r.enabled === 1,
    time: r.time,
    days: r.days ? r.days.split(",").map(Number) : [],
    lastSentDay: r.last_sent_day,
  }));
}

/** Sends one notification to every signed-up phone, removing phones the push service says are gone (404 / 410). */
async function pushToAll(
  env: Env,
  message: { title: string; body: string; url: string; tag: string },
): Promise<{ phones: number; sent: number; removed: number; errors: string[] }> {
  const [subs, keys, subject] = await Promise.all([
    env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all<PushSubscription>(),
    loadVapidKeys(env.DB),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'push_subject'").first<{ value: string }>(),
  ]);
  const result = { phones: subs.results.length, sent: 0, removed: 0, errors: [] as string[] };
  for (const sub of subs.results) {
    try {
      const status = await sendPush(sub, message, keys, subject?.value ?? "https://gym-tracker.workers.dev");
      if (status >= 200 && status < 300) result.sent++;
      else if (status === 404 || status === 410) {
        result.removed++;
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
      } else result.errors.push(`push service answered ${status}`);
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (result.errors.length) console.error("push errors", result.errors);
  return result;
}

/** What the reminders check against: today's training, brain rounds, weigh-in and Brain Check. */
async function loadReminderState(env: Env, today: string): Promise<ReminderState> {
  const timeZone = env.TIMEZONE;
  const since = new Date(`${addDays(today, -61)}T00:00:00Z`).toISOString();
  const thisWeek = weekStart(today);
  const [sets, cardio, exercises, weighIn, rounds, lastCheck] = await Promise.all([
    env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ?").bind(since).all<SetRow>(),
    env.DB.prepare("SELECT * FROM cardio WHERE performed_at >= ?").bind(since).all<CardioRow>(),
    env.DB.prepare("SELECT name, day FROM exercises").all<ExerciseButton>(),
    env.DB.prepare("SELECT 1 AS ok FROM body_weight WHERE measured_on >= ? AND measured_on <= ?").bind(thisWeek, today).first(),
    env.DB.prepare("SELECT performed_at FROM speed_rounds WHERE performed_at >= ?").bind(since).all<{ performed_at: string }>(),
    env.DB.prepare("SELECT performed_at FROM brain_checks ORDER BY performed_at DESC LIMIT 1").first<{ performed_at: string }>(),
  ]);
  const mobility = mobilityDays((await env.DB.prepare("SELECT day, item FROM mobility WHERE day >= ?").bind(addDays(today, -61)).all<{ day: string; item: string }>()).results);
  const days = trainingDaysByType(sets.results, dayLookup(exercises.results), timeZone);
  const activeDays = new Set([...days.keys(), ...cardioMinutesPerDay(cardio.results, timeZone).keys()]);
  const plan = todaysPlan(days, today);
  const roundDays = rounds.results.map((r) => localDay(r.performed_at, timeZone));
  return {
    today,
    trainedToday: activeDays.has(today),
    next: plan.next,
    lastOfNext: lastTrained(days)[plan.next],
    nudge: habitNudge({ activeDays, weekStreak: weekStreak(activeDays, today), today, next: plan.next }),
    roundsToday: roundDays.filter((d) => d === today).length,
    brainStreak: dayStreak(roundDays, today),
    weighedInThisWeek: Boolean(weighIn),
    brainCheckDue: brainCheckDue(lastCheck ? localDay(lastCheck.performed_at, timeZone) : null, today),
    mobilityDoneToday: mobility.has(today),
    mobilityStreak: dayStreak(mobility, today),
  };
}

async function runReminders(env: Env, now = new Date()): Promise<void> {
  const clock = localClock(now, env.TIMEZONE);
  const due = dueRules(await loadReminderRules(env.DB), clock);
  if (due.length === 0) return;
  const hasPhones = await env.DB.prepare("SELECT 1 AS ok FROM push_subscriptions LIMIT 1").first();
  const state = hasPhones ? await loadReminderState(env, clock.day) : null;
  for (const rule of due) {
    // Mark it handled first, so a slow or failed send is never repeated every 15 minutes.
    await env.DB.prepare("UPDATE reminders SET last_sent_day = ? WHERE key = ?").bind(clock.day, rule.key).run();
    const message = state && reminderMessage(rule.key, state);
    if (message) await pushToAll(env, message);
  }
}

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
} satisfies ExportedHandler<Env>;
