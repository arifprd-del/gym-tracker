import { html, raw } from "hono/html";
import { layout } from "./views";

// Touch-first logging screen: pick a day, tap an exercise, adjust weight and reps, tap "Log set".
// The page is rendered once with its data and then talks to /api/* using the signed-in session.

export type ExerciseButton = { name: string; day: "push" | "pull" | "legs" };

export type LogPageData = {
  exercises: ExerciseButton[];
  last: Record<string, { weight: number; reps: number }>;
  today: { id: number; exercise: string; weight: number; reps: number; at: string }[];
  cardio: {
    last: Record<string, { minutes: number; distance: number | null }>;
    today: { id: number; activity: string; minutes: number; distance: number | null; at: string }[];
  };
};

const styles = `
main.log { padding-bottom: 300px; gap: 14px; }
.log header a { font-size: 14px; }
.log header .row { flex-wrap: nowrap; }
.tabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; background: var(--card);
  border: 1px solid var(--line); border-radius: 14px; position: sticky; top: 8px; z-index: 2; }
.tabs button { border: 0; border-radius: 10px; padding: 12px 2px; font-weight: 600; font-size: 15px; background: none; white-space: nowrap; }
.tab-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 1px;
  box-shadow: 0 0 0 2px var(--card); }
.tabs button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 640px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.tile { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; min-height: 76px;
  padding: 10px 14px; border-radius: 14px; border: 2px solid var(--line); background: var(--card); color: var(--text);
  font: inherit; text-align: left; cursor: pointer; position: relative; -webkit-tap-highlight-color: transparent; }
.tile .name { font-weight: 650; font-size: 16px; line-height: 1.25; }
.tile .meta { color: var(--muted); font-size: 13px; }
.tile[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.tile .badge { position: absolute; top: 8px; right: 10px; font-size: 12px; font-weight: 700; color: var(--accent); }
.tile.add { border-style: dashed; color: var(--muted); align-items: center; }
.editing .tile:not(.add) { border-color: var(--danger); }
.editing .tile:not(.add) .badge { color: var(--danger); }
.toolbar { display: flex; justify-content: space-between; align-items: center; }
.toolbar button { font-size: 14px; }
.panel { position: fixed; left: 0; right: 0; bottom: 0; z-index: 3; background: var(--card); border-top: 1px solid var(--line);
  padding: 12px 16px calc(14px + env(safe-area-inset-bottom)); box-shadow: 0 -8px 24px rgb(0 0 0 / 0.08); }
.panel-inner { max-width: 960px; margin: 0 auto; display: grid; gap: 10px; }
.panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; min-height: 22px; }
.panel-head b { font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rest { color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.steppers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.steppers[hidden] { display: none; }
.stepper { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; align-items: center; background: var(--bg);
  border: 1px solid var(--line); border-radius: 14px; padding: 4px; }
.stepper button { height: 48px; border-radius: 10px; border: 0; background: var(--card); font-size: 24px; font-weight: 600;
  padding: 0; touch-action: manipulation; }
.stepper label { display: grid; justify-items: center; line-height: 1.1; }
.stepper input { width: 100%; border: 0; background: none; text-align: center; font-size: 26px; font-weight: 700; padding: 0;
  font-variant-numeric: tabular-nums; color: var(--text); }
.stepper small { color: var(--muted); font-size: 12px; }
.log-button { height: 56px; border-radius: 14px; font-size: 18px; font-weight: 700; touch-action: manipulation; }
.log-button:disabled { opacity: 0.45; }
.toast { position: fixed; left: 16px; right: 16px; bottom: calc(230px + env(safe-area-inset-bottom)); z-index: 4;
  max-width: 560px; margin: 0 auto; background: var(--text); color: var(--bg); border-radius: 14px; padding: 12px 14px;
  display: flex; gap: 12px; align-items: center; justify-content: space-between; font-size: 15px;
  transition: opacity .2s, transform .2s; }
.toast[hidden] { display: flex; opacity: 0; transform: translateY(8px); pointer-events: none; }
.toast button { background: none; border: 0; color: inherit; font-weight: 700; text-decoration: underline; padding: 4px; }
.today-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line);
  cursor: pointer; }
.today-row:last-child { border-bottom: 0; }
.today-row .sets { color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
`;

