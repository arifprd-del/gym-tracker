// Reminder rules: when each notification is due, and what it says given today's progress. Pure, so it's tested
// without a database; the Worker's cron (every 15 minutes) loads the state and sends what's due.
import { daysAgo, type SplitDay } from "./lib";

export type ReminderKey = "gym" | "brain" | "weekly" | "mobility";
export type ReminderRule = { key: ReminderKey; enabled: boolean; time: string; days: number[]; lastSentDay: string | null }; // days: 0 = Sunday
export type ReminderMessage = { title: string; body: string; url: string; tag: string };

export const REMINDER_KEYS: ReminderKey[] = ["gym", "mobility", "brain", "weekly"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** A reminder is sent up to this long after its time (covers a late cron run), never later in the day. */
const WINDOW_MINUTES = 180;

export type LocalClock = { day: string; time: string; weekday: number };

/** The local date, HH:MM and weekday (0 = Sunday) in a time zone. */
export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: WEEKDAYS.indexOf(parts.weekday) };
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Rules whose time has come today and that haven't been handled today. */
export function dueRules(rules: ReminderRule[], clock: LocalClock): ReminderRule[] {
  const now = minutesOf(clock.time);
  return rules.filter((r) => {
    const late = now - minutesOf(r.time);
    return r.enabled && r.days.includes(clock.weekday) && late >= 0 && late < WINDOW_MINUTES && r.lastSentDay !== clock.day;
  });
}

export type ReminderState = {
  today: string;
  trainedToday: boolean;
  next: SplitDay;
  lastOfNext: string | null;
  nudge: string | null; // "never miss twice" text, if any
  roundsToday: number;
  brainStreak: number;
  weighedInThisWeek: boolean;
  brainCheckDue: boolean;
  mobilityDoneToday: boolean;
  mobilityStreak: number;
};

const LABEL: Record<SplitDay, string> = { push: "Push", pull: "Pull", legs: "Legs" };

/** The notification for a rule, or null when there's nothing left to do. */
export function reminderMessage(key: ReminderKey, s: ReminderState): ReminderMessage | null {
  if (key === "gym") {
    if (s.trainedToday) return null;
    const label = LABEL[s.next];
    const last = s.lastOfNext ? `Last ${label}: ${daysAgo(s.lastOfNext, s.today).toLowerCase()}.` : `Start your ${label} rotation.`;
    return { title: `${label} day 💪`, body: s.nudge ?? `${last} Tap to open the log.`, url: `/log?tab=${s.next}`, tag: "gym" };
  }
  if (key === "brain") {
    if (s.roundsToday >= 2) return null;
    const body =
      s.roundsToday === 1
        ? "One more Quick Glance round finishes today (about 3 minutes)."
        : s.brainStreak > 0
          ? `2 Quick Glance rounds, about 7 minutes, keep your ${s.brainStreak}-day streak going.`
          : "2 Quick Glance rounds, about 7 minutes.";
    return { title: "Brain training 🧠", body, url: "/brain", tag: "brain" };
  }
  if (key === "mobility") {
    if (s.mobilityDoneToday) return null;
    const streak = s.mobilityStreak > 0 ? ` Keep your ${s.mobilityStreak}-day streak going.` : "";
    return { title: "Mobility 🌱", body: `6 minutes: squat hold, World's Greatest Stretch, pogo hops.${streak}`, url: "/longevity", tag: "mobility" };
  }
  const todo = [!s.weighedInThisWeek && "weigh in", s.brainCheckDue && "do the Brain Check (3 min)"].filter(Boolean) as string[];
  if (todo.length === 0) return null;
  return {
    title: "Weekly check-in",
    body: `Still to do this week: ${todo.join(" and ")}.`,
    url: s.weighedInThisWeek ? "/brain#check" : "/#body-weight",
    tag: "weekly",
  };
}
