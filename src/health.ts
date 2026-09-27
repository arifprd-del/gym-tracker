// Monthly longevity check (sit-to-stand, max dead hang, 12-minute test) and weekly blood pressure and waist.

export type FitnessTest = "sit_rise" | "hang" | "cooper";
export const FITNESS_TESTS: FitnessTest[] = ["sit_rise", "hang", "cooper"];
export const CHECK_EVERY_DAYS = 28;

/** Estimated VO2max (ml/kg/min) from the distance covered in 12 minutes (Cooper test). */
export function vo2FromCooper(distanceKm: number): number {
  return Math.round(((distanceKm * 1000 - 504.9) / 44.73) * 10) / 10;
}

/** The monthly check is due when any of the three tests hasn't been done in the last 4 weeks. */
export function fitnessCheckDue(latest: Partial<Record<FitnessTest, string>>, today: string): boolean {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - CHECK_EVERY_DAYS * 86_400_000;
  return FITNESS_TESTS.some((t) => !latest[t] || new Date(`${latest[t]}T00:00:00Z`).getTime() <= cutoff);
}

export type Tone = "good" | "watch" | "high";

/** Sitting-rising test (0-10): under 8 is linked to higher mortality in middle age and later. */
export function sitRiseLabel(score: number): { label: string; tone: Tone } {
  if (score >= 8) return { label: "Good (8–10)", tone: "good" };
  if (score >= 6) return { label: "Room to improve (6–7.5)", tone: "watch" };
  return { label: "Work on it (under 6)", tone: "high" };
}

/** Home blood pressure bands (NHS): ideal under 120/80, high from 135/85 at home. */
export function bpCategory(systolic: number, diastolic: number): { label: string; tone: Tone } {
  if (systolic >= 135 || diastolic >= 85) return { label: "High for a home reading: talk to your GP if it stays here", tone: "high" };
  if (systolic >= 120 || diastolic >= 80) return { label: "Above ideal", tone: "watch" };
  if (systolic < 90 || diastolic < 60) return { label: "Low: see a GP if you feel dizzy or faint", tone: "watch" };
  return { label: "Ideal", tone: "good" };
}

/** Waist-to-height ratio (NICE): under 0.5 healthy, 0.5–0.59 increased risk, 0.6+ high. */
export function waistRatio(waistCm: number, heightCm: number): { ratio: number; label: string; tone: Tone } {
  const ratio = Math.round((waistCm / heightCm) * 100) / 100;
  if (ratio >= 0.6) return { ratio, label: "High risk (0.6+)", tone: "high" };
  if (ratio >= 0.5) return { ratio, label: "Increased risk (0.5–0.59)", tone: "watch" };
  return { ratio, label: "Healthy (under 0.5)", tone: "good" };
}
