import { html, raw } from "hono/html";
import {
  addDays,
  weekStart,
  daysAgo,
  displayName,
  formatCardio,
  formatKg,
  formatLoad,
  formatMinutes,
  formatSleep,
  isTimed,
  SPLIT_DAYS,
  WORKOUT_DAYS,
  type BodyWeightRow,
  type ChecklistItem,
  type CardioRow,
  type DayOf,
  type ExerciseSession,
  type Stall,
  type WeekRecap,
  type WorkoutSummary,
  type Target,
  formatTarget,
  type DaySummary,
  type SetRow,
  type SplitDay,
  type TrainingDay,
  type WorkoutDay,
} from "./lib";

type Html = ReturnType<typeof html>;

const styles = `
:root {
  --bg: #f6f7f9; --card: #ffffff; --text: #16181d; --muted: #5f6673; --line: #e3e6eb;
  --accent: #2563eb; --accent-soft: #dbe6fd; --on-accent: #ffffff; --danger: #c52a2a;
  --heat-0: #e8ebf0; --nudge-bg: #fff1d6; --good: #0e7a52;
  --push: #2a78d6; --pull: #eb6834; --legs: #1baf7a; --other: #9aa0aa; --cardio: #4a3aa7;
  --longevity: #c0307a; --longevity-soft: #fbe3ef;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --card: #181b21; --text: #e8eaee; --muted: #9aa1ad; --line: #2a2f38;
    --accent: #6d9bff; --accent-soft: #1f2b44; --on-accent: #0f1115; --danger: #ff7474;
    --heat-0: #232833; --nudge-bg: #3a2f17; --good: #4fd6a0;
    --push: #3987e5; --pull: #d95926; --legs: #199e70; --other: #5b6270; --cardio: #9085e9;
    --longevity: #f07ab5; --longevity-soft: #3a1f2d;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
/* In the Home Screen app the page runs under the status bar and notch, so pad by the safe-area insets, and keep a
   solid strip behind the status bar so scrolled content doesn't show through the clock and battery. */
body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; height: env(safe-area-inset-top); background: var(--bg); z-index: 10; }
main { max-width: 960px; margin: 0 auto; display: grid; gap: 16px;
  padding: calc(20px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left)); }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
h1 { font-size: 22px; margin: 0; white-space: nowrap; }
h2 { font-size: 15px; margin: 0 0 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; overflow-x: auto; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
.stat b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 13px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; font-size: 13px; }
td.num, th.num { text-align: right; }
tr.day td { color: var(--muted); font-size: 13px; font-weight: 600; padding-top: 14px; }
button, .button { white-space: nowrap; font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 999px; padding: 6px 14px; cursor: pointer; text-decoration: none; }
button.primary, .button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
button.link { border: 0; background: none; color: var(--danger); padding: 2px 6px; font-size: 13px; }
.muted { color: var(--muted); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
svg text { fill: var(--muted); font-size: 11px; }
.volume { display: block; max-width: 640px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0 0 12px; padding: 0; list-style: none; font-size: 13px; color: var(--muted); }
.legend li { display: flex; align-items: center; gap: 6px; }
.swatch, .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; }
.dot { border-radius: 50%; margin-right: 8px; vertical-align: 1px; }
.split { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.split .stat { border-left: 4px solid var(--c); }
.split .stat { padding: 10px 12px; min-width: 0; }
.split .stat b { font-size: clamp(14px, 4vw, 18px); white-space: nowrap; }
.split .stat .label { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text); font-size: 14px; margin-bottom: 4px; }
.weigh { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px; margin-bottom: 12px; }
.weigh .big { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
.weigh form { display: flex; gap: 8px; }
.weigh input { width: 110px; font-size: 17px; }
.callout { background: var(--accent-soft); border-radius: 10px; padding: 8px 12px; margin: 0 0 12px; font-size: 14px; }
.line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.point { fill: var(--accent); stroke: var(--card); stroke-width: 2; }
.habits { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 12px; }
@media (max-width: 640px) { .habits { grid-template-columns: 1fr; } }
.habits .card h2 { display: flex; justify-content: space-between; }
.check-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.check-list li { display: flex; align-items: center; gap: 10px; font-size: 15px; }
.check { width: 22px; height: 22px; border-radius: 50%; flex: none; display: grid; place-items: center;
  border: 2px solid var(--c); color: var(--card); font-size: 13px; font-weight: 800; line-height: 1; }
.check.done { background: var(--c); }
.check-list .detail { margin-left: auto; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.split-head { display: flex; justify-content: space-between; gap: 12px; }
.meter { height: 10px; border-radius: 5px; background: var(--heat-0); overflow: hidden; }
.meter span { display: block; height: 100%; border-radius: 5px; background: var(--accent); }
.protein-add { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
.protein-add button { padding: 12px 0; font-size: 16px; font-weight: 600; border-radius: 12px; }
.protein-custom { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.protein-custom input { width: 80px; font-size: 17px; }
.progress { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; margin: 0 0 14px; }
.progress span { height: 6px; border-radius: 3px; background: var(--heat-0); }
.progress span.done { background: var(--accent); }
.complete { border-color: var(--accent); }
.plan-next { display: flex; align-items: center; gap: 10px; font-size: 26px; font-weight: 700; margin: 2px 0 4px; }
.plan-next .swatch { width: 14px; height: 14px; }
.plan .button { display: inline-block; margin-top: 12px; }
.nudge { background: var(--nudge-bg); color: var(--text); border-radius: 12px; padding: 12px 14px; margin: 0; font-weight: 500; }
.step-stats { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 0 0 12px; }
.step-stats b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
.step-stats span { color: var(--muted); font-size: 13px; }
.goal-line { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 4 4; }
a.plain { color: inherit; text-decoration: none; }
a.plain:hover, a.plain:focus-visible { text-decoration: underline; }
.stats.compact .stat b { font-size: clamp(18px, 5.2vw, 26px); white-space: nowrap; }
.tag { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600;
  background: var(--nudge-bg); color: var(--text); text-decoration: none; vertical-align: 1px; }
.history td.sets { white-space: normal; color: var(--muted); }
.recap-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.recap-headline { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
.recap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 20px; }
.recap-grid b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.recap-grid span { color: var(--muted); font-size: 13px; }
.recap-list { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
.trend { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.trend.up { color: var(--good); }
.trend.down { color: var(--danger); }
.trend.same, .trend.new { color: var(--muted); }
.card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.login { max-width: 360px; margin: 12vh auto 0; }
.login form { display: grid; gap: 12px; }
input { font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); }
.error { color: var(--danger); margin: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

export function layout(title: string, body: Html, head: Html | string = ""): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Arif Gym" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <title>${title}</title>
        <style>
          ${raw(styles)}
        </style>
        ${head}
      </head>
      <body>
        ${body}
      </body>
    </html>`;
}

export function loginPage(error?: string, next = "/"): Html {
  return layout(
    "Arif Gym Tracker",
    html`<main class="login card">
      <h1>Arif Gym Tracker</h1>
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${next}" />
        <input type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus />
        ${error ? html`<p class="error">${error}</p>` : ""}
        <button class="primary" type="submit">Sign in</button>
      </form>
    </main>`,
  );
}

