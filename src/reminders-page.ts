import { html, raw } from "hono/html";
import { WEEKDAYS, type ReminderKey, type ReminderRule } from "./reminders";
import { layout } from "./views";

const ABOUT: Record<ReminderKey, { title: string; text: string }> = {
  gym: { title: "Gym", text: "If you haven't trained yet that day: your next workout (Push, Pull or Legs), with the never-miss-twice nudge." },
  brain: { title: "Brain training", text: "If today's 2 Quick Glance rounds aren't done." },
  weekly: { title: "Weekly check-in", text: "If you haven't weighed in this week, or the Brain Check is due." },
};
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

const styles = `
.reminders { max-width: 560px; }
.reminders .card { display: grid; gap: 12px; }
.rem-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rem-head label { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 17px; min-width: 0; }
.rem-head input[type=checkbox] { flex: none; width: 22px; height: 22px; margin: 0; accent-color: var(--accent); }
.rem-head input[type=time] { flex: none; width: auto; min-width: 100px; font-size: 16px; padding: 8px 8px; }
.day-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.day-chips label { position: relative; }
.day-chips input { position: absolute; opacity: 0; inset: 0; margin: 0; }
.day-chips span { display: inline-block; min-width: 42px; text-align: center; padding: 6px 0; border-radius: 999px; border: 1px solid var(--line); font-size: 14px; }
.day-chips input:checked + span { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.day-chips input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
.rule.off .day-chips, .rule.off .muted { opacity: .5; }
#push-status { margin: 0; }
`;

export function remindersPage(d: { rules: ReminderRule[]; publicKey: string; devices: number; saved: boolean }): ReturnType<typeof html> {
  const byKey = new Map(d.rules.map((r) => [r.key, r]));
  return layout(
    "Reminders · Arif Gym Tracker",
    html`<main class="reminders">
      <header><h1>Reminders</h1><a class="button" href="/">Dashboard</a></header>

      <section class="card" id="push">
        <h2 style="margin: 0">Notifications on this phone</h2>
        <p id="push-status">Checking…</p>
        <div class="row">
          <button type="button" class="primary" id="push-on" hidden>Turn on notifications</button>
          <button type="button" id="push-test" hidden>Send a test</button>
          <button type="button" id="push-off" hidden>Turn off on this phone</button>
        </div>
        <p class="muted" style="margin: 0; font-size: 13px">${d.devices === 0 ? "No phone is signed up yet." : d.devices === 1 ? "1 phone gets reminders." : `${d.devices} phones get reminders.`}
          On iPhone this needs iOS 16.4 or later, and the app opened from its Home Screen icon.</p>
      </section>

      <form method="post" action="/reminders" style="display: grid; gap: 16px">
        ${(["gym", "brain", "weekly"] as ReminderKey[]).map((key) => {
          const r = byKey.get(key)!;
          return html`<section class="card rule${r.enabled ? "" : " off"}">
            <div class="rem-head">
              <label><input type="checkbox" name="${key}_enabled" ${r.enabled ? "checked" : ""} /> ${ABOUT[key].title}</label>
              <input type="time" name="${key}_time" value="${r.time}" step="900" aria-label="${ABOUT[key].title} time" required />
            </div>
            <p class="muted" style="margin: 0">${ABOUT[key].text}</p>
            <div class="day-chips" role="group" aria-label="${ABOUT[key].title} days">
              ${DAY_ORDER.map((n) => html`<label><input type="checkbox" name="${key}_days" value="${n}" ${r.days.includes(n) ? "checked" : ""} /><span>${WEEKDAYS[n]}</span></label>`)}
            </div>
          </section>`;
        })}
        <div class="row">
          <button type="submit" class="primary">Save reminders</button>
          ${d.saved ? html`<span role="status" style="color: var(--good)">Saved ✓</span>` : ""}
        </div>
        <p class="muted" style="margin: 0; font-size: 13px">UK time. A reminder can arrive up to 15 minutes after its time, and is skipped if it's already done.</p>
      </form>
    </main>
    <script>
      const PUBLIC_KEY = ${raw(JSON.stringify(d.publicKey))};
      const $ = (id) => document.getElementById(id);
      const status = (text) => { $("push-status").textContent = text; };
      const show = (on) => { $("push-on").hidden = on; $("push-test").hidden = !on; $("push-off").hidden = !on; };
      document.querySelectorAll(".rule input[type=checkbox][name$=_enabled]").forEach((box) =>
        box.addEventListener("change", () => box.closest(".rule").classList.toggle("off", !box.checked)));

      async function api(path, body) {
        const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
        if (res.status === 401) { location.href = "/login?next=/reminders"; throw new Error("Signed out"); }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't reach the tracker. Try again.");
        return data;
      }
      function keyBytes(b64) {
        const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
        return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
      }
      async function registration() {
        return navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready);
      }

      async function init() {
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
          const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
          status(standalone
            ? "This phone's browser can't do notifications. On iPhone, update to iOS 16.4 or later."
            : "Open Arif Gym from its Home Screen icon (not Safari) to turn on notifications.");
          return;
        }
        if (Notification.permission === "denied") {
          status("Notifications are blocked. Turn them on in Settings → Notifications → Arif Gym, then come back.");
          return;
        }
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") {
          await api("/api/push/subscribe", sub.toJSON()).catch(() => {}); // keeps the server's copy current
          status("On for this phone ✓");
          show(true);
        } else {
          status("Off for this phone.");
          show(false);
        }
      }

      $("push-on").onclick = async () => {
        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") { status("Not allowed. You can change this in Settings → Notifications → Arif Gym."); return; }
          const reg = await registration();
          const sub = (await reg.pushManager.getSubscription()) ||
            (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) }));
          await api("/api/push/subscribe", sub.toJSON());
          status("On for this phone ✓ Tap Send a test to check.");
          show(true);
        } catch (err) {
          status("Couldn't turn on: " + err.message);
        }
      };
      $("push-test").onclick = async () => {
        status("Sending…");
        try {
          const r = await api("/api/push/test", {});
          status(r.message);
        } catch (err) { status(err.message); }
      };
      $("push-off").onclick = async () => {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await api("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
        status("Off for this phone.");
        show(false);
      };
      init().catch((err) => status("Couldn't check notifications: " + err.message));
    </script>`,
    html`<style>${raw(styles)}</style>`,
  );
}
