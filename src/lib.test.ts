import assert from "node:assert/strict";
import { test } from "node:test";
import { createSession, hasValidBearer, isValidSession } from "./auth";
import {
  describeDay,
  describeLoggedSet,
  displayName,
  estimateOneRepMax,
  localDay,
  normalizeExercise,
  summarizeSets,
  weekStart,
  weekStreak,
  weeklyVolume,
  type SetRow,
} from "./lib";

let nextId = 1;
function set(performed_at: string, exercise: string, weight_kg: number, reps: number): SetRow {
  return { id: nextId++, performed_at, exercise, weight_kg, reps, rpe: null, note: null };
}

test("exercise names from voice and lists end up the same", () => {
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

test("logged-set message notes a new personal best", () => {
  const s = { exercise: "bench press", weight_kg: 82.5, reps: 5 };
  assert.equal(describeLoggedSet(s, 80, 3), "Bench Press, 82.5 kilos for 5. Set 3 logged. New personal best!");
  assert.equal(describeLoggedSet(s, 85, 1), "Bench Press, 82.5 kilos for 5. Set 1 logged.");
  assert.equal(describeLoggedSet(s, null, 1), "Bench Press, 82.5 kilos for 5. Set 1 logged.");
  assert.equal(describeLoggedSet({ exercise: "pull up", weight_kg: 0, reps: 12 }, null, 2), "Pull Up, 12 reps. Set 2 logged.");
});

test("day summary and spoken description", () => {
  const summary = summarizeSets([
    set("2026-09-23T08:00:00.000Z", "squat", 100, 5),
    set("2026-09-23T08:05:00.000Z", "squat", 110, 3),
    set("2026-09-23T08:20:00.000Z", "bench press", 80, 5),
  ]);
  assert.equal(summary.sets, 3);
  assert.equal(summary.volumeKg, 500 + 330 + 400);
  assert.equal(
    describeDay(summary),
    "3 sets today, 1230 kilos of volume. Squat: 2 sets, top 110 kilos. Bench Press: 1 set, top 80 kilos.",
  );
  assert.equal(describeDay(summarizeSets([])), "No sets logged today yet.");
  assert.equal(
    describeDay(summarizeSets([set("2026-09-23T08:00:00.000Z", "pull up", 0, 10)])),
    "1 set today, 0 kilos of volume. Pull Up: 1 set.",
  );
});

test("weekly volume includes empty weeks and ignores older sets", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");
  const weeks = weeklyVolume(
    [
      set("2026-09-22T08:00:00.000Z", "squat", 100, 5), // this week
      set("2026-09-08T08:00:00.000Z", "squat", 100, 2), // two weeks ago
      set("2026-01-01T08:00:00.000Z", "squat", 100, 5), // outside the window
    ],
    "UTC",
    3,
    now,
  );
  assert.deepEqual(weeks, [
    { week: "2026-09-07", volumeKg: 200 },
    { week: "2026-09-14", volumeKg: 0 },
    { week: "2026-09-21", volumeKg: 500 },
  ]);
});

test("week streak survives a current week with no session yet", () => {
  const days = ["2026-09-01", "2026-09-09", "2026-09-15"]; // weeks of 31 Aug, 7 Sep, 14 Sep
  assert.equal(weekStreak(days, "2026-09-23"), 3);
  assert.equal(weekStreak([...days, "2026-09-22"], "2026-09-23"), 4);
  assert.equal(weekStreak(["2026-09-01"], "2026-09-23"), 0);
});

test("bearer token check", async () => {
  assert.equal(await hasValidBearer("Bearer secret-token", "secret-token"), true);
  assert.equal(await hasValidBearer("Bearer wrong", "secret-token"), false);
  assert.equal(await hasValidBearer(undefined, "secret-token"), false);
  assert.equal(await hasValidBearer("Bearer anything", undefined), false);
});

test("sessions are signed and expire", async () => {
  const now = Date.UTC(2026, 8, 23);
  const cookie = await createSession("password", now);
  assert.equal(await isValidSession(cookie, "password", now), true);
  assert.equal(await isValidSession(cookie, "changed-password", now), false);
  assert.equal(await isValidSession(cookie, "password", now + 31 * 24 * 60 * 60 * 1000), false);
  const [expires] = cookie.split(".");
  assert.equal(await isValidSession(`${Number(expires) + 1}.${cookie.split(".")[1]}`, "password", now), false);
});

test("session refresh and sign-in redirects", async () => {
  const { sessionNeedsRefresh, safeNextPath } = await import("./auth");
  const now = Date.UTC(2026, 8, 23);
  const cookie = await createSession("password", now);
  assert.equal(sessionNeedsRefresh(cookie, now), false);
  assert.equal(sessionNeedsRefresh(cookie, now + 20 * 24 * 60 * 60 * 1000), true);
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
