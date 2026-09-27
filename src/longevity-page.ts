import { html, raw } from "hono/html";
import { MOBILITY_CORE, MOBILITY_DAYS_GOAL, INTERVAL_WALKS_GOAL, type MobilityItem } from "./longevity";
import { layout } from "./views";

// The Longevity page: a 6-minute daily mobility routine with timers, this week's longevity training, and how to
// progress each of the 7 exercises (from Dan Go's "7 exercises" video).

type Html = ReturnType<typeof html>;

export type LongevityPageData = {
  today: string;
  done: MobilityItem[]; // items ticked today
  hangLoggedToday: boolean; // a dead hang set at the gym counts for the hang item
  streak: number;
  mobilityDaysThisWeek: number;
  week: {
    intervalWalks: number;
    intervalMinutes: number;
    cardioMinutes: number;
    cardioGoal: number;
    hangCarrySessions: number;
    jumpSessions: number;
  };
  bestHangSeconds: number | null;
};

const ITEMS: { key: MobilityItem; title: string; how: string; timer?: number[]; bonus?: boolean }[] = [
  {
    key: "squat",
    title: "Deep squat hold",
    how: "Sit into a deep squat, chest tall. Hold a door frame and put your heels on a book if you need to.",
    timer: [2, 3, 5],
  },
  {
    key: "stretch",
    title: "World's Greatest Stretch",
    how: "Lunge, elbow down to the instep, then rotate that arm to the ceiling. 3 slow reps per side, 2 breaths each.",
  },
  {
    key: "pogo",
    title: "Pogo hops",
    how: "Small bounces off the balls of your feet, knees soft, landing so quietly you barely hear it. 2 × 20.",
  },
  {
    key: "hang",
    title: "Dead hang (bonus)",
    how: "Hang from a bar, ribs down, neck long. Feet on a chair if needed. A dead hang logged at the gym counts.",
    timer: [0.5, 1, 2],
    bonus: true,
  },
];

const LEVELS: { name: string; beginner: string; intermediate: string; advanced: string }[] = [
  { name: "Bar hang", beginner: "Feet on a chair, 5–10 s at a time", intermediate: "Full dead hang 20–60 s, build to 2 min a day", advanced: "3 min a day: mixed grip, scap pull-ups, one arm" },
  { name: "Interval walking", beginner: "2 min fast / 3 min slow", intermediate: "3 fast / 3 slow for 30 min, 4 days a week", advanced: "Same on an incline, or with a weighted vest" },
  { name: "Deep squat", beginner: "Hold support, heels raised, 2–5 min a day", intermediate: "Unassisted, 5–10 min a day in short bouts", advanced: "Wider or uneven stances, overhead reaches" },
  { name: "World's Greatest Stretch", beginner: "Slow, 2 breaths each position, no rotation", intermediate: "Full flow with rotation, 3 per side", advanced: "Overhead reach, or a light dumbbell" },
  { name: "Zone 2 cardio", beginner: "3 × 30 min brisk walks a week", intermediate: "4 × 45 min, mixed: walk, bike, row", advanced: "4 × 60 min with a heart-rate monitor" },
  { name: "Plyometrics", beginner: "Pogo hops, calf hops, line hops", intermediate: "Broad jumps, skater bounds, low box jumps", advanced: "Depth jumps, bounding, single-leg hops" },
  { name: "Loaded carries", beginner: "Suitcase carry, 30 s per side", intermediate: "Farmer's carry, 60 s", advanced: "Bodyweight in both hands for 1 min+" },
];

const styles = `
.longevity-page h1 { color: var(--longevity); }
.lg-status { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.lg-status .stat { border-left: 4px solid var(--longevity); }
.lg-status .stat b { font-size: 22px; }
.mob { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.mob li { border: 1px solid var(--line); border-left: 6px solid var(--longevity); border-radius: 14px; padding: 12px 14px; display: grid; gap: 8px; }
.mob li.done { background: var(--longevity-soft); }
.mob .top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.mob .top b { font-size: 17px; }
.mob p { margin: 0; color: var(--muted); font-size: 14px; }
.mob .row button { min-height: 40px; }
.mob .tick { border-color: var(--longevity); color: var(--longevity); font-weight: 700; min-width: 92px; }
.mob li.done .tick { background: var(--longevity); color: var(--card); }
.mob .clock { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--longevity); }
.lg-week { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.lg-week li { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
.lg-week li:last-child { border-bottom: 0; }
.levels details { border-bottom: 1px solid var(--line); padding: 8px 0; }
.levels summary { font-weight: 650; cursor: pointer; }
.levels dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 8px 0 0; font-size: 14px; }
.levels dt { color: var(--longevity); font-weight: 700; }
.levels dd { margin: 0; }
`;

