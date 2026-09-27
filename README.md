# Arif Gym Tracker

Log workout sets on a touch screen built for the gym floor, then track your progress on a web dashboard.

```
iPhone (Home Screen app)            Cloudflare Worker (Hono)                 Cloudflare D1
/log   tap exercise, Log set  ──▶  /api/log   (signed-in session)  ──▶     sets, exercises
/      dashboard              ◀──  charts, records, recent sets    ◀──┘
```

## What it does

- **Today (`/today`):** the Home Screen app opens here. It shows today's workout (next in the rotation, or done with a
  summary link), the mobility routine, brain training, protein with + buttons, interval walks this week, last night's
  sleep, yesterday's steps and cardio minutes. Below that are the week's open items: weigh-in, blood pressure and
  waist, the Brain Check and the monthly longevity check. Each is one tap away.
- **Tap-to-log screen (`/log`):** Push / Pull / Legs tabs with big exercise buttons. Weight and reps are pre-filled from
  your last set of that exercise, with +/− buttons (2.5 kg / 1 rep). One tap on **Log set** saves it with the current
  date and time. It also has undo, a rest timer and today's sets, and you can add or remove exercises in each tab.
  Add it to your Home Screen to open it full screen like an app. See [docs/iphone-setup.md](docs/iphone-setup.md).
- **Cardio tab:** Treadmill (plus bike, rower, cross trainer, or your own), logged by minutes (±5) with an optional
  distance in km.
- **Weekly body weight:** a weigh-in box on the dashboard (one entry per day, saving again replaces it), with the
  change over about four weeks and a weekly chart. A reminder shows until you've weighed in that week.
- **Dashboard (`/`):** today's sets, when you last trained Push / Pull / Legs, weekly volume stacked by workout type, a
  training-days calendar coloured by workout type, a week streak, personal records with an estimated one-rep max, and
  recent sets with delete buttons. Cardio has its own minutes-per-week chart, and cardio days are marked with a dot on
  the calendar. It supports light and dark mode and works on a phone.
- **Habit features (Atomic Habits):**
  - *This week* checklist: Push, Pull, Legs, the cardio goal (`CARDIO_WEEKLY_MINUTES` in `wrangler.jsonc`, 150),
    a weigh-in, brain training on 5 days and the mobility routine on 5 days, with a progress bar and a "Week complete" state.
  - *Next workout*: the next day in the Push → Pull → Legs rotation. The log screen opens on it until you've logged
    something today.
  - *Never miss twice*: a gentle banner after 4+ days without training, or late in the week when the streak is at risk.
  - *Beat last time*: on the log screen, your best set from the previous session with one-tap targets (one more rep,
    or +2.5 kg / +1 kg under 20 kg), and a 💪 when you beat it.
