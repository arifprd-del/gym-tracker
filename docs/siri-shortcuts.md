# Siri Shortcuts setup

Build these in the **Shortcuts** app on your iPhone. The name of each shortcut is the phrase you say to Siri. They also
run on an Apple Watch paired with the phone.

Everywhere below:

- `https://gym-tracker.<you>.workers.dev` is the URL `npm run deploy` printed. Replace it with your own.
- `YOUR_API_TOKEN` is the value you set with `npx wrangler secret put API_TOKEN`.

Every API response is JSON with a `say` field, which is a sentence ready for Siri to read out.

## 1. "Log set": the main one

| # | Action | Settings |
|---|--------|----------|
| 1 | **Get Contents of URL** | URL `https://gym-tracker.<you>.workers.dev/api/exercises`<br>Method **GET**<br>Headers: `Authorization` = `Bearer YOUR_API_TOKEN` |
| 2 | **Get Dictionary Value** | Get **Value** for key `exercises` in *Contents of URL* |
| 3 | **Choose from List** | List: *Dictionary Value*. Prompt "Which exercise?". Leave **Select Multiple** off. |
| 4 | **Ask for Input** | Type **Number**. Prompt "Weight in kilos? Say zero for bodyweight." Allow decimal numbers. |
| 5 | **Ask for Input** | Type **Number**. Prompt "How many reps?" |
| 6 | **Get Contents of URL** | URL `https://gym-tracker.<you>.workers.dev/api/log`<br>Method **POST**<br>Headers: `Authorization` = `Bearer YOUR_API_TOKEN`<br>Request Body **JSON**:<br>`exercise` (Text) = *Chosen Item*<br>`weight` (Number) = *Provided Input* from step 4<br>`reps` (Number) = *Provided Input* from step 5 |
| 7 | **Get Dictionary Value** | Get **Value** for key `say` in *Contents of URL* |
| 8 | **Speak Text** | *Dictionary Value* |

Say **"Hey Siri, log set"**, answer the three questions, and Siri replies with something like
*"Bench Press, 80 kilos for 5. Set 3 logged. New personal best!"*

**The first time:** the exercise list is empty until you've logged something. For the first set of each new exercise,
replace steps 1–3 with **Ask for Input** (Text, "Which exercise?"). Alternatively, add a **List** action with your usual
exercises and use it in step 3. Names are matched without case, so "bench press" and "Bench Press" count as the same exercise.

Optional extras for the step 6 JSON body: `rpe` (Number, 1–10) and `note` (Text).

## 2. "Same again": repeat the last set

| # | Action | Settings |
|---|--------|----------|
| 1 | **Get Contents of URL** | URL `…/api/repeat`, Method **POST**, the same `Authorization` header, Request Body **JSON** with no fields |
| 2 | **Get Dictionary Value** | key `say` |
| 3 | **Speak Text** | *Dictionary Value* |

To change the numbers ("same but 6 reps"), add an **Ask for Input** first and send `reps` (or `weight`) in the JSON
body. Any field you leave out is copied from the last set.

## 3. "Undo set": remove the last set, for when Siri mishears

Same as "Same again", but the URL is `…/api/undo`. Siri replies *"Removed Squat, 100 kilos for 5."*

## 4. "How's my workout": today's summary

| # | Action | Settings |
|---|--------|----------|
| 1 | **Get Contents of URL** | URL `…/api/today`, Method **GET**, the same `Authorization` header |
| 2 | **Get Dictionary Value** | key `say` |
| 3 | **Speak Text** | *Dictionary Value* |

Siri replies with something like *"6 sets today, 2178 kilos of volume. Squat: 2 sets, top 105 kilos. Pull Up: 1 set."*

## Tips

- **Apple Watch:** open each shortcut's details (ⓘ) and turn on **Show on Apple Watch**.
- **Back Tap:** on iPhone, go to Settings → Accessibility → Touch → Back Tap → Double Tap → *Same again*. This logs a
  repeat set without speaking.
- **Apple Health:** add a **Log Workout** action to the end of a "Finish workout" shortcut if you also want the session
  recorded in Health.
- **Keep the token private.** Don't share these shortcuts, because the token is stored inside them. If it leaks, run
  `npx wrangler secret put API_TOKEN` with a new value and update the shortcuts.
