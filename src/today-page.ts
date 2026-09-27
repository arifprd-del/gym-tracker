import { html, raw } from "hono/html";
import { formatSleep, type SplitDay } from "./lib";
import { layout } from "./views";

// Today: everything due today on one screen, each one tap away. The Home Screen app opens here.

type Html = ReturnType<typeof html>;

export type TodayData = {
  dateLabel: string; // "Sunday 27 September"
  workout: { doneToday: SplitDay | null; setsToday: number; next: SplitDay; lastOfNextAgo: string | null; nudge: string | null };
  mobility: { done: number; total: number; streak: number };
  brain: { rounds: number; streak: number };
  protein: { today: number; target: number };
  cardio: { weekMinutes: number; goal: number; walks: number; walksGoal: number };
  sleepLastNight: number | null;
  stepsYesterday: number | null;
  week: { weighedIn: boolean; bpThisWeek: boolean; waistThisWeek: boolean; brainCheckDue: boolean; fitnessCheckDue: boolean };
};

const LABEL: Record<SplitDay, string> = { push: "Push", pull: "Pull", legs: "Legs" };

const styles = `
.today-page h1 { margin: 0; }
.today-page .date { color: var(--muted); margin: 0; }
.t-progress { display: grid; gap: 6px; }
.t-bar { height: 10px; border-radius: 5px; background: var(--heat-0); overflow: hidden; }
.t-bar span { display: block; height: 100%; background: var(--good); border-radius: 5px; }
.t-info { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.t-info div { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; }
.t-info b { display: block; font-size: 17px; font-variant-numeric: tabular-nums; }
.t-info span { color: var(--muted); font-size: 12px; }
.t-list { display: grid; gap: 10px; }
.t-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 14px;
  background: var(--card); border: 1px solid var(--line); border-left: 6px solid var(--c); border-radius: 14px; color: var(--text); text-decoration: none; }
.t-row.done { opacity: .62; }
.t-check { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--c); display: grid; place-items: center; font-weight: 800; color: var(--card); }
.t-row.done .t-check { background: var(--c); }
.t-main { display: grid; min-width: 0; }
.t-main b { font-size: 16px; }
.t-main span { color: var(--muted); font-size: 13px; }
.t-go { font-weight: 700; color: var(--accent); white-space: nowrap; font-size: 15px; }
.t-protein { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; grid-column: 1 / -1; }
.t-protein button { padding: 10px 0; font-weight: 700; border-radius: 10px; }
.today-page h2 { margin: 6px 0 0; }
@media (max-width: 380px) { .t-go .w { display: none; } .t-row { gap: 10px; padding: 12px 12px; } }
`;

function row(o: { colour: string; done: boolean; title: string; status: string; href?: string; go?: string; extra?: Html }): Html {
  const inner = html`<span class="t-check" aria-hidden="true">${o.done ? "✓" : ""}</span>
    <span class="t-main"><b>${o.title}<span class="visually-hidden">${o.done ? " (done)" : ""}</span></b><span>${o.status}</span></span>
    ${o.go ? html`<span class="t-go"><span class="w">${o.go.replace(" →", "")} </span>→</span>` : html`<span></span>`}
    ${o.extra ?? ""}`;
  return o.href
    ? html`<a class="t-row${o.done ? " done" : ""}" style="--c: ${o.colour}" href="${o.href}">${inner}</a>`
    : html`<div class="t-row${o.done ? " done" : ""}" style="--c: ${o.colour}">${inner}</div>`;
}

