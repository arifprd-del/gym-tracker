import assert from "node:assert/strict";
import { test } from "node:test";
import { dueRules, isTime, localClock, reminderMessage, type ReminderRule, type ReminderState } from "./reminders";

test("local clock in London across the clock change", () => {
  assert.deepEqual(localClock(new Date("2026-09-26T19:05:00Z"), "Europe/London"), { day: "2026-09-26", time: "20:05", weekday: 6 });
  assert.deepEqual(localClock(new Date("2026-11-02T23:30:00Z"), "Europe/London"), { day: "2026-11-02", time: "23:30", weekday: 1 });
  assert.deepEqual(localClock(new Date("2026-09-26T23:10:00Z"), "Europe/London"), { day: "2026-09-27", time: "00:10", weekday: 0 });
});

test("rules are due from their time for three hours, once a day, on their days", () => {
  const rule = (over: Partial<ReminderRule>): ReminderRule => ({ key: "brain", enabled: true, time: "20:00", days: [0, 1, 2, 3, 4, 5, 6], lastSentDay: null, ...over });
  const at = (time: string, weekday = 6) => ({ day: "2026-09-26", time, weekday });
  assert.equal(dueRules([rule({})], at("19:59")).length, 0);
  assert.equal(dueRules([rule({})], at("20:00")).length, 1);
  assert.equal(dueRules([rule({})], at("22:59")).length, 1);
  assert.equal(dueRules([rule({})], at("23:00")).length, 0); // too late: skip rather than wake you
  assert.equal(dueRules([rule({ lastSentDay: "2026-09-26" })], at("20:15")).length, 0);
  assert.equal(dueRules([rule({ lastSentDay: "2026-09-25" })], at("20:15")).length, 1);
  assert.equal(dueRules([rule({ enabled: false })], at("20:15")).length, 0);
  assert.equal(dueRules([rule({ days: [1, 2, 3, 4, 5] })], at("20:15", 6)).length, 0);
  assert.ok(isTime("07:45") && isTime("23:59") && !isTime("24:00") && !isTime("7:45") && !isTime(undefined));
});

test("reminder messages only when something is left to do", () => {
  const s: ReminderState = {
    today: "2026-09-26",
    trainedToday: false,
    next: "pull",
    lastOfNext: "2026-09-23",
    nudge: null,
    roundsToday: 0,
    brainStreak: 4,
    weighedInThisWeek: false,
    brainCheckDue: true,
    mobilityDoneToday: false,
    mobilityStreak: 3,
  };
  assert.deepEqual(reminderMessage("gym", s), { title: "Pull day 💪", body: "Last Pull: 3 days ago. Tap to open the log.", url: "/log?tab=pull", tag: "gym" });
  assert.equal(reminderMessage("gym", { ...s, nudge: "Never miss twice: Pull today." })!.body, "Never miss twice: Pull today.");
  assert.equal(reminderMessage("gym", { ...s, lastOfNext: null })!.body, "Start your Pull rotation. Tap to open the log.");
  assert.equal(reminderMessage("gym", { ...s, trainedToday: true }), null);

  assert.equal(reminderMessage("brain", s)!.body, "2 Quick Glance rounds, about 7 minutes, keep your 4-day streak going.");
  assert.equal(reminderMessage("brain", { ...s, brainStreak: 0 })!.body, "2 Quick Glance rounds, about 7 minutes.");
  assert.equal(reminderMessage("brain", { ...s, roundsToday: 1 })!.body, "One more Quick Glance round finishes today (about 3 minutes).");
  assert.equal(reminderMessage("brain", { ...s, roundsToday: 2 }), null);

  assert.deepEqual(reminderMessage("mobility", s), {
    title: "Mobility 🌱",
    body: "6 minutes: squat hold, World's Greatest Stretch, pogo hops. Keep your 3-day streak going.",
    url: "/longevity",
    tag: "mobility",
  });
  assert.equal(reminderMessage("mobility", { ...s, mobilityDoneToday: true }), null);
  assert.deepEqual(reminderMessage("weekly", s), { title: "Weekly check-in", body: "Still to do this week: weigh in and do the Brain Check (3 min).", url: "/#body-weight", tag: "weekly" });
  assert.equal(reminderMessage("weekly", { ...s, weighedInThisWeek: true })!.url, "/brain#check");
  assert.equal(reminderMessage("weekly", { ...s, weighedInThisWeek: true, brainCheckDue: false }), null);
});
