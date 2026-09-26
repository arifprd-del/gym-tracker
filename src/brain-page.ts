import { html, raw } from "hono/html";
import { formatSleep } from "./lib";
import { layout } from "./views";

// The Brain page: Quick Glance speed training (daily), the Brain Check (weekly) and sleep.
// Speed training is modelled on the ACTIVE trial's adaptive speed-of-processing training; the Brain Check uses two
// standard short tests (a psychomotor vigilance task and a digit-symbol substitution task) to show whether it helps.

type Html = ReturnType<typeof html>;

export type BrainPageData = {
  today: string;
  startMs: number; // where today's first round starts: the flash time the last round ended on
  roundsToday: number;
  streak: number;
  daily: { day: string; bestMs: number }[]; // best flash per day with a completed round
  checks: { day: string; pvtMedianMs: number; pvtLapses: number; dsstCorrect: number }[];
  checkDue: boolean;
  sleep: { nights: { day: string; minutes: number | null }[]; lastNight: number | null; average7: number | null; syncedNights: number };
};

const styles = `
.brain .status { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.brain .status .stat b { font-size: 22px; }
.chip-due { display: inline-block; padding: 2px 10px; border-radius: 999px; background: var(--nudge-bg); font-size: 13px; font-weight: 600; }
.qg-stage { position: relative; width: 100%; max-width: 380px; margin: 0 auto; aspect-ratio: 1; background: var(--bg); border-radius: 50%; border: 1px solid var(--line); }
.qg-slot { position: absolute; width: 18%; aspect-ratio: 1; transform: translate(-50%, -50%); display: grid; place-items: center;
  border-radius: 50%; border: 0; background: none; padding: 0; color: inherit; }
.qg-slot svg, .qg-centre svg { width: 72%; height: 72%; }
.qg-stage.choosing .qg-slot { background: var(--card); border: 2px solid var(--line); cursor: pointer; }
.qg-stage.choosing .qg-slot:hover, .qg-stage.choosing .qg-slot:focus-visible { border-color: var(--accent); outline: none; }
.qg-slot.correct { box-shadow: 0 0 0 3px var(--good); border-color: var(--good) !important; }
.qg-slot.wrong { box-shadow: 0 0 0 3px var(--danger); border-color: var(--danger) !important; }
.qg-centre { position: absolute; left: 50%; top: 50%; width: 22%; aspect-ratio: 1; transform: translate(-50%, -50%); display: grid; place-items: center; }
.qg-fix { font-size: 26px; color: var(--muted); line-height: 1; }
.qg-mask { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; }
.qg-mask i { position: absolute; width: 9%; aspect-ratio: 1; background: var(--muted); opacity: .45; border-radius: 3px; }
.qg-prompt { min-height: 46px; margin: 0; font-weight: 600; font-size: 16px; }
.qg-prompt small, .bc-prompt small { display: block; font-weight: 400; color: var(--muted); font-size: 13px; }
.qg-answers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.big-btn { font: inherit; font-weight: 650; min-height: 56px; border-radius: 14px; border: 2px solid var(--line); background: var(--card);
  color: var(--text); display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; touch-action: manipulation; }
.big-btn svg { width: 28px; height: 28px; }
.big-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.bc-pad { min-height: 220px; border-radius: 18px; border: 2px solid var(--line); background: var(--bg); display: grid; place-items: center;
  font-size: 44px; font-weight: 700; font-variant-numeric: tabular-nums; cursor: pointer; user-select: none; touch-action: manipulation; }
.bc-pad.go { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.bc-pad.early { color: var(--danger); font-size: 24px; }
.bc-key { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 4px; }
.bc-key div { border: 1px solid var(--line); border-radius: 8px; display: grid; justify-items: center; padding: 4px 0; font-weight: 700; font-variant-numeric: tabular-nums; }
.bc-key svg { width: 70%; max-width: 26px; aspect-ratio: 1; }
.bc-symbol { display: grid; place-items: center; height: 110px; }
.bc-symbol svg { width: 90px; height: 90px; }
.bc-digits { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.bc-digits button { font: inherit; font-size: 22px; font-weight: 700; min-height: 54px; border-radius: 12px; border: 2px solid var(--line); background: var(--card); color: var(--text); touch-action: manipulation; }
.bc-flash-bad { animation: bad .25s; }
@keyframes bad { from { background: var(--nudge-bg); } }
@media (prefers-reduced-motion: reduce) { .bc-flash-bad { animation: none; } }
.bc-timer { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 14px; }
.mini-chart { display: block; width: 100%; max-width: 640px; }
.split-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
`;

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Small line chart of one value per day. `better` says which direction is an improvement, for the caption. */
function lineChart(points: { day: string; value: number }[], opts: { label: string; unit: string; better: "lower" | "higher" }): Html {
  if (points.length === 0) return html`<p class="muted" style="margin: 0">No results yet.</p>`;
  const W = 400, H = 130, L = 40, R = 14, T = 10, B = 22;
  const values = points.map((p) => p.value);
  const pad = Math.max(1, (Math.max(...values) - Math.min(...values)) * 0.15);
  const lo = Math.max(0, Math.floor(Math.min(...values) - pad));
  const hi = Math.ceil(Math.max(...values) + pad);
  const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i / (points.length - 1)) * (W - L - R));
  const y = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  return html`<svg class="mini-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.label}, ${opts.better} is better">
    <line x1="${L}" x2="${W - R}" y1="${T}" y2="${T}" stroke="var(--line)"></line>
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"></line>
    <text x="0" y="${T + 4}">${hi}</text>
    <text x="0" y="${H - B + 4}">${lo}</text>
    ${points.length > 1 ? html`<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"></path>` : ""}
    ${points.map((p, i) => html`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2"><title>${shortDate(p.day)}: ${Math.round(p.value)} ${opts.unit}</title></circle>`)}
    <text x="${L}" y="${H - 5}">${shortDate(points[0].day)}</text>
    ${points.length > 1 ? html`<text x="${W - R}" y="${H - 5}" text-anchor="end">${shortDate(points[points.length - 1].day)}</text>` : ""}
  </svg>
  <p class="muted" style="margin: 4px 0 0; font-size: 13px">${opts.label} (${opts.unit}), ${opts.better} is better.</p>`;
}

function sleepChart(nights: BrainPageData["sleep"]["nights"]): Html {
  const W = 400, H = 130, L = 30, R = 10, T = 10, B = 22;
  const max = 10 * 60;
  const slot = (W - L - R) / nights.length;
  const y = (m: number) => T + (1 - Math.min(m, max) / max) * (H - T - B);
  return html`<svg class="mini-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sleep per night, 7 hour line">
    <text x="0" y="${y(420) + 4}">7 h</text>
    <line x1="${L}" x2="${W - R}" y1="${y(420)}" y2="${y(420)}" stroke="var(--muted)" stroke-dasharray="4 4"></line>
    ${nights.map((n, i) => {
      const bx = L + i * slot + slot * 0.18;
      const bar = n.minutes
        ? html`<rect x="${bx.toFixed(1)}" y="${y(n.minutes).toFixed(1)}" width="${(slot * 0.64).toFixed(1)}" height="${(H - B - y(n.minutes)).toFixed(1)}" rx="2" fill="${n.minutes < 420 ? "var(--pull)" : "var(--accent)"}"></rect>`
        : "";
      return html`<g>${bar}<rect x="${(L + i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H - B}" fill="transparent"><title>Night ending ${shortDate(n.day)}: ${n.minutes === null ? "not synced" : formatSleep(n.minutes)}</title></rect></g>`;
    })}
    <text x="${L}" y="${H - 5}">${shortDate(nights[0].day)}</text>
    <text x="${W - R}" y="${H - 5}" text-anchor="end">${shortDate(nights[nights.length - 1].day)}</text>
  </svg>
  <p class="muted" style="margin: 4px 0 0; font-size: 13px">Orange nights are under 7 hours. Dashed line: 7 hours.</p>`;
}

const script = `
const data = JSON.parse(document.getElementById("brain-data").textContent);
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  if (res.status === 401) { location.href = "/login?next=/brain"; throw new Error("Signed out"); }
  if (!res.ok) throw new Error("Couldn't save. Check your signal and try again.");
  return res.json();
}

