import { MOBILITY_DAYS_GOAL } from "./lib";

export { MOBILITY_DAYS_GOAL };

// Longevity: the daily mobility routine and the weekly interval-walk goal (from Dan Go's 7 longevity exercises).

export type MobilityItem = "squat" | "stretch" | "pogo" | "hang";
export const MOBILITY_ITEMS: MobilityItem[] = ["squat", "stretch", "pogo", "hang"];
/** The home routine; the hang is a bonus (it needs a bar, and a dead hang logged at the gym ticks it). */
export const MOBILITY_CORE: MobilityItem[] = ["squat", "stretch", "pogo"];
export const INTERVAL_WALK = "interval walk";
export const INTERVAL_WALKS_GOAL = 4;

/** Days on which the whole home routine was done. */
export function mobilityDays(rows: { day: string; item: string }[]): Set<string> {
  const byDay = new Map<string, Set<string>>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? new Set()).add(r.item));
  return new Set([...byDay].filter(([, items]) => MOBILITY_CORE.every((i) => items.has(i))).map(([day]) => day));
}
