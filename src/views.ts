import { html, raw } from "hono/html";
import {
  addDays,
  daysAgo,
  displayName,
  formatKg,
  SPLIT_DAYS,
  WORKOUT_DAYS,
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
  --heat-0: #e8ebf0;
  --push: #2a78d6; --pull: #eb6834; --legs: #1baf7a; --other: #9aa0aa;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --card: #181b21; --text: #e8eaee; --muted: #9aa1ad; --line: #2a2f38;
    --accent: #6d9bff; --accent-soft: #1f2b44; --on-accent: #0f1115; --danger: #ff7474;
    --heat-0: #232833;
    --push: #3987e5; --pull: #d95926; --legs: #199e70; --other: #5b6270;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 20px 16px 48px; display: grid; gap: 16px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
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
button, .button { font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 999px; padding: 6px 14px; cursor: pointer; text-decoration: none; }
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
.card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.login { max-width: 360px; margin: 12vh auto 0; }
.login form { display: grid; gap: 12px; }
input { font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); }
.error { color: var(--danger); margin: 0; }
`;

export function layout(title: string, body: Html, head: Html | string = ""): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Gym" />
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
    "Gym Tracker",
    html`<main class="login card">
      <h1>Gym Tracker</h1>
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
  today: string;
  todaySummary: DaySummary;
  weekStreak: number;
  sessionsThisWeek: number;
  weekly: { week: string; byDay: Record<WorkoutDay, number>; volumeKg: number }[];
  heatmap: { start: string; weeks: number; days: Map<string, TrainingDay> };
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

function heatmap({ start, weeks, days }: DashboardData["heatmap"], today: string): Html {
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
      const fill = entry ? `var(--${entry.main})` : "var(--heat-0)";
      const label = entry
        ? `${shortDate(day)}: ${DAY_LABELS[entry.main]} day, ${entry.sets} ${entry.sets === 1 ? "set" : "sets"}`
        : `${shortDate(day)}: rest day`;
      cells.push(
        html`<rect x="${left + w * (cell + gap)}" y="${top + d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${fill}"><title>${label}</title></rect>`,
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

function setLoad(s: Pick<SetRow, "weight_kg" | "reps">): string {
  return s.weight_kg > 0 ? `${formatKg(s.weight_kg)} kg × ${s.reps}` : `${s.reps} reps`;
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
        <td class="num">${setLoad(s)}</td>
        <td class="muted">${s.rpe ? `RPE ${s.rpe}` : ""}${s.note ? ` · ${s.note}` : ""}</td>
        <td class="num">
          <form method="post" action="/sets/${s.id}/delete" onsubmit="return confirm('Delete this set?')">
            <button class="link" type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
  });

  return layout(
    "Gym Tracker",
    html`<main>
      <header>
        <h1>Gym Tracker</h1>
        <div class="row">
          <a class="button primary" href="/log">Log a set</a>
          <a class="button" href="/export.csv">Export CSV</a>
          <form method="post" action="/logout"><button type="submit">Sign out</button></form>
        </div>
      </header>

      <section class="stats" aria-label="Summary">
        <div class="stat"><b>${t.sets}</b><span>sets today</span></div>
        <div class="stat"><b>${Math.round(t.volumeKg).toLocaleString("en-GB")}</b><span>kg volume today</span></div>
        <div class="stat"><b>${data.sessionsThisWeek}</b><span>sessions this week</span></div>
        <div class="stat"><b>${data.weekStreak}</b><span>week streak</span></div>
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
        ${legend(WORKOUT_DAYS.filter((d) => d !== "other" || [...data.heatmap.days.values()].some((e) => e.main === "other")))}
        ${heatmap(data.heatmap, data.today)}
      </section>

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
