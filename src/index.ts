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
  parseSteps,
  dailySteps,
  exportCsv,
  exerciseSessions,
  progressChange,
  detectStall,
  stallsByExercise,
  stepsSummary,
  lastSessionBest,
  todaysPlan,
  weeklyChecklist,
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
import { logPage, type ExerciseButton } from "./log-page";
import { dashboardPage, exercisePage, loginPage, stepsKeyPage, type ExerciseRecord } from "./views";

type Env = {
  DB: D1Database;
  DASHBOARD_PASSWORD: string;
  TIMEZONE: string;
  CARDIO_WEEKLY_MINUTES?: string;
  STEPS_DAILY_GOAL?: string;
  /** Token the nightly iPhone Shortcuts automation sends to /sync/steps. It can only write step totals. */
  STEPS_TOKEN?: string;
};

function stepsGoal(env: Env): number {
  const goal = Number(env.STEPS_DAILY_GOAL);
  return Number.isFinite(goal) && goal > 0 ? goal : 8000;
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
// Accepts the sync key made on the dashboard (stored as a hash) or the STEPS_TOKEN secret.
app.post("/sync/steps", async (c) => {
  const stored = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'steps_key_sha256'").first<{ value: string }>();
  if (!stored && !c.env.STEPS_TOKEN) {
    return c.json({ message: "Steps sync isn't set up yet. Create a sync key on the dashboard's Steps card." }, 503);
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
    return c.json({ message: `Wrong steps key (received ${token.length} characters; a dashboard key has 48). Copy it again from the dashboard.` }, 401);
  }
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
    c.env.DB.prepare("SELECT name, day FROM exercises ORDER BY day, position, name").all<ExerciseButton>(),
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
  const trained = trainingDaysByType(history.results, dayLookup(buttons.results), timeZone);
  const plan = todaysPlan(trained, todayDate);
  return c.html(
    logPage({
      exercises: buttons.results,
      last: Object.fromEntries(lastSets.results.map((s) => [s.exercise, { weight: s.weight_kg, reps: s.reps }])),
      today: today.map((s) => ({ id: s.id, exercise: s.exercise, weight: s.weight_kg, reps: s.reps, at: s.performed_at })),
      plan: plan.next,
      doneToday: plan.doneToday,
      stalls: Object.fromEntries(stallsByExercise(history.results, timeZone, todayDate)),
      previous: Object.fromEntries(
        [...lastSessionBest(history.results, timeZone, todayDate)].map(([name, best]) => [name, { ...best, targets: beatTargets(best) }]),
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

  return c.html(
    dashboardPage({
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

// Everything in one file: sets, cardio and weigh-ins, with a "type" column to filter on in a spreadsheet.
app.get("/export.csv", async (c) => {
  const [sets, cardio, bodyWeight] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM sets").all<SetRow>(),
    c.env.DB.prepare("SELECT * FROM cardio").all<CardioRow>(),
    c.env.DB.prepare("SELECT * FROM body_weight").all<BodyWeightRow>(),
  ]);
  const csv = exportCsv({ sets: sets.results, cardio: cardio.results, bodyWeight: bodyWeight.results, timeZone: c.env.TIMEZONE });
  return c.body(csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="arif-gym-${localDay(new Date(), c.env.TIMEZONE)}.csv"`,
  });
});

export default app;
