import assert from "node:assert/strict";
import { test } from "node:test";
import { createSession, isValidSession } from "./auth";
import {
  dayLookup,
  displayName,
  estimateOneRepMax,
  formatLoad,
  localDay,
  loggedSetMessage,
  normalizeExercise,
  summarizeSets,
  weekStart,
  weekStreak,
  weeklyVolumeByDay,
  type SetRow,
} from "./lib";

let nextId = 1;
function set(performed_at: string, exercise: string, weight_kg: number, reps: number): SetRow {
  return { id: nextId++, performed_at, exercise, weight_kg, reps, rpe: null, note: null };
}

test("exercise names typed differently end up the same", () => {
  assert.equal(normalizeExercise("  Bench   Press "), "bench press");
  assert.equal(displayName("bench press"), "Bench Press");
});

test("estimated one-rep max", () => {
  assert.equal(estimateOneRepMax(100, 1), 100);
  assert.equal(estimateOneRepMax(90, 6), 108);
});

test("local day follows the configured time zone", () => {
  // 23:30 UTC on 30 June is already 1 July in London (BST).
  assert.equal(localDay("2026-06-30T23:30:00.000Z", "Europe/London"), "2026-07-01");
  assert.equal(localDay("2026-06-30T23:30:00.000Z", "UTC"), "2026-06-30");
});

test("weeks start on Monday", () => {
  assert.equal(weekStart("2026-09-23"), "2026-09-21"); // Wednesday
  assert.equal(weekStart("2026-09-21"), "2026-09-21"); // Monday
  assert.equal(weekStart("2026-09-27"), "2026-09-21"); // Sunday
});

test("logged-set message and loads", () => {
  const s = { exercise: "bench press", weight_kg: 82.5, reps: 5 };
  assert.equal(loggedSetMessage(s, 3, true), "Bench Press 82.5 kg × 5 · set 3 · new personal best!");
  assert.equal(loggedSetMessage(s, 1, false), "Bench Press 82.5 kg × 5 · set 1");
  assert.equal(formatLoad({ weight_kg: 0, reps: 12 }), "12 reps");
  assert.equal(formatLoad({ weight_kg: 80.04, reps: 5 }), "80 kg × 5");
});

test("day summary", () => {
  const summary = summarizeSets([
    set("2026-09-23T08:00:00.000Z", "squat", 100, 5),
    set("2026-09-23T08:05:00.000Z", "squat", 110, 3),
    set("2026-09-23T08:20:00.000Z", "bench press", 80, 5),
  ]);
  assert.equal(summary.sets, 3);
  assert.equal(summary.volumeKg, 500 + 330 + 400);
  assert.deepEqual(summary.exercises, [
    { exercise: "squat", sets: 2, topKg: 110 },
    { exercise: "bench press", sets: 1, topKg: 80 },
  ]);
});

test("weekly volume includes empty weeks and ignores older sets", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");
  const weeks = weeklyVolumeByDay(
    [
      set("2026-09-22T08:00:00.000Z", "squat", 100, 5), // this week
      set("2026-09-08T08:00:00.000Z", "squat", 100, 2), // two weeks ago
      set("2026-01-01T08:00:00.000Z", "squat", 100, 5), // outside the window
    ],
    dayLookup([{ name: "squat", day: "legs" }]),
    "UTC",
    3,
    now,
  );
  assert.deepEqual(
    weeks.map((w) => [w.week, w.volumeKg, w.byDay.legs]),
    [
      ["2026-09-07", 200, 200],
      ["2026-09-14", 0, 0],
      ["2026-09-21", 500, 500],
    ],
  );
});

test("week streak survives a current week with no session yet", () => {
  const days = ["2026-09-01", "2026-09-09", "2026-09-15"]; // weeks of 31 Aug, 7 Sep, 14 Sep
  assert.equal(weekStreak(days, "2026-09-23"), 3);
  assert.equal(weekStreak([...days, "2026-09-22"], "2026-09-23"), 4);
  assert.equal(weekStreak(["2026-09-01"], "2026-09-23"), 0);
});