export function todayPage(d: TodayData): Html {
  const w = d.workout;
  const daily = [d.mobility.done >= d.mobility.total, d.brain.rounds >= 2, d.protein.today >= d.protein.target];
  const dailyDone = daily.filter(Boolean).length;
  const weekly = [
    !d.week.weighedIn && row({ colour: "var(--accent)", done: false, title: "Weigh-in", status: "Not done yet this week", href: "/#body-weight", go: "Weigh →" }),
    (!d.week.bpThisWeek || !d.week.waistThisWeek) &&
      row({
        colour: "var(--longevity)",
        done: false,
        title: "Blood pressure and waist",
        status: !d.week.bpThisWeek && !d.week.waistThisWeek ? "Not measured yet this week" : !d.week.bpThisWeek ? "Blood pressure still to do" : "Waist still to do",
        href: d.week.bpThisWeek ? "/health#waist" : "/health#bp",
        go: "Measure →",
      }),
    d.week.brainCheckDue && row({ colour: "var(--good)", done: false, title: "Brain Check", status: "Weekly · 3 minutes", href: "/brain#check", go: "Start →" }),
    d.week.fitnessCheckDue && row({ colour: "var(--longevity)", done: false, title: "Monthly longevity check", status: "Sit to stand, max hang, 12-minute test", href: "/health#check", go: "Start →" }),
  ].filter(Boolean) as Html[];

  return layout(
    "Today · Arif Gym Tracker",
    html`<main class="today-page">
      <header>
        <div><h1>Today</h1><p class="date">${d.dateLabel}</p></div>
        <div class="row"><a class="button" href="/log">Log</a><a class="button" href="/">Dashboard</a></div>
      </header>

      <section class="t-progress" aria-label="Daily habits">
        <div class="row" style="justify-content: space-between"><b>${dailyDone === daily.length ? "Daily habits done 🎉" : "Daily habits"}</b><span class="muted">${dailyDone} of ${daily.length}</span></div>
        <div class="t-bar" aria-hidden="true"><span style="width: ${Math.round((dailyDone / daily.length) * 100)}%"></span></div>
      </section>

      <section class="t-info" aria-label="Last night and this week">
        <div><b>${d.sleepLastNight === null ? "–" : formatSleep(d.sleepLastNight)}</b><span>sleep last night</span></div>
        <div><b>${d.stepsYesterday === null ? "–" : d.stepsYesterday.toLocaleString("en-GB")}</b><span>steps yesterday</span></div>
        <div><b>${Math.round(d.cardio.weekMinutes)}/${d.cardio.goal}</b><span>cardio min this week</span></div>
      </section>

      <section class="t-list">
        ${row(
          w.doneToday
            ? { colour: `var(--${w.doneToday})`, done: true, title: `${LABEL[w.doneToday]} workout`, status: `${w.setsToday} ${w.setsToday === 1 ? "set" : "sets"} today`, href: "/summary", go: "Summary →" }
            : {
                colour: `var(--${w.next})`,
                done: false,
                title: `Workout: ${LABEL[w.next]}`,
                status: w.nudge ?? (w.lastOfNextAgo ? `Last ${LABEL[w.next]}: ${w.lastOfNextAgo}. Rest day? That's fine too.` : `Start your ${LABEL[w.next]} rotation`),
                href: `/log?tab=${w.next}`,
                go: "Start →",
              },
        )}
        ${row({
          colour: "var(--longevity)",
          done: d.mobility.done >= d.mobility.total,
          title: "🌱 Mobility",
          status: `${d.mobility.done}/${d.mobility.total} · about 6 minutes${d.mobility.streak ? ` · ${d.mobility.streak}-day streak` : ""}`,
          href: "/longevity",
          go: d.mobility.done >= d.mobility.total ? "" : "Start →",
        })}
        ${row({
          colour: "var(--good)",
          done: d.brain.rounds >= 2,
          title: "🧠 Brain training",
          status: `${Math.min(d.brain.rounds, 2)}/2 Quick Glance rounds${d.brain.streak ? ` · ${d.brain.streak}-day streak` : ""}`,
          href: "/brain",
          go: d.brain.rounds >= 2 ? "" : "Play →",
        })}
        <div id="protein">
          ${row({
            colour: "var(--accent)",
            done: d.protein.today >= d.protein.target,
            title: "Protein",
            status: `${d.protein.today} / ${d.protein.target} g${d.protein.today < d.protein.target ? ` · ${d.protein.target - d.protein.today} g to go` : " ✓"}`,
            extra: html`<div class="t-protein">${[10, 20, 30, 40].map((g) => html`<button type="button" data-g="${g}">+${g} g</button>`)}</div>`,
          })}
        </div>
        ${row({
          colour: "var(--longevity)",
          done: d.cardio.walks >= d.cardio.walksGoal,
          title: "🌱 Interval walk",
          status: `${d.cardio.walks}/${d.cardio.walksGoal} this week · 30 minutes, 3 fast / 3 slow`,
          href: "/log?tab=cardio&activity=interval%20walk",
          go: "Walk →",
        })}
      </section>

      ${weekly.length ? html`<h2>This week</h2><section class="t-list">${weekly}</section>` : ""}
      <p class="muted" id="t-msg" role="status" style="margin: 0; font-size: 13px"></p>
    </main>
    <script>
      document.querySelectorAll("#protein [data-g]").forEach((b) => b.addEventListener("click", async () => {
        const msg = document.getElementById("t-msg");
        msg.textContent = "Saving…";
        try {
          const res = await fetch("/api/protein", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ grams: Number(b.dataset.g) }) });
          if (res.status === 401) { location.href = "/login?next=/today"; return; }
          if (!res.ok) throw new Error();
          location.reload();
        } catch { msg.textContent = "Couldn't save. Check your signal and try again."; }
      }));
    </script>`,
    html`<style>${raw(styles)}</style>`,
  );
}
