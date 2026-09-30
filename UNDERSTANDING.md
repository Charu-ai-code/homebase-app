# HomeBase — product understanding

A shared household dashboard for two people, Charu and Shreya. One week of life — today, meals, calendar, chores, and the shopping list — lives in one card and stays in sync across devices.

Production: https://homebase-app-pied.vercel.app  
Repo: https://github.com/Charu-ai-code/homebase-app

## What the app is for

HomeBase is a kitchen-and-desk app, not a generic productivity suite.

- **Today** is the landing surface after you leave the home stack: timeline, prep that needs attention, calories against each person’s target, and household tasks.
- **Plan** holds the week calendar (including Google Calendar for each person), the meal plan, and the recipe book.
- **List** is the week’s shopping list, built from the meal plan and editable by hand, plus a pantry of things already at home.
- **Home stack** is the splash shown after PIN login. It shows both people as characters and three cards: Today, Plan, List. Clicking the HOMEBASE mark returns there.

The visual language is a late-80s HyperCard stack: dithered desk, hard black borders, beveled buttons, and three typefaces (Silkscreen for display, IBM Plex Mono for labels, Source Sans 3 for body).

## Who uses it

Two household members exist as rows in `people`. Each has a name, color, calorie target, and a PIN. Login is PIN-only — there is no email or password. A signed session cookie (`homebase_session`, HMAC, about 30 days) identifies who is driving the app. Google Calendar and Spotify tokens are stored per person.

On the home splash, tapping the other person opens a PIN switch so the household can hand the tablet over. Avatars (cute presets or a photo) are stored in the browser’s `localStorage` under `homebase.avatars.v1`. They are not in the database, so they stay on that device.

## How a request moves

```
Browser (index.html + app.js)
    → HomeBaseAPI (api-client.js)
        → /api/*  rewritten by vercel.json to api/router.js
            → handler in api/_routes/*
                → Neon Postgres
```

There is no frontend build. `app.js` holds the whole UI: a `state` object, one `render()` that picks the screen, and one click listener that calls `actions[data-action]`. Screens are string templates written into `#view`.

`GET /api/bootstrap` returns almost everything the UI needs for the current week: people, meals, calendar events, tasks, shopping list, pantry, recipe count, and the session. Mutations go to the matching `/api/household/*` route, then the client reloads bootstrap (or patches local state) and re-renders.

All `/api/*` traffic is one Vercel function (`api/router.js`, 30s max). New endpoints are added to the `ROUTES` map there, not as separate files under `/api` at the URL level.

## Screens

| Entry | Where it goes | What it shows |
| --- | --- | --- |
| Home stack | After login, or clicking HOMEBASE | Both people, avatars, cards for Today / Plan / List |
| TODAY | Topbar or home card | Day timeline, prep banner, calories, tasks, shopping shortcut |
| PLAN → Calendar | Subnav | Week / day / month, Google connect + sync, household events |
| PLAN → Meal plan | Subnav | Week grid of slots, per-person calorie totals, day detail |
| PLAN → Recipes | Subnav | Recipe cards and a detail view, including source links and images |
| LIST | Topbar or home card | Shopping rows grouped by category, store, or recipe, plus pantry |

The topbar TODAY / PLAN / LIST buttons leave the home splash. They set `state.showHomeSplash = false` and then render that tab.

## Data the household shares

Postgres schema starts in `db/migrations/0001_init.sql` and grows through `0010`. Important tables:

- **people** — name, color, calorie target, PIN hash (`sha256(pin + PIN_SALT)`).
- **recipes / recipe_ingredients** — the book. Ingredients carry an aisle used when the shopping list is built. Recipes can keep a source URL, a frozen import snapshot, tags, and an image (later migration).
- **meal_plan_slots** — one row per date + slot (`drink`, `breakfast`, `shake`, `lunch`, `snack`, `dinner`, and later `dessert`). A slot points at a recipe or an ad-hoc name, plus kcal and protein. `log_status` records planned / eaten / skipped.
- **calendar_events** — timed events. `source` is `manual` or `google`. Sync never deletes manual events.
- **household_tasks** — shared chores with a person, due date, category tag, and done flag.
- **shopping_list_items** — the list for a specific week (`week_start`). Fields added over time: aisle, store, need-by, priority, `source` (`meal_plan` vs `manual`), and `manual_override`.
- **shopping_item_recipes** — which recipes contributed to a generated line.
- **pantry** — “already at home.” Those items are skipped when the list is rebuilt; marking one OUT moves it onto the list.
- **external_accounts** — Google and Spotify tokens, one row per person per provider.
- **ai_insight_cache** — cached DeepSeek/Kimi text so the same insight is not regenerated on every paint.