// ---------------------------------------------------------------- Quick Glance
const SHAPE = {
  circle: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="currentColor"/></svg>',
  triangle: '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,10 92,86 8,86" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,6 62,38 96,38 68,58 79,92 50,72 21,92 32,58 4,38 38,38" fill="var(--push)"/></svg>',
  decoy: '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,14 86,82 14,82" fill="var(--muted)"/></svg>',
};
const TRIALS = 20, MIN_MS = 17, MAX_MS = 800, DECOYS_BELOW_MS = 250;
const SLOTS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 };
});
const qg = { ms: data.startMs, streak: 0, trial: 0, history: [], current: null, busy: false };
const stage = $("qg-stage");
$("qg-circle").innerHTML = SHAPE.circle + "Circle";
$("qg-triangle").innerHTML = SHAPE.triangle + "Triangle";

function draw({ centre = "fix", star = null, decoys = false, choosing = false, mark = null } = {}) {
  stage.classList.toggle("choosing", choosing);
  stage.innerHTML = SLOTS.map((p, i) => {
    let inner = "";
    if (!choosing && star === i) inner = SHAPE.star;
    else if (!choosing && decoys && star !== null) inner = SHAPE.decoy;
    const cls = mark && mark.slot === i ? " " + mark.kind : "";
    return '<button class="qg-slot' + cls + '" type="button" data-slot="' + i + '" style="left:' + p.x + '%;top:' + p.y + '%" ' +
      (choosing ? "" : 'tabindex="-1" disabled') + ' aria-label="Spot ' + (i + 1) + '">' + inner + "</button>";
  }).join("") + '<div class="qg-centre">' + (centre === "fix" ? '<span class="qg-fix" aria-hidden="true">✚</span>' : centre ? SHAPE[centre] : "") + "</div>";
}
function mask() {
  let bits = "";
  for (let i = 0; i < 70; i++) bits += '<i style="left:' + Math.random() * 92 + '%;top:' + Math.random() * 92 + '%;transform:rotate(' + Math.random() * 90 + 'deg)"></i>';
  stage.insertAdjacentHTML("beforeend", '<div class="qg-mask" aria-hidden="true">' + bits + "</div>");
}
function flash(t, ms) {
  return new Promise((resolve) => {
    draw({ centre: t.centre, star: t.star, decoys: t.decoys });
    const t0 = performance.now();
    const tick = (now) => {
      if (now - t0 >= ms - 4) { draw({ centre: null }); mask(); setTimeout(() => { draw({ centre: null }); resolve(); }, 250); }
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function setFlash() { $("qg-ms").textContent = Math.round(qg.ms); }
async function trial() {
  qg.busy = true;
  const t = { centre: Math.random() < 0.5 ? "circle" : "triangle", star: Math.floor(Math.random() * 8), decoys: qg.ms <= DECOYS_BELOW_MS };
  qg.current = t;
  $("qg-prompt").innerHTML = "Try " + (qg.trial + 1) + " of " + TRIALS + "<small>" + (t.decoys ? "Decoys on: find the ★ among the grey triangles." : "Eyes on the ✚") + "</small>";
  draw();
  await wait(700 + Math.random() * 500);
  await flash(t, qg.ms);
  $("qg-prompt").innerHTML = "Which shape was in the centre?";
  $("qg-answers").hidden = false;
  qg.busy = false;
}
function answer(shape) {
  if (qg.busy || !qg.current) return;
  qg.current.shapeOk = shape === qg.current.centre;
  $("qg-answers").hidden = true;
  $("qg-prompt").innerHTML = "Where was the ★?<small>Tap the spot.</small>";
  draw({ centre: null, choosing: true });
}
$("qg-circle").onclick = () => answer("circle");
$("qg-triangle").onclick = () => answer("triangle");
stage.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-slot]");
  if (!btn || !stage.classList.contains("choosing") || qg.busy) return;
  qg.busy = true;
  const t = qg.current, picked = Number(btn.dataset.slot), ok = t.shapeOk && picked === t.star;
  draw({ centre: null, choosing: true, mark: { slot: t.star, kind: picked === t.star ? "correct" : "wrong" } });
  $("qg-prompt").innerHTML = ok ? '<span style="color:var(--good)">✓ Both right</span>' :
    '<span style="color:var(--danger)">✗ ' + (t.shapeOk ? "The ★ was at the highlighted spot" : "It was a " + t.centre) + "</span>";
  qg.history.push({ ms: qg.ms, ok });
  // Staircase: two right in a row makes the flash 15% shorter; a miss makes it 20% longer.
  if (ok) { if (++qg.streak >= 2) { qg.ms = Math.max(MIN_MS, qg.ms * 0.85); qg.streak = 0; } }
  else { qg.streak = 0; qg.ms = Math.min(MAX_MS, qg.ms * 1.2); }
  setFlash();
  await wait(900);
  if (++qg.trial >= TRIALS) finishRound(); else trial();
});
async function finishRound() {
  const rights = qg.history.filter((h) => h.ok).map((h) => h.ms);
  const best = rights.length ? Math.round(Math.min(...rights)) : null;
  $("qg-prompt").innerHTML = (best ? "Round done: best " + best + " ms" : "Round done") + "<small>Saving…</small>";
  draw();
  try {
    await api("/api/brain/speed", { bestMs: best, finalMs: qg.ms, hits: rights.length, trials: TRIALS });
    data.roundsToday++;
    $("rounds-today").textContent = data.roundsToday + "/2";
    $("qg-prompt").innerHTML = (best ? "Round done: best " + best + " ms" : "Round done") +
      "<small>" + rights.length + "/" + TRIALS + " fully right. Saved. " + (data.roundsToday >= 2 ? "That's today's training done ✓" : "One more round makes today's 7 minutes.") + "</small>";
  } catch (err) {
    $("qg-prompt").innerHTML = "Round done<small>" + err.message + "</small>";
  }
  $("qg-start").hidden = false;
  $("qg-start").textContent = "Play another round";
}
$("qg-start").onclick = () => {
  Object.assign(qg, { streak: 0, trial: 0, history: [], current: null });
  setFlash();
  $("qg-start").hidden = true;
  trial();
};
draw({ centre: "triangle", star: 1 });
setFlash();

// ---------------------------------------------------------------- Brain Check
const SYMBOLS = [
  '<circle cx="50" cy="50" r="36" fill="currentColor"/>',
  '<rect x="16" y="16" width="68" height="68" fill="currentColor"/>',
  '<polygon points="50,10 90,86 10,86" fill="currentColor"/>',
  '<polygon points="50,8 92,50 50,92 8,50" fill="currentColor"/>',
  '<path d="M40 10h20v30h30v20H60v30H40V60H10V40h30z" fill="currentColor"/>',
  '<circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="14"/>',
  '<path d="M10 50a40 40 0 0 1 80 0z" fill="currentColor"/>',
  '<polygon points="30,12 70,12 90,50 70,88 30,88 10,50" fill="currentColor"/>',
  '<path d="M10 20h80v16H10zM10 64h80v16H10z" fill="currentColor"/>',
];
const svg = (i) => '<svg viewBox="0 0 100 100" aria-hidden="true">' + SYMBOLS[i] + "</svg>";
const bc = $("bc");

function showStep(html) { bc.innerHTML = html; }

$("bc-start").onclick = () => { $("bc-start").hidden = true; $("bc-intro").hidden = true; runPvt(); };

async function runPvt() {
  const DURATION = 90_000;
  const reactions = [];
  let falseStarts = 0, state = "wait", shownAt = 0, timer = null, raf = null;
  showStep('<p class="bc-prompt" style="margin:0;font-weight:600">Part 1 of 2 · Reaction<small>Tap the box the moment the counter appears. Don\\'t tap early.</small></p>' +
    '<div class="bc-pad" id="bc-pad" role="button" tabindex="0">Wait…</div><div class="bc-timer" id="bc-timer"></div>');
  const pad = $("bc-pad"), started = performance.now();
  const remaining = () => DURATION - (performance.now() - started);
  const schedule = () => {
    state = "wait"; pad.className = "bc-pad"; pad.textContent = "Wait…";
    if (remaining() <= 0) return finish();
    timer = setTimeout(show, 1500 + Math.random() * 3500);
  };
  const show = () => {
    state = "go"; pad.className = "bc-pad go"; shownAt = performance.now();
    const count = (now) => {
      if (state !== "go") return;
      const ms = now - shownAt;
      pad.textContent = Math.round(ms);
      if (ms > 5000) { reactions.push(5000); state = "done"; setTimeout(schedule, 400); return; }
      raf = requestAnimationFrame(count);
    };
    raf = requestAnimationFrame(count);
  };
  const tap = () => {
    if (state === "go") {
      const ms = performance.now() - shownAt;
      reactions.push(ms); state = "done"; cancelAnimationFrame(raf);
      pad.textContent = Math.round(ms) + " ms";
      setTimeout(schedule, 700);
    } else if (state === "wait") {
      falseStarts++; clearTimeout(timer); state = "done";
      pad.className = "bc-pad early"; pad.textContent = "Too soon";
      setTimeout(schedule, 900);
    }
  };
  pad.addEventListener("pointerdown", (e) => { e.preventDefault(); tap(); });
  pad.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tap(); } });
  const clock = setInterval(() => { $("bc-timer") && ($("bc-timer").textContent = Math.max(0, Math.ceil(remaining() / 1000)) + " s left"); }, 250);
  let done = false;
  function finish() {
    if (done) return; done = true; clearInterval(clock);
    const valid = reactions.filter((ms) => ms >= 100).sort((a, b) => a - b);
    const mid = Math.floor(valid.length / 2);
    const median = valid.length ? (valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2) : 5000;
    runDsst({ pvtMedianMs: Math.round(median), pvtLapses: valid.filter((ms) => ms > 500).length, pvtFalseStarts: falseStarts });
  }
  schedule();
}

