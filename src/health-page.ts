import { html, raw } from "hono/html";
import { bpCategory, sitRiseLabel, vo2FromCooper, waistRatio, type FitnessTest, type Tone } from "./health";
import { layout } from "./views";

// Health page: the monthly longevity check (sit-to-stand, max dead hang, 12-minute test) and weekly blood pressure
// and waist. Plain forms that post and come back here, so it works without any page script except the stopwatch.

type Html = ReturnType<typeof html>;

export type HealthPageData = {
  today: string;
  checkDue: boolean;
  tests: Record<FitnessTest, { id: number; day: string; value: number }[]>; // oldest first
  bp: { id: number; day: string; time: string; systolic: number; diastolic: number; pulse: number | null }[]; // newest first
  bpWeekly: { week: string; systolic: number; diastolic: number }[]; // oldest first
  waist: { day: string; cm: number }[]; // oldest first
  heightCm: number | null;
  saved: string | null;
  error: string | null;
};

const styles = `
.health h1 { color: var(--longevity); }
.health .card { display: grid; gap: 12px; }
.health h3 { margin: 0; font-size: 17px; }
.test { border: 1px solid var(--line); border-left: 6px solid var(--longevity); border-radius: 14px; padding: 12px 14px; display: grid; gap: 8px; }
.test p, .health .how { margin: 0; color: var(--muted); font-size: 14px; }
.big-num { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; }
.tone-good { color: var(--good); font-weight: 650; }
.tone-watch { color: #a1500b; font-weight: 650; }
@media (prefers-color-scheme: dark) { .tone-watch { color: #f0a35e; } }
.tone-high { color: var(--danger); font-weight: 650; }
.health form { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.health form label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
.health form input { width: 84px; font-size: 17px; }
.health .chart { display: block; width: 100%; max-width: 640px; }
.health .chart text { font-size: 11px; fill: var(--muted); }
.health table { width: 100%; border-collapse: collapse; font-size: 14px; }
.health td { padding: 6px 0; border-bottom: 1px solid var(--line); }
.health td.num { text-align: right; font-variant-numeric: tabular-nums; }
.health .saved { color: var(--good); font-weight: 650; margin: 0; }
.stopwatch { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--longevity); min-width: 80px; }
.chip-due { display: inline-block; padding: 2px 10px; border-radius: 999px; background: var(--nudge-bg); font-size: 13px; font-weight: 600; }
.legend-inline { display: flex; gap: 14px; font-size: 13px; color: var(--muted); }
.legend-inline i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 5px; }
`;

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** A small line chart: one or two series over dates, with optional dashed reference lines. */
function chart(
  days: string[],
  series: { values: number[]; colour: string; name: string }[],
  opts: { unit: string; refs?: { value: number; label: string }[]; label: string },
): Html {
  if (days.length < 2) return html``; // a trend needs two points
  const W = 400, H = 140, L = 34, R = 12, T = 10, B = 22;
  const all = [...series.flatMap((s) => s.values), ...(opts.refs ?? []).map((r) => r.value)];
  const pad = Math.max(1, (Math.max(...all) - Math.min(...all)) * 0.12);
  const lo = Math.floor(Math.min(...all) - pad);
  const hi = Math.ceil(Math.max(...all) + pad);
  const x = (i: number) => (days.length === 1 ? (L + W - R) / 2 : L + (i / (days.length - 1)) * (W - L - R));
  const y = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label}">
    <text x="0" y="${T + 4}">${hi}</text>
    <text x="0" y="${H - B + 4}">${lo}</text>
    ${(opts.refs ?? []).map(
      (r) => html`<line x1="${L}" x2="${W - R}" y1="${y(r.value).toFixed(1)}" y2="${y(r.value).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="4 4"></line>
        <text x="${W - R}" y="${(y(r.value) - 4).toFixed(1)}" text-anchor="end">${r.label}</text>`,
    )}
    ${series.map((s) => {
      const path = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
      return html`${days.length > 1 ? html`<path d="${path}" fill="none" stroke="${s.colour}" stroke-width="2" stroke-linejoin="round"></path>` : ""}
        ${s.values.map((v, i) => html`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${s.colour}" stroke="var(--card)" stroke-width="2"><title>${s.name} ${shortDate(days[i])}: ${v} ${opts.unit}</title></circle>`)}`;
    })}
    <text x="${L}" y="${H - 5}">${shortDate(days[0])}</text>
    ${days.length > 1 ? html`<text x="${W - R}" y="${H - 5}" text-anchor="end">${shortDate(days[days.length - 1])}</text>` : ""}
  </svg>`;
}

const tone = (t: Tone, text: string) => html`<span class="tone-${t}">${text}</span>`;

function del(action: string, what: string): Html {
  return html`<form method="post" action="${action}" onsubmit="return confirm('Delete this ${what}?')" style="display: inline"><button class="link" type="submit">Delete</button></form>`;
}

function testCard(key: FitnessTest, d: HealthPageData): Html {
  const rows = d.tests[key];
  const latest = rows.at(-1);
  const days = rows.map((r) => r.day);
  if (key === "sit_rise") {
    return html`<div class="test" id="t-sit_rise">
      <h3>1 · Sit to stand</h3>
      <p>Barefoot, cross your feet and sit down to the floor, then stand back up, without hands if you can. Start at
        5 points for going down and 5 for getting up. Take off 1 for each hand, knee, forearm or side of leg you use,
        and 0.5 for losing balance.</p>
      ${latest ? html`<div><span class="big-num">${latest.value}</span> / 10 · ${tone(sitRiseLabel(latest.value).tone, sitRiseLabel(latest.value).label)}</div>` : ""}
      <form method="post" action="/health/test">
        <input type="hidden" name="test" value="sit_rise" />
        <label>Down (0–5)<input name="down" inputmode="decimal" placeholder="5" required /></label>
        <label>Up (0–5)<input name="up" inputmode="decimal" placeholder="5" required /></label>
        <button class="primary" type="submit">Save</button>
      </form>
      ${chart(days, [{ values: rows.map((r) => r.value), colour: "var(--longevity)", name: "Score" }], { unit: "points", refs: [{ value: 8, label: "8: good" }], label: "Sit to stand score over time" })}
    </div>`;
  }
  if (key === "hang") {
    return html`<div class="test" id="t-hang">
      <h3>2 · Max dead hang</h3>
      <p>Hang from a bar, arms straight, as long as you can. Grip strength is one of the best predictors of healthy ageing.
        Use the stopwatch, then save.</p>
      ${latest ? html`<div><span class="big-num">${latest.value} s</span>${rows.length > 1 ? html` <span class="muted">· first ${rows[0].value} s</span>` : ""}</div>` : ""}
      <div class="row"><span class="stopwatch" id="sw">0 s</span><button type="button" id="sw-go">Start</button></div>
      <form method="post" action="/health/test">
        <input type="hidden" name="test" value="hang" />
        <label>Seconds<input name="value" id="sw-value" inputmode="numeric" placeholder="60" required /></label>
        <button class="primary" type="submit">Save</button>
      </form>
      ${chart(days, [{ values: rows.map((r) => r.value), colour: "var(--longevity)", name: "Hang" }], { unit: "s", label: "Max dead hang over time" })}
    </div>`;
  }
  return html`<div class="test" id="t-cooper">
    <h3>3 · 12-minute test</h3>
    <p>On the treadmill at 1% incline, after a 5-minute warm-up: cover as much distance as you can in 12 minutes,
      running or walking. Enter the km; it estimates your VO₂max, one of the strongest predictors of lifespan.</p>
    ${latest ? html`<div><span class="big-num">${vo2FromCooper(latest.value)}</span> VO₂max · <span class="muted">${latest.value} km</span></div>` : ""}
    <form method="post" action="/health/test">
      <input type="hidden" name="test" value="cooper" />
      <label>Distance (km)<input name="value" inputmode="decimal" placeholder="2.2" required /></label>
      <button class="primary" type="submit">Save</button>
    </form>
    ${chart(days, [{ values: rows.map((r) => vo2FromCooper(r.value)), colour: "var(--longevity)", name: "VO₂max" }], { unit: "ml/kg/min", label: "Estimated VO₂max over time" })}
  </div>`;
}

export function healthPage(d: HealthPageData): Html {
  const bpLatest = d.bp[0];
  const bpCat = bpLatest ? bpCategory(bpLatest.systolic, bpLatest.diastolic) : null;
  const waistLatest = d.waist.at(-1);
  const ratio = waistLatest && d.heightCm ? waistRatio(waistLatest.cm, d.heightCm) : null;
  return layout(
    "Health · Arif Gym Tracker",
    html`<main class="health">
      <header>
        <h1>🌱 Health check</h1>
        <div class="row"><a class="button" href="/longevity">Longevity</a><a class="button primary" href="/today">Today</a></div>
      </header>
      ${d.saved ? html`<p class="saved" role="status">Saved ✓ ${d.saved}</p>` : ""}
      ${d.error ? html`<p class="tone-high" role="alert" style="margin: 0">Not saved: ${d.error}.</p>` : ""}

      <section class="card" id="check">
        <h2 style="margin: 0">Monthly longevity check ${d.checkDue ? html`<span class="chip-due">Due</span>` : ""}</h2>
        <p class="how">About 20 minutes once a month; the tests can be on different days. Watch the trend over months.</p>
        ${testCard("sit_rise", d)} ${testCard("hang", d)} ${testCard("cooper", d)}
      </section>

      <section class="card" id="bp">
        <h2 style="margin: 0">Blood pressure</h2>
        <p class="how">Once a week, in the morning before coffee: sit quietly for 5 minutes, arm resting at heart height,
          and take 2 readings a minute apart. Interval walking is shown to lower it.</p>
        ${bpLatest && bpCat
          ? html`<div><span class="big-num">${bpLatest.systolic}/${bpLatest.diastolic}</span>${bpLatest.pulse ? html` <span class="muted">· pulse ${bpLatest.pulse}</span>` : ""}<br />${tone(bpCat.tone, bpCat.label)}</div>`
          : ""}
        <form method="post" action="/health/bp">
          <label>Top (systolic)<input name="systolic" inputmode="numeric" placeholder="120" required /></label>
          <label>Bottom (diastolic)<input name="diastolic" inputmode="numeric" placeholder="80" required /></label>
          <label>Pulse<input name="pulse" inputmode="numeric" placeholder="optional" /></label>
          <button class="primary" type="submit">Save</button>
        </form>
        ${d.bpWeekly.length
          ? html`<div class="legend-inline"><span><i style="background: var(--accent)"></i>Top</span><span><i style="background: var(--longevity)"></i>Bottom</span><span>Weekly average · dashed: 135/85 home limit</span></div>
              ${chart(d.bpWeekly.map((w) => w.week), [
                { values: d.bpWeekly.map((w) => w.systolic), colour: "var(--accent)", name: "Top" },
                { values: d.bpWeekly.map((w) => w.diastolic), colour: "var(--longevity)", name: "Bottom" },
              ], { unit: "mmHg", refs: [{ value: 135, label: "135" }, { value: 85, label: "85" }], label: "Blood pressure, weekly average" })}`
          : ""}
        ${d.bp.length
          ? html`<table>${d.bp.slice(0, 6).map(
              (r) => html`<tr><td class="muted">${shortDate(r.day)} ${r.time}</td><td class="num">${r.systolic}/${r.diastolic}${r.pulse ? ` · ${r.pulse}` : ""}</td><td class="num">${del(`/health/bp/${r.id}/delete`, "reading")}</td></tr>`,
            )}</table>`
          : ""}
        <p class="muted" style="margin: 0; font-size: 12px">For tracking, not diagnosis. If readings stay at 135/85 or above, or you feel unwell, see your GP.</p>
      </section>

      <section class="card" id="waist">
        <h2 style="margin: 0">Waist</h2>
        <p class="how">Once a week, standing relaxed, tape level around your belly button, after breathing out. Waist-to-height
          ratio is a better guide to health risk than weight alone.</p>
        ${waistLatest
          ? html`<div><span class="big-num">${waistLatest.cm} cm</span>${ratio ? html` · ratio ${ratio.ratio}<br />${tone(ratio.tone, ratio.label)}` : ""}</div>`
          : ""}
        <form method="post" action="/health/waist">
          <label>Waist (cm)<input name="cm" inputmode="decimal" placeholder="88" required /></label>
          ${d.heightCm ? "" : html`<label>Your height (cm)<input name="height" inputmode="decimal" placeholder="175" required /></label>`}
          <button class="primary" type="submit">Save today</button>
        </form>
        ${d.heightCm
          ? html`<form method="post" action="/health/height"><label>Height (cm)<input name="height" inputmode="decimal" value="${d.heightCm}" /></label><button type="submit">Update height</button></form>`
          : ""}
        ${chart(d.waist.map((w) => w.day), [{ values: d.waist.map((w) => w.cm), colour: "var(--longevity)", name: "Waist" }], {
          unit: "cm",
          refs: d.heightCm ? [{ value: Math.round(d.heightCm * 0.5), label: `ratio 0.5 = ${Math.round(d.heightCm * 0.5)} cm` }] : [],
          label: "Waist over time",
        })}
      </section>
    </main>
    <script>
      (() => {
        const go = document.getElementById("sw-go"), face = document.getElementById("sw"), out = document.getElementById("sw-value");
        let start = 0, timer = null;
        go.addEventListener("click", () => {
          if (timer) { clearInterval(timer); timer = null; go.textContent = "Start"; out.value = Math.round((Date.now() - start) / 1000); return; }
          start = Date.now(); go.textContent = "Stop";
          timer = setInterval(() => { face.textContent = Math.floor((Date.now() - start) / 1000) + " s"; }, 200);
        });
      })();
    </script>`,
    html`<style>${raw(styles)}</style>`,
  );
}