export type ExerciseRecord = { exercise: string; best_kg: number; best_e1rm: number; sets: number; last: string };

export type DashboardData = {
  recap: WeekRecap;
  habits: {
    plan: SplitDay;
    doneToday: SplitDay | null;
    lastOfNext: string | null;
    nudge: string | null;
    checklist: ChecklistItem[];
  };
  today: string;
  todaySummary: DaySummary;
  weekStreak: number;
  sessionsThisWeek: number;
  weekly: { week: string; byDay: Record<WorkoutDay, number>; volumeKg: number }[];
  heatmap: { start: string; weeks: number; days: Map<string, TrainingDay>; cardioDays: Map<string, number> };
  cardio: { thisWeekMinutes: number; weekly: { week: string; minutes: number }[]; recent: (CardioRow & { day: string; time: string })[] };
  steps: {
    daily: { day: string; steps: number | null }[];
    summary: { today: number | null; yesterday: number | null; average7: number | null; thisWeek: number; lastSynced: string | null };
    goal: number;
    hasSyncKey: boolean;
  };
  protein: {
    today: number;
    target: number | null; // null until there's a weigh-in
    fallback: number;
    perKg: number;
    weightKg: number | null;
    last: { grams: number; time: string } | null;
    daily: { day: string; grams: number }[];
  };
  bodyWeight: {
    weekly: { week: string; kg: number | null }[];
    trend: { latest: BodyWeightRow | null; changeKg: number | null; since: string | null };
    recent: BodyWeightRow[];
    loggedThisWeek: boolean;
  };
  lastTrained: Record<SplitDay, string | null>;
  dayOf: DayOf;
  /** Exercises whose last 3+ sessions haven't beaten their best. */
  stalled: Set<string>;
  records: ExerciseRecord[];
  recent: (SetRow & { day: string; time: string })[];
};

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const DAY_LABELS: Record<WorkoutDay, string> = { push: "Push", pull: "Pull", legs: "Legs", other: "Other" };

function legend(days: readonly WorkoutDay[]): Html {
  return html`<ul class="legend">
    ${days.map((d) => html`<li><span class="swatch" style="background: var(--${d})"></span>${DAY_LABELS[d]}</li>`)}
  </ul>`;
}

/** Coloured dot with the day name as its accessible label, so colour is never the only cue. */
function dayDot(day: WorkoutDay): Html {
  return html`<span class="dot" style="background: var(--${day})" role="img" aria-label="${DAY_LABELS[day]}" title="${DAY_LABELS[day]}"></span>`;
}

function kg(n: number): string {
  return `${Math.round(n).toLocaleString("en-GB")} kg`;
}

function volumeChart(weekly: DashboardData["weekly"]): Html {
  const width = 400;
  const height = 150;
  const chartHeight = 122;
  const gap = 2; // surface gap between stacked segments
  const max = Math.max(1, ...weekly.map((w) => w.volumeKg));
  const slot = width / weekly.length;
  const barWidth = slot * 0.62;
  const bars = weekly.map((w, i) => {
    const x = i * slot + (slot - barWidth) / 2;
    let y = chartHeight;
    const segments = WORKOUT_DAYS.filter((d) => w.byDay[d] > 0).map((d) => {
      const h = (w.byDay[d] / max) * (chartHeight - 16);
      y -= h;
      const drawn = Math.max(h - gap, 1);
      return html`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${drawn.toFixed(1)}" rx="2" fill="var(--${d})"></rect>`;
    });
    const breakdown = WORKOUT_DAYS.filter((d) => w.byDay[d] > 0)
      .map((d) => `${DAY_LABELS[d]} ${kg(w.byDay[d])}`)
      .join(", ");
    return html`<g>
      ${segments}
      <rect x="${(i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${chartHeight}" fill="transparent">
        <title>Week of ${shortDate(w.week)}: ${kg(w.volumeKg)}${breakdown ? ` (${breakdown})` : ""}</title>
      </rect>
      ${(weekly.length - 1 - i) % 2 === 0
        ? html`<text x="${(i * slot + slot / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${shortDate(w.week)}</text>`
        : ""}
    </g>`;
  });
  return html`<svg class="volume" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Weekly training volume by workout type">
    ${bars}
  </svg>`;
}

/** Cardio is marked with a dot (a shape, not a fourth colour) so it reads on top of the push / pull / legs colours. */
function cardioMarker(cx: number, cy: number): Html {
  return html`<circle cx="${cx}" cy="${cy}" r="2.6" fill="var(--text)" stroke="var(--card)" stroke-width="1.5"></circle>`;
}

function heatmap({ start, weeks, days, cardioDays }: DashboardData["heatmap"], today: string): Html {
  const cell = 14;
  const gap = 3;
  const left = 22;
  const top = 16;
  const cells = [];
  const monthLabels = [];
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, w * 7);
    if (w === 0 || monday.slice(8) <= "07") {
      monthLabels.push(
        html`<text x="${left + w * (cell + gap)}" y="11">${new Date(`${monday}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</text>`,
      );
    }
    for (let d = 0; d < 7; d++) {
      const day = addDays(monday, d);
      if (day > today) continue;
      const entry = days.get(day);
      const cardioMinutes = cardioDays.get(day);
      const fill = entry ? `var(--${entry.main})` : "var(--heat-0)";
      const parts = [
        entry ? `${DAY_LABELS[entry.main]} day, ${entry.sets} ${entry.sets === 1 ? "set" : "sets"}` : "",
        cardioMinutes ? `${formatMinutes(cardioMinutes)} cardio` : "",
      ].filter(Boolean);
      const label = `${shortDate(day)}: ${parts.length ? parts.join(", ") : "rest day"}`;
      const x = left + w * (cell + gap);
      const y = top + d * (cell + gap);
      cells.push(
        html`<g><title>${label}</title><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}"></rect>${cardioMinutes ? cardioMarker(x + cell / 2, y + cell / 2) : ""}</g>`,
      );
    }
  }
  const width = left + weeks * (cell + gap);
  const height = top + 7 * (cell + gap);
  return html`<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Training days coloured by workout type">
    ${monthLabels}
    <text x="0" y="${top + cell - 3}">M</text>
    <text x="0" y="${top + 2 * (cell + gap) + cell - 3}">W</text>
    <text x="0" y="${top + 4 * (cell + gap) + cell - 3}">F</text>
    ${cells}
  </svg>`;
}