Migrations run in filename order via `npm run migrate` (`scripts/migrate.mjs`).

## Shopping list behavior

This is the most specialized piece of the app.

1. On bootstrap, `syncShoppingFromMeals` rebuilds the current week’s list from recipe ingredients on the meal plan.
2. Generated lines get a **need-by** date from the first day that meal appears, and **priority** (high when due today or tomorrow).
3. Checked items stay on the list (default filter is all) and sink to the bottom of their category with a strikethrough.
4. If someone edits a line, `manual_override` is set. Later syncs will not overwrite the name, quantity, aisle, store, or note. Schedule fields can still refresh unless the user overrode need-by or priority.
5. If a meal-plan item disappears from the week, a manually overridden row is kept and treated as a manual item instead of being deleted.
6. Custom categories live in the database so the aisle list is not fixed.
7. SHARE uses `navigator.share` when the browser has it, otherwise it copies the list text.

## Auth, calendar, music, AI

**PIN login.** `POST /api/auth/login` hashes the PIN, finds the person, and sets the session cookie. Almost every household route calls `requireAuth`.

**Google Calendar.** Each person connects while signed in as themselves (Plan → Calendar). OAuth stores tokens in `external_accounts`. Sync now pulls this week’s primary calendar into `calendar_events` with `source = 'google'`. Manual events stay.

**Spotify.** Optional dock in the corner (iPod-style). OAuth plus the Web Playback SDK. Requires a Premium account for playback in the browser. Playback state is not household data; the connection is per person.

**AI.** `api/_lib/ai.js` talks to DeepSeek, or Kimi if that is the configured key, through the OpenAI SDK. Endpoints:

- dashboard — a short “needs attention” note for today
- schedule / schedule-confirm — a weekly scheduling suggestion, then an explicit confirm
- mealplan — commentary on the week (it does not rewrite meals unless `apply` is requested)
- recipe-estimate — fills nutrition when creating or importing a recipe

Insights are cached. Task and meal writes invalidate the relevant cache so the next call can refresh.

## Local development and deploy

```bash
npm install
cp .env.example .env.local   # DATABASE_URL, SESSION_SECRET, PIN_SALT, APP_BASE_URL, AI keys
npm run migrate
npm run seed
npx vercel dev --yes --listen 3000
```

Open `http://127.0.0.1:3000`. The app must be served by Vercel dev; opening the HTML file directly cannot reach `/api`.

Production is a GitHub push to `main`. Vercel deploys from that push. Commits must use the GitHub noreply author email (`268030911+Charu-ai-code@users.noreply.github.com`). A local machine hostname as the git email has been rejected as a stale author. The CLI `vercel deploy` has also failed with “Not authorized” while the Git integration still worked — prefer `git push`.

After a schema change, run the new migration against the production Neon database separately. A Git push does not migrate the database.

Static assets are cache-busted with `?v=` query strings in `index.html`. Bump that string when `app.js` or `styles.css` changes so a kitchen tablet does not keep an old file.

## Files worth knowing

| File | Role |
| --- | --- |
| `index.html` | Shell, login overlay, modal, topbar, script tags |
| `app.js` | All screens, actions, and client state |
| `styles.css` | HyperCard design tokens and layout |
| `api-client.js` | `window.HomeBaseAPI` fetch wrapper |
| `spotify-player.js` | Browser Spotify player |
| `api/router.js` | Single entry for every `/api` path |
| `api/_lib/household.js` | Week loading and shopping sync |
| `api/_lib/auth.js` / `crypto.js` | Session cookie and PIN hash |
| `db/migrations/*.sql` | Schema, applied in order |
| `scripts/seed.mjs` + `seed-data.mjs` | First household data and PINs |

`data.js` is leftover from the original mock prototype. The live app does not load it.

`README.md` is the setup guide. `HANDOFF.md` is an older session snapshot (it still describes an earlier visual system and an incomplete file map). This file is the current picture of how the product behaves.