test("sessions are signed and expire", async () => {
  const now = Date.UTC(2026, 8, 23);
  const cookie = await createSession("password", now);
  assert.equal(await isValidSession(cookie, "password", now), true);
  assert.equal(await isValidSession(cookie, "changed-password", now), false);
  assert.equal(await isValidSession(cookie, "password", now + 300 * 24 * 60 * 60 * 1000), true); // lasts a year
  assert.equal(await isValidSession(cookie, "password", now + 366 * 24 * 60 * 60 * 1000), false);
  const [expires] = cookie.split(".");
  assert.equal(await isValidSession(`${Number(expires) + 1}.${cookie.split(".")[1]}`, "password", now), false);
});

test("session refresh and sign-in redirects", async () => {
  const { sessionNeedsRefresh, safeNextPath } = await import("./auth");
  const now = Date.UTC(2026, 8, 23);
  const cookie = await createSession("password", now);
  assert.equal(sessionNeedsRefresh(cookie, now), false);
  assert.equal(sessionNeedsRefresh(cookie, now + 6 * 24 * 60 * 60 * 1000), false);
  assert.equal(sessionNeedsRefresh(cookie, now + 8 * 24 * 60 * 60 * 1000), true); // renewed after a week
  assert.equal(safeNextPath("/log"), "/log");
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
  assert.equal(safeNextPath(undefined), "/");
});

test("push / pull / legs split", async () => {
  const { dayLookup, weeklyVolumeByDay, trainingDaysByType, lastTrained, daysAgo } = await import("./lib");
  const dayOf = dayLookup([
    { name: "bench press", day: "push" },
    { name: "pull up", day: "pull" },
    { name: "squat", day: "legs" },
  ]);
  assert.equal(dayOf("bench press"), "push");
  assert.equal(dayOf("farmer carry"), "other");

  const sets = [
    set("2026-09-21T08:00:00.000Z", "bench press", 80, 5), // Mon: push
    set("2026-09-21T08:10:00.000Z", "bench press", 80, 5),
    set("2026-09-21T08:20:00.000Z", "squat", 100, 5), // one leg set on push day
    set("2026-09-22T08:00:00.000Z", "pull up", 0, 10), // Tue: pull (bodyweight)
    set("2026-09-23T08:00:00.000Z", "squat", 100, 5), // Wed: legs
    set("2026-09-23T08:10:00.000Z", "farmer carry", 40, 1),
  ];

  const [week] = weeklyVolumeByDay(sets, dayOf, "UTC", 1, new Date("2026-09-23T12:00:00.000Z"));
  assert.deepEqual(week.byDay, { push: 800, pull: 0, legs: 1000, other: 40 });
  assert.equal(week.volumeKg, 1840);

  const days = trainingDaysByType(sets, dayOf, "UTC");
  assert.equal(days.get("2026-09-21")?.main, "push");
  assert.equal(days.get("2026-09-22")?.main, "pull");
  assert.equal(days.get("2026-09-23")?.main, "legs"); // tie between legs and other goes to legs
  assert.deepEqual(lastTrained(days), { push: "2026-09-21", pull: "2026-09-22", legs: "2026-09-23" });

  assert.equal(daysAgo("2026-09-23", "2026-09-23"), "Today");
  assert.equal(daysAgo("2026-09-22", "2026-09-23"), "Yesterday");
  assert.equal(daysAgo("2026-09-19", "2026-09-23"), "4 days ago");
});

test("cardio formatting and weekly minutes", async () => {
  const { formatMinutes, formatCardio, cardioMessage, weeklyCardioMinutes, cardioMinutesPerDay } = await import("./lib");
  assert.equal(formatMinutes(25), "25 min");
  assert.equal(formatMinutes(60), "1 h");
  assert.equal(formatMinutes(95), "1 h 35 min");
  assert.equal(formatCardio({ minutes: 30, distance_km: 4.5 }), "30 min · 4.5 km");
  assert.equal(formatCardio({ minutes: 30, distance_km: null }), "30 min");
  assert.equal(cardioMessage({ activity: "treadmill", minutes: 20, distance_km: null }, 20), "Treadmill 20 min");
  assert.equal(cardioMessage({ activity: "treadmill", minutes: 20, distance_km: 3 }, 45), "Treadmill 20 min · 3 km · 45 min cardio today");

  const rows = [
    { id: 1, performed_at: "2026-09-22T07:00:00.000Z", activity: "treadmill", minutes: 30, distance_km: null },
    { id: 2, performed_at: "2026-09-22T18:00:00.000Z", activity: "treadmill", minutes: 15, distance_km: null },
    { id: 3, performed_at: "2026-09-10T07:00:00.000Z", activity: "rowing machine", minutes: 20, distance_km: 4 },
  ];
  assert.deepEqual(weeklyCardioMinutes(rows, "UTC", 3, new Date("2026-09-23T12:00:00.000Z")), [
    { week: "2026-09-07", minutes: 20 },
    { week: "2026-09-14", minutes: 0 },
    { week: "2026-09-21", minutes: 45 },
  ]);
  assert.equal(cardioMinutesPerDay(rows, "UTC").get("2026-09-22"), 45);
});

