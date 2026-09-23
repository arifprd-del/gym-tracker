# Gym Tracker

Log workout sets by voice with Siri Shortcuts, then track your progress on a web dashboard.

```
iPhone / Apple Watch            Cloudflare Worker (Hono)              Cloudflare D1
"Hey Siri, log set"  ──POST──▶  /api/log      (Bearer token)  ──▶    sets table
Siri speaks the reply ◀──JSON─  { "say": "…New personal best!" }
                                /             dashboard (password) ◀─┘
```

## What it does

- **Voice logging:** log a set, repeat the last set, undo it, or hear today's summary. Siri reads back every
  answer, including when you set a new personal best.
- **Dashboard:** today's sets, a weekly volume chart, a training-days heatmap, a week streak, personal records with
  an estimated one-rep max, and recent sets with delete buttons. It supports light and dark mode and works on a phone.
- **CSV export** of every set.

## API

All endpoints need `Authorization: Bearer <API_TOKEN>` and return JSON with a `say` field for Siri to speak.

| Method | Path | Body | Does |
|---|---|---|---|
| POST | `/api/log` | `{ exercise, weight?, reps, rpe?, note? }` | Logs a set. `weight` is in kg and defaults to 0 (bodyweight). |
| POST | `/api/repeat` | `{ weight?, reps? }` | Logs the last set again, optionally with a new weight or rep count. |
| POST | `/api/undo` | none | Deletes the most recent set. |
| GET | `/api/today` | none | Summarises today's sets. |
| GET | `/api/exercises` | none | Lists exercise names, most recently used first, for the Shortcut's picker. |

The API accepts JSON or form bodies. Numbers can arrive as text, and a decimal comma (`82,5`) is understood.

## Setup

The D1 database `gym-tracker` already exists (see `wrangler.jsonc`), and the schema in `migrations/` has been applied.

```sh
npm install
npx wrangler login

# Record the migration as applied (it is idempotent, so this is safe)
npm run db:migrate

# Secrets
npx wrangler secret put API_TOKEN            # e.g. the output of: openssl rand -hex 32
npx wrangler secret put DASHBOARD_PASSWORD   # a long password for the dashboard

npm run deploy
```

Then open the URL that `deploy` prints, sign in, and build the Shortcuts described in
[docs/siri-shortcuts.md](docs/siri-shortcuts.md).

Change `TIMEZONE` in `wrangler.jsonc` if you're not in the UK. It decides which day a late-evening set belongs to.

## Local development

```sh
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev          # http://localhost:8787
npm test             # unit tests
npm run typecheck
```

Try it from the command line:

```sh
curl -X POST localhost:8787/api/log \
  -H "Authorization: Bearer change-me-to-a-long-random-string" \
  -H "Content-Type: application/json" \
  -d '{"exercise":"Bench press","weight":80,"reps":5}'
```

## Security notes

- Anyone with the API token can add or delete sets, so treat it like a password. To revoke it, set a new token with
  `wrangler secret put API_TOKEN`.
- Dashboard sessions are HMAC-signed cookies (`HttpOnly`, `Secure`, `SameSite=Strict`) that last 30 days. Changing
  `DASHBOARD_PASSWORD` signs out every session.
- Only this Worker can reach D1; there's no public database endpoint.
