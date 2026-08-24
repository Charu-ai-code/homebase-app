import bootstrap from './_routes/bootstrap.js';
import weather from './_routes/weather.js';
import login from './_routes/auth/login.js';
import logout from './_routes/auth/logout.js';
import me from './_routes/auth/me.js';
import calendarSync from './_routes/calendar/sync.js';
import aiDashboard from './_routes/ai/dashboard.js';
import aiMealplan from './_routes/ai/mealplan.js';
import aiRecipeEstimate from './_routes/ai/recipe-estimate.js';
import aiSchedule from './_routes/ai/schedule.js';
import aiScheduleConfirm from './_routes/ai/schedule-confirm.js';
import householdCalendar from './_routes/household/calendar.js';
import householdImportJson from './_routes/household/import-json.js';
import householdMealsCopyWeek from './_routes/household/meals-copy-week.js';
import householdMeals from './_routes/household/meals.js';
import householdRecipes from './_routes/household/recipes.js';
import householdShopping from './_routes/household/shopping.js';
import householdSlots from './_routes/household/slots.js';
import householdTasks from './_routes/household/tasks.js';
import googleOAuthStart from './_routes/oauth/google/start.js';
import googleOAuthCallback from './_routes/oauth/google/callback.js';
import spotifyOAuthStart from './_routes/oauth/spotify/start.js';
import spotifyOAuthCallback from './_routes/oauth/spotify/callback.js';
import spotifyControl from './_routes/spotify/control.js';
import spotifyNow from './_routes/spotify/now.js';
import spotifyPlay from './_routes/spotify/play.js';
import spotifyPlaylists from './_routes/spotify/playlists.js';
import spotifyToken from './_routes/spotify/token.js';

const ROUTES = {
  bootstrap,
  weather,
  'auth/login': login,
  'auth/logout': logout,
  'auth/me': me,
  'calendar/sync': calendarSync,
  'ai/dashboard': aiDashboard,
  'ai/mealplan': aiMealplan,
  'ai/recipe-estimate': aiRecipeEstimate,
  'ai/schedule': aiSchedule,
  'ai/schedule-confirm': aiScheduleConfirm,
  'household/calendar': householdCalendar,
  'household/import-json': householdImportJson,
  'household/meals-copy-week': householdMealsCopyWeek,
  'household/meals': householdMeals,
  'household/recipes': householdRecipes,
  'household/shopping': householdShopping,
  'household/slots': householdSlots,
  'household/tasks': householdTasks,
  'oauth/google/start': googleOAuthStart,
  'oauth/google/callback': googleOAuthCallback,
  'oauth/spotify/start': spotifyOAuthStart,
  'oauth/spotify/callback': spotifyOAuthCallback,
  'spotify/control': spotifyControl,
  'spotify/now': spotifyNow,
  'spotify/play': spotifyPlay,
  'spotify/playlists': spotifyPlaylists,
  'spotify/token': spotifyToken,
};

export default async function handler(req, res) {
  const segments = req.query.path;
  const path = Array.isArray(segments) ? segments.join('/') : (segments || '');
  const fn = ROUTES[path];
  if (!fn) {
    res.status(404).json({ error: 'Not found', path });
    return;
  }
  return fn(req, res);
}