test("weekly body weight and trend", async () => {
  const { weeklyBodyWeight, bodyWeightTrend } = await import("./lib");
  const rows = [
    { measured_on: "2026-08-24", weight_kg: 82 },
    { measured_on: "2026-09-07", weight_kg: 81.4 },
    { measured_on: "2026-09-09", weight_kg: 81 }, // later in the same week wins
    { measured_on: "2026-09-21", weight_kg: 80.6 },
  ];
  assert.deepEqual(weeklyBodyWeight(rows, 3, "2026-09-23"), [
    { week: "2026-09-07", kg: 81 },
    { week: "2026-09-14", kg: null },
    { week: "2026-09-21", kg: 80.6 },
  ]);
  assert.deepEqual(bodyWeightTrend(rows), { latest: rows[3], changeKg: -1.4, since: "2026-08-24" });
  assert.deepEqual(bodyWeightTrend([rows[0]]), { latest: rows[0], changeKg: null, since: null });
  assert.deepEqual(bodyWeightTrend([]), { latest: null, changeKg: null, since: null });
});

test("habit features", async () => {
  const lib = await import("./lib");
  const dayOf = lib.dayLookup([
    { name: "bench press", day: "push" },
    { name: "pull up", day: "pull" },
    { name: "squat", day: "legs" },
  ]);
  const days = lib.trainingDaysByType(
    [
      set("2026-09-15T08:00:00.000Z", "squat", 100, 5), // Tue last week: legs
      set("2026-09-21T08:00:00.000Z", "bench press", 80, 5), // Mon: push
      set("2026-09-23T08:00:00.000Z", "pull up", 0, 8), // Wed: pull
    ],
    dayOf,
    "UTC",
  );

  // Today's plan follows the rotation after the latest split day.
  assert.deepEqual(lib.todaysPlan(days, "2026-09-24"), { next: "legs", doneToday: null });
  assert.deepEqual(lib.todaysPlan(days, "2026-09-23"), { next: "legs", doneToday: "pull" });
  assert.deepEqual(lib.todaysPlan(new Map(), "2026-09-23"), { next: "push", doneToday: null });

  // Weekly checklist for the week of Mon 21 Sept.
  const list = lib.weeklyChecklist({ days, cardioMinutesThisWeek: 55, cardioGoalMinutes: 90, weighedInThisWeek: true, today: "2026-09-24" });
  assert.deepEqual(
    list.map((i) => [i.key, i.done, i.detail]),
    [
      ["push", true, "Mon"],
      ["pull", true, "Wed"],
      ["legs", false, ""],
      ["cardio", false, "55/90 min"],
      ["weigh-in", true, ""],
    ],
  );

  // Never miss twice.
  const nudge = (activeDays: string[], today: string, weekStreak = 0) =>
    lib.habitNudge({ activeDays, weekStreak, today, next: "legs" });
  assert.equal(nudge(["2026-09-18"], "2026-09-21"), null); // Fri -> Mon is a normal weekend
  assert.equal(nudge(["2026-09-18"], "2026-09-22"), "It's been 4 days. Missing once is fine, never miss twice: Legs today.");
  assert.equal(nudge(["2026-09-24"], "2026-09-24"), null); // trained today
  assert.equal(
    nudge(["2026-09-17"], "2026-09-26", 5), // Saturday, nothing this week
    "No session yet this week. One Legs day keeps your 5-week streak going.",
  );

  // Beat last time uses the best set of the previous session, not today's sets.
  const best = lib.lastSessionBest(
    [
      set("2026-09-14T08:00:00.000Z", "bench press", 85, 3),
      set("2026-09-21T08:00:00.000Z", "bench press", 80, 5),
      set("2026-09-21T08:05:00.000Z", "bench press", 80, 6),
      set("2026-09-21T08:10:00.000Z", "bench press", 77.5, 8),
      set("2026-09-24T08:00:00.000Z", "bench press", 90, 1), // today, ignored
    ],
    "UTC",
    "2026-09-24",
  );
  assert.deepEqual(best.get("bench press"), { day: "2026-09-21", weight: 80, reps: 6 });
  assert.deepEqual(lib.beatTargets({ weight: 80, reps: 6 }), [
    { weight: 80, reps: 7 },
    { weight: 82.5, reps: 6 },
  ]);
  assert.deepEqual(lib.beatTargets({ weight: 8, reps: 12 }), [
    { weight: 8, reps: 13 },
    { weight: 9, reps: 12 },
  ]);
  assert.deepEqual(lib.beatTargets({ weight: 0, reps: 8 }), [{ weight: 0, reps: 9 }]);
  assert.equal(lib.beats({ weight: 80, reps: 7 }, { weight: 80, reps: 6 }), true);
  assert.equal(lib.beats({ weight: 80, reps: 6 }, { weight: 80, reps: 6 }), false);
  assert.equal(lib.beats({ weight: 82.5, reps: 3 }, { weight: 80, reps: 6 }), true);
});

