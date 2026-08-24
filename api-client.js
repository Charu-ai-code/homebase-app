const API = {
  async json(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...opts.headers },
        ...opts,
      });
    } catch {
      throw new Error('Cannot reach the server. Open http://127.0.0.1:3000 (run npx vercel dev --yes) — not a file:// page.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },

  me() { return this.json('/api/auth/me'); },
  login(pin) { return this.json('/api/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }); },
  logout() { return this.json('/api/auth/logout', { method: 'POST' }); },
  bootstrap(params = {}) {
    const q = new URLSearchParams();
    if (params.offset != null) q.set('offset', String(params.offset));
    if (params.week) q.set('week', params.week);
    const qs = q.toString();
    return this.json('/api/bootstrap' + (qs ? '?' + qs : ''));
  },
  syncCalendar(body = {}) {
    return this.json('/api/calendar/sync', { method: 'POST', body: JSON.stringify(body) });
  },
  aiDashboard() { return this.json('/api/ai/dashboard', { method: 'POST' }); },
  aiSchedule() { return this.json('/api/ai/schedule', { method: 'POST' }); },
  aiScheduleConfirm() { return this.json('/api/ai/schedule-confirm', { method: 'POST' }); },
  aiMealplan(body = {}) {
    return this.json('/api/ai/mealplan', { method: 'POST', body: JSON.stringify(body) });
  },
  estimateRecipe(body) {
    return this.json('/api/ai/recipe-estimate', { method: 'POST', body: JSON.stringify(body) });
  },
  inventRecipes(body = {}) {
    return this.json('/api/ai/recipe-estimate', { method: 'POST', body: JSON.stringify({ invent: true, count: body.count || 3 }) });
  },
  addSlot(body) {
    return this.json('/api/household/slots', { method: 'POST', body: JSON.stringify(body) });
  },
  listRecipes() { return this.json('/api/household/recipes'); },
  getRecipe(id) { return this.json('/api/household/recipes?id=' + encodeURIComponent(id)); },
  addRecipe(body) { return this.json('/api/household/recipes', { method: 'POST', body: JSON.stringify(body) }); },
  importJson(body) { return this.json('/api/household/import-json', { method: 'POST', body: JSON.stringify(body) }); },
  importJsonSchema() { return this.json('/api/household/import-json'); },
  patchRecipe(body) { return this.json('/api/household/recipes', { method: 'PATCH', body: JSON.stringify(body) }); },
  deleteRecipe(id) {
    return this.json('/api/household/recipes', { method: 'DELETE', body: JSON.stringify({ id }) });
  },
  weather() { return this.json('/api/weather'); },
  spotifyNow() { return this.json('/api/spotify/now'); },
  spotifyToken() { return this.json('/api/spotify/token'); },
  spotifyPlay(body) {
    return this.json('/api/spotify/play', { method: 'POST', body: JSON.stringify(body) });
  },
  spotifyPlaylists() { return this.json('/api/spotify/playlists'); },
  spotifyControl(action) {
    return this.json('/api/spotify/control', { method: 'POST', body: JSON.stringify({ action }) });
  },
  patchTask(body) { return this.json('/api/household/tasks', { method: 'PATCH', body: JSON.stringify(body) }); },
  addTask(body) { return this.json('/api/household/tasks', { method: 'POST', body: JSON.stringify(body) }); },
  deleteTask(idOrBody) {
    const body = typeof idOrBody === 'string' ? { id: idOrBody } : idOrBody;
    return this.json('/api/household/tasks', { method: 'DELETE', body: JSON.stringify(body) });
  },
  patchShopping(body) { return this.json('/api/household/shopping', { method: 'PATCH', body: JSON.stringify(body) }); },
  addShopping(body) { return this.json('/api/household/shopping', { method: 'POST', body: JSON.stringify(body) }); },
  deleteShopping(body) {
    return this.json('/api/household/shopping', { method: 'DELETE', body: JSON.stringify(body) });
  },
  addPantry(body) { return this.json('/api/household/pantry', { method: 'POST', body: JSON.stringify(body) }); },
  patchPantry(body) { return this.json('/api/household/pantry', { method: 'PATCH', body: JSON.stringify(body) }); },
  deletePantry(body) {
    return this.json('/api/household/pantry', { method: 'DELETE', body: JSON.stringify(body) });
  },
  patchCalendar(body) { return this.json('/api/household/calendar', { method: 'PATCH', body: JSON.stringify(body) }); },
  addCalendarEvent(body) {
    return this.json('/api/household/calendar', { method: 'POST', body: JSON.stringify(body) });
  },
  deleteCalendarEvent(id) {
    return this.json('/api/household/calendar', { method: 'DELETE', body: JSON.stringify({ id }) });
  },
  calendarRange(from, to) {
    return this.json(`/api/household/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  },
  patchMeals(body) { return this.json('/api/household/meals', { method: 'PATCH', body: JSON.stringify(body) }); },
  copyWeekMeals(fromWeekStart) {
    return this.json('/api/household/meals-copy-week', {
      method: 'POST',
      body: JSON.stringify({ fromWeekStart }),
    });
  },
};

window.HomeBaseAPI = API;
