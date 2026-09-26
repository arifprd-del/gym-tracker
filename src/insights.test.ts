import assert from "node:assert/strict";
import { test } from "node:test";
import { compareBySleep, METRICS, relativeToRecent, sleepInsights, strengthByDay } from "./insights";
import { addDays, type SetRow } from "./lib";

test("relative to recent level", () => {
  const pts = [100, 100, 100, 110, 90].map((value, i) => ({ day: addDays("2026-09-01", i), value }));
  const rel = relativeToRecent(pts, 7, 3);
  assert.deepEqual(rel.map((r) => [r.day, Math.round(r.pct)]), [["2026-09-04", 10], ["2026-09-05", -10]]);
  // A steady improvement is measured against recent days, not the first ones.
  const falling = [400, 380, 360, 340, 320, 300].map((value, i) => ({ day: addDays("2026-09-01", i), value }));
  assert.ok(relativeToRecent(falling, 3, 3).every((r) => r.pct < 0 && r.pct > -12));
});

test("strength per day against each exercise's previous sessions", () => {
  let id = 0;
  const set = (day: string, exercise: string, weight_kg: number, reps: number): SetRow => ({ id: ++id, performed_at: `${day}T10:00:00.000Z`, exercise, weight_kg, reps, rpe: null, note: null });
  const sets = [
    set("2026-09-01", "bench press", 80, 5), set("2026-09-04", "bench press", 80, 5), set("2026-09-07", "bench press", 80, 5),
    set("2026-09-10", "bench press", 84, 5), // +5% e1RM
    set("2026-09-02", "pull up", 0, 10), set("2026-09-05", "pull up", 0, 10), set("2026-09-08", "pull up", 0, 10),
    set("2026-09-10", "pull up", 0, 9), // −10% reps
  ];
  const rel = strengthByDay(sets, "UTC");
  assert.deepEqual(rel.map((r) => [r.day, Math.round(r.pct * 10) / 10]), [["2026-09-07", 0], ["2026-09-08", 0], ["2026-09-10", -2.5]]);
});

test("comparison needs 3 days of each and says which way", () => {
  const days = Array.from({ length: 8 }, (_, i) => addDays("2026-09-01", i));
  const sleep = new Map(days.map((d, i) => [d, i % 2 ? 360 : 480])); // odd days short
  const slowerAfterShort = days.map((day, i) => ({ day, pct: i % 2 ? 10 : 0 }));
  const speed = compareBySleep(METRICS.speed, slowerAfterShort, sleep);
  assert.equal(speed.ready, true);
  assert.equal(speed.sentence, "After nights under 7 h, your Quick Glance flash was 10% slower than after 7 h+ nights.");
  const strength = compareBySleep(METRICS.strength, days.map((day, i) => ({ day, pct: i % 2 ? -4 : 1 })), sleep);
  assert.equal(strength.sentence, "After nights under 7 h, your lifts were 5% weaker than after 7 h+ nights.");
  const same = compareBySleep(METRICS.strength, days.map((day) => ({ day, pct: 0.5 })), sleep);
  assert.equal(same.sentence, "After nights under 7 h, your lifts were about the same as after 7 h+ nights.");
  const early = compareBySleep(METRICS.speed, slowerAfterShort.slice(0, 4), sleep);
  assert.deepEqual([early.ready, early.short.n, early.good.n, early.sentence], [false, 2, 2, null]);
  // Days without a synced night are left out.
  assert.equal(compareBySleep(METRICS.speed, [{ day: "2026-10-01", pct: 50 }], sleep).short.n, 0);
});

test("sleep insights returns all four measures", () => {
  const out = sleepInsights({ sleep: [], speedDaily: [], sets: [], checks: [], timeZone: "UTC" });
  assert.deepEqual(out.map((c) => [c.key, c.ready]), [["speed", false], ["strength", false], ["reaction", false], ["symbols", false]]);
});
