# Arif Gym Tracker

Log workout sets on a touch screen built for the gym floor, then track your progress on a web dashboard.

```
iPhone (Home Screen app)            Cloudflare Worker (Hono)                 Cloudflare D1
/log   tap exercise, Log set  ──▶  /api/log   (signed-in session)  ──▶     sets, exercises
/      dashboard              ◀──  charts, records, recent sets    ◀──┘
```

## What it does

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
  - *This week* checklist: Push, Pull, Legs, the cardio goal (`CARDIO_WEEKLY_MINUTES` in `wrangler.jsonc`, default 90)
    and a weigh-in, with a progress bar and a "Week complete" state.
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
- **CSV export** of every set.

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

- Sessions are HMAC-signed cookies (`HttpOnly`, `Secure`, `SameSite=Strict`) that last 30 days and renew as you use
  the app. Changing `DASHBOARD_PASSWORD` signs out every session.
- The sign-in form doesn't limit repeated attempts, so use a long password.
- Only this Worker can reach D1; there's no public database endpoint.
