import assert from "node:assert/strict";
import { test } from "node:test";
import { bpCategory, fitnessCheckDue, sitRiseLabel, vo2FromCooper, waistRatio } from "./health";

test("health and fitness bands", () => {
  assert.equal(vo2FromCooper(2.4), 42.4); // (2400 - 504.9) / 44.73
  assert.equal(vo2FromCooper(2.0), 33.4);
  assert.equal(fitnessCheckDue({}, "2026-09-27"), true);
  assert.equal(fitnessCheckDue({ sit_rise: "2026-09-20", hang: "2026-09-20", cooper: "2026-09-01" }, "2026-09-27"), false);
  assert.equal(fitnessCheckDue({ sit_rise: "2026-09-20", hang: "2026-09-20", cooper: "2026-08-30" }, "2026-09-27"), true);
  assert.equal(fitnessCheckDue({ sit_rise: "2026-09-20", hang: "2026-09-20" }, "2026-09-27"), true);
  assert.equal(sitRiseLabel(8.5).tone, "good");
  assert.equal(sitRiseLabel(6).tone, "watch");
  assert.equal(sitRiseLabel(4.5).tone, "high");
  assert.equal(bpCategory(118, 76).tone, "good");
  assert.equal(bpCategory(126, 78).tone, "watch");
  assert.equal(bpCategory(122, 86).tone, "high");
  assert.equal(bpCategory(138, 80).tone, "high");
  assert.equal(bpCategory(88, 58).tone, "watch");
  assert.deepEqual(waistRatio(86, 175), { ratio: 0.49, label: "Healthy (under 0.5)", tone: "good" });
  assert.equal(waistRatio(92, 175).tone, "watch");
  assert.equal(waistRatio(106, 175).tone, "high");
});
