import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  createSession,
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
} from "./lib";
import { logPage, type ExerciseButton } from "./log-page";
import { dashboardPage, loginPage, type ExerciseRecord } from "./views";

type Env = {
  DB: D1Database;
  DASHBOARD_PASSWORD: string;
  TIMEZONE: string;
};

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

// Everything below needs a signed-in session.
app.use("*", async (c, next) => {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (!cookie || !(await isValidSession(cookie, c.env.DASHBOARD_PASSWORD))) {
    const path = new URL(c.req.url).pathname;
    return c.redirect(path === "/" ? "/login" : `/login?next=${encodeURIComponent(path)}`);
  }
  // Keep people who use the app regularly signed in.
  if (sessionNeedsRefresh(cookie)) await setSessionCookie(c);
  await next();
});

// Touch-friendly logging screen.
app.get("/log", async (c) => {
  const timeZone = c.env.TIMEZONE;
  const [buttons, lastSets, today, lastCardio, cardio] = await Promise.all([
    c.env.DB.prepare("SELECT name, day FROM exercises ORDER BY day, position, name").all<ExerciseButton>(),
    c.env.DB.prepare(
      "SELECT s.* FROM sets s JOIN (SELECT MAX(id) AS id FROM sets GROUP BY exercise) latest ON s.id = latest.id",
    ).all<SetRow>(),
    setsToday(c.env.DB, timeZone),
    c.env.DB.prepare(
      "SELECT c.* FROM cardio c JOIN (SELECT MAX(id) AS id FROM cardio GROUP BY activity) latest ON c.id = latest.id ORDER BY c.id DESC",
    ).all<CardioRow>(),
    cardioToday(c.env.DB, timeZone),
  ]);
  return c.html(
    logPage({
      exercises: buttons.results,
      last: Object.fromEntries(lastSets.results.map((s) => [s.exercise, { weight: s.weight_kg, reps: s.reps }])),
      today: today.map((s) => ({ id: s.id, exercise: s.exercise, weight: s.weight_kg, reps: s.reps, at: s.performed_at })),
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

app.get("/", async (c) => {
  const timeZone = c.env.TIMEZONE;
  const now = new Date();
  const today = localDay(now, timeZone);
  const heatmapStart = addDays(weekStart(today), -7 * (HEATMAP_WEEKS - 1));
  // One extra day covers time zones ahead of UTC.
  const since = new Date(`${addDays(heatmapStart, -1)}T00:00:00Z`).toISOString();

  const [window, records, exercises, cardioWindow, bodyWeight] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ? ORDER BY performed_at DESC").bind(since).all<SetRow>(),
    c.env.DB.prepare(
      `SELECT exercise, MAX(weight_kg) AS best_kg, ${RECORD_E1RM} AS best_e1rm, COUNT(*) AS sets, MAX(performed_at) AS last
       FROM sets GROUP BY exercise ORDER BY last DESC`,
    ).all<ExerciseRecord>(),
    c.env.DB.prepare("SELECT name, day FROM exercises").all<ExerciseButton>(),
    c.env.DB.prepare("SELECT * FROM cardio WHERE performed_at >= ? ORDER BY performed_at DESC").bind(since).all<CardioRow>(),
    c.env.DB.prepare("SELECT * FROM body_weight ORDER BY measured_on DESC").all<BodyWeightRow>(),
  ]);

  const sets = window.results;
  const cardio = cardioWindow.results;
  const dayOf = dayLookup(exercises.results);
  const days = trainingDaysByType(sets, dayOf, timeZone);
  const cardioDays = cardioMinutesPerDay(cardio, timeZone);
  const activeDays = new Set([...days.keys(), ...cardioDays.keys()]);
  const thisWeek = weekStart(today);

  return c.html(
    dashboardPage({
      today,
      todaySummary: summarizeSets(sets.filter((s) => localDay(s.performed_at, timeZone) === today).reverse()),
      weekStreak: weekStreak(activeDays, today),
      sessionsThisWeek: [...activeDays].filter((d) => d >= thisWeek).length,
      weekly: weeklyVolumeByDay(sets, dayOf, timeZone, VOLUME_WEEKS, now),
      heatmap: { start: heatmapStart, weeks: HEATMAP_WEEKS, days, cardioDays },
      cardio: {
        thisWeekMinutes: [...cardioDays].filter(([d]) => d >= thisWeek).reduce((sum, [, m]) => sum + m, 0),
        weekly: weeklyCardioMinutes(cardio, timeZone, VOLUME_WEEKS, now),
        recent: cardio.slice(0, RECENT_CARDIO).map((r) => ({
          ...r,
          day: localDay(r.performed_at, timeZone),
          time: new Date(r.performed_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }),
        })),
      },
      bodyWeight: {
        weekly: weeklyBodyWeight(bodyWeight.results, BODY_WEIGHT_WEEKS, today),
        trend: bodyWeightTrend(bodyWeight.results),
        recent: bodyWeight.results.slice(0, 6),
        loggedThisWeek: bodyWeight.results.some((r) => r.measured_on >= thisWeek && r.measured_on <= today),
      },
      lastTrained: lastTrained(days),
      dayOf,
      records: records.results.map((r) => ({ ...r, last: localDay(r.last, timeZone) })),
      recent: sets.slice(0, RECENT_SETS).map((s) => ({
        ...s,
        day: localDay(s.performed_at, timeZone),
        time: new Date(s.performed_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }),
      })),
    }),
  );
});

app.post("/sets/:id/delete", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isInteger(id)) await c.env.DB.prepare("DELETE FROM sets WHERE id = ?").bind(id).run();
  return c.redirect("/");
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

app.get("/export.csv", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM sets ORDER BY performed_at").all<SetRow>();
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Stop spreadsheet apps from running a note such as "=HYPERLINK(...)" as a formula.
    if (/^[=+\-@]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    "performed_at,exercise,weight_kg,reps,rpe,note",
    ...results.map((s) => [s.performed_at, displayName(s.exercise), s.weight_kg, s.reps, s.rpe, s.note].map(cell).join(",")),
  ];
  return c.body(lines.join("\n") + "\n", 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="gym-sets-${localDay(new Date(), c.env.TIMEZONE)}.csv"`,
  });
});

export default app;
