# HomeBase — live household app

Shared calendar, meal plan, shopping list, and chores for Charu + Shreya.
Vanilla HTML/CSS/JS frontend, Vercel serverless API, Neon Postgres, DeepSeek AI (Kimi optional), Google Calendar.

## Stack

- **Frontend:** static HTML/CSS/JS (`index.html`, `app.js`)
- **API:** Vercel serverless functions in `/api`
- **Database:** Neon Postgres ([`db/migrations/0001_init.sql`](db/migrations/0001_init.sql))
- **AI:** DeepSeek (preferred) or Kimi via OpenAI-compatible API
- **Calendar:** Google Calendar OAuth (read-only, per person)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon pooled connection string |
| `SESSION_SECRET` | Yes | Random string for session cookies |
| `PIN_SALT` | Yes | Salt for PIN hashing |
| `CHARU_PIN` / `SHREYA_PIN` | Seed only | Default PINs for first seed |
| `DEEPSEEK_API_KEY` | Yes* | From [platform.deepseek.com](https://platform.deepseek.com) |
| `DEEPSEEK_MODEL` | No | Default `deepseek-chat` |
| `KIMI_API_KEY` | Alt | Used if DeepSeek key is unset |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For calendar | Google Cloud OAuth web client |
| `APP_BASE_URL` | Yes | `http://localhost:3000` locally, Vercel URL in prod |

### 3. Run database migration + seed

```bash
npm run migrate
npm run seed
```

Default PINs after seed: **Charu `1234`**, **Shreya `5678`** (override via env before seeding).

### 4. Run locally

```bash
npx vercel dev
# or: npm start
```

Open `http://localhost:3000`, enter your PIN.

## Deploy to Vercel

1. Push to GitHub and import in [vercel.com](https://vercel.com)
2. Framework preset: **Other**, build command empty
3. Add all env vars from `.env.example` in Project → Settings → Environment Variables
4. Set `APP_BASE_URL` to your production URL (e.g. `https://homebase.vercel.app`)
5. Add the production callback to Google OAuth:
   - `https://YOUR-DOMAIN/api/oauth/google/callback`

After deploy, run migrate + seed once against your Neon database (from your machine with `DATABASE_URL` set).

## Google Calendar

1. Each person logs in with their PIN
2. On **Plan → Calendar**, tap **Connect Charu** or **Connect Shreya**
3. Authorize Google (test users must be added while app is in Testing mode)
4. Tap **Sync Now** to pull this week's events into HomeBase

Manual HomeBase events (`source=manual`) are never deleted by sync.

## API routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/login` | POST | PIN login |
| `/api/auth/logout` | POST | Clear session |
| `/api/auth/me` | GET | Current user |
| `/api/bootstrap` | GET | Full household state |
| `/api/calendar/sync` | POST | Pull Google Calendar events |
| `/api/oauth/google/start` | GET | Start OAuth (must be logged in) |
| `/api/ai/dashboard` | POST | Today priority insight |
| `/api/ai/schedule` | POST | Weekly scheduling insight |
| `/api/ai/schedule-confirm` | POST | Confirm AI schedule |
| `/api/ai/mealplan` | POST | Meal plan commentary |
| `/api/household/tasks` | GET/POST/PATCH | Household tasks |
| `/api/household/shopping` | POST/PATCH | Shopping list |
| `/api/household/calendar` | PATCH | Event/prep toggles |
| `/api/household/recipes` | GET/POST | Recipe book list, detail (`?id=`), create |
| `/api/household/meals` | PATCH | Meal slot swaps / assign recipe |

## What's implemented

- PIN login (kitchen-tablet friendly)
- Live persistence for tasks, shopping, calendar events, meal slots
- Recipe book + recipe cards; assign recipes onto the meal plan
- Per-person Google Calendar connect + weekly sync
- DeepSeek/Kimi AI insights (dashboard, schedule, meal plan) with DB cache
- Original UI: Today, Calendar, Meal plan, Recipes, Shopping list

## Out of scope

Cook Mode, Spotify, Instacart, live WHOOP API, writing events back to Google Calendar.