function cardioChart(weekly: DashboardData["cardio"]["weekly"]): Html {
  const width = 400;
  const height = 150;
  const chartHeight = 122;
  const max = Math.max(30, ...weekly.map((w) => w.minutes));
  const slot = width / weekly.length;
  const barWidth = slot * 0.62;
  const bars = weekly.map((w, i) => {
    const h = (w.minutes / max) * (chartHeight - 18);
    const x = i * slot + (slot - barWidth) / 2;
    const isLast = i === weekly.length - 1;
    return html`<g>
      ${w.minutes > 0 ? html`<rect x="${x.toFixed(1)}" y="${(chartHeight - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--cardio)"></rect>` : ""}
      ${isLast && w.minutes > 0 ? html`<text x="${(x + barWidth / 2).toFixed(1)}" y="${(chartHeight - h - 5).toFixed(1)}" text-anchor="middle">${Math.round(w.minutes)}</text>` : ""}
      <rect x="${(i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${chartHeight}" fill="transparent"><title>Week of ${shortDate(w.week)}: ${formatMinutes(w.minutes)}</title></rect>
      ${(weekly.length - 1 - i) % 2 === 0
        ? html`<text x="${(i * slot + slot / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${shortDate(w.week)}</text>`
        : ""}
    </g>`;
  });
  return html`<svg class="volume" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Cardio minutes per week">${bars}</svg>`;
}

function bodyWeightChart(allWeeks: DashboardData["bodyWeight"]["weekly"]): Html {
  // Start at the first weigh-in (showing at least 8 weeks) rather than a long empty run.
  const first = allWeeks.findIndex((w) => w.kg !== null);
  const weekly = first === -1 ? allWeeks : allWeeks.slice(Math.min(first, Math.max(0, allWeeks.length - 8)));
  const points = weekly.map((w, i) => ({ ...w, i })).filter((w): w is { week: string; kg: number; i: number } => w.kg !== null);
  if (points.length === 0) return html``;
  const width = 400;
  const height = 150;
  const left = 34;
  const right = 18; // room for the last date label
  const top = 10;
  const chartHeight = 112;
  const lo = Math.floor(Math.min(...points.map((p) => p.kg)) - 1);
  const hi = Math.ceil(Math.max(...points.map((p) => p.kg)) + 1);
  const slot = (width - left - right) / weekly.length;
  const px = (i: number) => left + i * slot + slot / 2;
  const py = (kg: number) => top + ((hi - kg) / (hi - lo)) * chartHeight;
  // Break the line where a week has no weigh-in.
  const segments: string[] = [];
  let current = "";
  weekly.forEach((w, i) => {
    if (w.kg === null) {
      if (current) segments.push(current);
      current = "";
    } else current += `${current ? "L" : "M"}${px(i).toFixed(1)},${py(w.kg).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const labelEvery = Math.ceil(weekly.length / 6);
  return html`<svg class="volume" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Weekly body weight">
    <line x1="${left}" x2="${width}" y1="${top}" y2="${top}" stroke="var(--line)"></line>
    <line x1="${left}" x2="${width}" y1="${top + chartHeight}" y2="${top + chartHeight}" stroke="var(--line)"></line>
    <text x="0" y="${top + 4}">${hi}</text>
    <text x="0" y="${top + chartHeight + 4}">${lo}</text>
    ${segments.map((d) => html`<path class="line" d="${d}"></path>`)}
    ${points.map((p) => html`<circle class="point" cx="${px(p.i).toFixed(1)}" cy="${py(p.kg).toFixed(1)}" r="4"><title>Week of ${shortDate(p.week)}: ${formatKg(p.kg)} kg</title></circle>`)}
    ${weekly.map((w, i) =>
      (weekly.length - 1 - i) % labelEvery === 0
        ? html`<text x="${px(i).toFixed(1)}" y="${height - 6}" text-anchor="middle">${shortDate(w.week)}</text>`
        : "",
    )}
  </svg>`;
}

const n = (v: number) => v.toLocaleString("en-GB");

function stepsChart({ daily, goal }: DashboardData["steps"]): Html {
  const width = 400;
  const height = 150;
  const chartHeight = 122;
  const right = 20; // room for the last date label
  const max = Math.max(goal * 1.15, ...daily.map((d) => d.steps ?? 0));
  const slot = (width - right) / daily.length;
  const barWidth = slot * 0.7;
  const y = (v: number) => chartHeight - (v / max) * (chartHeight - 10);
  const bars = daily.map((d, i) => {
    const x = i * slot + (slot - barWidth) / 2;
    const label = d.steps === null ? "not synced" : `${n(d.steps)} steps${d.steps >= goal ? " ✓ goal" : ""}`;
    return html`<g>
      ${d.steps ? html`<rect x="${x.toFixed(1)}" y="${y(d.steps).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(chartHeight - y(d.steps)).toFixed(1)}" rx="1.5" fill="var(--accent)"></rect>` : ""}
      <rect x="${(i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${chartHeight}" fill="transparent"><title>${shortDate(d.day)}: ${label}</title></rect>
      ${(daily.length - 1 - i) % 7 === 0 ? html`<text x="${(i * slot + slot / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${shortDate(d.day)}</text>` : ""}
    </g>`;
  });
  return html`<svg class="volume" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Daily steps for the last ${daily.length} days, goal ${n(goal)}">
    ${bars}
    <line class="goal-line" x1="0" x2="${width - right}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"></line>
  </svg>`;
}

function proteinChart(daily: DashboardData["protein"]["daily"], target: number): Html {
  const width = 400;
  const height = 130;
  const chartHeight = 102;
  const right = 20;
  const max = Math.max(target * 1.25, ...daily.map((d) => d.grams));
  const slot = (width - right) / daily.length;
  const barWidth = slot * 0.7;
  const y = (v: number) => chartHeight - (v / max) * (chartHeight - 10);
  return html`<svg class="volume" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Protein per day for the last ${daily.length} days, target ${target} g">
    ${daily.map((d, i) => {
      const x = i * slot + (slot - barWidth) / 2;
      return html`<g>
        ${d.grams ? html`<rect x="${x.toFixed(1)}" y="${y(d.grams).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(chartHeight - y(d.grams)).toFixed(1)}" rx="1.5" fill="var(--accent)"></rect>` : ""}
        <rect x="${(i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${chartHeight}" fill="transparent"><title>${shortDate(d.day)}: ${d.grams ? `${d.grams} g${d.grams >= target ? " ✓ target" : ""}` : "nothing logged"}</title></rect>
        ${(daily.length - 1 - i) % 7 === 0 ? html`<text x="${(i * slot + slot / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${shortDate(d.day)}</text>` : ""}
      </g>`;
    })}
    <line class="goal-line" x1="0" x2="${width - right}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"></line>
  </svg>`;
}

function proteinCard(p: DashboardData["protein"]): Html {
  const target = p.target ?? p.fallback;
  const left = target - p.today;
  const pct = Math.min(100, Math.round((p.today / target) * 100));
  return html`<section class="card" id="protein">
    <h2 class="split-head"><span>Protein today</span><span>${p.today} / ${target} g</span></h2>
    <div class="meter" aria-hidden="true"><span style="width: ${pct}%"></span></div>
    <p style="margin: 8px 0 12px">${left > 0 ? html`<b>${left} g</b> to go` : html`<b style="color: var(--good)">Target reached ✓</b>`}
      <span class="muted">· ${p.target ? `${p.perKg} g per kg × ${formatKg(p.weightKg!)} kg` : "add a weigh-in to set your own target"}</span></p>
    <div class="protein-add">
      ${[10, 20, 30, 40].map((g) => html`<button type="button" data-g="${g}">+${g} g</button>`)}
    </div>
    <form class="protein-custom" id="protein-form">
      <input name="g" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="g" aria-label="Grams of protein" autocomplete="off" />
      <button type="submit">Add</button>
      ${p.last ? html`<button type="button" class="link" id="protein-undo">Undo +${p.last.grams} g (${p.last.time})</button>` : ""}
    </form>
    <p class="muted" id="protein-msg" role="status" style="margin: 0 0 10px; font-size: 13px"></p>
    ${p.daily.some((d) => d.grams > 0) ? proteinChart(p.daily, target) : ""}
    <p class="muted" style="margin: 6px 0 0; font-size: 13px">Rough guide: chicken breast 150 g ≈ 45 g · tin of tuna ≈ 25 g · whey scoop ≈ 24 g ·
      Greek yogurt 200 g ≈ 20 g · 3 eggs ≈ 19 g · lentils, 1 cup cooked ≈ 18 g · milk 300 ml ≈ 10 g.</p>
    <script>
      (() => {
        const msg = document.getElementById("protein-msg");
        async function post(path, body) {
          const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
          if (res.status === 401) { location.href = "/login?next=/%23protein"; return; }
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { msg.textContent = data.error || "Couldn't save. Check your signal and try again."; return; }
          location.reload();
        }
        const add = (g) => { if (g >= 1 && g <= 300) { msg.textContent = "Saving…"; post("/api/protein", { grams: g }); } else msg.textContent = "Enter 1 to 300 grams."; };
        document.querySelectorAll("#protein [data-g]").forEach((b) => b.addEventListener("click", () => add(Number(b.dataset.g))));
        document.getElementById("protein-form").addEventListener("submit", (e) => { e.preventDefault(); add(Math.round(Number(e.target.g.value))); });
        const undo = document.getElementById("protein-undo");
        if (undo) undo.addEventListener("click", () => post("/api/protein/undo", {}));
      })();
    </script>
  </section>`;
}

function syncKeyForm(hasSyncKey: boolean): Html {
  const confirm = hasSyncKey ? `return confirm('Make a new sync key? The old one stops working, so paste the new one into the shortcut.')` : "";
  return html`<form method="post" action="/steps-key" onsubmit="${confirm}" style="margin-top: 10px">
    <button type="submit"${hasSyncKey ? "" : html` class="primary"`}>${hasSyncKey ? "New sync key" : "Create sync key"}</button>
  </form>`;
}

function stepsCard(steps: DashboardData["steps"]): Html {
  const s = steps.summary;
  if (!s.lastSynced) {
    return html`<section class="card" id="steps">
      <h2>Steps</h2>
      <p class="muted" style="margin: 0">Not synced yet. Create a sync key, copy it into the shortcut's Authorization header, and your
        daily steps will appear here. The nightly automation is described in <b>docs/iphone-setup.md</b>.</p>
      ${syncKeyForm(steps.hasSyncKey)}
    </section>`;
  }
  const stat = (value: number | null, label: string) => html`<div><b>${value === null ? "–" : n(value)}</b><span>${label}</span></div>`;
  return html`<section class="card" id="steps">
    <h2>Steps</h2>
    <div class="step-stats">
      ${s.today !== null ? stat(s.today, "today") : stat(s.yesterday, "yesterday")}
      ${stat(s.average7, "7-day average")}
      ${stat(s.thisWeek, "this week")}
    </div>
    ${stepsChart(steps)}
    <p class="muted" style="font-size: 13px; margin: 6px 0 0">Dashed line: ${n(steps.goal)}-step daily goal · last synced ${shortDate(s.lastSynced)}</p>
    ${syncKeyForm(steps.hasSyncKey)}
  </section>`;
}

function bodyWeightCard(bw: DashboardData["bodyWeight"]): Html {
  const { latest, changeKg, since } = bw.trend;
  const change =
    changeKg === null ? "" : `${changeKg > 0 ? "+" : changeKg < 0 ? "−" : "±"}${formatKg(Math.abs(changeKg))} kg since ${shortDate(since!)}`;
  return html`<section class="card" id="body-weight">
    <h2>Body weight</h2>
    ${bw.loggedThisWeek ? "" : html`<p class="callout">No weigh-in yet this week. Add one below.</p>`}
    <div class="weigh">
      <div>
        <div class="big">${latest ? `${formatKg(latest.weight_kg)} kg` : "–"}</div>
        <span class="muted">${latest ? `${shortDate(latest.measured_on)}${change ? ` · ${change}` : ""}` : "No weigh-ins yet"}</span>
      </div>
      <form method="post" action="/body-weight">
        <input name="weight" inputmode="decimal" placeholder="kg" aria-label="Body weight in kg" autocomplete="off" required />
        <button class="primary" type="submit">Save today</button>
      </form>
    </div>
    ${bodyWeightChart(bw.weekly)}
    ${bw.recent.length
      ? html`<table>
          ${bw.recent.map(
            (r) => html`<tr>
              <td class="muted">${shortDate(r.measured_on)}</td>
              <td class="num">${formatKg(r.weight_kg)} kg</td>
              <td class="num">
                <form method="post" action="/body-weight/${r.measured_on}/delete" onsubmit="return confirm('Delete this weigh-in?')">
                  <button class="link" type="submit">Delete</button>
                </form>
              </td>
            </tr>`,
          )}
        </table>`
      : ""}
  </section>`;
}

function cardioCard(cardio: DashboardData["cardio"]): Html {
  return html`<section class="card" id="cardio">
    <h2>Cardio (minutes per week)</h2>
    ${cardioChart(cardio.weekly)}
    ${cardio.recent.length
      ? html`<table>
          ${cardio.recent.map(
            (r) => html`<tr>
              <td class="muted">${shortDate(r.day)} ${r.time}</td>
              <td>${displayName(r.activity)}</td>
              <td class="num">${formatCardio(r)}</td>
              <td class="num">
                <form method="post" action="/cardio/${r.id}/delete" onsubmit="return confirm('Delete this cardio session?')">
                  <button class="link" type="submit">Delete</button>
                </form>
              </td>
            </tr>`,
          )}
        </table>`
      : html`<p class="muted">No cardio yet. Use the Cardio tab on the Log screen.</p>`}
  </section>`;
}

function checkColour(key: string): string {
  if (key === "weigh-in") return "var(--accent)";
  if (key === "brain") return "var(--good)";
  if (key === "mobility") return "var(--longevity)";
  return `var(--${key})`;
}

function habitCards(h: DashboardData["habits"], today: string): Html {
  const done = h.checklist.filter((i) => i.done).length;
  const complete = done === h.checklist.length;
  const next = DAY_LABELS[h.plan];
  return html`${h.nudge ? html`<p class="nudge" role="status">${h.nudge}</p>` : ""}
    <section class="habits">
      <div class="card${complete ? " complete" : ""}">
        <h2><span>${complete ? "Week complete 🎉" : "This week"}</span><span>${done}/${h.checklist.length}</span></h2>
        <div class="progress" aria-hidden="true">${h.checklist.map((i) => html`<span class="${i.done ? "done" : ""}"></span>`)}</div>
        <ul class="check-list">
          ${h.checklist.map(
            (i) => html`<li>
              <span class="check${i.done ? " done" : ""}" style="--c: ${checkColour(i.key)}" aria-hidden="true">${i.done ? "✓" : ""}</span>
              <span>${i.label}<span class="visually-hidden">${i.done ? " (done)" : " (to do)"}</span></span>
              <span class="detail">${i.detail}</span>
            </li>`,
          )}
        </ul>
      </div>
      <div class="card plan">
        <h2>Next workout</h2>
        ${h.doneToday ? html`<p class="muted" style="margin: 0 0 6px">${DAY_LABELS[h.doneToday]} done today ✓ · next time:</p>` : ""}
        <div class="plan-next"><span class="swatch" style="background: var(--${h.plan})"></span>${next}</div>
        <span class="muted">${h.lastOfNext ? `Last ${next}: ${daysAgo(h.lastOfNext, today).toLowerCase()}` : `Start your ${next} rotation`}</span>
        <br />
        <a class="button primary" href="/log?tab=${h.plan}">${h.doneToday ? "Open log" : `Start ${next} →`}</a>
      </div>
    </section>`;
}

function splitTiles(last: DashboardData["lastTrained"], today: string): Html {
  return html`<section class="split" aria-label="Last workout of each type">
    ${SPLIT_DAYS.map((d) => {
      const date = last[d];
      // Compact "3d ago" so three tiles fit across a phone.
      const headline = date ? daysAgo(date, today).replace(/^(\d+) days ago$/, "$1d ago") : "Not yet";
      return html`<div class="stat" style="--c: var(--${d})">
        <span class="label"><span class="swatch" style="background: var(--${d})"></span>${DAY_LABELS[d]}</span>
        <b>${headline}</b>
        <span>${date ? shortDate(date) : "in 16 weeks"}</span>
      </div>`;
    })}
  </section>`;
}

export function dashboardPage(data: DashboardData): Html {
  const { todaySummary: t } = data;
  let lastDay = "";
  const recentRows = data.recent.map((s) => {
    const dayHeader =
      s.day !== lastDay ? html`<tr class="day"><td colspan="5"><a class="plain" href="/summary?day=${s.day}">${shortDate(s.day)} · summary →</a></td></tr>` : "";
    lastDay = s.day;
    return html`${dayHeader}
      <tr>
        <td class="muted">${s.time}</td>
        <td>${dayDot(data.dayOf(s.exercise))}<a class="plain" href="${exerciseHref(s.exercise)}">${displayName(s.exercise)}</a></td>
        <td class="num">${formatLoad(s)}</td>
        <td class="muted">${s.rpe ? `RPE ${s.rpe}` : ""}${s.note ? ` · ${s.note}` : ""}</td>
        <td class="num">
          <form method="post" action="/sets/${s.id}/delete" onsubmit="return confirm('Delete this set?')">
            <button class="link" type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
  });

  return layout(
    "Arif Gym Tracker",
    html`<main>
      <header>
        <h1>Arif Gym Tracker</h1>
        <div class="row">
          <a class="button primary" href="/today">Today</a>
          <a class="button" href="/log">Log a set</a>
          <a class="button" href="/brain">Brain</a>
          <a class="button" href="/longevity" style="border-color: var(--longevity); color: var(--longevity)">🌱 Longevity</a>
          <a class="button" href="/reminders">Reminders</a>
          <a class="button" href="/export.csv">Export CSV</a>
          <form method="post" action="/logout"><button type="submit">Sign out</button></form>
        </div>
      </header>

      ${habitCards(data.habits, data.today)}

      ${proteinCard(data.protein)}

      ${recapCard(data.recap, data.today)}

      <section class="stats" aria-label="Summary">
        <div class="stat"><b>${t.sets}</b><span>sets today</span></div>
        <div class="stat"><b>${Math.round(t.volumeKg).toLocaleString("en-GB")}</b><span>kg volume today</span></div>
        <div class="stat"><b>${data.sessionsThisWeek}</b><span>sessions this week</span></div>
        <div class="stat"><b>${data.weekStreak}</b><span>week streak</span></div>
        <div class="stat"><b>${formatMinutes(data.cardio.thisWeekMinutes)}</b><span>cardio this week</span></div>
      </section>

      ${splitTiles(data.lastTrained, data.today)}

      ${t.sets > 0
        ? html`<section class="card">
            <h2>Today</h2>
            <table>
              <tr><th>Exercise</th><th class="num">Sets</th><th class="num">Top weight</th></tr>
              ${t.exercises.map(
                (e) => html`<tr><td>${dayDot(data.dayOf(e.exercise))}<a class="plain" href="${exerciseHref(e.exercise)}">${displayName(e.exercise)}</a></td><td class="num">${e.sets}</td><td class="num">${e.topKg > 0 ? `${formatKg(e.topKg)} kg` : "Bodyweight"}</td></tr>`,
              )}
            </table>
          </section>`
        : ""}

      <section class="card">
        <h2>Weekly volume (kg × reps)</h2>
        ${legend(WORKOUT_DAYS.filter((d) => d !== "other" || data.weekly.some((w) => w.byDay.other > 0)))}
        ${volumeChart(data.weekly)}
      </section>

      <section class="card">
        <h2>Training days</h2>
        <div class="row" style="gap: 16px; align-items: flex-start">
          ${legend(WORKOUT_DAYS.filter((d) => d !== "other" || [...data.heatmap.days.values()].some((e) => e.main === "other")))}
          <ul class="legend"><li><svg width="10" height="10" aria-hidden="true">${cardioMarker(5, 5)}</svg>Cardio</li></ul>
        </div>
        ${heatmap(data.heatmap, data.today)}
      </section>

      ${cardioCard(data.cardio)}

      ${stepsCard(data.steps)}

      ${bodyWeightCard(data.bodyWeight)}

      <section class="card">
        <h2>Personal records</h2>
        ${data.records.length === 0
          ? html`<p class="muted">Nothing logged yet. Tap “Log a set” at the gym.</p>`
          : html`<table>
              <tr><th>Exercise</th><th class="num">Best</th><th class="num">Est. 1RM</th><th class="num">Sets</th><th class="num">Last done</th></tr>
              ${data.records.map(
                (r) => html`<tr>
                  <td>${dayDot(data.dayOf(r.exercise))}<a class="plain" href="${exerciseHref(r.exercise)}">${displayName(r.exercise)}</a>${data.stalled.has(r.exercise) ? html` <a class="tag" href="${exerciseHref(r.exercise)}" title="No progress in the last 3 sessions">Stalled</a>` : ""}</td>
                  <td class="num">${r.best_kg > 0 ? `${formatKg(r.best_kg)} kg` : "Bodyweight"}</td>
                  <td class="num">${r.best_kg > 0 && !isTimed(r.exercise) ? `${formatKg(r.best_e1rm)} kg` : "–"}</td>
                  <td class="num">${r.sets}</td>
                  <td class="num">${shortDate(r.last)}</td>
                </tr>`,
              )}
            </table>`}
      </section>

      <section class="card">
        <h2>Recent sets</h2>
        ${data.recent.length === 0 ? html`<p class="muted">No sets yet.</p>` : html`<table>${recentRows}</table>`}
      </section>
    </main>`,
  );
}

/** Shown once after making a steps sync key: the exact header value and URL, each with a Copy button. */
export function stepsKeyPage(key: string, url: string): Html {
  const copyField = (id: string, label: string, value: string) => html`<label for="${id}"><b>${label}</b></label>
    <div class="row" style="flex-wrap: nowrap">
      <input id="${id}" value="${value}" readonly style="flex: 1; min-width: 0; font-family: ui-monospace, monospace; font-size: 14px" />
      <button type="button" class="primary" data-copy="${id}">Copy</button>
    </div>`;
  return layout(
    "Steps Sync Key",
    html`<main style="max-width: 560px">
      <header><h1>Steps sync key</h1><a class="button" href="/#steps">Dashboard</a></header>
      <section class="card" style="display: grid; gap: 12px">
        <p style="margin: 0">This key is shown <b>only once</b>. Copy it into the shortcut now.</p>
        ${copyField("header-value", "Authorization header value", `Bearer ${key}`)}
        <ol style="margin: 0; padding-left: 20px; display: grid; gap: 6px">
          <li>Tap <b>Copy</b> above.</li>
          <li>In the shortcut's <b>Get Contents of URL</b>, tap the <b>Authorization</b> value, select all, delete it, then <b>Paste</b>.
            It should read <code>Bearer</code> then the key. Don't type anything else.</li>
          <li>Tap <b>▶︎</b>. You should get "Saved … steps".</li>
        </ol>
        ${copyField("url-value", "URL (only if you need it)", url)}
        <p class="muted" style="margin: 0; font-size: 13px">Making a new key later replaces this one.</p>
      </section>
    </main>
    <script>
      document.querySelectorAll("[data-copy]").forEach((button) => {
        button.addEventListener("click", async () => {
          const input = document.getElementById(button.dataset.copy);
          try {
            await navigator.clipboard.writeText(input.value);
          } catch {
            input.select();
            document.execCommand("copy");
          }
          button.textContent = "Copied ✓";
          setTimeout(() => (button.textContent = "Copy"), 2000);
        });
      });
    </script>`,
  );
}

export function exerciseHref(name: string): string {
  return `/exercise/${encodeURIComponent(name)}`;
}

export type ExercisePageData = {
  name: string;
  day: WorkoutDay;
  sessions: ExerciseSession[];
  change: { change: number; since: string } | null;
  stall: Stall | null;
  today: string;
};

function stallBanner(stall: Stall): Html {
  const bestText = stall.bodyweight ? `${stall.best} reps` : `est. 1RM ${formatKg(stall.best)} kg`;
  const tips = stall.bodyweight
    ? html`<li>Add one extra set, or rest a minute longer between sets.</li><li>Or slow the lowering phase to 3 seconds per rep for a couple of sessions.</li>`
    : html`<li><b>Deload:</b> one session at <b>${formatLoad({ weight_kg: stall.deload!.weight, reps: stall.deload!.reps })}</b>, then build back up by 2.5 kg a session.</li>
        <li><b>Or change the rep range:</b> try <b>${formatLoad({ weight_kg: stall.switchReps!.weight, reps: stall.switchReps!.reps })}</b> for a few weeks.</li>`;
  return html`<section class="nudge" role="status">
    <b>Stalled for ${stall.sessions} sessions.</b> Your best (${bestText}) was on ${shortDate(stall.bestDay)}. Plateaus are normal; a small change usually breaks them:
    <ul style="margin: 8px 0 0; padding-left: 20px; display: grid; gap: 4px">${tips}</ul>
    <span class="muted" style="font-size: 13px">Both targets are one tap on the Log screen.</span>
  </section>`;
}

/** Line chart of one value per session, placed by date so gaps between sessions show as gaps in time. */
function progressChart(sessions: ExerciseSession[], bodyweight: boolean, colour: string, name = ""): Html {
  if (sessions.length === 0) return html``;
  const width = 400;
  const height = 170;
  const left = 38;
  const right = 18;
  const top = 12;
  const chartHeight = 126;
  const value = (s: ExerciseSession) => (bodyweight ? s.bestReps : s.bestE1rm);
  const values = sessions.map(value);
  const span = Math.max(...values) - Math.min(...values);
  const pad = Math.max(bodyweight ? 1 : 2.5, span * 0.15);
  const lo = Math.max(0, Math.floor(Math.min(...values) - pad));
  const hi = Math.ceil(Math.max(...values) + pad);
  const t = (day: string) => Date.parse(`${day}T00:00:00Z`);
  const t0 = t(sessions[0].day);
  const t1 = Math.max(t(sessions[sessions.length - 1].day), t0 + 86_400_000);
  const px = (day: string) => left + ((t(day) - t0) / (t1 - t0)) * (width - left - right);
  const py = (v: number) => top + ((hi - v) / (hi - lo)) * chartHeight;
  const path = sessions.map((s, i) => `${i ? "L" : "M"}${px(s.day).toFixed(1)},${py(value(s)).toFixed(1)}`).join("");
  const ticks = sessions.length === 1 ? [sessions[0].day] : [0, 1, 2, 3].map((i) => new Date(t0 + ((t1 - t0) * i) / 3).toISOString().slice(0, 10));
  const unit = bodyweight ? "reps" : "kg";
  return html`<svg class="volume" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${bodyweight ? "Best reps" : "Estimated one-rep max"} per session">
    <line x1="${left}" x2="${width - right}" y1="${top}" y2="${top}" stroke="var(--line)"></line>
    <line x1="${left}" x2="${width - right}" y1="${top + chartHeight}" y2="${top + chartHeight}" stroke="var(--line)"></line>
    <text x="0" y="${top + 4}">${hi}</text>
    <text x="0" y="${top + chartHeight + 4}">${lo}</text>
    ${sessions.length > 1 ? html`<path class="line" d="${path}" style="stroke: ${colour}"></path>` : ""}
    ${sessions.map(
      (s) => html`<circle cx="${px(s.day).toFixed(1)}" cy="${py(value(s)).toFixed(1)}" r="${s.record ? 5.5 : 4}" fill="${colour}" stroke="var(--card)" stroke-width="2">
        <title>${shortDate(s.day)}: ${bodyweight ? `${s.bestReps}${isTimed(name) ? " s" : " reps"}` : isTimed(name) ? `${formatKg(s.topWeight)} kg` : `est. 1RM ${formatKg(s.bestE1rm)} kg`} · best set ${formatLoad({ weight_kg: s.topWeight, reps: s.bestReps, exercise: name })}${s.record ? " · 🏆 record" : ""}</title>
      </circle>`,
    )}
    ${ticks.map((d, i) => html`<text x="${px(d).toFixed(1)}" y="${height - 6}" text-anchor="${i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}">${shortDate(d)}</text>`)}
  </svg>
  <p class="muted" style="font-size: 13px; margin: 6px 0 0">${bodyweight ? "Most reps in a set, each session." : "Best estimated one-rep max (Epley) each session, in " + unit + "."} Bigger dots are weight records.</p>`;
}

export function exercisePage(d: ExercisePageData): Html {
  const title = displayName(d.name);
  const colour = d.day === "other" ? "var(--accent)" : `var(--${d.day})`;
  const sessions = d.sessions;
  const bodyweight = sessions.length > 0 && sessions.every((s) => s.topWeight === 0);
  const best = sessions.reduce<ExerciseSession | null>((b, s) => (!b || s.topWeight > b.topWeight || (s.topWeight === b.topWeight && s.bestReps > b.bestReps) ? s : b), null);
  const bestE1rm = sessions.reduce<ExerciseSession | null>((b, s) => (!b || s.bestE1rm > b.bestE1rm ? s : b), null);
  const totalSets = sessions.reduce((n, s) => n + s.sets.length, 0);
  const last = sessions[sessions.length - 1];
  const change = d.change
    ? `${d.change.change > 0 ? "+" : d.change.change < 0 ? "−" : "±"}${bodyweight ? Math.abs(d.change.change) : formatKg(Math.abs(d.change.change))} ${bodyweight ? "reps" : "kg"}`
    : "–";
  const stat = (value: string, label: string) => html`<div class="stat"><b>${value}</b><span>${label}</span></div>`;
  return layout(
    `${title} · Arif Gym Tracker`,
    html`<main>
      <header>
        <h1 style="display: flex; align-items: center; gap: 10px; white-space: normal">
          <span class="swatch" style="background: ${colour}; width: 14px; height: 14px"></span>${title}
        </h1>
        <div class="row">
          <a class="button primary" href="/log?tab=${d.day === "other" ? "push" : d.day}">Log</a>
          <a class="button" href="/">Dashboard</a>
        </div>
      </header>

      ${sessions.length === 0
        ? html`<section class="card"><p class="muted" style="margin: 0">No sets logged for ${title} yet.</p></section>`
        : html`${d.stall ? stallBanner(d.stall) : ""}
            <section class="stats compact" aria-label="Summary">
              ${bodyweight
                ? stat(`${best!.bestReps} reps`, `best set · ${shortDate(best!.day)}`)
                : stat(`${formatKg(best!.topWeight)} kg × ${best!.bestReps}`, `best set · ${shortDate(best!.day)}`)}
              ${bodyweight ? "" : stat(`${formatKg(bestE1rm!.bestE1rm)} kg`, `best est. 1RM · ${shortDate(bestE1rm!.day)}`)}
              ${stat(change, d.change ? `since ${shortDate(d.change.since)}` : "change (needs 2 sessions)")}
              ${stat(String(sessions.length), `sessions · ${totalSets} sets`)}
              ${stat(daysAgo(last.day, d.today).replace(/^(\d+) days ago$/, "$1d ago"), `last done · ${shortDate(last.day)}`)}
            </section>

            <section class="card">
              <h2>${bodyweight ? "Best reps" : "Strength (est. 1RM)"}</h2>
              ${progressChart(sessions, bodyweight, colour, d.name)}
            </section>

            <section class="card">
              <h2>History</h2>
              <table class="history">
                <tr><th>Date</th><th>Sets</th><th class="num">Volume</th></tr>
                ${[...sessions].reverse().map(
                  (s) => html`<tr>
                    <td>${shortDate(s.day)}${s.record ? " 🏆" : ""}</td>
                    <td class="sets">${s.sets.map((x) => (x.weight > 0 ? `${formatKg(x.weight)}×${x.reps}` : `${x.reps}`)).join(", ")}</td>
                    <td class="num">${s.volumeKg > 0 ? `${Math.round(s.volumeKg).toLocaleString("en-GB")} kg` : `${s.sets.reduce((n, x) => n + x.reps, 0)} reps`}</td>
                  </tr>`,
                )}
              </table>
            </section>`}
    </main>`,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Weekly recap

function weekRange(week: string): string {
  return `${shortDate(week)} – ${shortDate(addDays(week, 6))}`;
}

function recapHeadline(r: WeekRecap): string {
  if (r.sessions === 0) return "No training logged this week.";
  const parts = [`${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}`];
  if (r.records.length) parts.push(`${r.records.length} personal ${r.records.length === 1 ? "best" : "bests"}`);
  if (r.complete) parts.push("week complete 🎉");
  return parts.join(" · ");
}

function signed(n: number, unit: string): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}${unit}`;
}

function recapStats(r: WeekRecap): Html {
  const split = SPLIT_DAYS.filter((d) => r.splitDone[d]).map((d) => DAY_LABELS[d]);
  const item = (value: string, label: string) => html`<div><b>${value}</b><span>${label}</span></div>`;
  return html`<div class="recap-grid">
    ${item(split.length === 3 ? "All 3 ✓" : split.length ? split.join(", ") : "None", split.length === 3 ? "Push, Pull and Legs" : `${split.length}/3 split days`)}
    ${item(`${Math.round(r.volumeKg).toLocaleString("en-GB")} kg`, r.volumeChangePct === null ? `volume · ${r.sets} sets` : `volume · ${signed(r.volumeChangePct, "%")} vs week before`)}
    ${item(formatMinutes(r.cardioMinutes), `cardio · goal ${formatMinutes(r.cardioGoal)}${r.cardioMinutes >= r.cardioGoal ? " ✓" : ""}`)}
    ${item(r.steps.average === null ? "–" : `${r.steps.average.toLocaleString("en-GB")}`, r.steps.average === null ? "steps · not synced" : `steps a day · ${r.steps.daysAtGoal}/${r.steps.syncedDays} days at goal`)}
    ${item(r.bodyWeight ? `${formatKg(r.bodyWeight.kg)} kg` : "–", r.bodyWeight ? (r.bodyWeight.changeKg === null ? "body weight" : `body weight · ${signed(r.bodyWeight.changeKg, " kg")}`) : "no weigh-in")}
    ${r.brain ? item(`${r.brain.days}/${r.brain.goal}`, `brain training days${r.brain.days >= r.brain.goal ? " ✓" : ""}`) : ""}
    ${r.longevity ? item(`${r.longevity.mobilityDays}/${r.longevity.mobilityGoal}`, `🌱 mobility days · ${r.longevity.intervalWalks}/${r.longevity.intervalWalksGoal} interval walks`) : ""}
    ${r.protein && r.protein.daysLogged ? item(`${r.protein.averageG} g`, `protein a day · ${r.protein.daysAtTarget}/${r.protein.daysLogged} days at target`) : ""}
    ${r.sleep ? item(r.sleep.averageMinutes === null ? "–" : formatSleep(r.sleep.averageMinutes), r.sleep.averageMinutes === null ? "sleep · not synced" : `sleep a night · ${r.sleep.nights} nights synced`) : ""}
  </div>`;
}

/** Dashboard card: the week just finished (or, on Sunday, the week ending today). */
export function recapCard(r: WeekRecap, today: string): Html {
  const current = weekStart(today) === r.week;
  return html`<section class="card" id="recap">
    <div class="recap-head">
      <h2>${current ? "This week" : "Last week"} · ${weekRange(r.week)}</h2>
      <a class="plain muted" href="/recap?week=${r.week}" style="font-size: 14px">Full recap →</a>
    </div>
    <p class="recap-headline">${recapHeadline(r)}</p>
    ${recapStats(r)}
  </section>`;
}

export function recapPage(r: WeekRecap, today: string): Html {
  const prev = addDays(r.week, -7);
  const next = addDays(r.week, 7);
  const hasNext = next <= weekStart(today);
  return layout(
    `Week of ${shortDate(r.week)} · Arif Gym Tracker`,
    html`<main>
      <header>
        <h1 style="white-space: normal">Week recap</h1>
        <div class="row">
          <a class="button" href="/recap?week=${prev}" aria-label="Previous week">←</a>
          ${hasNext ? html`<a class="button" href="/recap?week=${next}" aria-label="Next week">→</a>` : ""}
          <a class="button" href="/">Dashboard</a>
        </div>
      </header>

      <section class="card">
        <h2>${weekRange(r.week)}${weekStart(today) === r.week ? " (so far)" : ""}</h2>
        <p class="recap-headline">${recapHeadline(r)}</p>
        ${recapStats(r)}
      </section>

      <section class="card">
        <h2>Personal bests</h2>
        ${r.records.length
          ? html`<ul class="recap-list">${r.records.map(
              (p) => html`<li><a class="plain" href="${exerciseHref(p.exercise)}"><b>${displayName(p.exercise)}</b></a> ${formatLoad({ weight_kg: p.weight, reps: p.reps, exercise: p.exercise })} <span class="muted">· ${shortDate(p.day)}</span></li>`,
            )}</ul>`
          : html`<p class="muted" style="margin: 0">No new weight records this week.</p>`}
      </section>

      ${r.stalled.length
        ? html`<section class="card">
            <h2>Needs attention</h2>
            <p style="margin: 0 0 8px">No progress in the last 3 sessions. Try a deload or a new rep range:</p>
            <ul class="recap-list">${r.stalled.map((e) => html`<li><a class="plain" href="${exerciseHref(e)}"><b>${displayName(e)}</b></a></li>`)}</ul>
          </section>`
        : ""}

      <section class="card">
        <h2>Next up</h2>
        <p style="margin: 0"><span class="swatch" style="background: var(--${r.next}); display: inline-block; margin-right: 6px"></span><b>${DAY_LABELS[r.next]}</b> starts the next week of your rotation.</p>
      </section>
    </main>`,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Workout summary

const TREND_LABEL = { up: "↑ better", same: "= same", down: "↓ lower", new: "new" } as const;

export function summaryPage(s: WorkoutSummary, today: string, targets: Record<string, Target | null | undefined> = {}): Html {
  const isToday = s.day === today;
  const typeLabel = s.main ? DAY_LABELS[s.main] : null;
  const headline =
    s.sets === 0 && s.cardio.length === 0
      ? "Nothing logged on this day."
      : [
          s.sets ? `${typeLabel && typeLabel !== "Other" ? `${typeLabel} day` : "Workout"} done 💪` : "Cardio done 💪",
          s.records ? `${s.records} personal ${s.records === 1 ? "best" : "bests"}` : "",
          s.beatLastTime && !s.records ? `beat last time on ${s.beatLastTime}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
  const stat = (value: string, label: string) => html`<div class="stat"><b>${value}</b><span>${label}</span></div>`;
  const change =
    s.volumeChangePct === null || !s.previousSameType
      ? null
      : `${s.volumeChangePct > 0 ? "+" : s.volumeChangePct < 0 ? "−" : "±"}${Math.abs(s.volumeChangePct)}% vs last ${typeLabel} (${shortDate(s.previousSameType.day)})`;
  return layout(
    `Workout ${shortDate(s.day)} · Arif Gym Tracker`,
    html`<main>
      <header>
        <h1 style="white-space: normal">${isToday ? "Today's workout" : `Workout · ${shortDate(s.day)}`}</h1>
        <div class="row">
          ${isToday ? html`<a class="button" href="/log">Log</a>` : ""}
          <a class="button primary" href="/">Dashboard</a>
        </div>
      </header>

      <section class="card">
        <h2 style="display: flex; align-items: center; gap: 8px">
          ${s.main ? html`<span class="swatch" style="background: var(--${s.main})"></span>` : ""}${shortDate(s.day)}
        </h2>
        <p class="recap-headline" style="margin: 0">${headline}</p>
        ${change ? html`<p class="muted" style="margin: 6px 0 0">Volume ${change}</p>` : ""}
      </section>

      ${s.sets || s.cardio.length
        ? html`<section class="stats compact" aria-label="Summary">
            ${stat(s.durationMinutes === null ? "–" : formatMinutes(s.durationMinutes), "duration")}
            ${stat(String(s.sets), `sets · ${s.exercises.length} ${s.exercises.length === 1 ? "exercise" : "exercises"}`)}
            ${stat(`${Math.round(s.volumeKg).toLocaleString("en-GB")} kg`, "volume")}
            ${s.cardio.length ? stat(formatMinutes(s.cardioMinutes), "cardio") : ""}
          </section>`
        : ""}

      ${s.exercises.length
        ? html`<section class="card">
            <h2>Exercises</h2>
            <table class="history">
              <tr><th>Exercise</th><th>Sets</th><th class="num">vs last time</th></tr>
              ${s.exercises.map(
                (e) => html`<tr>
                  <td><a class="plain" href="${exerciseHref(e.exercise)}"><b>${displayName(e.exercise)}</b></a>${e.record ? " 🏆" : ""}</td>
                  <td class="sets">
                    ${e.sets.map((x) => (x.weight > 0 ? `${formatKg(x.weight)}×${x.reps}` : `${x.reps}`)).join(", ")}
                    ${targets[e.exercise]
                      ? html`<br /><span style="font-size: 12px">target ${formatTarget(targets[e.exercise]!)} · ${e.sets.length}/${targets[e.exercise]!.sets}${e.sets.length >= targets[e.exercise]!.sets ? " ✓" : ""}</span>`
                      : ""}
                  </td>
                  <td class="num">
                    <span class="trend ${e.trend}">${TREND_LABEL[e.trend]}</span>
                    ${e.previous ? html`<br /><span class="muted" style="font-size: 12px">last ${formatLoad({ weight_kg: e.previous.weight, reps: e.previous.reps, exercise: e.exercise })}</span>` : ""}
                  </td>
                </tr>`,
              )}
            </table>
          </section>`
        : ""}

      ${s.cardio.length
        ? html`<section class="card">
            <h2>Cardio</h2>
            <ul class="recap-list">${s.cardio.map((c) => html`<li><b>${displayName(c.activity)}</b> ${formatCardio({ minutes: c.minutes, distance_km: c.distance })}</li>`)}</ul>
          </section>`
        : ""}

      ${isToday
        ? html`<section class="card">
            <h2>Next workout</h2>
            <p style="margin: 0"><span class="swatch" style="background: var(--${s.next}); display: inline-block; margin-right: 6px"></span><b>${DAY_LABELS[s.next]}</b> is next in your rotation. Rest well.</p>
          </section>`
        : ""}
    </main>`,
  );
}
