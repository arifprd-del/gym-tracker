# Using it on your iPhone

1. Open `https://gym-tracker.<you>.workers.dev/log` in **Safari** and sign in with your dashboard password.
2. Tap **Share → Add to Home Screen** and name it **Arif Gym**.
3. Open **Arif Gym** from your Home Screen and sign in once more. iOS keeps Home Screen apps separate from Safari. After that
   you stay signed in as long as you use it.

## Logging a set

1. Pick **Push**, **Pull** or **Legs**. It opens on the tab you used last.
2. Tap an exercise. Weight and reps fill in from your last set of it.
3. Adjust with **−/+** (2.5 kg or 1 rep per tap), or tap the number to type it.
4. Tap **Log set**. The date and time are saved automatically.

Mis-tapped? Tap **Undo** in the message that appears. The **Today** list at the bottom shows what you've done; tap a row
to do another set of that exercise.

## Cardio

Tap the **Cardio** tab. Treadmill is picked for you with last time's minutes and distance. Adjust the **minutes**
(5 per tap) and, if you like, the **km** (0.5 per tap; leave it at 0 to skip distance), then tap **Log cardio**. Use
**+ Add activity** for anything not listed.

## Weekly weigh-in

Tap **Weigh-in** at the top of the log screen (or scroll to **Body weight** on the dashboard), type your weight and tap
**Save today**. Once a week is enough; the dashboard reminds you until you've done it that week.

## Changing your exercises

Use **+ Add exercise** at the end of a tab to add one, or **Edit list** to remove one (your logged sets are kept). An
exercise's tab also sets its colour on the dashboard: blue for Push, orange for Pull, green for Legs.

## Optional: open it when you arrive at the gym

In the **Shortcuts** app, go to **Automation → + → Arrive**. Choose your gym, select **Run Immediately**, and add an
**Open URLs** action with your `/log` address.

## Nightly steps sync

Your iPhone sends each day's step total from the Health app to the dashboard's **Steps** card. A website can't read
Health data itself, so a Shortcuts automation does it every night.

### 1. Add the token (once)

In GitHub, open the repo's **Settings → Secrets and variables → Actions → New repository secret**. Name it
`STEPS_TOKEN` and paste a long random value, such as 30+ letters and numbers from a password generator. Then run
**Actions → Test and deploy → Run workflow**. Keep the value handy for step 2, but don't share it anywhere else.

### 2. Build the automation

In the **Shortcuts** app, go to **Automation → + → Time of Day**:

- **Time:** 23:45, **Repeat:** Daily
- Select **Run Immediately**, then **Next** and **New Blank Automation**

Add these actions:

| # | Action | Settings |
|---|---|---|
| 1 | **Find Health Samples** | Type **Steps**. Add the filter **Start Date is Today**. Set **Group By** to **Day**. |
| 2 | **Calculate Statistics** | **Sum** of *Health Samples* |
| 3 | **Get Contents of URL** | URL `https://gym-tracker.opinion-2nd.workers.dev/sync/steps`. Tap **Show More**: Method **POST**. Headers: `Authorization` = `Bearer ` followed by your token. Request Body **JSON**: add a **Number** field `steps` set to *Statistics Result*. |

Tap **Done**. To test it, open the automation and tap **▶︎**. Within a few seconds, the Steps card on the dashboard
shows today's count.

### Tips

- **Numbers higher than the Health app?** If you wear an Apple Watch, iPhone and Watch steps can be counted twice.
  **Group By Day** normally prevents this. If it still happens, add the filter **Source is** *your iPhone*.
- **A missed night:** Health data is locked while the phone is locked with a passcode, so a run can occasionally fail.
  Syncing again replaces that day's total, so the next run fixes today. For a missed earlier day, run the shortcut by
  hand with the Health filter set to that date and add a **Text** field `date` (`YYYY-MM-DD`) to the JSON. Up to 7 days
  back is accepted.
- **Goal line:** the dashed line is 8,000 steps a day. Change `STEPS_DAILY_GOAL` in `wrangler.jsonc` to move it.