export function longevityPage(d: LongevityPageData): Html {
  const done = new Set<MobilityItem>(d.done);
  if (d.hangLoggedToday) done.add("hang");
  const coreDone = MOBILITY_CORE.filter((k) => done.has(k)).length;
  const json = JSON.stringify({ done: [...done] }).replace(/</g, "\\u003c");
  return layout(
    "Longevity · Arif Gym Tracker",
    html`<main class="longevity-page">
      <header>
        <h1>🌱 Longevity</h1>
        <div class="row"><a class="button" href="/health">Health check</a><a class="button primary" href="/today">Today</a></div>
      </header>

      <section class="lg-status" aria-label="Summary">
        <div class="stat"><b id="core-count">${coreDone}/${MOBILITY_CORE.length}</b><span>mobility today</span></div>
        <div class="stat"><b>${d.streak}</b><span>day streak</span></div>
        <div class="stat"><b>${d.mobilityDaysThisWeek}/${MOBILITY_DAYS_GOAL}</b><span>mobility days this week</span></div>
        <div class="stat"><b>${d.week.intervalWalks}/${INTERVAL_WALKS_GOAL}</b><span>interval walks this week</span></div>
      </section>

      <section class="card" style="display: grid; gap: 12px">
        <h2 style="margin: 0">Daily mobility · about 6 minutes</h2>
        <ul class="mob">
          ${ITEMS.map(
            (it) => html`<li data-item="${it.key}" class="${done.has(it.key) ? "done" : ""}">
              <div class="top"><b>${it.title}</b><button type="button" class="tick">${done.has(it.key) ? "Done ✓" : "Done"}</button></div>
              <p>${it.how}</p>
              ${it.timer
                ? html`<div class="row">
                    <span class="clock" aria-live="polite">${fmtClock(it.timer[0] * 60)}</span>
                    ${it.timer.map((m) => html`<button type="button" data-timer="${m * 60}">▶ ${m < 1 ? `${m * 60} s` : `${m} min`}</button>`)}
                  </div>`
                : ""}
            </li>`,
          )}
        </ul>
        <p class="muted" id="mob-msg" role="status" style="margin: 0; font-size: 13px">The first three make a mobility day. Timers tick the item when they finish.</p>
      </section>

      <section class="card" style="display: grid; gap: 10px">
        <h2 style="margin: 0">This week</h2>
        <ul class="lg-week">
          <li><span>Interval walks (3 fast / 3 slow)</span><b>${d.week.intervalWalks}/${INTERVAL_WALKS_GOAL} · ${d.week.intervalMinutes} min</b></li>
          <li><span>All cardio (zone 2 and intervals)</span><b>${d.week.cardioMinutes}/${d.week.cardioGoal} min</b></li>
          <li><span>Hang and carry sessions</span><b>${d.week.hangCarrySessions}</b></li>
          <li><span>Jump sessions (pogo, broad jump)</span><b>${d.week.jumpSessions}</b></li>
          <li><span>Best dead hang</span><b>${d.bestHangSeconds === null ? "–" : `${d.bestHangSeconds} s`}</b></li>
        </ul>
        <div class="row">
          <a class="button primary" href="/log?tab=cardio&amp;activity=interval%20walk" style="background: var(--longevity); border-color: var(--longevity)">▶ Interval walk</a>
          <a class="button" href="/log?tab=pull">Hangs &amp; carries</a>
          <a class="button" href="/log?tab=legs">Jumps</a>
        </div>
      </section>

      <section class="card levels">
        <h2>How to progress</h2>
        ${LEVELS.map(
          (l) => html`<details>
            <summary>${l.name}</summary>
            <dl><dt>Beginner</dt><dd>${l.beginner}</dd><dt>Intermediate</dt><dd>${l.intermediate}</dd><dt>Advanced</dt><dd>${l.advanced}</dd></dl>
          </details>`,
        )}
        <p class="muted" style="margin: 10px 0 0; font-size: 13px">From Dan Go's "7 exercises I use to feel like I'm 26". Move up a level when the current one feels easy for 2 weeks.</p>
      </section>
    </main>
    <script id="lg-data" type="application/json">${raw(json)}</script>
    <script>${raw(script)}</script>`,
    html`<style>${raw(styles)}</style>`,
  );
}

function fmtClock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

const script = `
const CORE = ${JSON.stringify(MOBILITY_CORE)};
const data = JSON.parse(document.getElementById("lg-data").textContent);
const done = new Set(data.done);
const msg = document.getElementById("mob-msg");
const clock = (s) => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
let audio = null, running = null;

function beep() {
  try {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.25, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
    o.start(); o.stop(audio.currentTime + 0.41);
  } catch {}
}

function paint(li) {
  const on = done.has(li.dataset.item);
  li.classList.toggle("done", on);
  li.querySelector(".tick").textContent = on ? "Done ✓" : "Done";
  const n = CORE.filter((k) => done.has(k)).length;
  document.getElementById("core-count").textContent = n + "/" + CORE.length;
  if (n === CORE.length) msg.textContent = "Mobility done for today 🌱";
}

async function save(li, on) {
  const item = li.dataset.item;
  on ? done.add(item) : done.delete(item);
  paint(li);
  try {
    const res = await fetch("/api/mobility", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ item, done: on }) });
    if (res.status === 401) { location.href = "/login?next=/longevity"; return; }
    if (!res.ok) throw new Error();
  } catch {
    on ? done.delete(item) : done.add(item);
    paint(li);
    msg.textContent = "Couldn't save. Check your signal and try again.";
  }
}

document.querySelectorAll(".mob li").forEach((li) => {
  li.querySelector(".tick").addEventListener("click", () => save(li, !done.has(li.dataset.item)));
  li.querySelectorAll("[data-timer]").forEach((b) => b.addEventListener("click", () => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
    if (running) clearInterval(running.id);
    const total = Number(b.dataset.timer), start = Date.now(), face = li.querySelector(".clock");
    const id = setInterval(() => {
      const left = Math.max(0, total - (Date.now() - start) / 1000);
      face.textContent = clock(Math.ceil(left));
      if (left <= 0) { clearInterval(id); running = null; beep(); if (!done.has(li.dataset.item)) save(li, true); }
    }, 200);
    running = { id };
  }));
});
`;