- **Steps:** a nightly iPhone Shortcuts automation posts the day's step total from Health to `/sync/steps`, using a
  sync key made with **Create sync key** on the dashboard's Steps card (only its hash is stored, and it can only write
  step totals; a `STEPS_TOKEN` secret also works). The dashboard shows today or yesterday, the 7-day average, this
  week's total and a 30-day chart with a goal line (`STEPS_DAILY_GOAL`, default 8,000). Setup is in
  [docs/iphone-setup.md](docs/iphone-setup.md#nightly-steps-sync).
- **Sets × reps targets:** each exercise button has a target (starting at 3 × 5–8 for big lifts, 3 × 6–10 for
  pull-ups and dips, 3 × 8–12 for the rest), shown on the button with today's progress (2/3, then ✓ 3/3) and as
  "set 2 of 3" in the panel. **Edit list → tap an exercise** changes it (e.g. `4x6-10`, empty for none). Beat-last-time
  uses double progression: +1 rep until the top of the range, then more weight at the bottom of it.
- **Exercise progress (`/exercise/<name>`):** tap an exercise name on the dashboard, or **📈 Progress** on the log
  screen, to see the best set, best estimated 1RM, the change over about 8 weeks, a strength-over-time chart (best reps
  for bodyweight moves) and every session's sets, with 🏆 on record days.
- **Stall alert:** when an exercise's last 3 sessions (within the last 6 weeks) haven't beaten its best estimated 1RM
  (best reps for bodyweight moves), the log screen offers one-tap **Deload** (about 10% lighter) and **Switch** (other
  rep range at a matching weight) targets, the progress page explains both, and Personal records tags it "Stalled".
- **Workout summary (`/summary`):** **Finish workout** on the log screen (or a date in Recent sets) shows the day's
  duration, sets, volume vs the last session of the same type, each exercise with ↑ / = / ↓ against last time,
  personal bests, cardio and the next workout.
- **Week recap (`/recap`):** a dashboard card for the week just finished (on Sundays, the week ending today) and a
  full page with ← → to browse weeks: sessions, split days done, volume vs the week before, cardio vs goal, steps,
  body weight change, the week's personal bests, stalled exercises and what's next in the rotation.
- **Brain (`/brain`):** daily *Quick Glance* speed training (adaptive, two rounds a day, modelled on the ACTIVE
  trial's speed-of-processing training) with a streak and a best-flash chart; a weekly *Brain Check* (90 s reaction
  test and 90 s symbol match) with trend charts; and last night's sleep with a 14-night chart. Brain training 5 days a
  week is on the weekly checklist, and the recap shows brain days and average sleep.
- **Sleep:** the nightly Shortcut can also post last night's sleep to `/sync/sleep` with the same sync key, or you
  can type a night on the Brain page (a typed night isn't overwritten by the sync). See
  [docs/iphone-setup.md](docs/iphone-setup.md#nightly-sleep-sync).
- **Reminders (`/reminders`):** iPhone notifications (Web Push) for the gym (your next workout), brain training and a
  weekly check-in (weigh-in, Brain Check), each with its own time and days, sent only when that thing isn't done yet.
  A Cloudflare cron runs every 15 minutes; the push keys are made on first use and kept in D1, so there's nothing to
  configure. Setup: [docs/iphone-setup.md](docs/iphone-setup.md#reminders-notifications).
- **Protein:** a dashboard card (also **Protein** on the Log screen) with +10 / +20 / +30 / +40 g buttons, your own
  amount and undo. The daily target is 1.6 g per kg of your latest weigh-in (`PROTEIN_G_PER_KG` in `wrangler.jsonc`),
  with a 14-day chart; the recap shows the week's average and days at target.
- **Sleep and performance (Brain page):** compares days after nights under 7 hours with days after 7+ hours for Quick
  Glance speed, lifting strength (best estimated 1RM against each exercise's previous sessions), reaction time and
  symbol matching. Each measure is taken against your own recent level, and it needs 3 days of each kind of night
  before it shows a pattern.
- **Longevity (`/longevity`, marked 🌱 in pink everywhere):** Dan Go's 7 longevity exercises.
  - A 6-minute daily mobility routine: deep squat hold and dead hang with timers, World's Greatest Stretch and pogo
    hops. It has a streak, a weekly-checklist item (5 days) and an optional reminder.
  - **Interval walk** on the Cardio tab, with a full-screen 3 min fast / 3 min slow timer (or 2 / 3 for beginners)
    that beeps at each change and fills in the minutes.
  - Timed exercises (anything named hang, carry, plank or hold) log seconds instead of reps, beat last time by
    5 seconds, and stay out of volume and stall alerts. Dead hang and farmer's carry are on Pull day; pogo hops and
    broad jumps start Legs day.
  - The page also shows this week's interval walks, hang/carry and jump sessions, the best dead hang, and
    beginner / intermediate / advanced steps for all 7.
- **Health check (`/health`):** the monthly longevity check (sit-to-stand score 0–10, max dead hang with a stopwatch,
  12-minute treadmill test with estimated VO₂max), weekly home blood pressure (NHS bands, weekly-average chart with
  the 135/85 home limit) and waist with waist-to-height ratio (NICE bands). The weekly reminder includes whatever is
  due. It's for tracking, not diagnosis.
- **CSV export:** one file with every set, cardio session, weigh-in and protein entry (a `type` column tells them apart), in date order with local date and time.

Both pages need the dashboard password. The `/api/*` endpoints behind the log screen use the same signed-in session and
accept only JSON.

## Deploying with GitHub Actions

Every push to `main` runs the tests, applies any new D1 migrations and deploys the Worker
(`.github/workflows/deploy.yml`). Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token from the **Edit Cloudflare Workers** template, with **Account → D1 → Edit** added |
| `CLOUDFLARE_ACCOUNT_ID` | Your account ID (shown on the Workers & Pages overview page) |
| `DASHBOARD_PASSWORD` | A long password for signing in |
| `STEPS_TOKEN` | Optional. An alternative to the dashboard's steps sync key |

Then run the workflow from the **Actions** tab (**Test and deploy → Run workflow**), or push a commit. The deploy log
prints your `https://gym-tracker.<subdomain>.workers.dev` URL.

Change `TIMEZONE` in `wrangler.jsonc` if you're not in the UK. It decides which day a late-evening set belongs to.

## Manual deploy

```sh
npm install
npx wrangler login
npm run db:migrate
npx wrangler secret put DASHBOARD_PASSWORD
npm run deploy
```

## Local development

```sh
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev          # http://localhost:8787
npm test             # unit tests
npm run typecheck
```

## Security notes

- Sessions are HMAC-signed cookies (`HttpOnly`, `Secure`, `SameSite=Strict`) that last a year and renew as you use
  the app, so each device signs in once. Changing `DASHBOARD_PASSWORD` signs out every session.
- The sign-in form doesn't limit repeated attempts, so use a long password.
- Only this Worker can reach D1; there's no public database endpoint.
