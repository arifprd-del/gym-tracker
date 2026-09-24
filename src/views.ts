import { html, raw } from "hono/html";
import {
  addDays,
  daysAgo,
  displayName,
  formatCardio,
  formatKg,
  formatLoad,
  formatMinutes,
  SPLIT_DAYS,
  WORKOUT_DAYS,
  type BodyWeightRow,
  type ChecklistItem,
  type CardioRow,
  type DayOf,
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
  --heat-0: #e8ebf0; --nudge-bg: #fff1d6;
  --push: #2a78d6; --pull: #eb6834; --legs: #1baf7a; --other: #9aa0aa; --cardio: #4a3aa7;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --card: #181b21; --text: #e8eaee; --muted: #9aa1ad; --line: #2a2f38;
    --accent: #6d9bff; --accent-soft: #1f2b44; --on-accent: #0f1115; --danger: #ff7474;
    --heat-0: #232833; --nudge-bg: #3a2f17;
    --push: #3987e5; --pull: #d95926; --legs: #199e70; --other: #5b6270; --cardio: #9085e9;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 20px 16px 48px; display: grid; gap: 16px; }
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
.progress { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin: 0 0 14px; }
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
  bodyWeight: {
    weekly: { week: string; kg: number | null }[];
    trend: { latest: BodyWeightRow | null; changeKg: number | null; since: string | null };
    recent: BodyWeightRow[];
    loggedThisWeek: boolean;
  };
  lastTrained: Record<SplitDay, string | null>;
  dayOf: DayOf;
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
    const dayHeader = s.day !== lastDay ? html`<tr class="day"><td colspan="5">${shortDate(s.day)}</td></tr>` : "";
    lastDay = s.day;
    return html`${dayHeader}
      <tr>
        <td class="muted">${s.time}</td>
        <td>${dayDot(data.dayOf(s.exercise))}${displayName(s.exercise)}</td>
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
          <a class="button primary" href="/log">Log a set</a>
          <a class="button" href="/export.csv">Export CSV</a>
          <form method="post" action="/logout"><button type="submit">Sign out</button></form>
        </div>
      </header>

      ${habitCards(data.habits, data.today)}

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
                (e) => html`<tr><td>${dayDot(data.dayOf(e.exercise))}${displayName(e.exercise)}</td><td class="num">${e.sets}</td><td class="num">${e.topKg > 0 ? `${formatKg(e.topKg)} kg` : "Bodyweight"}</td></tr>`,
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
                  <td>${dayDot(data.dayOf(r.exercise))}${displayName(r.exercise)}</td>
                  <td class="num">${r.best_kg > 0 ? `${formatKg(r.best_kg)} kg` : "Bodyweight"}</td>
                  <td class="num">${r.best_kg > 0 ? `${formatKg(r.best_e1rm)} kg` : "–"}</td>
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