test("steps parsing and summaries", async () => {
  const { parseSteps, isIsoDate, dailySteps, stepsSummary } = await import("./lib");
  assert.equal(parseSteps(8423), 8423);
  assert.equal(parseSteps(8423.6), 8424);
  assert.equal(parseSteps("8,423"), 8423);
  assert.equal(parseSteps(" 12 000 "), 12000);
  assert.equal(parseSteps("lots"), null);
  assert.equal(parseSteps(-5), null);
  assert.equal(parseSteps(undefined), null);
  assert.equal(isIsoDate("2026-09-24"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("24/09/2026"), false);

  const rows = [
    { day: "2026-09-20", steps: 6000 }, // Sunday, last week
    { day: "2026-09-22", steps: 9000 },
    { day: "2026-09-23", steps: 8000 },
  ];
  assert.deepEqual(dailySteps(rows, 3, "2026-09-24"), [
    { day: "2026-09-22", steps: 9000 },
    { day: "2026-09-23", steps: 8000 },
    { day: "2026-09-24", steps: null },
  ]);
  assert.deepEqual(stepsSummary(rows, "2026-09-24"), {
    today: null,
    yesterday: 8000,
    average7: 7667, // (6000 + 9000 + 8000) / 3 synced days
    thisWeek: 17000,
    lastSynced: "2026-09-23",
  });
  assert.equal(stepsSummary([], "2026-09-24").average7, null);
});

test("steps sync keys", async () => {
  const { sha256Hex, newSyncKey, bearerToken } = await import("./auth");
  const key = newSyncKey();
  assert.match(key, /^[0-9a-f]{48}$/);
  assert.notEqual(key, newSyncKey());
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(bearerToken("Bearer abc123"), "abc123");
  assert.equal(bearerToken("  bearer   abc123  "), "abc123");
  assert.equal(bearerToken("abc123"), null);
  assert.equal(bearerToken(undefined), null);
});

test("CSV export combines sets, cardio and weigh-ins", async () => {
  const { exportCsv, csvCell } = await import("./lib");
  assert.equal(csvCell('said "hi", then left'), '"said ""hi"", then left"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell(-2.5), "-2.5"); // numbers are never prefixed
  assert.equal(csvCell(null), "");

  const csv = exportCsv({
    timeZone: "Europe/London",
    sets: [{ id: 1, performed_at: "2026-09-21T17:30:00.000Z", exercise: "bench press", weight_kg: 80, reps: 5, rpe: 8, note: "felt good" }],
    cardio: [{ id: 1, performed_at: "2026-09-21T18:15:00.000Z", activity: "treadmill", minutes: 20, distance_km: 2.5 }],
    bodyWeight: [
      { measured_on: "2026-09-21", weight_kg: 81.3 },
      { measured_on: "2026-09-14", weight_kg: 81.7 },
    ],
  });
  assert.equal(
    csv,
    [
      "type,date,time,name,weight_kg,reps,minutes,distance_km,rpe,note",
      "body weight,2026-09-14,,,81.7,,,,,",
      "body weight,2026-09-21,,,81.3,,,,,",
      "set,2026-09-21,18:30,Bench Press,80,5,,,8,felt good",
      "cardio,2026-09-21,19:15,Treadmill,,,20,2.5,,",
      "",
    ].join("\n"),
  );
});
