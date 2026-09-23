import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_DAYS, createSession, hasValidBearer, isValidSession, safeEqual } from "./auth";
import {
  addDays,
  describeDay,
  describeLoggedSet,
  displayName,
  localDay,
  normalizeExercise,
  setsPerDay,
  spokenLoad,
  summarizeSets,
  weekStart,
  weekStreak,
  weeklyVolume,
  type SetRow,
} from "./lib";
import { dashboardPage, loginPage, type ExerciseRecord } from "./views";

type Env = {
  DB: D1Database;
  API_TOKEN: string;
  DASHBOARD_PASSWORD: string;
  TIMEZONE: string;
};

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------------------------------------------------
// Input parsing. Shortcuts may send numbers as text, and some locales dictate "82,5" instead of "82.5".

// Blank values become undefined, so optional and defaulted fields must declare that on the inner schema.
const number = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return undefined;
    return typeof v === "string" ? Number(v.trim().replace(",", ".")) : v;
  }, schema);

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

const logSchema = z.object({
  exercise: z.string().trim().min(1).max(80),
  weight: number(z.number().min(0).max(1000).default(0)),
  reps: number(z.number().int().min(1).max(200)),
  rpe: number(z.number().min(1).max(10).optional()),
  note: optionalText(500),
});

const repeatSchema = z.object({
  weight: number(z.number().min(0).max(1000).optional()),
  reps: number(z.number().int().min(1).max(200).optional()),
});

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  try {
    if (type.includes("application/json")) return ((await c.req.json()) as Record<string, unknown>) ?? {};
    if (type.includes("form")) return (await c.req.parseBody()) as Record<string, unknown>;
  } catch {
    // Fall through: an unreadable body is treated as empty and fails validation with a spoken message.
  }
  return {};
}

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

async function logSet(env: Env, input: { exercise: string; weight: number; reps: number; rpe?: number; note?: string }) {
  const exercise = normalizeExercise(input.exercise);
  const previous = await env.DB.prepare("SELECT MAX(weight_kg) AS best FROM sets WHERE exercise = ?")
    .bind(exercise)
    .first<{ best: number | null }>();
  const set = await env.DB.prepare(
    "INSERT INTO sets (exercise, weight_kg, reps, rpe, note) VALUES (?, ?, ?, ?, ?) RETURNING *",
  )
    .bind(exercise, input.weight, input.reps, input.rpe ?? null, input.note ?? null)
    .first<SetRow>();
  if (!set) throw new Error("Insert returned no row");
  const setNumber = (await setsToday(env.DB, env.TIMEZONE, exercise)).length;
  const previousBest = previous?.best ?? null;
  return {
    say: describeLoggedSet(set, previousBest, setNumber),
    personalBest: previousBest !== null && set.weight_kg > previousBest,
    set,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// API for Siri Shortcuts. Every response has a `say` field the Shortcut can pass straight to "Speak Text".

app.use("/api/*", async (c, next) => {
  if (!(await hasValidBearer(c.req.header("authorization"), c.env.API_TOKEN))) {
    return c.json({ say: "The gym tracker did not accept the Shortcut's token." }, 401);
  }
  await next();
});

app.post("/api/log", async (c) => {
  const parsed = logSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json({ say: "I didn't catch that set. I need an exercise and a number of reps.", issues: parsed.error.issues }, 400);
  }
  return c.json(await logSet(c.env, parsed.data));
});

// Logs the most recent set again, optionally with a new weight or rep count ("same again", "same but 6 reps").
app.post("/api/repeat", async (c) => {
  const parsed = repeatSchema.safeParse(await readBody(c));
  if (!parsed.success) return c.json({ say: "I didn't catch the new weight or reps." }, 400);
  const last = await c.env.DB.prepare("SELECT * FROM sets ORDER BY id DESC LIMIT 1").first<SetRow>();
  if (!last) return c.json({ say: "There is no previous set to repeat yet." }, 404);
  return c.json(
    await logSet(c.env, {
      exercise: last.exercise,
      weight: parsed.data.weight ?? last.weight_kg,
      reps: parsed.data.reps ?? last.reps,
    }),
  );
});

// Removes the most recent set, for when Siri mishears.
app.post("/api/undo", async (c) => {
  const removed = await c.env.DB.prepare("DELETE FROM sets WHERE id = (SELECT MAX(id) FROM sets) RETURNING *").first<SetRow>();
  if (!removed) return c.json({ say: "There is nothing to undo." }, 404);
  return c.json({
    say: `Removed ${displayName(removed.exercise)}, ${spokenLoad(removed)}.`,
    removed,
  });
});

app.get("/api/today", async (c) => {
  const summary = summarizeSets(await setsToday(c.env.DB, c.env.TIMEZONE));
  return c.json({ say: describeDay(summary), summary });
});

// Exercise names, most recently used first, for a "Choose from List" step in the Shortcut.
app.get("/api/exercises", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT exercise FROM sets GROUP BY exercise ORDER BY MAX(performed_at) DESC LIMIT 50",
  ).all<{ exercise: string }>();
  return c.json({ exercises: results.map((r) => displayName(r.exercise)) });
});

// ---------------------------------------------------------------------------------------------------------------------
// Dashboard

app.get("/login", (c) => c.html(loginPage()));

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  if (!c.env.DASHBOARD_PASSWORD || !(await safeEqual(password, c.env.DASHBOARD_PASSWORD))) {
    return c.html(loginPage("That password is not right."), 401);
  }
  setCookie(c, SESSION_COOKIE, await createSession(c.env.DASHBOARD_PASSWORD), {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return c.redirect("/");
});

app.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.redirect("/login");
});

// Everything below needs a signed-in session.
app.use("*", async (c, next) => {
  if (!(await isValidSession(getCookie(c, SESSION_COOKIE), c.env.DASHBOARD_PASSWORD))) return c.redirect("/login");
  await next();
});

const HEATMAP_WEEKS = 16;
const VOLUME_WEEKS = 12;
const RECENT_SETS = 40;

app.get("/", async (c) => {
  const timeZone = c.env.TIMEZONE;
  const now = new Date();
  const today = localDay(now, timeZone);
  const heatmapStart = addDays(weekStart(today), -7 * (HEATMAP_WEEKS - 1));
  // One extra day covers time zones ahead of UTC.
  const since = new Date(`${addDays(heatmapStart, -1)}T00:00:00Z`).toISOString();

  const [window, records] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM sets WHERE performed_at >= ? ORDER BY performed_at DESC").bind(since).all<SetRow>(),
    c.env.DB.prepare(
      `SELECT exercise, MAX(weight_kg) AS best_kg, ${RECORD_E1RM} AS best_e1rm, COUNT(*) AS sets, MAX(performed_at) AS last
       FROM sets GROUP BY exercise ORDER BY last DESC`,
    ).all<ExerciseRecord>(),
  ]);

  const sets = window.results;
  const days = setsPerDay(sets, timeZone);
  const thisWeek = weekStart(today);

  return c.html(
    dashboardPage({
      today,
      todaySummary: summarizeSets(sets.filter((s) => localDay(s.performed_at, timeZone) === today).reverse()),
      weekStreak: weekStreak(days.keys(), today),
      sessionsThisWeek: [...days.keys()].filter((d) => d >= thisWeek).length,
      weekly: weeklyVolume(sets, timeZone, VOLUME_WEEKS, now),
      heatmap: { start: heatmapStart, weeks: HEATMAP_WEEKS, days },
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