function runDsst(pvt) {
  const DURATION = 90_000;
  // A fresh random key each week, so the test measures speed rather than memory of the key.
  const order = [...Array(9).keys()].sort(() => Math.random() - 0.5); // order[digit-1] = symbol index
  let correct = 0, errors = 0, current = -1;
  showStep('<p class="bc-prompt" style="margin:0;font-weight:600">Part 2 of 2 · Symbol match<small>Find the symbol in the key and tap its number. As many as you can in 90 seconds.</small></p>' +
    '<div class="bc-key">' + order.map((s, d) => "<div>" + svg(s) + "<span>" + (d + 1) + "</span></div>").join("") + "</div>" +
    '<div class="bc-symbol" id="bc-symbol"></div>' +
    '<div class="bc-digits">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => '<button type="button" data-d="' + d + '">' + d + "</button>").join("") + "</div>" +
    '<div class="bc-timer" id="bc-timer"></div>');
  const next = () => {
    let s; do { s = Math.floor(Math.random() * 9); } while (s === current);
    current = s; $("bc-symbol").innerHTML = svg(s);
  };
  const started = performance.now();
  const remaining = () => DURATION - (performance.now() - started);
  bc.querySelector(".bc-digits").addEventListener("pointerdown", (e) => {
    const b = e.target.closest("[data-d]");
    if (!b || remaining() <= 0) return;
    e.preventDefault();
    if (order[Number(b.dataset.d) - 1] === current) correct++;
    else { errors++; const sym = $("bc-symbol"); sym.classList.remove("bc-flash-bad"); void sym.offsetWidth; sym.classList.add("bc-flash-bad"); }
    next();
  });
  const clock = setInterval(async () => {
    const left = remaining();
    $("bc-timer").textContent = Math.max(0, Math.ceil(left / 1000)) + " s left · " + correct + " right";
    if (left <= 0) { clearInterval(clock); await saveCheck({ ...pvt, dsstCorrect: correct, dsstErrors: errors }); }
  }, 200);
  next();
}

