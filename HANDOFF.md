# HomeBase — project handoff

Status snapshot as of this session, written for whoever (human or Cursor) picks
this up next. Covers what exists, what actually works vs. is unverified, and
what's deliberately not built yet.

## 1. What this project is

A household dashboard for two people (Charu, Shreya): a shared "Today" view,
a calendar + household tasks, a calorie-tracked meal plan, and a shopping list.
Visual language is a flat, high-contrast "modernist" system — Archivo font,
hard 2px black borders, no border-radius, red accent `#ec3013` — defined once
in `styles.css` as reusable utility classes (`.k`, `.h1`–`.h3`, `.tg`/`.tgr`
pill buttons, `.btn`/`.btnr`/`.btnd`, `.chip` person-color dots). Every screen
reuses these; don't introduce a second styling convention.

## 2. History — why the architecture is what it is

1. Started as a static, single-device, **mock-data-only** click-through
  prototype (`data.js` held fake in-memory state that reset on reload).
2. Requirements grew: real shared/live data between two people's own devices,
  a real database, real Recipes, and real external integrations (Google
   Calendar, Spotify — user has Premium — plus "make it smart" AI).
3. **neon**
4. **Final stack, now implemented:** vanilla HTML/CSS/JS frontend (no
  bundler, no build step) + **Neon** (serverless Postgres, free, no card,  auto-wakes on query — no manual resume like neon) + **Vercel**  serverless functions under `/api` (free, no card, works with a plain  static site) for all backend logic. Auth is a small custom PIN login  instead of magic-link email. Google Calendar is connected per-person via  OAuth. For the "make it smart" AI layer, **kimi** was chosen as the  primary provider (cheap/free-credit API, OpenAI-SDK-compatible), with  **Kimi** wired as an automatic F
5. Recipes and Spotify were explicitly pushed out of this pass
  to ship the core live/shared experience first (see §5). WHOOP has since
  been removed from the product.



## 3. Current file map

```
index.html          App shell + PIN login overlay markup
styles.css           All styling (utility-class design system)
app.js               Render/action SPA — state object, per-screen render
                      functions, one delegated data-action click handler
api-client.js         Thin fetch wrapper (window.HomeBaseAPI) used by app.js
data.js               LEGACY — no longer imported by index.html/app.js.
                      Superseded by scripts/seed-data.mjs. Safe to delete
                      once you've confirmed the live DB is correctly seeded.

db/migrations/0001_init.sql   Full Postgres schema (plain SQL, no Supabase-
                      specific RLS/auth — Neon has no built-in auth layer,
                      so every /api handler checks the session itself)

api/_lib/db.js         Neon client (@neondatabase/serverless)
api/_lib/crypto.js     PIN hashing (sha256+salt), session HMAC, random state
api/_lib/auth.js       Session cookie set/verify/clear, requireAuth() guard
api/_lib/response.js   json()/readJson()/redirect()/cookie helpers
api/_lib/google.js     OAuth client, token exchange/refresh, calendar fetch
api/_lib/household.js  Shared data-loading/shaping (week ranges, day keys,
                      slot keys) used across bootstrap + AI endpoints
api/_lib/ai.js         Kimi client resolution + chat() + insight
                      cache get/set/invalidate (backed by ai_insight_cache)

api/auth/login.js, logout.js, me.js       PIN login / logout / current user
api/bootstrap.js       Single endpoint returning the full household state
                      the frontend needs on load (replaces data.js's consts)
api/oauth/google/start.js, callback.js    Per-person Google OAuth flow
api/calendar/sync.js   Pulls the current week's primary-calendar events into
                      calendar_events (source='google'); manual events
                      (source='manual') are never overwritten
api/ai/dashboard.js    AI priority-banner insight
api/ai/schedule.js, schedule-confirm.js   AI scheduling suggestion + confirm
api/ai/mealplan.js     AI meal-plan commentary
api/household/tasks.js, shopping.js, calendar.js, meals.js
                      CRUD/PATCH for the four shared tables; tasks.js and
                      meals.js also call invalidateCache() so AI insights
                      regenerate after a relevant change instead of going stale

scripts/migrate.mjs    Runs db/migrations/0001_init.sql against DATABASE_URL
scripts/seed-data.mjs  Hand-transcribed copy of the old data.js mock week,
                      exported as SEED_DATA (recipes, meal slots, calendar
                      events, tasks, shopping items, PINs)
scripts/seed.mjs       Inserts SEED_DATA into Neon; hashes CHARU_PIN/SHREYA_PIN

package.json, vercel.json, .env.example, .gitignore, README.md   Project/deploy config
.vercel/project.json   Local machine is linked to Vercel project
                      "homebase-app" (prj_4wrGEAkF94gVQJHfANvpdhbhePHU) —
                      note this is a local link only (see §6).
```



## 4. Environment variables

Defined in `.env.example`; a filled-in `.env.local` already exists on this
machine (git-ignored, not committed) with real values for: `DATABASE_URL`,
`SESSION_SECRET`, `PIN_SALT`, `CHARU_PIN`, `SHREYA_PIN`, `KIMI_API_KEY`,
`KIMI_MODEL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_BASE_URL`.