const script = `
const data = JSON.parse(document.getElementById("log-data").textContent);
const DAYS = ["push", "pull", "legs"];
const LABELS = { push: "Push", pull: "Pull", legs: "Legs", cardio: "Cardio", other: "Other" };
// Treadmill first: it's the usual one. Activities logged before show up too.
const DEFAULT_ACTIVITIES = ["treadmill", "exercise bike", "rowing machine", "cross trainer"];
const $ = (id) => document.getElementById(id);
const els = { tabs: $("tabs"), grid: $("grid"), today: $("today"), todayCard: $("today-card"), selected: $("selected"),
  rest: $("rest"), weight: $("weight"), reps: $("reps"), log: $("log"), toast: $("toast"), toastText: $("toast-text"),
  undo: $("undo"), edit: $("edit"), liftSteppers: $("lift-steppers"), cardioSteppers: $("cardio-steppers"),
  minutes: $("minutes"), distance: $("distance") };
const state = { tab: "push", selected: null, cardioSelected: null, extraActivities: [], editing: false, restFrom: null, lastLogged: null };

const title = (n) => n.replace(/(^|\\s)(\\S)/g, (m, s, c) => s + c.toUpperCase());
const norm = (n) => n.trim().replace(/\\s+/g, " ").toLowerCase();
const fmt = (kg) => String(Math.round(kg * 10) / 10);
const load = (w, r) => (w > 0 ? fmt(w) + " kg × " + r : "BW × " + r);
const cardioLoad = (m, d) => fmt(m) + " min" + (d ? " · " + fmt(d) + " km" : "");
const readNumber = (input) => Number(String(input.value).trim().replace(",", "."));

try { const saved = localStorage.getItem("gym-tab"); if (saved) state.tab = saved; } catch {}

function otherExercises() {
  const assigned = new Set(data.exercises.map((e) => e.name));
  return Object.keys(data.last).filter((n) => !assigned.has(n)).sort();
}
function exercisesFor(tab) {
  return tab === "other" ? otherExercises() : data.exercises.filter((e) => e.day === tab).map((e) => e.name);
}
function setsToday(name) { return data.today.filter((s) => s.exercise === name).length; }
function activities() {
  return [...new Set([...DEFAULT_ACTIVITIES, ...Object.keys(data.cardio.last), ...state.extraActivities])];
}
const isCardio = () => state.tab === "cardio";

function el(tag, props, children) {
  const node = Object.assign(document.createElement(tag), props || {});
  for (const child of children || []) node.append(child);
  return node;
}

function renderTabs() {
  const tabs = otherExercises().length ? [...DAYS, "cardio", "other"] : [...DAYS, "cardio"];
  if (!tabs.includes(state.tab)) state.tab = "push";
  els.tabs.replaceChildren(...tabs.map((tab) => {
    const dot = el("span", { className: "tab-dot" });
    dot.style.background = "var(--" + tab + ")";
    const b = el("button", { type: "button" }, [dot, LABELS[tab]]);
    b.setAttribute("aria-pressed", String(tab === state.tab));
    b.onclick = () => {
      state.tab = tab;
      state.editing = false;
      try { localStorage.setItem("gym-tab", tab); } catch {}
      if (tab === "cardio" && !state.cardioSelected) return selectCardio(activities()[0]);
      render();
    };
    return b;
  }));
}

function renderCardioGrid() {
  const tiles = activities().map((name) => {
    const last = data.cardio.last[name];
    const count = data.cardio.today.filter((c) => c.activity === name).length;
    const b = el("button", { type: "button", className: "tile" }, [
      el("span", { className: "name", textContent: title(name) }),
      el("span", { className: "meta", textContent: last ? "Last " + cardioLoad(last.minutes, last.distance) : "New" }),
    ]);
    if (count) b.append(el("span", { className: "badge", textContent: "×" + count }));
    b.setAttribute("aria-pressed", String(name === state.cardioSelected));
    b.onclick = () => selectCardio(name);
    return b;
  });
  const add = el("button", { type: "button", className: "tile add", textContent: "+ Add activity" });
  add.onclick = () => {
    const input = prompt("Add a cardio activity");
    if (!input || !input.trim()) return;
    const name = norm(input);
    if (!activities().includes(name)) state.extraActivities.push(name);
    selectCardio(name);
  };
  tiles.push(add);
  els.grid.replaceChildren(...tiles);
}

function renderGrid() {
  els.grid.classList.toggle("editing", state.editing);
  els.edit.hidden = state.tab === "other" || isCardio();
  if (isCardio()) return renderCardioGrid();
  els.edit.textContent = state.editing ? "Done" : "Edit list";
  const tiles = exercisesFor(state.tab).map((name) => {
    const last = data.last[name];
    const count = setsToday(name);
    const b = el("button", { type: "button", className: "tile" }, [
      el("span", { className: "name", textContent: title(name) }),
      el("span", { className: "meta", textContent: last ? "Last " + load(last.weight, last.reps) : "New" }),
    ]);
    if (state.editing) b.append(el("span", { className: "badge", textContent: "Remove" }));
    else if (count) b.append(el("span", { className: "badge", textContent: "×" + count }));
    b.setAttribute("aria-pressed", String(!state.editing && name === state.selected));
    b.onclick = () => (state.editing ? removeExercise(name) : select(name));
    return b;
  });
  if (state.tab !== "other") {
    const add = el("button", { type: "button", className: "tile add", textContent: "+ Add exercise" });
    add.onclick = addExercise;
    tiles.push(add);
  }
  els.grid.replaceChildren(...tiles);
}

function renderToday() {
  const groups = new Map();
  for (const s of data.today) {
    if (!groups.has(s.exercise)) groups.set(s.exercise, []);
    groups.get(s.exercise).push(s);
  }
  const cardioGroups = new Map();
  for (const c of data.cardio.today) {
    if (!cardioGroups.has(c.activity)) cardioGroups.set(c.activity, []);
    cardioGroups.get(c.activity).push(c);
  }
  els.todayCard.hidden = groups.size === 0 && cardioGroups.size === 0;
  const cardioRows = [...cardioGroups].map(([name, sessions]) => {
    const row = el("div", { className: "today-row" }, [
      el("b", { textContent: title(name) }),
      el("span", { className: "sets", textContent: sessions.map((c) => cardioLoad(c.minutes, c.distance)).join(", ") }),
    ]);
    row.onclick = () => {
      state.tab = "cardio";
      selectCardio(name);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    return row;
  });
  els.today.replaceChildren(...cardioRows, ...[...groups].map(([name, sets]) => {
    const row = el("div", { className: "today-row" }, [
      el("b", { textContent: title(name) }),
      el("span", { className: "sets", textContent: sets.map((s) => (s.weight > 0 ? fmt(s.weight) + "×" + s.reps : "BW×" + s.reps)).join(", ") }),
    ]);
    row.onclick = () => {
      const button = data.exercises.find((e) => e.name === name);
      state.tab = button ? button.day : "other";
      select(name);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    return row;
  }));
  const times = [...data.today, ...data.cardio.today].map((e) => new Date(e.at).getTime());
  state.restFrom = times.length ? Math.max(...times) : null;
  tick();
}

function renderPanel() {
  const cardio = isCardio();
  const selected = cardio ? state.cardioSelected : state.selected;
  els.liftSteppers.hidden = cardio;
  els.cardioSteppers.hidden = !cardio;
  els.selected.textContent = selected ? title(selected) : cardio ? "Pick an activity" : "Tap an exercise";
  els.log.textContent = cardio ? "Log cardio" : "Log set";
  els.log.disabled = !selected;
}

function render() { renderTabs(); renderGrid(); renderPanel(); }

function select(name) {
  state.selected = name;
  const last = data.last[name];
  els.weight.value = last ? fmt(last.weight) : "20";
  els.reps.value = last ? String(last.reps) : "10";
  render();
}

function selectCardio(name) {
  state.cardioSelected = name;
  const last = data.cardio.last[name];
  els.minutes.value = last ? fmt(last.minutes) : "30";
  els.distance.value = last && last.distance ? fmt(last.distance) : "0";
  render();
}

function tick() {
  if (!state.restFrom) { els.rest.textContent = ""; return; }
  const seconds = Math.max(0, Math.floor((Date.now() - state.restFrom) / 1000));
  if (seconds > 60 * 60) { els.rest.textContent = ""; return; }
  els.rest.textContent = "Rest " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
setInterval(tick, 1000);

let toastTimer;
function toast(message, canUndo) {
  els.toastText.textContent = message;
  els.undo.hidden = !canUndo;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), canUndo ? 6000 : 4000);
}

async function api(path, body) {
  let response;
  try {
    response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), credentials: "same-origin" });
  } catch {
    throw new Error("Couldn't reach the tracker. Check your signal and try again.");
  }
  if (response.status === 401) { location.href = "/login?next=/log"; throw new Error("Signed out."); }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.message || "Something went wrong.");
  return json;
}

document.querySelectorAll("[data-step]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = $(button.dataset.target);
    const step = Number(button.dataset.step);
    const min = Number(input.dataset.min);
    const current = readNumber(input) || 0;
    input.value = fmt(Math.max(min, Math.round((current + step) * 10) / 10));
  });
});

async function logCardio() {
  const activity = state.cardioSelected;
  const minutes = readNumber(els.minutes);
  const distance = readNumber(els.distance) || 0;
  if (!activity) return;
  if (!(minutes > 0)) return toast("Check the minutes.");
  if (!(distance >= 0)) return toast("Check the distance.");
  els.log.disabled = true;
  try {
    const result = await api("/api/cardio", { activity, minutes, distance });
    const c = result.cardio;
    data.cardio.last[c.activity] = { minutes: c.minutes, distance: c.distance_km };
    data.cardio.today.push({ id: c.id, activity: c.activity, minutes: c.minutes, distance: c.distance_km, at: c.performed_at });
    state.lastLogged = { kind: "cardio", id: c.id };
    toast("✓ " + result.message, true);
    renderToday();
    render();
  } catch (error) {
    toast(error.message);
  } finally {
    els.log.disabled = !state.cardioSelected;
  }
}

els.log.addEventListener("click", async () => {
  if (isCardio()) return logCardio();
  const exercise = state.selected;
  const weight = readNumber(els.weight);
  const reps = Math.round(readNumber(els.reps));
  if (!exercise) return;
  if (!(weight >= 0) || !(reps >= 1)) return toast("Check the weight and reps.");
  els.log.disabled = true;
  try {
    const result = await api("/api/log", { exercise, weight, reps });
    const s = result.set;
    data.last[s.exercise] = { weight: s.weight_kg, reps: s.reps };
    data.today.push({ id: s.id, exercise: s.exercise, weight: s.weight_kg, reps: s.reps, at: s.performed_at });
    state.lastLogged = { kind: "set", id: s.id };
    toast((result.personalBest ? "🏆 " : "✓ ") + result.message, true);
    renderToday();
    render();
  } catch (error) {
    toast(error.message);
  } finally {
    els.log.disabled = !state.selected;
  }
});

// Undo removes exactly the entry this page just logged.
els.undo.addEventListener("click", async () => {
  els.toast.hidden = true;
  const target = state.lastLogged;
  if (!target) return;
  state.lastLogged = null;
  try {
    if (target.kind === "cardio") {
      const result = await api("/api/cardio/delete", { id: target.id });
      data.cardio.today = data.cardio.today.filter((c) => c.id !== target.id);
      toast(result.message);
    } else {
      const result = await api("/api/sets/delete", { id: target.id });
      data.today = data.today.filter((s) => s.id !== target.id);
      const previous = [...data.today].reverse().find((s) => s.exercise === result.removed.exercise);
      if (previous) data.last[previous.exercise] = { weight: previous.weight, reps: previous.reps };
      toast(result.message);
    }
    renderToday();
    render();
  } catch (error) {
    toast(error.message);
  }
});

els.edit.addEventListener("click", () => { state.editing = !state.editing; renderGrid(); });

async function addExercise() {
  const input = prompt("Add an exercise to " + LABELS[state.tab]);
  if (!input || !input.trim()) return;
  const name = norm(input);
  try {
    await api("/api/exercises", { name, day: state.tab });
    data.exercises = data.exercises.filter((e) => e.name !== name);
    data.exercises.push({ name, day: state.tab });
    select(name);
  } catch (error) {
    toast(error.message);
  }
}

async function removeExercise(name) {
  if (!confirm("Remove " + title(name) + " from " + LABELS[state.tab] + "? Sets you've logged are kept.")) return;
  try {
    await api("/api/exercises/remove", { name });
    data.exercises = data.exercises.filter((e) => e.name !== name);
    if (state.selected === name) state.selected = null;
    render();
  } catch (error) {
    toast(error.message);
  }
}

renderToday();
if (isCardio()) selectCardio(activities()[0]);
else render();
`;