async function saveCheck(result) {
  const prev = data.checks[data.checks.length - 1];
  const cmp = (now, before, lowerBetter) => {
    if (before === undefined) return "";
    const better = lowerBetter ? now < before : now > before;
    const same = now === before;
    return ' <span style="color:' + (same ? "var(--muted)" : better ? "var(--good)" : "var(--danger)") + '">(' + (same ? "same as" : better ? "better than" : "vs") + " " + before + " last time)</span>";
  };
  showStep('<p class="bc-prompt" style="margin:0;font-weight:600">Saving…</p>');
  try {
    await api("/api/brain/check", result);
    showStep('<p class="bc-prompt" style="margin:0;font-weight:700;font-size:18px">Brain Check done ✓</p>' +
      "<ul style=\\"margin:0;padding-left:20px;display:grid;gap:6px\\">" +
      "<li>Reaction: <b>" + result.pvtMedianMs + " ms</b> typical" + cmp(result.pvtMedianMs, prev && prev.pvtMedianMs, true) + "</li>" +
      "<li>Lapses (over 0.5 s): <b>" + result.pvtLapses + "</b>" + cmp(result.pvtLapses, prev && prev.pvtLapses, true) + " · too-early taps: " + result.pvtFalseStarts + "</li>" +
      "<li>Symbols matched: <b>" + result.dsstCorrect + "</b>" + cmp(result.dsstCorrect, prev && prev.dsstCorrect, false) + " · mistakes: " + result.dsstErrors + "</li>" +
      "</ul><p class=\\"muted\\" style=\\"margin:0;font-size:13px\\">Scores move a little week to week with sleep and caffeine; look at the trend over a month or two.</p>" +
      '<a class="button" href="/brain#check" onclick="location.reload()">See trend</a>');
  } catch (err) {
    showStep('<p class="bc-prompt" style="margin:0">' + err.message + "</p>");
  }
}
`;

export function brainPage(d: BrainPageData): Html {
  const json = JSON.stringify({ startMs: d.startMs, roundsToday: d.roundsToday, checks: d.checks }).replace(/</g, "\\u003c");
  const latest = d.checks[d.checks.length - 1];
  return layout(
    "Brain · Arif Gym Tracker",
    html`<main class="brain">
      <header>
        <h1>Brain</h1>
        <div class="row">
          <a class="button" href="/log">Log</a>
          <a class="button primary" href="/">Dashboard</a>
        </div>
      </header>

      <section class="status" aria-label="Today">
        <div class="stat"><b id="rounds-today">${d.roundsToday}/2</b><span>speed rounds today</span></div>
        <div class="stat"><b>${d.streak}</b><span>day streak</span></div>
        <div class="stat"><b>${d.checkDue ? html`<span class="chip-due">Due</span>` : "Done ✓"}</b><span>weekly Brain Check</span></div>
        <div class="stat"><b>${d.sleep.lastNight === null ? "–" : formatSleep(d.sleep.lastNight)}</b><span>sleep last night</span></div>
      </section>

      <section class="card" id="speed" style="display: grid; gap: 12px">
        <div class="card-head"><h2 style="margin: 0">Speed training · Quick Glance</h2><span class="muted" style="font-size: 14px">Flash <b id="qg-ms">${Math.round(d.startMs)}</b> ms</span></div>
        <p class="qg-prompt" id="qg-prompt">Two rounds a day, about 7 minutes.<small>Keep your eyes on the ✚. A shape flashes in the centre while a ★ flashes at the edge. Name the shape, then tap where the ★ was. It speeds up as you improve and starts where you left off.</small></p>
        <div class="qg-stage" id="qg-stage" aria-label="Playing field"></div>
        <div class="qg-answers" id="qg-answers" hidden>
          <button class="big-btn" type="button" id="qg-circle" aria-label="Circle"></button>
          <button class="big-btn" type="button" id="qg-triangle" aria-label="Triangle"></button>
        </div>
        <button class="big-btn primary" type="button" id="qg-start">Start round</button>
        ${lineChart(d.daily.map((p) => ({ day: p.day, value: p.bestMs })), { label: "Best flash each day", unit: "ms", better: "lower" })}
      </section>

      <section class="card" id="check" style="display: grid; gap: 12px">
        <div class="card-head"><h2 style="margin: 0">Weekly Brain Check</h2>${d.checkDue ? html`<span class="chip-due">Due</span>` : html`<span class="muted" style="font-size: 14px">Next due in a week</span>`}</div>
        <p id="bc-intro" style="margin: 0">Two 90-second tests, once a week, to see whether training is working: a <b>reaction test</b> (attention) and a
          <b>symbol match</b> (processing speed). Do it at a similar time of day each week, before caffeine if you can.</p>
        <button class="big-btn ${d.checkDue ? "primary" : ""}" type="button" id="bc-start">${d.checkDue ? "Start Brain Check (3 min)" : "Do it again anyway"}</button>
        <div id="bc" style="display: grid; gap: 12px"></div>
        ${latest ? html`<p class="muted" style="margin: 0">Last check ${shortDate(latest.day)}: reaction <b>${latest.pvtMedianMs} ms</b>, ${latest.pvtLapses} lapses, <b>${latest.dsstCorrect}</b> symbols.</p>` : ""}
        <div class="split-2">
          <div>${lineChart(d.checks.map((c) => ({ day: c.day, value: c.pvtMedianMs })), { label: "Reaction time", unit: "ms", better: "lower" })}</div>
          <div>${lineChart(d.checks.map((c) => ({ day: c.day, value: c.dsstCorrect })), { label: "Symbols matched in 90 s", unit: "correct", better: "higher" })}</div>
        </div>
      </section>

      <section class="card" id="sleep" style="display: grid; gap: 10px">
        <h2 style="margin: 0">Sleep</h2>
        ${d.sleep.syncedNights === 0
          ? html`<p class="muted" style="margin: 0">Not synced yet. Add the sleep step to your nightly Shortcut (see <b>docs/iphone-setup.md</b>), using the same sync key as steps.</p>`
          : html`<p style="margin: 0">Last night <b>${d.sleep.lastNight === null ? "not synced" : formatSleep(d.sleep.lastNight)}</b> · 7-night average <b>${d.sleep.average7 === null ? "–" : formatSleep(d.sleep.average7)}</b>. About 7 hours is linked to the lowest dementia risk.</p>
              ${sleepChart(d.sleep.nights)}`}
      </section>
    </main>
    <script id="brain-data" type="application/json">${raw(json)}</script>
    <script>${raw(script)}</script>`,
    html`<style>${raw(styles)}</style>`,
  );
}