**Flag for whoever continues this:** `.env.local` has a Kimi key but **no**
`DEEPSEEK_API_KEY`. `api/_lib/ai.js` resolves DeepSeek first and falls back
to Kimi automatically, so the app currently runs on **Kimi**, not DeepSeek,
even though the README/plan describe DeepSeek as "preferred." Confirm that's
intentional, or add a DeepSeek key if not.

These same variables need to be added in the Vercel project's Environment
Variables settings before/at deploy time — they exist locally but that does
not automatically populate Vercel.

## 5. What's implemented (verified by reading the code, not by running it live)

- PIN login → signed httpOnly session cookie → `requireAuth()` gate on every
API handler.
- `/api/bootstrap` aggregates people, calendar events, tasks, shopping list,
meal plan, cached AI insights, and Google-connection status in one call —
this is what the frontend loads on boot instead of reading `data.js`.
- Household CRUD for tasks / shopping / calendar / meal-plan slots, called
from `app.js` actions via `api-client.js`, matching the original prototype's
"optimistic local update, then persist, revert on failure" pattern.
- Google Calendar OAuth per person (`/api/oauth/google/start` +
`/callback`), tokens stored in `external_accounts`, `/api/calendar/sync`
pulling the current week's primary-calendar events in as `source='google'`
rows, merged alongside manual events.
- AI insights (dashboard priority line, scheduling suggestion + confirm,
meal-plan commentary) via DeepSeek/Kimi, cached in `ai_insight_cache` and
invalidated when the underlying tasks/meals change — replacing every
static "AI" string from the original mock prototype.
- `data.js` is fully decoupled from the running app (confirmed via grep —
nothing in `index.html`/`app.js` references it anymore).



## 6. Not done yet / open questions

**Explicitly deferred (per the working plan, schema already supports these):**

- Spotify integration (now-playing dock / playback control) — not started;
`external_accounts.provider` already allows `'spotify'` in the schema.
- Writing events back to Google Calendar (read-only sync only), multi-
calendar selection (primary calendar only per person).

WHOOP was removed from the product (UI, bootstrap, AI context, and seed).
The `whoop_manual_entries` table may still exist in older DBs but is unused.

**Done in a later pass (recipes + meal plan + weather + spotify):**

- Recipe Book + Recipe Card under Plan → RECIPES (`/api/household/recipes`).
- Meal plan week navigation + auto-jump to latest seeded week when the
current week is empty.
- Assign recipe → any meal slot (breakfast/lunch/dinner/etc) via day view
or recipe card; modal add/edit (browser prompts were unreliable).
- Weather via Open-Meteo (`/api/weather`).
- Spotify OAuth + now-playing dock (`/api/oauth/spotify/*`, `/api/spotify/now`).
  Needs `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in env.
- Seed ships 14 recipes across breakfast/lunch/dinner/side.

**Unverified — should be checked before considering this "done":**

- No git commits exist yet (`git log` on `main` shows none), so nothing has
been pushed to GitHub. `.vercel/project.json` shows this machine is linked
to a Vercel project, but whether anything has actually been deployed
(via `vercel deploy` CLI directly, vs. git-integration) is unconfirmed.
- Whether `npm run migrate` and `npm run seed` have actually been run
against the live Neon database — i.e. whether the schema and seed rows
really exist in Neon right now, or only in the SQL/scripts on disk. This
session did not run them (no dev server or DB connection was exercised).
- No end-to-end run of the app (login → bootstrap → calendar sync → AI
insight) has been done in this session — everything above was confirmed
by reading the code, not by clicking through it.
- No automated tests exist anywhere in the project.



## 7. Suggested next steps

1. Confirm `.env.local` values are also set in Vercel's project settings.
2. Run `npm run migrate` then `npm run seed` against the real `DATABASE_URL`
  if not already done; spot-check a few tables in Neon's SQL editor.
3. `npm start` (or `npx vercel dev`) locally, log in as both Charu and
  Shreya (PINs from `.env.local`/seed), click through Today / Plan /
   List, confirm data persists across a reload and both PIN logins see the
   same shared state.
4. Connect Google Calendar for both people and hit "Sync Now"; remember
  Testing-mode Google OAuth refresh tokens expire after ~7 days, so
   periodic reconnects are expected, not a bug.
5. Decide the DeepSeek-vs-Kimi question from §4, then sanity-check a couple
  of `/api/ai/*` responses for tone/accuracy.
6. Commit the working tree, push to GitHub, connect that repo to the Vercel
  project for real continuous deployment (current link is local-only).
7. Once the above is solid, pick up the deferred work in §6 — Recipes is
  the biggest piece and the schema is already there for it.
8. Consider deleting `data.js` (or moving it to a `legacy/` folder) now that
  `scripts/seed-data.mjs` is the real source of seed data — keeping both
   around risks someone editing the wrong one later.