export function logPage(data: LogPageData) {
  // JSON inside a script tag: escape "<" so a name like "</script>" cannot end the tag early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return layout(
    "Log",
    html`<main class="log">
        <header>
          <h1>Log</h1>
          <div class="row">
            <a class="button" href="/#body-weight">Weigh-in</a>
            <a class="button" href="/">Dashboard</a>
          </div>
        </header>

        <nav class="tabs" id="tabs" aria-label="Workout day"></nav>

        <section>
          <div class="toolbar"><span></span><button type="button" id="edit">Edit list</button></div>
          <div class="grid" id="grid"></div>
        </section>

        <section class="card" id="today-card" hidden>
          <h2>Today</h2>
          <div id="today"></div>
        </section>
      </main>

      <div class="toast" id="toast" role="status" aria-live="polite" hidden>
        <span id="toast-text"></span>
        <button type="button" id="undo">Undo</button>
      </div>

      <div class="panel">
        <div class="panel-inner">
          <div class="panel-head"><b id="selected">Tap an exercise</b><span class="rest" id="rest"></span></div>
          <div class="steppers" id="lift-steppers">
            <div class="stepper">
              <button type="button" data-step="-2.5" data-target="weight" aria-label="Less weight">−</button>
              <label><input id="weight" type="text" inputmode="decimal" value="20" data-min="0" autocomplete="off" /><small>kg</small></label>
              <button type="button" data-step="2.5" data-target="weight" aria-label="More weight">+</button>
            </div>
            <div class="stepper">
              <button type="button" data-step="-1" data-target="reps" aria-label="Fewer reps">−</button>
              <label><input id="reps" type="text" inputmode="numeric" value="10" data-min="1" autocomplete="off" /><small>reps</small></label>
              <button type="button" data-step="1" data-target="reps" aria-label="More reps">+</button>
            </div>
          </div>
          <div class="steppers" id="cardio-steppers" hidden>
            <div class="stepper">
              <button type="button" data-step="-5" data-target="minutes" aria-label="Fewer minutes">−</button>
              <label><input id="minutes" type="text" inputmode="numeric" value="30" data-min="1" autocomplete="off" /><small>minutes</small></label>
              <button type="button" data-step="5" data-target="minutes" aria-label="More minutes">+</button>
            </div>
            <div class="stepper">
              <button type="button" data-step="-0.5" data-target="distance" aria-label="Less distance">−</button>
              <label><input id="distance" type="text" inputmode="decimal" value="0" data-min="0" autocomplete="off" /><small>km</small></label>
              <button type="button" data-step="0.5" data-target="distance" aria-label="More distance">+</button>
            </div>
          </div>
          <button type="button" class="primary log-button" id="log" disabled>Log set</button>
        </div>
      </div>

      <script id="log-data" type="application/json">${raw(json)}</script>
      <script>${raw(script)}</script>`,
    html`<meta name="theme-color" content="#0f1115" /><style>${raw(styles)}</style>`,
  );
}
