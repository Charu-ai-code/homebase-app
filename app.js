// HomeBase — live app wired to Vercel /api + Neon + DeepSeek/Kimi + Google Calendar.

const DEFAULT_SLOT_KEYS = ['drink', 'breakfast', 'shake', 'lunch', 'snack', 'dinner', 'dessert'];
const DEFAULT_SLOT_LABELS = {
  drink: 'MORNING DRINK', breakfast: 'BREAKFAST', shake: 'SHAKE', lunch: 'LUNCH',
  snack: 'SNACK', dinner: 'DINNER', dessert: 'DESSERT',
};
let SLOT_KEYS = [...DEFAULT_SLOT_KEYS];
let SLOT_LABELS = { ...DEFAULT_SLOT_LABELS };
const SWAPPABLE = new Set(['shake', 'snack']);
const SWAP_ALT = {
  shake: { name: 'Paneer bhurji, small', kcal: 260, protein: 28 },
  snack: { name: 'Greek yogurt + honey', kcal: 150, protein: 12 },
};

let PEOPLE = {};
let PROTEIN_FLOOR = 110;
let TODAY_INDEX = 0;
let WEEK = [];
let HOUSEHOLD_TASKS = [];
let TASK_TAGS = ['cleaning', 'laundry', 'bills', 'car', 'errands'];
let SHOP_CATEGORIES = ['Produce', 'Meat + dairy', 'Pantry', 'Frozen', 'Bakery', 'Spices', 'Other'];
let SHOPPING_LIST = [];
let ALREADY_AT_HOME = [];
let ONION_BREAKDOWN = [];
let SKIP_DINNER_MESSAGES = [];
let ITEM_RECIPES = {};
let RECIPES = [];
let googleConnections = {};
let aiInsights = {};
let session = null;
let weekLabel = '';
let weekOffset = 0;
let weekStart = null; // YYYY-MM-DD Monday of viewed week — source of truth for PREV/NEXT
let recipeCount = 0;
let shoppingUnchecked = 0;
let filledSlots = 0;
let isLoading = true;

const state = {
  tab: 'today',
  planSub: 'meals',
  selectedDayKey: null,
  dayDetailPerson: 'charu',
  taskFilter: 'all',
  calendarAiConfirmed: false,
  showOtherWindows: false,
  mealMode: 'all',
  listGroupBy: 'aisle',
  listFilter: 'all',
  listSort: 'due',
  selectedItemId: null,
  slotSwaps: new Set(),
  prepDone: false,
  selectedRecipeId: null,
  assignRecipeDay: null,
  assignSlot: 'dinner',
  recipeFilter: 'all',
  spotify: null,
  ipodMinimized: false,
  ipodView: 'now', // now | menu | playlists
  spotifyPlaylists: [],
  spotifyVolume: 0.85,
  calendarMode: 'week', // week | day | month
  calendarDayKey: null,
  monthCursor: null, // YYYY-MM-01
  monthEventsByDate: {},
};

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function findDay(key) { return WEEK.find((d) => d.key === key); }
function personName(key) { return key === 'shared' ? 'Both' : PEOPLE[key].name; }
function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

function getEffectiveSlot(day, slot) {
  const empty = { name: '—', kcal: 0, protein: 0, recipeId: null, status: 'planned' };
  const swapped = state.slotSwaps.has(day.key + ':' + slot);
  if (swapped && SWAP_ALT[slot]) return { ...empty, ...SWAP_ALT[slot], status: day.meals?.[slot]?.status || 'planned' };
  return day.meals?.[slot] || empty;
}

function effectiveDayTotals(day) {
  let kcal = 0, protein = 0;
  let plannedKcal = 0, plannedProtein = 0;
  let eaten = 0, skipped = 0, pending = 0;
  SLOT_KEYS.forEach((s) => {
    const v = getEffectiveSlot(day, s);
    if (!v?.name || v.name === '—') return;
    const k = Number(v.kcal) || 0;
    const p = Number(v.protein) || 0;
    plannedKcal += k;
    plannedProtein += p;
    if (v.status === 'skipped') {
      skipped += 1;
      return;
    }
    if (v.status === 'eaten') eaten += 1;
    else pending += 1;
    kcal += k;
    protein += p;
  });
  return { kcal, protein, plannedKcal, plannedProtein, eaten, skipped, pending };
}

function shiftDateStr(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

let toastTimer = null;
function toast(msg) {
  clearTimeout(toastTimer);
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.hidden = true;
}

function openModal({ title, fieldsHtml, submitLabel = 'SAVE', onSubmit }) {
  const overlay = document.getElementById('modalOverlay');
  const card = document.getElementById('modalCard');
  if (!overlay || !card) {
    toast('Modal unavailable');
    return;
  }
  card.innerHTML = `
    <div class="modal-title">${escapeHtml(title)}</div>
    <form id="modalForm">
      ${fieldsHtml}
      <div class="modal-actions">
        <button type="button" class="btn" id="modalCancel">CANCEL</button>
        <button type="submit" class="btn btnr">${escapeHtml(submitLabel)}</button>
      </div>
    </form>`;
  overlay.hidden = false;
  document.getElementById('modalCancel').onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  document.getElementById('modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const values = Object.fromEntries(fd.entries());
    try {
      await onSubmit(values, e.target);
      closeModal();
    } catch (err) {
      toast(err.message || 'Could not save');
    }
  };
  const first = card.querySelector('input, select, textarea');
  if (first) setTimeout(() => first.focus(), 50);
}

function openRecipePicker({ title, onPick }) {
  if (!RECIPES.length) {
    toast('No recipes yet — add one in the Recipe book first.');
    return;
  }
  const overlay = document.getElementById('modalOverlay');
  const card = document.getElementById('modalCard');
  card.innerHTML = `
    <div class="modal-title">${escapeHtml(title)}</div>
    <div class="m" style="margin-top:8px">Or type a quick name below</div>
    <form id="modalForm">
      <label><span class="k">AD HOC NAME</span>
        <input name="adhocName" placeholder="e.g. Leftover rajma">
      </label>
      <label><span class="k">KCAL</span><input name="kcal" type="number" value="300"></label>
      <label><span class="k">PROTEIN (G)</span><input name="protein" type="number" value="15"></label>
      <div class="k" style="margin-top:16px">FROM RECIPE BOOK</div>
      <div class="recipe-picker">
        ${RECIPES.map((r) => `
          <div class="recipe-picker-row" data-pick-recipe="${r.id}">
            <span class="h3" style="font-size:14px">${escapeHtml(r.name)}</span>
            <span class="m">${r.kcal || '—'} kcal · ${(r.tags || []).join(', ') || 'any'}</span>
          </div>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="modalCancel">CANCEL</button>
        <button type="submit" class="btn btnr">USE AD HOC</button>
      </div>
    </form>`;
  overlay.hidden = false;
  document.getElementById('modalCancel').onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  card.querySelectorAll('[data-pick-recipe]').forEach((row) => {
    row.onclick = async () => {
      try {
        await onPick({ recipeId: row.dataset.pickRecipe });
        closeModal();
      } catch (err) {
        toast(err.message || 'Could not assign');
      }
    };
  });
  document.getElementById('modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const adhocName = String(fd.get('adhocName') || '').trim();
    if (!adhocName) {
      toast('Pick a recipe or enter a name');
      return;
    }
    try {
      await onPick({
        adhocName,
        kcal: Number(fd.get('kcal')) || 0,
        protein: Number(fd.get('protein')) || 0,
      });
      closeModal();
    } catch (err) {
      toast(err.message || 'Could not save');
    }
  };
}

// ---------------------------------------------------------------- top nav

function renderChrome() {
  document.querySelectorAll('#mainNav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === state.tab);
  });
  const subnav = document.getElementById('subnav');
  if (state.tab === 'plan') {
    subnav.hidden = false;
    subnav.innerHTML = `
      <span class="tg ${state.planSub === 'calendar' ? 'tgr' : ''}" data-action="setPlanSub" data-value="calendar">CALENDAR</span>
      <span class="tg ${state.planSub === 'meals' ? 'tgr' : ''}" data-action="setPlanSub" data-value="meals">MEAL PLAN</span>
      <span class="tg ${state.planSub === 'recipes' ? 'tgr' : ''}" data-action="setPlanSub" data-value="recipes">RECIPES</span>
    `;
  } else {
    subnav.hidden = true;
    subnav.innerHTML = '';
  }
  renderSpotifyIpod();
}

function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function applyWebPlayerNow(now) {
  if (!now) return;
  state.spotify = { ...(state.spotify || {}), now: { ...(state.spotify?.now || {}), ...now } };
  renderSpotifyIpod();
}

async function ensureSpotifyWebPlayer() {
  if (!window.SpotifyWeb || !session) return false;
  try {
    await SpotifyWeb.activate(applyWebPlayerNow);
    return true;
  } catch (err) {
    console.warn('Spotify web player:', err.message);
    applyWebPlayerNow({
      connected: true,
      webPlayer: true,
      playing: false,
      title: 'Player error',
      artist: err.message || 'Could not start browser player',
      message: 'Try MENU → Reconnect Spotify',
    });
    return false;
  }
}

function renderSpotifyIpod() {
  const dock = document.getElementById('ipodDock');
  if (!dock) return;
  if (!session) {
    dock.hidden = true;
    return;
  }
  dock.hidden = false;

  const now = state.spotify?.now || { connected: false };
  const webReady = window.SpotifyWeb?.isReady?.();
  const needsReconnect = !!state.spotify?.needsReconnect;
  const canControl = (now.connected || webReady) && !needsReconnect;
  const mini = state.ipodMinimized;
  const view = state.ipodView || 'now';
  const progress = now.durationMs && now.progressMs != null
    ? Math.min(100, (now.progressMs / now.durationMs) * 100)
    : 0;

  if (mini) {
    dock.innerHTML = `
      <button type="button" class="ipod-mini" data-action="toggleIpod" title="Open iPod">
        ${now.albumArt
          ? `<img src="${escapeHtml(now.albumArt)}" alt="">`
          : '<span class="ipod-mini-icon">♫</span>'}
        ${now.playing ? '<span class="ipod-mini-dot"></span>' : ''}
      </button>`;
    return;
  }

  dock.innerHTML = `
    <div class="ipod ${now.playing ? 'playing' : ''}">
      <button type="button" class="ipod-minimize" data-action="toggleIpod" aria-label="Minimize">−</button>
      <div class="ipod-screen">
        ${view === 'menu' ? `
          <div class="ipod-menu">
            <div class="ipod-menu-title">MENU</div>
            ${needsReconnect ? `
              <div class="ipod-reconnect">Reconnect required for playlists + browser play</div>
              <button type="button" class="ipod-menu-item" data-action="connectSpotify">⟳ Reconnect Spotify</button>
            ` : `
              <button type="button" class="ipod-menu-item" data-action="openPlaylists">▶ Playlists</button>
            `}
            <button type="button" class="ipod-menu-item" data-action="refreshSpotify">↻ Refresh player</button>
            ${!needsReconnect ? `<button type="button" class="ipod-menu-item" data-action="connectSpotify">⟳ Reconnect Spotify</button>` : ''}
            ${canControl ? `
              <label class="ipod-vol">
                <span class="k" style="color:#9ca3af">VOLUME</span>
                <input type="range" min="0" max="100" value="${Math.round((state.spotifyVolume ?? 0.85) * 100)}" data-action="spotifyVolume">
              </label>
            ` : ''}
            <button type="button" class="ipod-menu-item" data-action="ipodBack">← Now playing</button>
          </div>
        ` : view === 'playlists' ? `
          <div class="ipod-menu ipod-playlists">
            <div class="ipod-menu-title">PLAYLISTS</div>
            <div class="ipod-playlist-list">
              ${state.spotifyPlaylists.length
                ? state.spotifyPlaylists.map((p) => `
                  <button type="button" class="ipod-playlist-row" data-action="playSpotifyPlaylist" data-uri="${escapeHtml(p.uri)}" data-name="${escapeHtml(p.name)}">
                    ${p.image ? `<img src="${escapeHtml(p.image)}" alt="">` : '<span class="ipod-pl-icon">♫</span>'}
                    <span class="ipod-pl-meta">
                      <span class="ipod-pl-name">${escapeHtml(p.name)}</span>
                      <span class="ipod-pl-sub">${p.tracks} tracks${p.owner ? ' · ' + escapeHtml(p.owner) : ''}</span>
                    </span>
                  </button>
                `).join('')
                : '<div class="ipod-pl-empty">Loading…</div>'}
            </div>
            <button type="button" class="ipod-menu-item" data-action="ipodBack">← Back</button>
          </div>
        ` : `
          <div class="ipod-now">
            <div class="ipod-art">
              ${now.albumArt
                ? `<img src="${escapeHtml(now.albumArt)}" alt="">`
                : '<div class="ipod-art-empty">♫</div>'}
            </div>
            <div class="ipod-meta">
              <div class="ipod-title">${escapeHtml(now.title || (now.connected ? 'HomeBase iPod' : 'Not connected'))}</div>
              <div class="ipod-artist">${escapeHtml(
                needsReconnect
                  ? 'Reconnect Spotify (MENU) for playlists + browser play'
                  : (now.artist || now.message || (canControl ? 'MENU → Playlists' : 'Connect Spotify Premium'))
              )}</div>
            </div>
            ${now.durationMs ? `
              <div class="ipod-scrub">
                <div class="ipod-scrub-fill" style="width:${progress}%"></div>
              </div>
              <div class="ipod-times">
                <span>${formatMs(now.progressMs)}</span>
                <span>${formatMs(now.durationMs)}</span>
              </div>
            ` : ''}
            <div class="ipod-status">${needsReconnect
              ? '⟳ RECONNECT IN MENU'
              : now.playing
              ? (now.webPlayer ? '▶ BROWSER → SPEAKERS' : '▶ NOW PLAYING')
              : canControl ? (webReady ? '⏸ MENU → pick playlist' : '… starting player') : '○ OFFLINE'}</div>
          </div>
        `}
      </div>
      <div class="ipod-wheel-wrap">
        <div class="ipod-wheel">
          <button type="button" class="ipod-wheel-btn ipod-wheel-menu" data-action="toggleIpodMenu">MENU</button>
          <button type="button" class="ipod-wheel-btn ipod-wheel-prev" data-action="spotifyPrev" ${!canControl ? 'disabled' : ''}>⏮</button>
          <button type="button" class="ipod-wheel-btn ipod-wheel-next" data-action="spotifyNext" ${!canControl ? 'disabled' : ''}>⏭</button>
          <button type="button" class="ipod-wheel-btn ipod-wheel-play" data-action="spotifyPlayPause" ${!canControl ? 'disabled' : ''}>${now.playing ? '⏸' : '▶'}</button>
          <button type="button" class="ipod-wheel-center" data-action="${canControl ? 'spotifyPlayPause' : 'connectSpotify'}" aria-label="${canControl ? 'Play' : 'Connect'}"></button>
        </div>
        ${!canControl ? `
          <button type="button" class="ipod-connect" data-action="connectSpotify">${needsReconnect && now.connected ? 'RECONNECT SPOTIFY' : 'CONNECT SPOTIFY'}</button>
          <div class="ipod-hint">${needsReconnect && now.connected ? 'Approve all permissions on the Spotify screen' : 'Premium · plays in browser → your speakers'}</div>
        ` : ''}
      </div>
    </div>`;
}

function tickClock() {
  const el = document.getElementById('clockTime');
  const dateEl = document.getElementById('clockDate');
  if (!el) return;
  const now = new Date();
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  el.textContent = `${h}:${m} ${ampm}`;
  if (dateEl) {
    const day = WEEK[TODAY_INDEX];
    dateEl.textContent = day
      ? day.full.toUpperCase()
      : now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  }
}

async function loadBootstrap() {
  const params = weekStart ? { week: weekStart } : {};
  const data = await HomeBaseAPI.bootstrap(params);
  PEOPLE = data.people;
  PROTEIN_FLOOR = data.proteinFloor;
  TODAY_INDEX = data.todayIndex;
  WEEK = data.week;
  HOUSEHOLD_TASKS = data.householdTasks;
  TASK_TAGS = Array.isArray(data.taskTags) && data.taskTags.length
    ? data.taskTags
    : ['cleaning', 'laundry', 'bills', 'car', 'errands'];
  SHOP_CATEGORIES = Array.isArray(data.shopCategories) && data.shopCategories.length
    ? data.shopCategories
    : SHOP_CATEGORIES;
  SHOPPING_LIST = data.shoppingList;
  ALREADY_AT_HOME = data.alreadyAtHome || [];
  ONION_BREAKDOWN = data.onionBreakdown || [];
  SKIP_DINNER_MESSAGES = data.skipDinnerMessages || [];
  ITEM_RECIPES = data.itemRecipes || {};
  googleConnections = data.googleConnections || {};
  aiInsights = data.aiInsights || {};
  weekLabel = data.weekLabel || '';
  weekOffset = data.weekOffset ?? weekOffset;
  weekStart = data.weekStart || WEEK[0]?.dateStr || weekStart;
  recipeCount = data.recipeCount || 0;
  shoppingUnchecked = data.shoppingUnchecked || 0;
  filledSlots = data.filledSlots || 0;
  if (Array.isArray(data.slotKeys) && data.slotKeys.length) SLOT_KEYS = data.slotKeys;
  if (data.slotLabels) SLOT_LABELS = { ...DEFAULT_SLOT_LABELS, ...data.slotLabels };
  session = data.session;
  state.calendarAiConfirmed = !!aiInsights.calendarConfirmed;
}

async function loadMonthEvents(cursorYmd) {
  const { from, to } = monthBounds(cursorYmd);
  const data = await HomeBaseAPI.calendarRange(from, to);
  const byDate = {};
  for (const ev of data.events || []) {
    (byDate[ev.date] = byDate[ev.date] || []).push(ev);
  }
  state.monthEventsByDate = byDate;
  state.monthCursor = `${from.slice(0, 8)}01`;
}

async function loadRecipes() {
  const data = await HomeBaseAPI.listRecipes();
  RECIPES = data.recipes || [];
  recipeCount = RECIPES.length;
}

function showLogin(err) {
  document.getElementById('loginOverlay').hidden = false;
  document.getElementById('app').style.visibility = 'hidden';
  const errEl = document.getElementById('loginError');
  if (errEl) errEl.textContent = err || '';
}

function hideLogin() {
  document.getElementById('loginOverlay').hidden = true;
  document.getElementById('app').style.visibility = 'visible';
}

async function loadWeather() {
  try {
    const w = await HomeBaseAPI.weather();
    const tempEl = document.getElementById('weatherTemp');
    const labelEl = document.getElementById('weatherLabel');
    if (tempEl) tempEl.textContent = `${w.tempF}°`;
    if (labelEl) labelEl.textContent = `${w.label} · ${w.rainPct}% rain`;
  } catch {
    const labelEl = document.getElementById('weatherLabel');
    if (labelEl) labelEl.textContent = 'Weather unavailable';
  }
}

async function loadSpotify() {
  try {
    const data = await HomeBaseAPI.spotifyNow();
    state.spotify = data;
    if (data.now?.connected) await ensureSpotifyWebPlayer();
  } catch {
    state.spotify = { now: { connected: false } };
  }
}

async function tryLogin(pin) {
  await HomeBaseAPI.login(pin);
  hideLogin();
  await loadBootstrap();
  await loadRecipes().catch(() => {});
  await Promise.all([loadWeather(), loadSpotify()]);
  render();
  prefetchAi();
  maybeSyncGoogle();
  startBackgroundSync();
}

async function prefetchAi() {
  try {
    if (!aiInsights.dashboard) {
      const r = await HomeBaseAPI.aiDashboard();
      aiInsights.dashboard = r.insight;
    }
    if (!aiInsights.calendar && !state.calendarAiConfirmed) {
      const r = await HomeBaseAPI.aiSchedule();
      aiInsights.calendar = r.insight;
    }
    if (!aiInsights.mealplan) {
      // Insight only — don't rewrite the week on every login
      const r = await HomeBaseAPI.aiMealplan({ apply: false });
      aiInsights.mealplan = r.insight;
    }
    render();
  } catch {
    // AI optional if key missing
  }
}

async function maybeSyncGoogle() {
  const anyConnected = Object.values(googleConnections).some((g) => g.connected);
  if (!anyConnected) return;
  try {
    await HomeBaseAPI.syncCalendar();
    await loadBootstrap();
    render();
  } catch {
    // sync is best-effort
  }
}

// ---------------------------------------------------------------- background sync
//
// bootstrap only loaded on boot + after your own actions, so a change made on
// the other person's device (or phone) never showed up here without a manual
// reload. Poll it periodically and on tab focus instead. Safe to re-render
// #view underneath the user: every text input in this app lives inside
// #modalCard (a separate overlay untouched by render()), and screen-position
// state (state.tab / selectedDayKey / selectedRecipeId, etc.) is client-only
// and unaffected by a bootstrap refetch.

let bootstrapPollTimer = null;
let bootstrapInFlight = false;

async function refreshBootstrap() {
  if (!session || bootstrapInFlight || document.visibilityState === 'hidden') return;
  bootstrapInFlight = true;
  try {
    await loadBootstrap();
    render();
  } catch (err) {
    console.warn('Background sync failed:', err.message);
  } finally {
    bootstrapInFlight = false;
  }
}

function startBackgroundSync() {
  if (bootstrapPollTimer) return;
  bootstrapPollTimer = setInterval(refreshBootstrap, 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBootstrap();
  });
  window.addEventListener('focus', refreshBootstrap);
}

function stopBackgroundSync() {
  if (bootstrapPollTimer) {
    clearInterval(bootstrapPollTimer);
    bootstrapPollTimer = null;
  }
}

async function initApp() {
  tickClock();
  const params = new URLSearchParams(window.location.search);
  if (params.get('oauth') === 'connected') {
    history.replaceState({}, '', '/');
    toast('Google Calendar connected — tap SYNC NOW');
  }
  if (params.get('oauth') === 'error' || params.get('oauth') === 'failed' || params.get('oauth') === 'missing' || params.get('oauth') === 'invalid_state') {
    history.replaceState({}, '', '/');
    const reason = params.get('reason');
    toast(
      reason
        ? `Google connect failed: ${reason}`
        : 'Google connect failed — use http://127.0.0.1:3000 and add that callback URL in Google Cloud',
    );
  }
  if (params.get('spotify') === 'connected') {
    history.replaceState({}, '', '/');
    SpotifyWeb?.disconnect?.();
    toast('Spotify reconnected — open MENU → Playlists, then tap one to play');
  }
  if (params.get('spotify') === 'error' || params.get('spotify') === 'failed') {
    history.replaceState({}, '', '/');
    toast('Spotify connect failed — use http://127.0.0.1:3000 (not localhost)');
  }

  try {
    await HomeBaseAPI.me();
    hideLogin();
    await loadBootstrap();
    await loadRecipes().catch(() => {});
    await Promise.all([loadWeather(), loadSpotify()]);
    isLoading = false;
    render();
    prefetchAi();
    maybeSyncGoogle();
    startBackgroundSync();
  } catch {
    isLoading = false;
    showLogin();
  }
}

// ---------------------------------------------------------------- dashboard

function renderDashboard() {
  if (!WEEK.length) {
    document.getElementById('view').innerHTML = '<div class="screen"><div class="screen-body" style="padding:40px"><div class="h2">No data yet</div><div class="p" style="margin-top:12px">Run <code>npm run migrate</code> and <code>npm run seed</code> against your Neon database.</div></div></div>';
    return;
  }
  const day = WEEK[TODAY_INDEX] || WEEK[0];
  const prep = day.prep;

  let banner;
  if (prep && !state.prepDone) {
    const assignee = PEOPLE[prep.who];
    banner = `
      <div class="priority-banner">
        <div class="k" style="letter-spacing:.18em">NEEDS ATTENTION NOW</div>
        <div class="row" style="align-items:flex-end;justify-content:space-between;gap:28px;margin-top:14px">
          <div>
            <div class="title">${prep.when} — ${assignee.name.toUpperCase()}:<br>${prep.task.toUpperCase()} · ${prep.minutes} MIN</div>
            <div class="desc">${escapeHtml(aiInsights.dashboard || `Tonight is ${day.dinner.name}${day.dinner.marinateHours ? `. It needs ${day.dinner.marinateHours} hours of marination` : ''}, ${assignee.name} is clear until 6:00.`)}</div>
          </div>
          <div class="col" style="gap:8px;flex:none">
            <button class="btn" style="background:#fff;color:var(--color-accent);border-color:#fff;width:150px" data-action="startPrep">START NOW</button>
            <button class="btn btn-ghost" style="width:150px" data-action="reassignPrep">REASSIGN</button>
          </div>
        </div>
      </div>`;
  } else {
    const aiLine = aiInsights.dashboard || `Dinner together at ${day.dinner.time} — ${day.dinner.name}.`;
    banner = `
      <div class="priority-banner calm">
        <div class="k" style="letter-spacing:.18em;color:#bab6b6">ALL CAUGHT UP</div>
        <div class="title" style="margin-top:14px">Dinner together at ${day.dinner.time} — ${day.dinner.name}.</div>
        <div class="desc" style="color:#dedbdb">${escapeHtml(aiLine)}</div>
      </div>`;
  }

  const timelineRows = day.events.map((ev, i) => {
    const isPrepRow = !!ev.prep;
    const done = isPrepRow ? state.prepDone : !!ev.done;
    const barColor = ev.person === 'charu' ? 'var(--color-accent)' : ev.person === 'shared' ? 'var(--color-text)' : 'var(--color-text)';
    const tag = isPrepRow ? '<span class="tg tgr">PREP</span>' : (ev.title === 'Dinner together' ? '<span class="tg tgd">COOK MODE →</span>' : '');
    return `
      <div class="timeline-row ${done ? 'done' : ''}" data-action="toggleEvent" data-index="${i}">
        <div class="time">${formatTime(ev.start)}</div>
        <div class="bar" style="background:${ev.suggested ? 'var(--color-accent)' : barColor}"></div>
        <div class="label">
          <div><span class="h3">${escapeHtml(ev.title)}</span> <span class="m">${personName(ev.person)}${ev.end ? '' : ''}</span></div>
          ${tag}
        </div>
      </div>`;
  }).join('');

  const shoppingUnchecked = SHOPPING_LIST.flatMap((g) => g.items).filter((i) => !i.checked).length;
  const shoppingTotal = SHOPPING_LIST.flatMap((g) => g.items).length;

  const openTasks = HOUSEHOLD_TASKS.filter((t) => !t.done).slice(0, 4);
  const mealLog = effectiveDayTotals(day);
  const mealRowsToday = SLOT_KEYS.map((slot) => {
    const v = getEffectiveSlot(day, slot);
    if (!v?.name || v.name === '—') return '';
    const st = v.status || 'planned';
    return `
      <div class="meal-log-row ${st}">
        <div class="meal-log-main">
          <div class="k">${SLOT_LABELS[slot] || slot}</div>
          <div class="h3">${escapeHtml(v.name)}</div>
          <div class="m">${v.kcal || 0} kcal · ${v.protein || 0}g${st === 'skipped' ? ' · not counted' : ''}</div>
        </div>
        <div class="meal-log-actions">
          <button type="button" class="tg ${st === 'eaten' ? 'tgr' : ''}" data-action="logMeal" data-date="${escapeHtml(day.dateStr)}" data-slot="${escapeHtml(slot)}" data-status="eaten">ATE</button>
          <button type="button" class="tg ${st === 'skipped' ? 'tgr' : ''}" data-action="logMeal" data-date="${escapeHtml(day.dateStr)}" data-slot="${escapeHtml(slot)}" data-status="skipped">SKIP</button>
          ${st !== 'planned' ? `<button type="button" class="tg" data-action="logMeal" data-date="${escapeHtml(day.dateStr)}" data-slot="${escapeHtml(slot)}" data-status="planned">UNDO</button>` : ''}
        </div>
      </div>`;
  }).join('');

  document.getElementById('view').innerHTML = `
    <div class="screen">
      <div class="screen-bar">
        <div class="row" style="flex:1;align-items:center;padding:0 28px;font-weight:800;font-size:12px;letter-spacing:.1em;color:var(--color-neutral-600)">TODAY, MERGED</div>
        <div class="row" style="flex:none;align-items:center;gap:16px;padding:0 28px;font-size:12px;font-weight:800;letter-spacing:.08em">
          <span class="row" style="align-items:center;gap:7px"><span class="chip cha"></span>CHARU</span>
          <span class="row" style="align-items:center;gap:7px"><span class="chip shr"></span>SHREYA</span>
          <span class="row" style="align-items:center;gap:7px;color:var(--color-neutral-600)"><span class="chip shd"></span>SHARED</span>
        </div>
      </div>
      <div class="screen-body">
        <div class="col" style="flex:1;overflow:auto">
          ${banner}
          <div class="col" style="padding:18px 28px 8px">
            <div class="row" style="align-items:baseline;justify-content:space-between;gap:12px">
              <div class="k">TODAY’S MEALS</div>
              <div class="m">${mealLog.eaten} ate · ${mealLog.skipped} skipped · ${mealLog.kcal} kcal logged</div>
            </div>
            <div class="m" style="margin-top:6px">Tap <strong>ATE</strong> when you finish a meal, or <strong>SKIP</strong> if you didn’t have it (kcal won’t count).</div>
            <div class="meal-log-list">${mealRowsToday || '<div class="m" style="margin-top:12px">No meals planned today — add them on the meal plan.</div>'}</div>
          </div>
          <div class="col" style="padding:0 28px">${timelineRows}</div>
        </div>
        <div class="aside" style="overflow:auto">
          <div class="rail-section" style="cursor:pointer" data-action="setTab" data-value="list">
            <div class="row" style="align-items:baseline;justify-content:space-between"><div class="k">SHOPPING LIST</div><div style="font-size:12px;font-weight:800;letter-spacing:.1em;color:var(--color-accent-700)">OPEN →</div></div>
            <div class="row" style="align-items:baseline;gap:10px;margin-top:6px"><span style="font-size:32px;font-weight:900;letter-spacing:-.02em">${shoppingUnchecked}</span><span class="p">to buy · ${shoppingTotal - shoppingUnchecked} already checked off</span></div>
            <div class="m" style="margin-top:6px">Built from this week's meal plan</div>
          </div>
          <div class="rail-section" style="flex:1">
            <div class="k">HOUSEHOLD</div>
            ${openTasks.map((t) => `
              <div class="household-row" data-action="toggleTask" data-id="${t.id}">
                <span class="chip ${t.person === 'charu' ? 'cha' : t.person === 'shreya' ? 'shr' : 'shd'}"></span>
                <span class="h3" style="flex:1">${escapeHtml(t.title)}</span>
                <span class="m" ${t.suggested ? 'style="color:var(--color-accent-700)"' : ''}>${t.suggested ? t.suggestedTime + '?' : (t.due || t.note || '')}</span>
              </div>`).join('') || '<div class="m" style="margin-top:10px">No open tasks</div>'}
          </div>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- calendar

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 20 * 60;
const DAY_SPAN = DAY_END_MIN - DAY_START_MIN;
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

function renderGoogleBar() {
  const charu = googleConnections.charu || {};
  const shreya = googleConnections.shreya || {};
  const who = (session?.name || '').toLowerCase();
  return `
    <div class="google-bar">
      <span class="k">GOOGLE CALENDAR</span>
      ${charu.connected
        ? `<span class="connected">Charu · ${escapeHtml(charu.email || 'connected')}</span>`
        : `<button class="btn" data-action="connectGoogle" data-person="charu" ${who && who !== 'charu' ? 'title="Log in as Charu first"' : ''}>CONNECT CHARU</button>`}
      ${shreya.connected
        ? `<span class="connected">Shreya · ${escapeHtml(shreya.email || 'connected')}</span>`
        : `<button class="btn" data-action="connectGoogle" data-person="shreya" ${who && who !== 'shreya' ? 'title="Log in as Shreya first"' : ''}>CONNECT SHREYA</button>`}
      <button class="btn" data-action="syncGoogle">SYNC NOW</button>
      <button class="btn btnr" data-action="addCalEvent">+ EVENT</button>
      ${session ? `<span class="session-bar">${escapeHtml(session.name)} · <span data-action="logout" style="cursor:pointer;color:var(--color-accent)">LOG OUT</span></span>` : ''}
    </div>`;
}

function eventClass(ev) {
  const cls = ['cal-event'];
  if (ev.person === 'charu') cls.push('p-charu');
  if (ev.person === 'shreya') cls.push('p-shreya');
  if (ev.person === 'shared') cls.push('p-shared');
  if (ev.highlight) cls.push('highlight');
  if (ev.prep) cls.push('prep');
  if (ev.suggested) cls.push('suggested');
  if (ev.source === 'google') cls.push('from-google');
  return cls.join(' ');
}

function renderCalEventBlock(ev, { withTime = false, top, height } = {}) {
  const style = top != null
    ? `top:${top}%;height:${height}%`
    : '';
  const inner = `${withTime ? `<div class="m" style="opacity:.8;font-size:10px">${formatTime(ev.start)}${ev.end ? '–' + formatTime(ev.end) : ''}</div>` : ''}${escapeHtml(ev.title)}${ev.source === 'google' ? '<span class="cal-src">G</span>' : ''}`;
  if (!ev.id) {
    return `<div class="${eventClass(ev)}" style="${style}">${inner}</div>`;
  }
  return `<div class="${eventClass(ev)}" style="${style}" data-action="editCalEvent" data-id="${escapeHtml(ev.id)}" title="Tap to edit">${inner}</div>`;
}

function personOptions(selected = 'shared') {
  return ['shared', 'charu', 'shreya'].map((p) =>
    `<option value="${p}" ${selected === p ? 'selected' : ''}>${p === 'shared' ? 'Both / Shared' : p.charAt(0).toUpperCase() + p.slice(1)}</option>`
  ).join('');
}

function tagOptions(selected = 'errands') {
  const tags = TASK_TAGS.length ? TASK_TAGS : ['errands', 'cleaning', 'laundry', 'bills', 'car'];
  const list = tags.includes(selected) ? tags : [...tags, selected].filter(Boolean);
  return list.map((t) => {
    const label = String(t).replace(/_/g, ' ');
    return `<option value="${escapeHtml(t)}" ${t === selected ? 'selected' : ''}>${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</option>`;
  }).join('');
}

function taskCategoryLabel(tag) {
  return String(tag || 'errands').replace(/_/g, ' ').toUpperCase();
}

function findCalEvent(id) {
  for (const day of WEEK) {
    const ev = (day.events || []).find((e) => e.id === id);
    if (ev) return { ...ev, date: day.dateStr };
  }
  const monthEv = (state.monthEvents || []).find((e) => e.id === id);
  if (monthEv) return monthEv;
  return null;
}

function renderCalAside() {
  const filterTags = ['all', ...TASK_TAGS];
  const tasks = HOUSEHOLD_TASKS.filter((t) => state.taskFilter === 'all' || t.tag === state.taskFilter);
  const charuLoad = HOUSEHOLD_TASKS.filter((t) => t.person === 'charu' && !t.done).length + HOUSEHOLD_TASKS.filter((t) => t.person === 'shared' && !t.done).length * 0.5;
  const shreyaLoad = HOUSEHOLD_TASKS.filter((t) => t.person === 'shreya' && !t.done).length + HOUSEHOLD_TASKS.filter((t) => t.person === 'shared' && !t.done).length * 0.5;
  const loadTotal = charuLoad + shreyaLoad || 1;
  return `
    <div class="aside">
      <div class="aside-section" style="flex:1;overflow:auto">
        <div class="row" style="align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div class="k">HOUSEHOLD TASKS</div>
          <div class="row" style="gap:6px">
            <span class="tg" style="font-size:10px" data-action="addTaskCategory">+ CATEGORY</span>
            <span class="tg tgr" style="font-size:10px" data-action="addTask">+ ADD</span>
          </div>
        </div>
        <div class="m" style="margin-top:6px">Check to complete · ✎ edit · × delete</div>
        <div class="chip-filters">
          ${filterTags.map((f) => `
            <span class="tg ${state.taskFilter === f ? 'tgr' : ''}" data-action="setTaskFilter" data-value="${escapeHtml(f)}">${f === 'all' ? 'ALL ' + HOUSEHOLD_TASKS.length : taskCategoryLabel(f)}</span>
          `).join('')}
        </div>
        <div style="margin-top:14px">
          ${tasks.map((t) => `
            <div class="household-row ${t.done ? 'done' : ''}" style="${t.suggested ? 'background:var(--color-accent-100)' : ''}">
              <span class="check ${t.done ? 'checked' : ''} ${t.suggested ? 'dashed' : ''}" data-action="toggleTask" data-id="${t.id}">${t.done ? '✓' : ''}</span>
              <span class="chip ${t.person === 'charu' ? 'cha' : t.person === 'shreya' ? 'shr' : 'shd'}" title="${escapeHtml(t.person || 'shared')}"></span>
              <button type="button" class="task-title-btn" data-action="editTask" data-id="${t.id}">
                <span class="h3">${escapeHtml(t.title)}</span>
                <span class="task-meta">
                  <span class="task-tag">${escapeHtml(taskCategoryLabel(t.tag))}</span>
                  <span class="m">${t.person === 'shared' ? 'BOTH' : (t.person || '').toUpperCase()}</span>
                </span>
              </button>
              <button type="button" class="shop-icon-btn" data-action="editTask" data-id="${t.id}" title="Edit">✎</button>
              <button type="button" class="shop-icon-btn danger" data-action="deleteTask" data-id="${t.id}" title="Delete">×</button>
            </div>`).join('') || '<div class="m" style="padding:12px 0">No tasks — tap + ADD</div>'}
        </div>
      </div>
      <div class="aside-section">
        <div class="k">BALANCE THIS WEEK</div>
        <div class="balance-row"><span class="who" style="color:${PEOPLE.charu?.color || '#ec3013'}">CHARU</span><div class="balance-track"><div style="width:${charuLoad / loadTotal * 100}%;background:${PEOPLE.charu?.color || '#ec3013'}"></div></div><span class="m">${charuLoad}</span></div>
        <div class="balance-row"><span class="who">SHREYA</span><div class="balance-track"><div style="width:${shreyaLoad / loadTotal * 100}%;background:var(--color-text)"></div></div><span class="m">${shreyaLoad}</span></div>
      </div>
    </div>`;
}

function renderCalChrome(title, mainHtml) {
  const mode = state.calendarMode || 'week';
  document.getElementById('view').innerHTML = `
    ${renderGoogleBar()}
    <div class="screen">
      <div class="screen-bar">
        <div class="row" style="flex:1;align-items:center;padding-left:26px;gap:16px;flex-wrap:wrap">
          <div class="h2">${escapeHtml(title)}</div>
          <div class="row" style="gap:0">
            <span class="tg ${mode === 'day' ? 'tgr' : ''}" data-action="calendarView" data-value="day">DAY</span>
            <span class="tg ${mode === 'week' ? 'tgr' : ''}" data-action="calendarView" data-value="week">WEEK</span>
            <span class="tg ${mode === 'month' ? 'tgr' : ''}" data-action="calendarView" data-value="month">MONTH</span>
          </div>
          ${mode === 'week' ? `
            <button type="button" class="tg" data-action="shiftWeek" data-value="-1">◀</button>
            <button type="button" class="tg" data-action="shiftWeek" data-value="1">▶</button>
          ` : ''}
          ${mode === 'day' ? `
            <button type="button" class="tg" data-action="shiftCalDay" data-value="-1">◀</button>
            <button type="button" class="tg" data-action="shiftCalDay" data-value="1">▶</button>
          ` : ''}
          ${mode === 'month' ? `
            <button type="button" class="tg" data-action="shiftMonth" data-value="-1">◀</button>
            <button type="button" class="tg" data-action="shiftMonth" data-value="1">▶</button>
          ` : ''}
        </div>
        <div class="row" style="flex:none;align-items:center;gap:16px;padding-right:26px;font-size:12px;font-weight:800;letter-spacing:.08em">
          <span class="row" style="align-items:center;gap:7px"><span class="chip cha"></span>CHARU</span>
          <span class="row" style="align-items:center;gap:7px"><span class="chip shr"></span>SHREYA</span>
          <span class="row" style="align-items:center;gap:7px;color:var(--color-neutral-600)"><span class="chip shd"></span>SHARED</span>
          <span class="tg tgr" data-action="addCalEvent">+ EVENT</span>
          <span class="tg" data-action="addTask">+ TASK</span>
        </div>
      </div>
      ${state.calendarAiConfirmed ? `
        <div class="ai-band"><div class="p">${escapeHtml(aiInsights.calendar || 'Scheduled: shared chores are now on the calendar.')}</div></div>
      ` : `
        <div class="ai-band">
          <div class="row" style="gap:14px;align-items:flex-start">
            <span class="tg tgr" style="margin-top:2px">AI</span>
            <div>
              <div class="p" style="font-size:15px;max-width:640px">${escapeHtml(aiInsights.calendar || 'Ask AI for a scheduling suggestion, or add events with + EVENT.')}</div>
              ${state.showOtherWindows ? '<div class="m" style="margin-top:8px">Other windows: Sunday 1–3 PM (Shreya only), Wednesday evening after 8 PM (both, low energy).</div>' : ''}
            </div>
          </div>
          <div class="row" style="gap:8px;flex:none">
            <button class="btn btnd" data-action="scheduleAi">SCHEDULE IT</button>
            <button class="btn" data-action="showOtherWindows">SHOW OTHER WINDOWS</button>
          </div>
        </div>
      `}
      <div class="screen-body" style="overflow:hidden">
        <div class="col" style="flex:1;overflow:hidden">${mainHtml}</div>
        ${renderCalAside()}
      </div>
    </div>`;
}

function renderCalDayTrack(events, tall = false) {
  const hours = ['8', '10', '12', '2', '4', '6', '8'];
  return `
    <div class="cal-grid ${tall ? 'cal-grid-day' : ''}">
      <div class="cal-hours">
        <div style="height:40px;border-bottom:1px solid var(--color-neutral-300)"></div>
        <div class="cal-hours-track">
          ${hours.map((h, i) => `<div style="top:${i * 120}px">${h}</div>`).join('')}
        </div>
      </div>
      <div class="cal-days">
        <div class="cal-day-col today" style="flex:1">
          <div class="cal-day-head">Schedule</div>
          <div class="cal-track">
            ${(events || []).map((ev) => {
              const start = toMin(ev.start);
              const end = ev.end ? toMin(ev.end) : start + 20;
              const top = Math.max(0, (start - DAY_START_MIN) / DAY_SPAN * 100);
              const height = Math.max(3, (end - start) / DAY_SPAN * 100);
              return renderCalEventBlock(ev, { withTime: true, top, height });
            }).join('') || '<div class="m" style="padding:16px">No events — tap + EVENT</div>'}
          </div>
        </div>
      </div>
    </div>`;
}

function renderCalendarWeekBody() {
  const hours = ['8', '10', '12', '2', '4', '6', '8'];
  return `
    <div class="cal-grid">
      <div class="cal-hours">
        <div style="height:40px;border-bottom:1px solid var(--color-neutral-300)"></div>
        <div class="cal-hours-track">
          ${hours.map((h, i) => `<div style="top:${i * 120}px">${h}</div>`).join('')}
        </div>
      </div>
      <div class="cal-days">
        ${WEEK.map((day, idx) => `
          <div class="cal-day-col ${idx === TODAY_INDEX ? 'today' : ''}">
            <div class="cal-day-head" data-action="openCalDay" data-key="${day.key}" data-date="${day.dateStr || ''}">${day.label} ${day.date}</div>
            <div class="cal-track">
              ${day.events.map((ev) => {
                const start = toMin(ev.start);
                const end = ev.end ? toMin(ev.end) : start + 20;
                const top = Math.max(0, (start - DAY_START_MIN) / DAY_SPAN * 100);
                const height = Math.max(3, (end - start) / DAY_SPAN * 100);
                return renderCalEventBlock(ev, { top, height });
              }).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderCalendarDayBody() {
  const day = findDay(state.calendarDayKey) || WEEK[TODAY_INDEX] || WEEK[0];
  if (!day) return '<div class="p" style="padding:24px">No day loaded</div>';
  return renderCalDayTrack(day.events, true);
}

function monthBounds(cursorYmd) {
  const [y, m] = cursorYmd.slice(0, 7).split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m)}-01`;
  const to = `${y}-${pad(m)}-${pad(last.getDate())}`;
  // grid starts Monday
  const startDow = first.getDay(); // 0 Sun
  const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
  const gridStart = new Date(y, m - 1, 1 + mondayOffset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    cells.push({
      dateStr: ds,
      dayNum: d.getDate(),
      inMonth: d.getMonth() === m - 1,
      label: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()],
    });
  }
  return { from, to, cells, title: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
}

function renderCalendarMonthBody() {
  const cursor = state.monthCursor || (weekStart ? weekStart.slice(0, 8) + '01' : new Date().toISOString().slice(0, 8) + '01');
  const { cells } = monthBounds(cursor);
  const todayStr = new Date().toISOString().slice(0, 10);
  return `
    <div class="month-grid">
      ${['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => `<div class="month-dow">${d}</div>`).join('')}
      ${cells.map((c) => {
        const evs = state.monthEventsByDate[c.dateStr] || [];
        return `
          <div class="month-cell ${c.inMonth ? '' : 'muted'} ${c.dateStr === todayStr ? 'today' : ''}" data-action="openCalDayFromMonth" data-date="${c.dateStr}">
            <div class="month-num">${c.dayNum}</div>
            <div class="month-evs">
              ${evs.slice(0, 3).map((ev) => `
                <div class="month-ev ${ev.person === 'charu' ? 'cha' : ev.person === 'shared' ? 'shd' : 'shr'} ${ev.prep ? 'prep' : ''}">${escapeHtml(ev.title)}</div>
              `).join('')}
              ${evs.length > 3 ? `<div class="m">+${evs.length - 3} more</div>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function renderCalendar() {
  const mode = state.calendarMode || 'week';
  if (mode === 'day') {
    const day = findDay(state.calendarDayKey) || WEEK[TODAY_INDEX] || WEEK[0];
    const title = day ? (day.full || `${day.label} ${day.date}`) : 'Day';
    renderCalChrome(title, renderCalendarDayBody());
    return;
  }
  if (mode === 'month') {
    const cursor = state.monthCursor || (weekStart ? `${weekStart.slice(0, 8)}01` : new Date().toISOString().slice(0, 8) + '01');
    const { title } = monthBounds(cursor);
    renderCalChrome(title, renderCalendarMonthBody());
    return;
  }
  renderCalChrome(weekLabel || 'This week', renderCalendarWeekBody());
}

// ---------------------------------------------------------------- meal plan week grid

function weekSlotLabel(key) {
  if (key === 'who') return "WHO'S BUSY";
  const short = {
    drink: 'DRINK',
    breakfast: 'BREAKFAST',
    shake: 'SHAKE',
    lunch: 'LUNCH',
    snack: 'SNACK',
    dinner: 'DINNER',
    dessert: 'DESSERT',
    lunch_charu: 'LUNCH · C',
    snack_am: 'SNACK AM',
    snack_pm: 'SNACK PM',
    before_sleep: 'NIGHT',
  };
  if (short[key]) return short[key];
  const raw = SLOT_LABELS[key] || key;
  return String(raw).replace(/_/g, ' ').toUpperCase();
}

function renderWeekGrid() {
  const isAll = state.mealMode === 'all';
  const rows = isAll ? ['who', ...SLOT_KEYS] : ['dinner'];
  const avg = WEEK.length ? WEEK.reduce((sum, d) => sum + effectiveDayTotals(d).kcal, 0) / WEEK.length : 0;
  const avgProtein = WEEK.length ? WEEK.reduce((sum, d) => sum + effectiveDayTotals(d).protein, 0) / WEEK.length : 0;
  const prepCount = WEEK.filter((d) => d.prep).length;
  const dinnerFilled = WEEK.filter((d) => d.dinner?.name && d.dinner.name !== '—').length;
  const chipRecipes = RECIPES.slice(0, 8);

  document.getElementById('view').innerHTML = `
    <div class="screen">
      <div class="screen-bar">
        <div class="row" style="flex:1;align-items:center;padding-left:26px;gap:20px">
          <div class="h2">Meal plan · ${escapeHtml(weekLabel.replace('Week of ', '') || 'this week')}</div>
          <button type="button" class="tg" data-action="shiftWeek" data-value="-1">◀ PREV</button>
          <button type="button" class="tg" data-action="shiftWeek" data-value="1">NEXT ▶</button>
          <button type="button" class="tg" data-action="copyWeekMeals">COPY TO NEXT WEEK</button>
        </div>
        <div class="row" style="flex:none;align-items:center;gap:8px;padding-right:26px">
          <span class="tg ${!isAll ? 'tgr' : ''}" data-action="setMealMode" data-value="dinners">DINNERS ONLY</span>
          <span class="tg ${isAll ? 'tgr' : ''}" data-action="setMealMode" data-value="all">ALL MEALS</span>
          <span class="tg tgr" data-action="askAi">ASK AI TO PLAN</span>
          <span class="tg" data-action="setPlanSub" data-value="recipes">RECIPES →</span>
        </div>
      </div>
      <div class="plan-stats">
        <div class="plan-stat" data-action="setPlanSub" data-value="recipes" style="cursor:pointer"><div class="k">SOURCE</div><div class="n">${recipeCount}</div><div class="m">recipes in book</div></div>
        <div class="plan-stat"><div class="k">→ PLAN</div><div class="n">${isAll ? filledSlots || WEEK.length * 6 : dinnerFilled}</div><div class="m">${isAll ? 'meal slots filled' : 'dinners chosen'}</div></div>
        <div class="plan-stat"><div class="k">→ DAILY AVG</div><div class="n">${Math.round(avg) || '—'}</div><div class="m">kcal · ${Math.round(avgProtein)}g protein</div></div>
        <div class="plan-stat accent"><div class="k" style="color:#ffe0d9">→ TARGETS</div><div class="n">${PEOPLE.charu?.calorieTarget || '—'} / ${PEOPLE.shreya?.calorieTarget || '—'}</div><div class="m" style="color:#ffe0d9">Charu / Shreya kcal</div></div>
        <div class="plan-stat" data-action="setTab" data-value="list" style="cursor:pointer"><div class="k">→ BUY</div><div class="n">${shoppingUnchecked}</div><div class="m">items, to buy</div></div>
        <div class="plan-stat dark"><div class="k" style="color:#bab6b6">→ PREP</div><div class="n">${prepCount}</div><div class="m" style="color:#bab6b6">tasks in calendar</div></div>
      </div>
      <div class="row" style="flex:none;padding:12px 26px;border-bottom:2px solid var(--color-text);align-items:center;gap:14px">
        <span class="tg tgr">AI</span>
        <div class="p">${escapeHtml(aiInsights.mealplan || 'Ask AI to comment on this week\'s meal plan.')}</div>
      </div>
      ${!WEEK.length || !dinnerFilled ? `
        <div class="row" style="flex:none;padding:20px 26px;border-bottom:1px solid var(--color-neutral-300)">
          <div class="p">No meals planned for this week yet. Tap <strong>RECIPES</strong> to open the book, or use ◀ PREV / NEXT ▶ to find a week with data.</div>
        </div>` : ''}
      <div class="week-grid">
        <div class="week-labels">
          <div class="head-spacer"></div>
          ${rows.map((r) => `<div class="slot-label" title="${escapeHtml(SLOT_LABELS[r] || r)}">${escapeHtml(weekSlotLabel(r))}</div>`).join('')}
          ${isAll ? '<div class="total-label">DAY TOTAL</div>' : ''}
          <div class="prep-label">PREP</div>
        </div>
        <div class="week-days">
          ${WEEK.map((day) => {
            const totals = effectiveDayTotals(day);
            const cDiff = totals.kcal - (PEOPLE.charu?.calorieTarget || 0);
            const sDiff = totals.kcal - (PEOPLE.shreya?.calorieTarget || 0);
            return `
            <div class="week-day ${day.key === WEEK[TODAY_INDEX]?.key ? 'today' : ''}">
              <div class="week-day-head" data-action="openDayDetail" data-key="${day.key}">${day.label} ${day.date}</div>
              ${rows.map((r) => {
                if (r === 'who') {
                  return `<div class="slot-cell"><div class="m" style="font-size:11px;line-height:1.3">${escapeHtml(day.who.charu)}<br>${escapeHtml(day.who.shreya)}</div></div>`;
                }
                if (r === 'dinner' && !isAll) {
                  return `<div class="slot-cell" style="flex:2" data-action="openDayDetail" data-key="${day.key}"><div class="name" style="font-size:15px">${escapeHtml(day.dinner.name)}</div><div class="m" style="margin-top:3px">${day.dinner.minutes || '—'} min${day.dinner.marinateHours ? ` + ${day.dinner.marinateHours} hr marinate` : ''} · ${escapeHtml(String(day.dinner.method || ''))}</div></div>`;
                }
                const slot = getEffectiveSlot(day, r);
                const st = slot.status || 'planned';
                return `<div class="slot-cell ${st === 'skipped' ? 'is-skipped' : ''}" data-action="openDayDetail" data-key="${day.key}"><div class="name">${escapeHtml(slot.name)}</div><div class="kcal">${st === 'skipped' ? 'skipped' : `${slot.kcal} kcal`}</div></div>`;
              }).join('')}
              ${isAll ? `
                <div class="day-total">
                  <div class="row" style="align-items:baseline;gap:6px"><span class="n">${totals.kcal}</span><span class="m" style="color:#bab6b6">kcal</span></div>
                  <div class="row" style="gap:8px;margin-top:3px">
                    <span class="vs ${cDiff <= 0 ? 'under' : 'over'}">C ${cDiff <= 0 ? cDiff : '+' + cDiff}</span>
                    <span class="vs ${sDiff <= 0 ? 'under' : 'over'}">S ${sDiff <= 0 ? sDiff : '+' + sDiff}</span>
                  </div>
                  <div class="m" style="color:#bab6b6;margin-top:2px">${totals.protein}g protein</div>
                </div>` : ''}
              <div class="slot-cell prep-cell">
                ${day.prep ? `<div style="padding:5px 7px;font-size:10px;font-weight:700;line-height:1.3;background:${day.prep.urgent ? 'var(--color-accent)' : 'var(--color-surface)'};color:${day.prep.urgent ? '#fff' : 'var(--color-text)'};border-left:3px solid var(--color-accent)">${day.prep.when}<br>${personName(day.prep.who)}: ${escapeHtml(day.prep.task)} · ${day.prep.minutes} min</div>` : '<div class="m" style="font-size:11px">No prep needed</div>'}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="row" style="flex:none;padding:14px 26px;border-top:2px solid var(--color-text);align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        ${isAll
          ? `<div class="k">TAP A DAY TO SEE THE FULL BREAKDOWN AND SWAP A SLOT</div>`
          : `<div class="row" style="gap:16px;align-items:center;flex-wrap:wrap"><div class="k">OPEN A DAY OR RECIPE TO FILL ANY SLOT (BREAKFAST → DINNER)</div><div class="row" style="gap:8px;flex-wrap:wrap">${chipRecipes.map((r) => `<span class="tg" data-action="pickRecipeForPlan" data-id="${r.id}">${escapeHtml(r.name)}</span>`).join('') || '<span class="m">Open RECIPES to add dishes</span>'}</div></div>`}
        <div class="row" style="gap:8px">
          <span class="btn" data-action="toast" data-value="Prep tasks are already placed on the calendar.">EXPORT PREP TO CALENDAR</span>
          <span class="btn btnr" data-action="setTab" data-value="list">BUILD SHOPPING LIST →</span>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- day detail

function renderDayDetail() {
  const day = findDay(state.selectedDayKey) || WEEK[TODAY_INDEX];
  if (!day) {
    document.getElementById('view').innerHTML = '<div class="screen"><div class="screen-body" style="padding:40px"><div class="h2">No day selected</div></div></div>';
    return;
  }
  const person = PEOPLE[state.dayDetailPerson] || { name: '—', calorieTarget: 2000 };
  const totals = effectiveDayTotals(day);
  const target = person.calorieTarget;
  const under = totals.kcal <= target;
  const proteinMet = totals.protein >= PROTEIN_FLOOR;

  let running = 0;
  const rows = SLOT_KEYS.map((slot) => {
    const v = getEffectiveSlot(day, slot);
    const st = v.status || 'planned';
    const countKcal = st === 'skipped' ? 0 : (Number(v.kcal) || 0);
    running += countKcal;
    const barW = Math.min(100, Math.round((running / target) * 100));
    const empty = !v.name || v.name === '—';
    return `
      <div class="slot-row ${st}">
        <div class="top">
          <div class="row" style="align-items:baseline;gap:14px;flex-wrap:wrap">
            <span class="k" style="width:120px;flex:none">${SLOT_LABELS[slot]}</span>
            <span class="h3 ${st === 'skipped' ? 'slot-skipped' : ''}">${escapeHtml(v.name)}</span>
            ${st === 'eaten' ? '<span class="tg tgr" style="font-size:9px;padding:3px 8px">ATE</span>' : ''}
            ${st === 'skipped' ? '<span class="tg" style="font-size:9px;padding:3px 8px">SKIPPED</span>' : ''}
            <span class="tg tgr" style="font-size:9px;padding:3px 8px" data-action="setDaySlot" data-slot="${slot}">${empty ? '+ ADD' : 'CHANGE'}</span>
            ${SWAPPABLE.has(slot) ? `<span class="tg" style="font-size:9px;padding:3px 6px" data-action="swapSlot" data-slot="${slot}">SWAP</span>` : ''}
          </div>
          <div class="row" style="align-items:baseline;gap:16px"><span class="m">${st === 'skipped' ? '0' : v.protein}g protein</span><span class="h3" style="width:70px;text-align:right">${st === 'skipped' ? 0 : v.kcal}</span></div>
        </div>
        ${!empty ? `
          <div class="row" style="gap:6px;margin:8px 0 4px;flex-wrap:wrap">
            <span class="tg ${st === 'eaten' ? 'tgr' : ''}" data-action="logMeal" data-date="${escapeHtml(day.dateStr)}" data-slot="${escapeHtml(slot)}" data-status="eaten">ATE</span>
            <span class="tg ${st === 'skipped' ? 'tgr' : ''}" data-action="logMeal" data-date="${escapeHtml(day.dateStr)}" data-slot="${escapeHtml(slot)}" data-status="skipped">SKIP</span>
            ${st !== 'planned' ? `<span class="tg" data-action="logMeal" data-date="${escapeHtml(day.dateStr)}" data-slot="${escapeHtml(slot)}" data-status="planned">UNDO</span>` : ''}
          </div>` : ''}
        <div class="slot-progress-row">
          <div class="slot-progress"><div style="width:${barW}%"></div></div>
          <span class="m" style="width:130px;text-align:right">${running} / ${target} kcal</span>
        </div>
      </div>`;
  }).join('');

  const deficit = target - totals.kcal;
  const aiLine = deficit >= 0
    ? `At this pace, ${person.name} is on track for roughly a ${deficit} kcal deficit today, and ${proteinMet ? 'is already past' : `is ${PROTEIN_FLOOR - totals.protein}g under`} the ${PROTEIN_FLOOR}g protein floor.`
    : `${person.name} is running about ${Math.abs(deficit)} kcal over target today. Swapping the snack or shake below would bring it back under.`;

  document.getElementById('view').innerHTML = `
    <div class="screen">
      <div class="screen-bar">
        <div class="row" style="flex:1;align-items:center;padding-left:24px;gap:16px">
          <span class="tg" data-action="stepDay" data-value="-1">◀</span>
          <div class="h2">${day.full}</div>
          <span class="tg" data-action="stepDay" data-value="1">▶</span>
          <span class="tg" data-action="backToWeek" style="margin-left:8px">← WEEK VIEW</span>
        </div>
        <div class="row" style="flex:none;align-items:center;gap:8px;padding-right:24px">
          <span class="tg ${state.dayDetailPerson === 'charu' ? 'tgr' : ''}" data-action="setDayDetailPerson" data-value="charu">CHARU</span>
          <span class="tg ${state.dayDetailPerson === 'shreya' ? 'tgr' : ''}" data-action="setDayDetailPerson" data-value="shreya">SHREYA</span>
        </div>
      </div>
      <div class="row" style="flex:none;padding:16px 24px;border-bottom:2px solid var(--color-text);align-items:flex-end;justify-content:space-between">
        <div>
          <div class="k">PLANNED TODAY</div>
          <div class="row" style="align-items:baseline;gap:10px;margin-top:4px"><span style="font-size:38px;font-weight:900;letter-spacing:-.02em">${totals.kcal}</span><span class="m">kcal of ${target} · ${totals.protein}g protein, floor ${PROTEIN_FLOOR}</span></div>
        </div>
        <div class="row" style="gap:8px">
          <span class="tg ${under ? 'tgr' : ''}" style="${under ? '' : 'background:var(--color-text);color:#fff;border-color:var(--color-text)'}">${under ? 'UNDER TARGET' : 'OVER TARGET'}</span>
          <span class="tg ${proteinMet ? 'tgr' : ''}">${proteinMet ? 'PROTEIN MET' : 'PROTEIN LOW'}</span>
        </div>
      </div>
      <div class="day-detail">${rows}</div>
      <div class="row" style="flex:none;padding:12px 24px;border-top:1px solid var(--color-neutral-300);gap:8px">
        <span class="tg" data-action="addCustomSlot">+ CUSTOM SLOT</span>
        <span class="m">e.g. dessert, second breakfast</span>
      </div>
      <div class="row" style="flex:none;height:70px;border-top:2px solid var(--color-text);align-items:center;padding:0 24px;gap:16px">
        <span class="tg tgr">AI</span>
        <div class="p" style="font-size:14px">${aiLine}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- recipes

function inferSourceName(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (h.includes('youtube') || h === 'youtu.be') return 'YouTube';
    if (h.includes('instagram')) return 'Instagram';
    if (h.includes('tiktok')) return 'TikTok';
    if (h.includes('facebook')) return 'Facebook';
    return h;
  } catch {
    return 'Link';
  }
}

function recipeRefLink(r) {
  const url = r?.sourceUrl || r?.source_url;
  if (!url) return '';
  const label = r?.sourceName || r?.source_name || inferSourceName(url);
  return `<a class="recipe-ref-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>`;
}

function parseRecipeFormValues(values) {
  const ingredients = String(values.ingredients || '').split('\n').map((line) => {
    const [name, qty, aisle] = line.split('|').map((s) => s.trim());
    return name ? { name, qty, aisle: aisle || 'Other' } : null;
  }).filter(Boolean);
  const method = String(values.method || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const imageUrl = String(values.imageUrl || '').trim()
    || `https://image.pollinations.ai/prompt/${encodeURIComponent((values.name || 'food') + ', plated food photography, appetizing')}?width=800&height=1000&nologo=true`;
  const sourceUrl = String(values.sourceUrl || '').trim() || null;
  const sourceName = String(values.sourceName || '').trim()
    || (sourceUrl ? inferSourceName(sourceUrl) : null);
  return {
    name: values.name,
    minutes: Number(values.minutes) || null,
    kcal: Number(values.kcal) || null,
    protein: Number(values.protein) || null,
    servings: values.servings || '2',
    tags: [values.tag || 'dinner'],
    method: method.length ? method : ['Prep', 'Cook', 'Serve'],
    ingredients,
    imageUrl,
    sourceUrl,
    sourceName,
  };
}

function parseJsonFromAi(text) {
  let s = String(text || '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) s = fence[1].trim();
  return JSON.parse(s);
}

const AI_RECIPE_PROMPT = `You convert recipes into HomeBase JSON. Return ONLY valid JSON — no markdown, no explanation.

Rules:
- recipe_name: clear dish title
- meal_type: breakfast | lunch | dinner | snack | side | drink | shake | dessert
- method: array of short step strings
- kcal and protein_g: estimate per serving if not given (integers)
- ingredients: every ingredient with quantity and aisle (Produce | Meat + dairy | Pantry | Frozen | Bakery | Spices | Other)
- source_name / source_url: if from Instagram or a blog

{
  "recipe_name": "",
  "meal_type": "dinner",
  "minutes": null,
  "kcal": null,
  "protein_g": null,
  "servings": "2",
  "method": ["step 1", "step 2"],
  "source_name": null,
  "source_url": null,
  "ingredients": [
    { "ingredient": "", "quantity": "", "aisle": "Pantry" }
  ]
}

Convert this recipe:`;

function normalizeRecipeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  // Google Images result page / search URLs are not direct image files
  if (/google\.[^/]+\/(imgres|search|url\?)/i.test(raw)) return '';
  // Prefer direct lh3 / googleusercontent image hosts as-is
  return raw;
}

function recipeCover(r) {
  const direct = normalizeRecipeImageUrl(r?.imageUrl);
  if (direct) return direct;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent((r?.name || 'food') + ', plated food photography, appetizing')}?width=800&height=1000&nologo=true`;
}

function recipeImgTag(r, className = '') {
  const src = recipeCover(r);
  const cls = className ? ` class="${className}"` : '';
  return `<img${cls} src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback-name="${escapeHtml(r?.name || 'food')}">`;
}

function bindRecipeImageFallbacks(root = document) {
  root.querySelectorAll('img.recipe-card-img, .recipe-hero img').forEach((img) => {
    if (img.dataset.boundFallback) return;
    img.dataset.boundFallback = '1';
    img.addEventListener('error', () => {
      img.classList.add('is-broken');
      const name = img.dataset.fallbackName || 'food';
      const fallback = `https://image.pollinations.ai/prompt/${encodeURIComponent(name + ', plated food photography, appetizing')}?width=800&height=1000&nologo=true&seed=1`;
      if (img.src !== fallback) img.src = fallback;
    });
  });
}

function renderRecipeGrid() {
  const filters = ['all', 'breakfast', 'lunch', 'dinner', 'dessert', 'snack', 'side'];
  const list = state.recipeFilter === 'all'
    ? RECIPES
    : RECIPES.filter((r) => (r.tags || []).map((t) => t.toLowerCase()).includes(state.recipeFilter));

  document.getElementById('view').innerHTML = `
    <div class="screen">
      <div class="screen-bar">
        <div class="row" style="flex:1;align-items:center;padding-left:26px;gap:16px">
          <div class="h2">Recipes</div>
          <div class="m">${list.length} dish${list.length === 1 ? '' : 'es'}</div>
        </div>
        <div class="row" style="flex:none;align-items:center;gap:8px;padding-right:26px">
          <span class="tg" data-action="setPlanSub" data-value="meals">← MEAL PLAN</span>
          <span class="tg" data-action="importRecipeJson">IMPORT JSON</span>
          <span class="tg" data-action="aiInventRecipes">AI INVENT 3</span>
          <span class="tg tgr" data-action="addRecipe">+ ADD RECIPE</span>
        </div>
      </div>
      <div class="row" style="flex:none;padding:10px 26px;gap:8px;border-bottom:1px solid var(--color-neutral-300);flex-wrap:wrap">
        ${filters.map((f) => `
          <span class="tg ${state.recipeFilter === f ? 'tgr' : ''}" data-action="setRecipeFilter" data-value="${f}">${f.toUpperCase()}</span>
        `).join('')}
      </div>
      ${!list.length ? `
        <div class="recipe-empty">
          <div class="h2">No recipes yet</div>
          <div class="p" style="margin-top:10px">IMPORT JSON from an AI chatbot, or tap + ADD RECIPE to type one in yourself.</div>
        </div>
      ` : `
        <div class="recipe-grid">
          ${list.map((r) => `
            <div class="recipe-card">
              <button type="button" class="recipe-card-del" data-action="deleteRecipe" data-id="${r.id}" title="Delete recipe">×</button>
              <div data-action="openRecipe" data-id="${r.id}">
                ${recipeImgTag(r, 'recipe-card-img')}
                <div class="recipe-card-body">
                  <div class="k">${(r.tags || []).slice(0, 2).map((t) => t.toUpperCase()).join(' · ') || 'RECIPE'}</div>
                  <div class="h3" style="margin-top:6px">${escapeHtml(r.name)}</div>
                  <div class="row" style="gap:12px;margin-top:10px;flex-wrap:wrap">
                    <span class="m">${r.kcal != null ? r.kcal + ' kcal' : '— kcal'}</span>
                    <span class="m">${r.protein != null ? r.protein + 'g protein' : ''}</span>
                    <span class="m">${r.minutes != null ? r.minutes + ' min' : ''}</span>
                  </div>
                  ${r.sourceUrl ? `<div style="margin-top:10px">${recipeRefLink(r)}</div>` : ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>`;
  bindRecipeImageFallbacks();
}

function renderRecipeDetail() {
  const r = RECIPES.find((x) => x.id === state.selectedRecipeId);
  if (!r) {
    state.selectedRecipeId = null;
    return renderRecipeGrid();
  }
  const full = r._full || r;
  const ingredients = full.ingredients || [];
  const method = full.method || [];
  const slot = state.assignSlot || 'dinner';

  document.getElementById('view').innerHTML = `
    <div class="screen">
      <div class="screen-bar">
        <div class="row" style="flex:1;align-items:center;padding-left:26px;gap:16px">
          <span class="tg" data-action="backToRecipes">← RECIPES</span>
          <div class="h2">${escapeHtml(full.name)}</div>
        </div>
        <div class="row" style="flex:none;align-items:center;gap:8px;padding-right:26px">
          <span class="tg" data-action="aiFillRecipe" data-id="${full.id}">AI CALORIES</span>
          <span class="tg" data-action="editRecipe" data-id="${full.id}">EDIT</span>
          <span class="tg" data-action="deleteRecipe" data-id="${full.id}">DELETE</span>
        </div>
      </div>
      <div class="screen-body" style="overflow:auto">
        <div class="col" style="flex:1;padding:0;max-width:520px">
          <div class="recipe-hero">
            ${recipeImgTag(full, '')}
            <span class="tg tgr recipe-hero-edit" data-action="editRecipePhoto" data-id="${full.id}">EDIT PHOTO</span>
          </div>
          <div style="padding:22px 28px">
            <div class="row" style="gap:24px;flex-wrap:wrap;margin-bottom:20px">
              <div><div class="k">KCAL</div><div class="h3" style="margin-top:4px">${full.kcal || '—'}</div></div>
              <div><div class="k">PROTEIN</div><div class="h3" style="margin-top:4px">${full.protein || '—'}g</div></div>
              <div><div class="k">TIME</div><div class="h3" style="margin-top:4px">${full.minutes || '—'} min</div></div>
              <div><div class="k">SERVINGS</div><div class="h3" style="margin-top:4px">${escapeHtml(full.servings || '—')}</div></div>
            </div>
            ${full.sourceUrl ? `
              <div style="margin-bottom:20px">
                <div class="k">REFERENCE</div>
                <div style="margin-top:8px">${recipeRefLink(full)}</div>
              </div>` : ''}
            <div class="k">INGREDIENTS</div>
            <div class="col" style="margin-top:12px;margin-bottom:22px">
              ${ingredients.length ? ingredients.map((i) => `
                <div class="row" style="justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--color-neutral-300)">
                  <span class="h3" style="font-size:15px">${escapeHtml(i.name)}</span>
                  <span class="m">${escapeHtml([i.qty, i.aisle].filter(Boolean).join(' · '))}</span>
                </div>
              `).join('') : '<div class="p">Tap AI CALORIES to generate ingredients + nutrition.</div>'}
            </div>
            <div class="k">METHOD</div>
            <ol class="recipe-method">
              ${method.length ? method.map((step) => `<li class="p">${escapeHtml(typeof step === 'string' ? step : String(step))}</li>`).join('') : '<li class="p">No steps yet.</li>'}
            </ol>
          </div>
        </div>
        <div class="aside">
          <div class="aside-section">
            <div class="k">1 · MEAL SLOT</div>
            <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">
              ${SLOT_KEYS.map((s) => `
                <span class="tg ${slot === s ? 'tgr' : ''}" data-action="setAssignSlot" data-value="${s}">${SLOT_LABELS[s] || s.toUpperCase()}</span>
              `).join('')}
              <span class="tg" data-action="addCustomSlot">+ SLOT</span>
            </div>
          </div>
          <div class="aside-section">
            <div class="k">2 · DAY THIS WEEK</div>
            <div class="p" style="margin-top:8px">Assign as <strong>${SLOT_LABELS[slot] || slot}</strong></div>
            <div class="col" style="gap:8px;margin-top:14px">
              ${WEEK.map((d) => {
                const current = d.meals?.[slot]?.name || 'empty';
                return `<button class="btn" data-action="assignRecipeToSlot" data-id="${full.id}" data-day="${d.dateStr}" data-slot="${slot}">${d.label} ${d.date} · ${escapeHtml(current)}</button>`;
              }).join('') || '<div class="m">No week loaded</div>'}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  bindRecipeImageFallbacks();
}

// ---------------------------------------------------------------- shopping list

const SHOP_STORES = ['Costco', 'Trader Joe\'s', 'Whole Foods', 'Target', 'Walmart', 'Indian grocery', 'Farmers market', 'Safeway', 'Kroger'];

function shopCategoryOptions(selected) {
  const extras = SHOP_CATEGORIES.includes(selected) || !selected
    ? []
    : [selected];
  const list = [...new Set([...SHOP_CATEGORIES, ...extras])];
  return list.map((c) =>
    `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');
}

function shopCategoryField(selected) {
  return `
    <label><span class="k">CATEGORY</span>
      <select name="aisle">${shopCategoryOptions(selected || 'Other')}</select>
    </label>
    <label><span class="k">OR NEW CATEGORY</span>
      <input name="newAisle" placeholder="e.g. Indian store, Household">
    </label>`;
}

function resolveShopCategory(values, fallback = 'Other') {
  return String(values.newAisle || '').trim() || values.aisle || fallback;
}

function applyShopCategories(categories) {
  if (Array.isArray(categories) && categories.length) SHOP_CATEGORIES = categories;
}

function shopStoreField(name, value) {
  return `
    <label><span class="k">STORE</span>
      <input name="${name}" list="shop-stores-datalist" value="${escapeHtml(value || '')}" placeholder="e.g. Costco, Indian grocery">
    </label>
    <datalist id="shop-stores-datalist">
      ${SHOP_STORES.map((s) => `<option value="${escapeHtml(s)}">`).join('')}
    </datalist>`;
}

function shopScheduleFields(item = {}) {
  const needBy = item.needBy || '';
  const priority = item.priority || 'normal';
  const autoHint = item.source === 'meal_plan'
    ? `<div class="m" style="margin-top:8px">${item.needByOverride
      ? 'Manual need-by date — clear the date and save to revert to meal plan.'
      : 'Need-by is auto-set to the first day this ingredient is used on the meal plan.'}</div>`
    : '';
  return `
    <label><span class="k">NEED BY</span>
      <input name="needBy" type="date" value="${escapeHtml(needBy)}">
    </label>
    <label><span class="k">PRIORITY</span>
      <select name="priority">
        <option value="high" ${priority === 'high' ? 'selected' : ''}>High</option>
        <option value="normal" ${priority === 'normal' ? 'selected' : ''}>Normal</option>
        <option value="low" ${priority === 'low' ? 'selected' : ''}>Low</option>
      </select>
    </label>
    ${autoHint}`;
}

function formatNeedBy(dateStr) {
  if (!dateStr) return '';
  const ds = dateStr.slice(0, 10);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (ds === todayStr) return 'Today';
  if (ds === tomorrowStr) return 'Tomorrow';
  const d = new Date(`${ds}T12:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function isDueSoon(needBy) {
  if (!needBy) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const need = new Date(`${needBy.slice(0, 10)}T12:00:00`);
  const diff = Math.round((need - today) / 86400000);
  return diff >= 0 && diff <= 2;
}

function sortShoppingItems(items) {
  const sorted = [...items];
  const priRank = { high: 0, normal: 1, low: 2 };
  sorted.sort((a, b) => {
    // Checked items always sink to the bottom of the section (still visible).
    if (!!a.checked !== !!b.checked) return a.checked ? 1 : -1;
    if (state.listSort === 'name') return a.name.localeCompare(b.name);
    const pa = priRank[a.priority] ?? 1;
    const pb = priRank[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    const da = a.needBy || '9999-99-99';
    const db = b.needBy || '9999-99-99';
    if (da !== db) return da.localeCompare(db);
    return a.name.localeCompare(b.name);
  });
  return sorted;
}

function shopPriorityPill(priority) {
  if (!priority || priority === 'normal') return '';
  const label = priority === 'high' ? 'HIGH' : 'LOW';
  return `<span class="shop-priority-pill ${priority}">${label}</span>`;
}

function formatShoppingShareText() {
  const allItems = SHOPPING_LIST.flatMap((g) => g.items);
  const label = (weekLabel || 'This week').replace(/^Week of /, 'Week of ');
  const lines = [`HomeBase shopping — ${label}`, ''];
  if (state.listGroupBy === 'store') {
    const byStore = {};
    allItems.forEach((it) => {
      const store = (it.store || '').trim() || 'Any store';
      (byStore[store] = byStore[store] || []).push(it);
    });
    Object.keys(byStore).sort().forEach((store) => {
      lines.push(store.toUpperCase());
      sortShoppingItems(byStore[store]).forEach((it) => {
        const mark = it.checked ? '✓' : '☐';
        const qty = it.qty ? ` (${it.qty})` : '';
        lines.push(`${mark} ${it.name}${qty}`);
      });
      lines.push('');
    });
  } else {
    const byAisle = {};
    allItems.forEach((it) => {
      const aisle = it.aisle || 'Other';
      (byAisle[aisle] = byAisle[aisle] || []).push(it);
    });
    const order = [...SHOP_CATEGORIES, ...Object.keys(byAisle).filter((a) => !SHOP_CATEGORIES.includes(a))];
    order.filter((a) => byAisle[a]?.length).forEach((aisle) => {
      lines.push(aisle.toUpperCase());
      sortShoppingItems(byAisle[aisle]).forEach((it) => {
        const mark = it.checked ? '✓' : '☐';
        const qty = it.qty ? ` (${it.qty})` : '';
        const store = it.store ? ` · ${it.store}` : '';
        lines.push(`${mark} ${it.name}${qty}${store}`);
      });
      lines.push('');
    });
  }
  const open = allItems.filter((i) => !i.checked).length;
  const done = allItems.filter((i) => i.checked).length;
  lines.push(`${open} to buy · ${done} done`);
  return lines.join('\n').trim();
}

function findShoppingItem(id) {
  return SHOPPING_LIST.flatMap((g) => g.items).find((i) => i.id === id) || null;
}

function removeShoppingItemLocal(id) {
  for (const g of SHOPPING_LIST) {
    const idx = g.items.findIndex((i) => i.id === id);
    if (idx >= 0) {
      g.items.splice(idx, 1);
      break;
    }
  }
  SHOPPING_LIST = SHOPPING_LIST.filter((g) => g.items.length);
}

function upsertShoppingItemLocal(item) {
  removeShoppingItemLocal(item.id);
  let group = SHOPPING_LIST.find((g) => g.aisle === item.aisle);
  if (!group) {
    group = { aisle: item.aisle, items: [] };
    SHOPPING_LIST.push(group);
    SHOPPING_LIST.sort((a, b) => a.aisle.localeCompare(b.aisle));
  }
  group.items.push(item);
  group.items = sortShoppingItems(group.items);
}

function renderShoppingList() {
  const allItems = SHOPPING_LIST.flatMap((g) => g.items);
  const openItems = allItems.filter((i) => !i.checked);
  const doneItems = allItems.filter((i) => i.checked);
  const filter = state.listFilter || 'open';
  let visible = filter === 'done' ? doneItems : filter === 'all' ? allItems : openItems;
  if (filter === 'urgent') {
    visible = openItems.filter((i) => i.priority === 'high' || isDueSoon(i.needBy));
  }

  if (state.selectedItemId && !allItems.some((i) => i.id === state.selectedItemId)) {
    state.selectedItemId = null;
  }
  const selected = allItems.find((i) => i.id === state.selectedItemId) || null;
  const selectedRecipes = selected ? (ITEM_RECIPES[selected.id] || []) : [];

  let groupsHtml = '';
  if (!visible.length) {
    groupsHtml = `
      <div class="shop-empty">
        <div class="h2">${filter === 'urgent' ? 'Nothing urgent this week'
          : filter === 'done' ? 'Nothing checked off yet'
          : filter === 'open' ? 'All caught up'
          : 'List is empty'}</div>
        <div class="p" style="margin-top:10px">${filter === 'urgent'
          ? 'Items marked high priority or due in the next 2 days show here.'
          : filter === 'open' && doneItems.length
          ? `${doneItems.length} bought — still shown under ALL (checked items stay at the bottom of each category).`
          : 'Tap + to add milk, produce, or anything else.'}</div>
        <button type="button" class="btn btnr shop-empty-add" data-action="addItem">+ ADD ITEM</button>
      </div>`;
  } else if (state.listGroupBy === 'aisle') {
    const byAisle = {};
    visible.forEach((it) => {
      const aisle = it.aisle || 'Other';
      (byAisle[aisle] = byAisle[aisle] || []).push(it);
    });
    const order = [...SHOP_CATEGORIES, ...Object.keys(byAisle).filter((a) => !SHOP_CATEGORIES.includes(a))];
    groupsHtml = order.filter((a) => byAisle[a]?.length).map((aisle) => {
      const items = sortShoppingItems(byAisle[aisle]);
      const left = items.filter((i) => !i.checked).length;
      return `
        <section class="shop-group">
          <div class="shop-group-head">
            <div class="k">${escapeHtml(aisle.toUpperCase())}</div>
            <div class="m">${left ? `${left} to buy` : 'done'}${items.length !== left ? ` · ${items.length}` : ''}</div>
          </div>
          ${items.map((it) => renderShoppingRow(it)).join('')}
        </section>`;
    }).join('');
  } else if (state.listGroupBy === 'store') {
    const byStore = {};
    visible.forEach((it) => {
      const store = (it.store || '').trim() || 'Any store';
      (byStore[store] = byStore[store] || []).push(it);
    });
    const order = [...SHOP_STORES, 'Any store', ...Object.keys(byStore).filter((s) => !SHOP_STORES.includes(s) && s !== 'Any store')];
    groupsHtml = order.filter((s) => byStore[s]?.length).map((store) => {
      const items = sortShoppingItems(byStore[store]);
      const left = items.filter((i) => !i.checked).length;
      return `
        <section class="shop-group">
          <div class="shop-group-head">
            <div class="k">${escapeHtml(store.toUpperCase())}</div>
            <div class="m">${left ? `${left} to buy` : 'done'}${items.length !== left ? ` · ${items.length}` : ''}</div>
          </div>
          ${items.map((it) => renderShoppingRow(it)).join('')}
        </section>`;
    }).join('');
  } else {
    const byRecipe = {};
    visible.forEach((it) => {
      const recipes = ITEM_RECIPES[it.id] || ['Manual'];
      const primary = recipes[0];
      (byRecipe[primary] = byRecipe[primary] || []).push(it);
    });
    groupsHtml = Object.keys(byRecipe).sort().map((recipe) => `
      <section class="shop-group">
        <div class="shop-group-head">
          <div class="k">${escapeHtml(recipe.toUpperCase())}</div>
          <div class="m">${byRecipe[recipe].length}</div>
        </div>
        ${sortShoppingItems(byRecipe[recipe]).map((it) => renderShoppingRow(it)).join('')}
      </section>`).join('');
  }

  document.getElementById('view').innerHTML = `
    <div class="screen">
      <div class="screen-bar shop-bar">
        <div class="shop-bar-left">
          <div class="h2">Shopping</div>
          <button type="button" class="tg" data-action="shiftWeek" data-value="-1">◀</button>
          <div class="shop-count"><strong>${openItems.length}</strong> to buy · ${escapeHtml((weekLabel || '').replace(/^Week of /, '') || 'this week')}</div>
          <button type="button" class="tg" data-action="shiftWeek" data-value="1">▶</button>
        </div>
        <div class="shop-bar-tools">
          <div class="shop-seg">
            <span class="tg ${filter === 'all' ? 'tgr' : ''}" data-action="setListFilter" data-value="all">ALL</span>
            <span class="tg ${filter === 'open' ? 'tgr' : ''}" data-action="setListFilter" data-value="open">TO BUY</span>
            <span class="tg ${filter === 'urgent' ? 'tgr' : ''}" data-action="setListFilter" data-value="urgent">URGENT</span>
            <span class="tg ${filter === 'done' ? 'tgr' : ''}" data-action="setListFilter" data-value="done">DONE</span>
          </div>
          <div class="shop-seg">
            <span class="tg ${state.listSort === 'due' ? 'tgr' : ''}" data-action="setListSort" data-value="due">DUE</span>
            <span class="tg ${state.listSort === 'name' ? 'tgr' : ''}" data-action="setListSort" data-value="name">A–Z</span>
          </div>
          <div class="shop-seg">
            <span class="tg ${state.listGroupBy === 'aisle' ? 'tgr' : ''}" data-action="setListGroupBy" data-value="aisle">CATEGORY</span>
            <span class="tg ${state.listGroupBy === 'store' ? 'tgr' : ''}" data-action="setListGroupBy" data-value="store">STORE</span>
            <span class="tg ${state.listGroupBy === 'recipe' ? 'tgr' : ''}" data-action="setListGroupBy" data-value="recipe">RECIPE</span>
          </div>
          <span class="tg" data-action="shareShoppingList" title="Share or copy list">SHARE</span>
          ${doneItems.length ? `<span class="tg" data-action="clearCheckedItems" title="Remove checked items">CLEAR DONE</span>` : ''}
          <span class="tg" style="font-size:10px" data-action="addShopCategory">+ CATEGORY</span>
          <button type="button" class="shop-add-btn" data-action="addItem" title="Add item" aria-label="Add item">+</button>
        </div>
      </div>
      <div class="screen-body shop-body">
        <div class="shop-list">${groupsHtml}</div>
        <aside class="shop-aside">
          ${selected ? `
            <div class="shop-aside-block">
              <div class="k">SELECTED</div>
              <div class="h2" style="margin-top:8px">${escapeHtml(selected.name)}</div>
              <div class="shop-aside-meta">
                <span class="shop-cat-pill">${escapeHtml(selected.aisle || 'Other')}</span>
                ${selected.store ? `<span class="shop-store-pill">${escapeHtml(selected.store)}</span>` : ''}
                ${shopPriorityPill(selected.priority)}
                <span class="h3">${escapeHtml(selected.qty || '1')}</span>
              </div>
              ${selected.needBy ? `
                <div class="shop-aside-due" style="margin-top:12px">
                  <div class="k">NEED BY</div>
                  <div class="h3" style="margin-top:4px">${escapeHtml(formatNeedBy(selected.needBy))}</div>
                  <div class="m">${selected.needByOverride ? 'Manual date' : selected.source === 'meal_plan' ? 'Auto from meal plan' : ''}</div>
                </div>` : ''}
              ${selected.note ? `<div class="p" style="margin-top:12px">${escapeHtml(selected.note)}</div>` : ''}
              ${selected.manualOverride ? `<div class="m" style="margin-top:8px">Manual edit locked — meal plan sync won’t overwrite this item.</div>` : ''}
              ${selected.source === 'meal_plan' && !selected.manualOverride ? `
                <div class="m" style="margin-top:8px">From this week’s meal plan — need-by follows the first scheduled meal. Edit to lock your changes.</div>
                ${selected.needByOverride ? `<button type="button" class="btn" style="margin-top:10px;width:100%" data-action="resetShopSchedule" data-id="${escapeHtml(selected.id)}">RESET TO MEAL PLAN DATE</button>` : ''}` : ''}
              ${selected.source === 'meal_plan' && selected.manualOverride && selected.needByOverride ? `
                <button type="button" class="btn" style="margin-top:10px;width:100%" data-action="resetShopSchedule" data-id="${escapeHtml(selected.id)}">RESET NEED-BY DATE</button>` : ''}
              ${selected.source === 'manual' ? `<div class="m" style="margin-top:8px">Added manually — stays on the list until you delete it.</div>` : ''}
              ${selectedRecipes.length ? `
                <div class="k" style="margin-top:18px">USED IN</div>
                <div class="shop-recipe-chips">
                  ${selectedRecipes.map((r) => `<span class="shop-chip">${escapeHtml(r)}</span>`).join('')}
                </div>` : ''}
              <div class="shop-aside-actions">
                <button type="button" class="btn btnr" data-action="editItem" data-id="${escapeHtml(selected.id)}">EDIT</button>
                <button type="button" class="btn" data-action="deleteItem" data-id="${escapeHtml(selected.id)}">DELETE</button>
              </div>
            </div>` : `
            <div class="shop-aside-block">
              <div class="k">THIS WEEK</div>
              <div class="h3" style="margin-top:10px">${escapeHtml(weekLabel || 'Meal plan week')}</div>
              <div class="p" style="margin-top:8px">List builds from this week’s meal plan. Checked items stay visible (struck through at the bottom of each category). Edits you save are kept when the meal plan syncs.</div>
              <button type="button" class="btn btnr" style="margin-top:16px" data-action="addItem">+ ADD ITEM</button>
              <button type="button" class="btn" style="margin-top:8px;width:100%;text-align:center" data-action="shareShoppingList">SHARE LIST</button>
              <button type="button" class="btn" style="margin-top:8px;width:100%;text-align:center" data-action="setTab" data-value="plan">OPEN MEAL PLAN</button>
            </div>`}
          <div class="shop-aside-block">
            <div class="row" style="align-items:center;justify-content:space-between;gap:8px">
              <div class="k">ALREADY AT HOME · ${ALREADY_AT_HOME.length}</div>
              <button type="button" class="tg tgr" style="font-size:10px;padding:4px 8px" data-action="addPantryItem">+ ADD</button>
            </div>
            <div class="m" style="margin-top:8px">In stock — skipped when building the list. Tap <strong>OUT</strong> when it runs out to move it onto shopping.</div>
            ${ALREADY_AT_HOME.length ? `
              <div class="pantry-list">
                ${ALREADY_AT_HOME.map((p) => {
                  const item = typeof p === 'string' ? { id: null, name: p, aisle: 'Pantry' } : p;
                  return `
                    <div class="pantry-row">
                      <button type="button" class="pantry-name" data-action="editPantryItem" data-id="${escapeHtml(item.id || '')}" title="Edit">
                        <span class="h3">${escapeHtml(item.name)}</span>
                        <span class="m">${escapeHtml([item.aisle || 'Pantry', item.store].filter(Boolean).join(' · '))}</span>
                      </button>
                      <button type="button" class="tg" style="font-size:10px" data-action="pantryRanOut" data-id="${escapeHtml(item.id || '')}" title="Ran out — add to shopping">OUT → LIST</button>
                      <button type="button" class="shop-icon-btn danger" data-action="deletePantryItem" data-id="${escapeHtml(item.id || '')}" title="Remove from at home">×</button>
                    </div>`;
                }).join('')}
              </div>` : `<div class="m" style="margin-top:12px">Nothing marked at home yet.</div>`}
          </div>
        </aside>
      </div>
    </div>`;
}

function renderShoppingRow(it) {
  const selected = state.selectedItemId === it.id;
  const recipes = ITEM_RECIPES[it.id];
  return `
    <div class="shop-row ${it.checked ? 'is-checked' : ''} ${selected ? 'is-selected' : ''}">
      <button type="button" class="check ${it.checked ? 'checked' : ''}" data-action="toggleItem" data-id="${escapeHtml(it.id)}" aria-label="${it.checked ? 'Mark not bought' : 'Mark bought'}">${it.checked ? '✓' : ''}</button>
      <button type="button" class="shop-row-main" data-action="selectItem" data-id="${escapeHtml(it.id)}">
        <span class="shop-row-name">${escapeHtml(it.name)}</span>
        <span class="shop-row-sub">
          <span class="shop-cat-pill sm">${escapeHtml(it.aisle || 'Other')}</span>
          ${it.store ? `<span class="shop-store-pill sm">${escapeHtml(it.store)}</span>` : ''}
          ${shopPriorityPill(it.priority)}
          ${it.needBy ? `<span class="shop-needby-pill sm">${escapeHtml(formatNeedBy(it.needBy))}</span>` : ''}
          ${it.manualOverride ? `<span class="shop-locked-pill sm">LOCKED</span>` : ''}
          ${recipes?.length ? `<span class="m">${escapeHtml(recipes.slice(0, 2).join(', '))}${recipes.length > 2 ? '…' : ''}</span>` : ''}
        </span>
      </button>
      <span class="shop-row-qty">${escapeHtml(it.qty || '')}</span>
      <button type="button" class="shop-icon-btn" data-action="editItem" data-id="${escapeHtml(it.id)}" title="Edit">✎</button>
      <button type="button" class="shop-icon-btn danger" data-action="deleteItem" data-id="${escapeHtml(it.id)}" title="Delete">×</button>
    </div>`;
}

// ---------------------------------------------------------------- render dispatch

function render() {
  if (isLoading) {
    document.getElementById('view').innerHTML = '<div class="screen"><div class="screen-body" style="padding:40px"><div class="h2">Loading…</div></div></div>';
    return;
  }
  renderChrome();
  if (state.tab === 'today') return renderDashboard();
  if (state.tab === 'plan') {
    if (state.planSub === 'calendar') return renderCalendar();
    if (state.planSub === 'recipes') {
      return state.selectedRecipeId ? renderRecipeDetail() : renderRecipeGrid();
    }
    return state.selectedDayKey ? renderDayDetail() : renderWeekGrid();
  }
  if (state.tab === 'list') return renderShoppingList();
}

// ---------------------------------------------------------------- actions

const actions = {
  setTab(el) {
    state.tab = el.dataset.value;
    state.selectedDayKey = null;
    if (state.tab === 'plan') state.planSub = 'meals';
    render();
  },
  setPlanSub(el) {
    state.planSub = el.dataset.value;
    state.selectedDayKey = null;
    state.selectedRecipeId = null;
    if (state.planSub === 'recipes' && !RECIPES.length) {
      loadRecipes().then(render).catch((err) => toast(err.message));
      return;
    }
    render();
  },

  async startPrep() {
    state.prepDone = true;
    try { await HomeBaseAPI.patchCalendar({ prepDone: true }); } catch { /* local ok */ }
    render();
    toast('Marked started.');
  },
  async reassignPrep() {
    const day = WEEK[TODAY_INDEX];
    if (!day?.prep) return;
    const newAssignee = day.prep.who === 'charu' ? 'shreya' : 'charu';
    day.prep.who = newAssignee;
    const ev = day.events.find((e) => e.prep);
    if (ev) ev.person = newAssignee;
    render();
    toast(`Reassigned to ${PEOPLE[newAssignee]?.name || newAssignee}.`);
  },
  async toggleEvent(el) {
    const day = WEEK[TODAY_INDEX];
    const ev = day.events[Number(el.dataset.index)];
    if (ev.prep) {
      state.prepDone = !state.prepDone;
      try { await HomeBaseAPI.patchCalendar({ prepDone: state.prepDone }); } catch { /* ok */ }
    } else if (ev.id) {
      ev.done = !ev.done;
      try { await HomeBaseAPI.patchCalendar({ id: ev.id, done: ev.done }); } catch { /* ok */ }
    }
    render();
  },
  async toggleTask(el) {
    const t = HOUSEHOLD_TASKS.find((x) => x.id === el.dataset.id);
    if (!t) return;
    if (t.suggested) {
      t.suggested = false;
      try { await HomeBaseAPI.patchTask({ id: t.id, suggested: false }); } catch { /* ok */ }
      toast(`${t.title} confirmed.`);
    } else {
      t.done = !t.done;
      try { await HomeBaseAPI.patchTask({ id: t.id, done: t.done }); } catch { /* ok */ }
    }
    render();
  },
  async addTask() {
    openModal({
      title: 'New household task',
      submitLabel: 'ADD TASK',
      fieldsHtml: `
        <label><span class="k">TITLE</span><input name="title" required placeholder="e.g. Fold laundry"></label>
        <label><span class="k">ASSIGN TO</span>
          <select name="person">${personOptions('shared')}</select>
        </label>
        <label><span class="k">CATEGORY</span>
          <select name="tag">${tagOptions('errands')}</select>
        </label>
        <label><span class="k">OR NEW CATEGORY</span>
          <input name="newTag" placeholder="e.g. pets, garden (optional)">
        </label>
        <label><span class="k">DUE DATE</span><input name="dueDate" type="date"></label>`,
      async onSubmit(values) {
        const person = values.person || 'shared';
        const tag = String(values.newTag || '').trim() || values.tag || 'errands';
        const r = await HomeBaseAPI.addTask({
          title: values.title,
          person,
          tag,
          dueDate: values.dueDate || null,
        });
        if (Array.isArray(r.tags)) TASK_TAGS = r.tags;
        else if (tag && !TASK_TAGS.includes(tag.toLowerCase().replace(/[^a-z0-9]+/g, '_'))) {
          /* tags refreshed on next bootstrap */
        }
        HOUSEHOLD_TASKS.push({
          id: r.id,
          title: values.title,
          person,
          due: values.dueDate || null,
          dueDate: values.dueDate || null,
          tag: r.tag || tag,
          done: false,
        });
        if (r.tags) TASK_TAGS = r.tags;
        render();
        toast(`Task added · ${person === 'shared' ? 'both' : person}`);
      },
    });
  },
  addTaskCategory() {
    openModal({
      title: 'New task category',
      submitLabel: 'ADD CATEGORY',
      fieldsHtml: `
        <label><span class="k">NAME</span><input name="name" required placeholder="e.g. Pets, Garden, Kids"></label>
        <div class="m" style="margin-top:8px">Shows up in filters and when you add or edit tasks.</div>`,
      async onSubmit(values) {
        const r = await HomeBaseAPI.addTask({ addCategory: true, name: values.name });
        TASK_TAGS = r.tags || TASK_TAGS;
        state.taskFilter = r.tag || state.taskFilter;
        render();
        toast(`Category “${r.tag}” added`);
      },
    });
  },
  editTask(el) {
    const t = HOUSEHOLD_TASKS.find((x) => x.id === el.dataset.id);
    if (!t) return;
    openModal({
      title: 'Edit task',
      submitLabel: 'SAVE',
      fieldsHtml: `
        <label><span class="k">TITLE</span><input name="title" required value="${escapeHtml(t.title)}"></label>
        <label><span class="k">ASSIGN TO</span>
          <select name="person">${personOptions(t.person || 'shared')}</select>
        </label>
        <label><span class="k">CATEGORY</span>
          <select name="tag">${tagOptions(t.tag || 'errands')}</select>
        </label>
        <label><span class="k">OR NEW CATEGORY</span>
          <input name="newTag" placeholder="Type to create one">
        </label>
        <label><span class="k">DUE DATE</span><input name="dueDate" type="date" value="${escapeHtml(t.dueDate || t.due || '')}"></label>
        <label class="row" style="gap:8px;align-items:center;margin-top:8px">
          <input type="checkbox" name="done" value="1" ${t.done ? 'checked' : ''}>
          <span class="m">Mark complete</span>
        </label>
        <div class="modal-actions" style="margin-top:12px;padding:0">
          <button type="button" class="btn" id="deleteTaskBtn" style="color:var(--color-accent)">DELETE TASK</button>
        </div>`,
      async onSubmit(values) {
        const tag = String(values.newTag || '').trim() || values.tag;
        const r = await HomeBaseAPI.patchTask({
          id: t.id,
          title: values.title,
          person: values.person,
          tag,
          dueDate: values.dueDate || null,
          done: !!values.done,
        });
        if (r.tags) TASK_TAGS = r.tags;
        await loadBootstrap();
        render();
        toast('Task saved.');
      },
    });
    setTimeout(() => {
      document.getElementById('deleteTaskBtn')?.addEventListener('click', async () => {
        if (!confirm('Delete this task?')) return;
        try {
          await HomeBaseAPI.deleteTask(t.id);
          closeModal();
          HOUSEHOLD_TASKS = HOUSEHOLD_TASKS.filter((x) => x.id !== t.id);
          render();
          toast('Task deleted.');
        } catch (err) {
          toast(err.message || 'Delete failed');
        }
      });
    }, 50);
  },
  async deleteTask(el) {
    const t = HOUSEHOLD_TASKS.find((x) => x.id === el.dataset.id);
    if (!t) return;
    if (!confirm(`Delete “${t.title}”?`)) return;
    try {
      await HomeBaseAPI.deleteTask(t.id);
      HOUSEHOLD_TASKS = HOUSEHOLD_TASKS.filter((x) => x.id !== t.id);
      render();
      toast('Task deleted.');
    } catch (err) {
      toast(err.message || 'Delete failed');
    }
  },
  addCalEvent() {
    const day = findDay(state.calendarDayKey) || WEEK[TODAY_INDEX] || WEEK[0];
    const defaultDate = day?.dateStr || weekStart || new Date().toISOString().slice(0, 10);
    const defaultPerson = (session?.name || 'shared').toLowerCase();
    openModal({
      title: 'New calendar event',
      submitLabel: 'ADD EVENT',
      fieldsHtml: `
        <label><span class="k">TITLE</span><input name="title" required placeholder="e.g. Gym, Client call"></label>
        <label><span class="k">DATE</span><input name="date" type="date" required value="${escapeHtml(defaultDate)}"></label>
        <div class="row" style="gap:12px">
          <label style="flex:1"><span class="k">START</span><input name="start" type="time" value="09:00" required></label>
          <label style="flex:1"><span class="k">END</span><input name="end" type="time" value="10:00"></label>
        </div>
        <label><span class="k">WHO</span>
          <select name="person">${personOptions(['charu', 'shreya'].includes(defaultPerson) ? defaultPerson : 'shared')}</select>
        </label>
        <label class="row" style="gap:8px;align-items:center;margin-top:8px">
          <input type="checkbox" name="prep" value="1">
          <span class="m">Prep task (meal prep / chores on calendar)</span>
        </label>`,
      async onSubmit(values) {
        await HomeBaseAPI.addCalendarEvent({
          title: values.title,
          date: values.date,
          start: values.start,
          end: values.end || null,
          person: values.person,
          prep: !!values.prep,
        });
        await loadBootstrap();
        render();
        toast('Event added.');
      },
    });
  },
  editCalEvent(el) {
    const ev = findCalEvent(el.dataset.id);
    if (!ev) {
      toast('Event not found — try SYNC NOW or refresh');
      return;
    }
    openModal({
      title: ev.source === 'google' ? 'Edit event (from Google)' : 'Edit event',
      submitLabel: 'SAVE',
      fieldsHtml: `
        <label><span class="k">TITLE</span><input name="title" required value="${escapeHtml(ev.title)}"></label>
        <label><span class="k">DATE</span><input name="date" type="date" required value="${escapeHtml(ev.date || '')}"></label>
        <div class="row" style="gap:12px">
          <label style="flex:1"><span class="k">START</span><input name="start" type="time" value="${escapeHtml((ev.start || '09:00').slice(0, 5))}" required></label>
          <label style="flex:1"><span class="k">END</span><input name="end" type="time" value="${escapeHtml((ev.end || '').slice(0, 5))}"></label>
        </div>
        <label><span class="k">WHO</span>
          <select name="person">${personOptions(ev.person || 'shared')}</select>
        </label>
        <label class="row" style="gap:8px;align-items:center;margin-top:8px">
          <input type="checkbox" name="prep" value="1" ${ev.prep ? 'checked' : ''}>
          <span class="m">Prep task</span>
        </label>
        <label class="row" style="gap:8px;align-items:center">
          <input type="checkbox" name="done" value="1" ${ev.done ? 'checked' : ''}>
          <span class="m">Mark done</span>
        </label>
        ${ev.source === 'google' ? '<div class="m" style="margin-top:8px">Synced from Google — edits stay in HomeBase only (not written back to Google).</div>' : ''}
        <div class="modal-actions" style="margin-top:12px;padding:0">
          <button type="button" class="btn" id="deleteCalEventBtn" style="color:var(--color-accent)">DELETE</button>
        </div>`,
      async onSubmit(values) {
        await HomeBaseAPI.patchCalendar({
          id: ev.id,
          title: values.title,
          date: values.date,
          start: values.start,
          end: values.end || null,
          person: values.person,
          prep: !!values.prep,
          done: !!values.done,
        });
        await loadBootstrap();
        if (state.calendarMode === 'month' && state.monthCursor) {
          await loadMonthEvents(state.monthCursor).catch(() => {});
        }
        render();
        toast('Event saved.');
      },
    });
    setTimeout(() => {
      document.getElementById('deleteCalEventBtn')?.addEventListener('click', async () => {
        if (!confirm('Delete this event from HomeBase?')) return;
        try {
          await HomeBaseAPI.deleteCalendarEvent(ev.id);
          closeModal();
          await loadBootstrap();
          if (state.calendarMode === 'month' && state.monthCursor) {
            await loadMonthEvents(state.monthCursor).catch(() => {});
          }
          render();
          toast('Event deleted.');
        } catch (err) {
          toast(err.message || 'Delete failed');
        }
      });
    }, 50);
  },

  async calendarView(el) {
    const mode = el.dataset.value || 'week';
    state.calendarMode = mode;
    if (mode === 'day') {
      state.calendarDayKey = state.calendarDayKey || WEEK[TODAY_INDEX]?.key || WEEK[0]?.key;
      render();
      return;
    }
    if (mode === 'month') {
      state.monthCursor = state.monthCursor
        || (weekStart ? `${weekStart.slice(0, 8)}01` : new Date().toISOString().slice(0, 8) + '01');
      try {
        await loadMonthEvents(state.monthCursor);
      } catch (err) {
        toast(err.message || 'Could not load month');
      }
      render();
      return;
    }
    render();
  },
  openCalDay(el) {
    state.calendarMode = 'day';
    state.calendarDayKey = el.dataset.key || WEEK[TODAY_INDEX]?.key;
    render();
  },
  async openCalDayFromMonth(el) {
    const dateStr = el.dataset.date;
    if (!dateStr) return;
    // Load that week so day timeline has full household data
    const prev = weekStart;
    weekStart = dateStr;
    try {
      await loadBootstrap();
      // Align to Monday of that week for consistency
      weekStart = WEEK[0]?.dateStr || dateStr;
      const day = WEEK.find((d) => d.dateStr === dateStr) || WEEK[0];
      state.calendarMode = 'day';
      state.calendarDayKey = day?.key || null;
      render();
    } catch (err) {
      weekStart = prev;
      toast(err.message || 'Could not open day');
    }
  },
  async shiftCalDay(el) {
    const delta = Number(el.dataset.value) || 0;
    const idx = WEEK.findIndex((d) => d.key === state.calendarDayKey);
    const next = idx + delta;
    if (next >= 0 && next < WEEK.length) {
      state.calendarDayKey = WEEK[next].key;
      render();
      return;
    }
    // Cross week boundary
    const prev = weekStart;
    const base = WEEK[0]?.dateStr || weekStart;
    if (!base) return;
    weekStart = shiftDateStr(base, delta > 0 ? 7 : -7);
    try {
      await loadBootstrap();
      state.calendarDayKey = delta > 0 ? WEEK[0]?.key : WEEK[WEEK.length - 1]?.key;
      render();
    } catch (err) {
      weekStart = prev;
      toast(err.message || 'Could not change day');
    }
  },
  async shiftMonth(el) {
    const delta = Number(el.dataset.value) || 0;
    const cursor = state.monthCursor || (weekStart ? `${weekStart.slice(0, 8)}01` : new Date().toISOString().slice(0, 8) + '01');
    const [y, m] = cursor.slice(0, 7).split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const pad = (n) => String(n).padStart(2, '0');
    state.monthCursor = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    try {
      await loadMonthEvents(state.monthCursor);
      render();
    } catch (err) {
      toast(err.message || 'Could not change month');
    }
  },
  async scheduleAi() {
    try {
      const r = await HomeBaseAPI.aiScheduleConfirm();
      state.calendarAiConfirmed = true;
      aiInsights.calendar = r.summary;
      await loadBootstrap();
      render();
      toast('Scheduled on the calendar.');
    } catch (err) {
      toast(err.message || 'Schedule failed');
    }
  },
  showOtherWindows() { state.showOtherWindows = !state.showOtherWindows; render(); },
  setTaskFilter(el) { state.taskFilter = el.dataset.value; render(); },

  setMealMode(el) { state.mealMode = el.dataset.value; render(); },
  async copyWeekMeals() {
    const fromWeekStart = weekStart || WEEK[0]?.dateStr;
    if (!fromWeekStart) {
      toast('Week not loaded yet');
      return;
    }
    const filled = WEEK.some((d) => Object.values(d.meals || {}).some((m) => m?.name && m.name !== '—'));
    if (!filled) {
      toast('This week is empty — add meals first');
      return;
    }
    try {
      toast('Copying meal plan to next week…');
      const r = await HomeBaseAPI.copyWeekMeals(fromWeekStart);
      weekStart = r.toWeekStart;
      state.selectedDayKey = null;
      await loadBootstrap();
      render();
      toast(`Copied ${r.copied} meal${r.copied === 1 ? '' : 's'} to next week`);
    } catch (err) {
      toast(err.message || 'Could not copy week');
    }
  },
  async shiftWeek(el) {
    const delta = Number(el.dataset.value) || 0;
    const prevStart = weekStart || WEEK[0]?.dateStr;
    if (!prevStart) {
      toast('Week not loaded yet');
      return;
    }
    const nextStart = shiftDateStr(prevStart, delta * 7);
    weekStart = nextStart;
    state.selectedDayKey = null;
    try {
      toast(delta > 0 ? 'Loading next week…' : 'Loading previous week…');
      await loadBootstrap();
      render();
      const dinners = WEEK.filter((d) => d.dinner?.name && d.dinner.name !== '—').length;
      toast(
        (weekLabel || nextStart)
        + (dinners ? ` · ${dinners} dinners` : ' · empty — add from Recipes'),
      );
    } catch (err) {
      weekStart = prevStart;
      toast(err.message || 'Could not change week');
    }
  },
  async openRecipe(el) {
    state.selectedRecipeId = el.dataset.id;
    try {
      const data = await HomeBaseAPI.getRecipe(el.dataset.id);
      const idx = RECIPES.findIndex((r) => r.id === el.dataset.id);
      if (idx >= 0) RECIPES[idx] = { ...RECIPES[idx], ...data.recipe, _full: data.recipe };
      else RECIPES.push({ ...data.recipe, _full: data.recipe });
      render();
    } catch (err) {
      toast(err.message);
    }
  },
  backToRecipes() { state.selectedRecipeId = null; render(); },
  async deleteRecipe(el) {
    const id = el.dataset.id;
    const recipe = RECIPES.find((r) => r.id === id);
    if (!id) return;
    if (!confirm(`Delete “${recipe?.name || 'this recipe'}”? Meals using it keep the name as text.`)) return;
    try {
      await HomeBaseAPI.deleteRecipe(id);
      RECIPES = RECIPES.filter((r) => r.id !== id);
      if (state.selectedRecipeId === id) state.selectedRecipeId = null;
      recipeCount = Math.max(0, (recipeCount || 1) - 1);
      render();
      toast('Recipe deleted.');
    } catch (err) {
      toast(err.message || 'Could not delete');
    }
  },
  async pickRecipeForPlan(el) {
    state.selectedRecipeId = el.dataset.id;
    state.planSub = 'recipes';
    try {
      const data = await HomeBaseAPI.getRecipe(el.dataset.id);
      const idx = RECIPES.findIndex((r) => r.id === el.dataset.id);
      if (idx >= 0) RECIPES[idx] = { ...RECIPES[idx], ...data.recipe, _full: data.recipe };
      render();
      toast('Pick a day on the right to set dinner.');
    } catch (err) {
      toast(err.message);
    }
  },
  async assignRecipeToDay(el) {
    const recipeId = el.dataset.id;
    const planDate = el.dataset.day;
    try {
      await HomeBaseAPI.patchMeals({ planDate, slotKey: state.assignSlot || 'dinner', recipeId });
      await loadBootstrap();
      state.planSub = 'meals';
      state.selectedRecipeId = null;
      render();
      toast('Meal plan updated.');
    } catch (err) {
      toast(err.message);
    }
  },
  async assignRecipeToSlot(el) {
    try {
      await HomeBaseAPI.patchMeals({
        planDate: el.dataset.day,
        slotKey: el.dataset.slot || 'dinner',
        recipeId: el.dataset.id,
      });
      await loadBootstrap();
      state.planSub = 'meals';
      state.selectedRecipeId = null;
      render();
      toast(`${SLOT_LABELS[el.dataset.slot] || 'Meal'} updated.`);
    } catch (err) {
      toast(err.message);
    }
  },
  setAssignSlot(el) { state.assignSlot = el.dataset.value; render(); },
  setRecipeFilter(el) {
    state.recipeFilter = el.dataset.value;
    state.selectedRecipeId = null;
    render();
  },
  async aiFillRecipe(el) {
    const id = el.dataset.id;
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) return;
    try {
      toast('AI is estimating calories…');
      const { estimate } = await HomeBaseAPI.estimateRecipe({ name: recipe.name });
      await HomeBaseAPI.patchRecipe({
        id,
        kcal: estimate.kcal,
        protein: estimate.protein,
        minutes: estimate.minutes,
        servings: estimate.servings,
        tags: estimate.tags,
        method: estimate.method,
        ingredients: estimate.ingredients,
        imageUrl: estimate.imageUrl,
      });
      await loadRecipes();
      if (state.selectedRecipeId === id || !state.selectedRecipeId) {
        const data = await HomeBaseAPI.getRecipe(id);
        const idx = RECIPES.findIndex((r) => r.id === id);
        if (idx >= 0) RECIPES[idx] = { ...RECIPES[idx], ...data.recipe, _full: data.recipe };
      }
      render();
      toast(`${estimate.kcal} kcal · ${estimate.protein}g protein`);
    } catch (err) {
      toast(err.message || 'AI estimate failed');
    }
  },
  addCustomSlot() {
    openModal({
      title: 'Custom meal slot',
      submitLabel: 'ADD SLOT',
      fieldsHtml: `
        <label><span class="k">NAME</span><input name="name" required placeholder="e.g. Dessert, Second breakfast"></label>
        <div class="m" style="margin-top:10px">Shows up on day view and meal plan for the whole household.</div>`,
      async onSubmit(values) {
        await HomeBaseAPI.addSlot({ name: values.name });
        await loadBootstrap();
        render();
        toast('Slot added.');
      },
    });
  },
  async setDaySlot(el) {
    const day = findDay(state.selectedDayKey);
    if (!day?.dateStr) return;
    const slot = el.dataset.slot;
    if (!RECIPES.length) await loadRecipes().catch(() => {});
    openRecipePicker({
      title: `Set ${SLOT_LABELS[slot]} · ${day.label} ${day.date}`,
      async onPick(pick) {
        await HomeBaseAPI.patchMeals({
          planDate: day.dateStr,
          slotKey: slot,
          ...pick,
        });
        await loadBootstrap();
        render();
        toast(`${SLOT_LABELS[slot]} updated.`);
      },
    });
  },
  async quickAssignRecipe(el) {
    state.selectedRecipeId = el.dataset.id;
    state.assignSlot = 'lunch';
    try {
      const data = await HomeBaseAPI.getRecipe(el.dataset.id);
      const idx = RECIPES.findIndex((r) => r.id === el.dataset.id);
      if (idx >= 0) RECIPES[idx] = { ...RECIPES[idx], ...data.recipe, _full: data.recipe };
      render();
      toast('Pick a meal slot and day on the right.');
    } catch (err) {
      toast(err.message);
    }
  },
  async editRecipe(el) {
    const id = el.dataset.id;
    let full;
    try {
      const data = await HomeBaseAPI.getRecipe(id);
      full = data.recipe;
    } catch (err) {
      toast(err.message);
      return;
    }
    openModal({
      title: 'Edit recipe',
      submitLabel: 'SAVE',
      fieldsHtml: `
        <label><span class="k">NAME</span><input name="name" required value="${escapeHtml(full.name)}"></label>
        <label><span class="k">MEAL TYPE</span>
          <select name="tag">
            ${['breakfast','lunch','dinner','snack','side','drink'].map((t) =>
              `<option value="${t}" ${(full.tags || []).includes(t) ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label><span class="k">MINUTES</span><input name="minutes" type="number" value="${full.minutes ?? 30}"></label>
        <label><span class="k">KCAL</span><input name="kcal" type="number" value="${full.kcal ?? 400}"></label>
        <label><span class="k">PROTEIN (G)</span><input name="protein" type="number" value="${full.protein ?? 20}"></label>
        <label><span class="k">SERVINGS</span><input name="servings" value="${escapeHtml(full.servings || '2')}"></label>
        <label><span class="k">PHOTO URL</span>
          <input name="imageUrl" value="${escapeHtml(full.imageUrl || '')}" placeholder="https://… or leave blank for AI photo">
        </label>
        <label><span class="k">REFERENCE LINK</span>
          <input name="sourceUrl" type="url" value="${escapeHtml(full.sourceUrl || '')}" placeholder="YouTube, Instagram, or recipe blog URL">
        </label>
        <label><span class="k">LINK LABEL (optional)</span>
          <input name="sourceName" value="${escapeHtml(full.sourceName || '')}" placeholder="e.g. YouTube · @chef (auto-detected if blank)">
        </label>
        <label><span class="k">METHOD (one step per line)</span>
          <textarea name="method">${escapeHtml((full.method || []).join('\n'))}</textarea>
        </label>
        <label><span class="k">INGREDIENTS (name | qty | aisle per line)</span>
          <textarea name="ingredients">${escapeHtml((full.ingredients || []).map((i) => [i.name, i.qty || '', i.aisle || ''].join(' | ')).join('\n'))}</textarea>
        </label>`,
      async onSubmit(values) {
        await HomeBaseAPI.patchRecipe({
          id,
          ...parseRecipeFormValues(values),
        });
        await loadRecipes();
        if (state.selectedRecipeId === id) {
          const data = await HomeBaseAPI.getRecipe(id);
          const idx = RECIPES.findIndex((r) => r.id === id);
          if (idx >= 0) RECIPES[idx] = { ...RECIPES[idx], ...data.recipe, _full: data.recipe };
        }
        render();
        toast('Recipe saved.');
      },
    });
  },
  editRecipePhoto(el) {
    const id = el.dataset.id;
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) return;
    const current = recipe.imageUrl || recipeCover(recipe);
    openModal({
      title: 'Recipe photo',
      submitLabel: 'SAVE PHOTO',
      fieldsHtml: `
        <div style="margin-bottom:14px">
          <img src="${escapeHtml(current)}" alt="" style="width:100%;max-height:200px;object-fit:cover;border:2px solid var(--color-text)">
        </div>
        <label><span class="k">IMAGE URL</span>
          <input name="imageUrl" value="${escapeHtml(recipe.imageUrl || '')}" placeholder="https://… direct .jpg / googleusercontent link">
        </label>
        <label><span class="k">OR DESCRIBE A NEW AI PHOTO</span>
          <input name="prompt" placeholder="e.g. butter chicken in a bowl, warm lighting">
        </label>
        <div class="m" style="margin-top:10px">Use a <strong>direct image address</strong> (right-click photo → Copy image address). Google Images search pages won’t display. Or leave URL blank and describe an AI photo.</div>`,
      async onSubmit(values) {
        const pasted = String(values.imageUrl || '').trim();
        let imageUrl = normalizeRecipeImageUrl(pasted);
        const prompt = String(values.prompt || '').trim();
        if (pasted && !imageUrl) {
          throw new Error('That looks like a Google search page, not an image file. Right-click the photo → Copy image address.');
        }
        if (!imageUrl && prompt) {
          imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ', plated food photography, appetizing')}?width=800&height=1000&nologo=true&seed=${Date.now()}`;
        }
        if (!imageUrl) {
          imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent((recipe.name || 'food') + ', plated food photography, appetizing')}?width=800&height=1000&nologo=true&seed=${Date.now()}`;
        }
        await HomeBaseAPI.patchRecipe({ id, imageUrl });
        await loadRecipes();
        if (state.selectedRecipeId === id) {
          const data = await HomeBaseAPI.getRecipe(id);
          const idx = RECIPES.findIndex((r) => r.id === id);
          if (idx >= 0) RECIPES[idx] = { ...RECIPES[idx], ...data.recipe, _full: data.recipe };
        }
        render();
        toast('Photo updated.');
      },
    });
  },
  assignRecipePrompt() {
    toast('Pick a meal slot and day on the right.');
  },
  importRecipeJson() {
    openModal({
      title: 'Import recipe JSON',
      submitLabel: 'IMPORT',
      fieldsHtml: `
        <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button type="button" class="btn" id="copyAiPrompt">COPY AI PROMPT</button>
          <button type="button" class="btn" id="pasteExample">EXAMPLE JSON</button>
        </div>
        <label><span class="k">PASTE JSON FROM AI CHATBOT</span>
          <textarea name="json" rows="14" placeholder='{ "recipe_name": "...", "ingredients": [...] }' style="font-family:ui-monospace,monospace;font-size:12px"></textarea>
        </label>
        <div class="m" style="margin-top:10px">Works with Insta recipes — copy the AI prompt, paste the caption in ChatGPT/Claude, then paste the JSON here. Same name updates an existing recipe.</div>`,
      async onSubmit(values) {
        let payload;
        try {
          payload = parseJsonFromAi(values.json);
        } catch {
          throw new Error('Invalid JSON — ask AI for ONLY JSON, no markdown');
        }
        toast('Importing…');
        const r = await HomeBaseAPI.importJson(payload);
        await loadRecipes();
        await loadBootstrap().catch(() => {});
        state.planSub = 'recipes';
        state.selectedRecipeId = r.imported?.[0]?.id || null;
        render();
        const parts = [];
        if (r.created) parts.push(`${r.created} new`);
        if (r.updated) parts.push(`${r.updated} updated`);
        if (r.meals) parts.push(`${r.meals} meals`);
        toast(`Imported${parts.length ? ': ' + parts.join(', ') : ''}`);
      },
    });
    setTimeout(() => {
      document.getElementById('copyAiPrompt')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(AI_RECIPE_PROMPT);
          toast('AI prompt copied — paste in ChatGPT/Claude, then add your recipe');
        } catch {
          toast('Could not copy — see docs/ai-recipe-import-prompt.md');
        }
      });
      document.getElementById('pasteExample')?.addEventListener('click', async () => {
        try {
          const ex = await HomeBaseAPI.importJsonSchema();
          const ta = document.querySelector('#modalForm textarea[name=json]');
          if (ta && ex.exampleSingleRecipe) {
            ta.value = JSON.stringify(ex.exampleSingleRecipe, null, 2);
          }
        } catch {
          toast('Could not load example');
        }
      });
    }, 60);
  },
  async aiInventRecipes() {
    try {
      toast('AI is inventing recipes…');
      const r = await HomeBaseAPI.inventRecipes({ count: 3 });
      await loadRecipes();
      state.planSub = 'recipes';
      state.selectedRecipeId = null;
      render();
      toast(`Added ${(r.recipes || []).length} recipes`);
    } catch (err) {
      toast(err.message || 'AI invent failed');
    }
  },
  addRecipe() {
    openModal({
      title: 'Add a recipe',
      submitLabel: 'SAVE RECIPE',
      fieldsHtml: `
        <label><span class="k">NAME</span>
          <input name="name" required placeholder="e.g. Butter chicken">
        </label>
        <label><span class="k">MEAL TYPE</span>
          <select name="tag">
            ${['breakfast','lunch','dinner','snack','side','drink'].map((t) => `<option value="${t}" ${t === 'dinner' ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label><span class="k">MINUTES</span><input name="minutes" type="number" placeholder="30"></label>
        <label><span class="k">KCAL</span><input name="kcal" type="number" placeholder="400"></label>
        <label><span class="k">PROTEIN (G)</span><input name="protein" type="number" placeholder="20"></label>
        <label><span class="k">SERVINGS</span><input name="servings" value="2"></label>
        <label><span class="k">PHOTO URL</span>
          <input name="imageUrl" placeholder="Optional — auto photo if blank">
        </label>
        <label><span class="k">REFERENCE LINK</span>
          <input name="sourceUrl" type="url" placeholder="YouTube, Instagram, or website URL">
        </label>
        <label><span class="k">LINK LABEL (optional)</span>
          <input name="sourceName" placeholder="e.g. YouTube · @chef (auto if blank)">
        </label>
        <label><span class="k">METHOD (one step per line)</span>
          <textarea name="method" placeholder="Prep ingredients&#10;Cook&#10;Serve"></textarea>
        </label>
        <label><span class="k">INGREDIENTS (name | qty | aisle per line)</span>
          <textarea name="ingredients" placeholder="Chicken | 500g | Meat"></textarea>
        </label>
        <label class="row" style="gap:8px;align-items:flex-start;margin-top:12px">
          <input type="checkbox" name="useAi" value="1" style="margin-top:3px">
          <span class="m">Optional: use AI to fill calories, steps & ingredients (uses your API credits)</span>
        </label>`,
      async onSubmit(values) {
        let payload = parseRecipeFormValues(values);
        if (values.useAi) {
          try {
            toast('AI is filling details…');
            const { estimate } = await HomeBaseAPI.estimateRecipe({ name: values.name });
            payload = {
              ...payload,
              name: estimate.name || payload.name,
              minutes: estimate.minutes ?? payload.minutes,
              kcal: estimate.kcal ?? payload.kcal,
              protein: estimate.protein ?? payload.protein,
              servings: estimate.servings || payload.servings,
              tags: estimate.tags?.length ? estimate.tags : payload.tags,
              method: estimate.method?.length ? estimate.method : payload.method,
              ingredients: estimate.ingredients?.length ? estimate.ingredients : payload.ingredients,
              imageUrl: estimate.imageUrl || payload.imageUrl,
            };
          } catch (err) {
            toast(err.message || 'AI unavailable — saved your manual entry');
          }
        }
        const r = await HomeBaseAPI.addRecipe(payload);
        await loadRecipes();
        state.planSub = 'recipes';
        state.selectedRecipeId = r.recipe?.id || null;
        render();
        toast(values.useAi && payload.kcal ? `${payload.kcal} kcal · ${payload.protein}g protein` : 'Recipe saved.');
      },
    });
  },
  async askAi() {
    try {
      toast('AI is inventing dinners + adding recipes…');
      const weekStart = WEEK[0]?.dateStr;
      const r = await HomeBaseAPI.aiMealplan({ force: true, apply: true, weekStart });
      aiInsights.mealplan = r.insight;
      state.planSub = 'meals';
      state.selectedDayKey = null;
      await loadBootstrap();
      await loadRecipes().catch(() => {});
      render();
      const n = (r.dinners || []).length;
      const created = (r.createdRecipes || []).length;
      toast(
        n
          ? `Planned ${n} dinners` + (created ? ` · ${created} new recipes in the book` : '')
          : (r.insight || 'Plan updated'),
      );
    } catch (err) {
      toast(err.message || 'AI unavailable — check API key in .env.local');
    }
  },
  openDayDetail(el) { state.selectedDayKey = el.dataset.key; render(); },
  backToWeek() { state.selectedDayKey = null; render(); },
  stepDay(el) {
    const idx = WEEK.findIndex((d) => d.key === state.selectedDayKey);
    const next = (idx + Number(el.dataset.value) + WEEK.length) % WEEK.length;
    state.selectedDayKey = WEEK[next].key;
    render();
  },
  setDayDetailPerson(el) { state.dayDetailPerson = el.dataset.value; render(); },
  async swapSlot(el) {
    const day = findDay(state.selectedDayKey);
    const key = day.key + ':' + el.dataset.slot;
    const alt = SWAP_ALT[el.dataset.slot];
    if (state.slotSwaps.has(key)) {
      state.slotSwaps.delete(key);
    } else {
      state.slotSwaps.add(key);
      if (alt && day.dateStr) {
        try {
          await HomeBaseAPI.patchMeals({
            planDate: day.dateStr,
            slotKey: el.dataset.slot,
            adhocName: alt.name,
            kcal: alt.kcal,
            protein: alt.protein,
          });
        } catch { /* local swap still shows */ }
      }
    }
    render();
  },

  async logMeal(el) {
    const planDate = el.dataset.date;
    const slotKey = el.dataset.slot;
    const status = el.dataset.status || 'planned';
    if (!planDate || !slotKey) return;
    const day = WEEK.find((d) => d.dateStr === planDate);
    const meal = day?.meals?.[slotKey];
    if (!meal || !meal.name || meal.name === '—') {
      toast('Add a meal in that slot first');
      return;
    }
    meal.status = status;
    render();
    try {
      await HomeBaseAPI.patchMeals({ planDate, slotKey, status });
      toast(status === 'eaten' ? 'Marked eaten' : status === 'skipped' ? 'Skipped — kcal not counted' : 'Reset to planned');
    } catch (err) {
      await loadBootstrap();
      render();
      toast(err.message || 'Could not update');
    }
  },

  setListGroupBy(el) { state.listGroupBy = el.dataset.value; render(); },
  setListFilter(el) { state.listFilter = el.dataset.value; render(); },
  setListSort(el) { state.listSort = el.dataset.value; render(); },
  selectItem(el) { state.selectedItemId = el.dataset.id; render(); },
  async shareShoppingList() {
    const text = formatShoppingShareText();
    const title = `Shopping — ${(weekLabel || 'this week').replace(/^Week of /, '')}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text });
        toast('Shared.');
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('List copied — paste into Messages or Notes.');
    } catch {
      openModal({
        title: 'Share shopping list',
        submitLabel: 'CLOSE',
        fieldsHtml: `<textarea readonly rows="14" style="width:100%;font-family:var(--font-mono);font-size:12px">${escapeHtml(text)}</textarea>
          <div class="m" style="margin-top:8px">Select all and copy.</div>`,
        async onSubmit() {},
      });
    }
  },
  async toggleItem(el) {
    const it = findShoppingItem(el.dataset.id);
    if (!it) return;
    it.checked = !it.checked;
    try { await HomeBaseAPI.patchShopping({ id: it.id, checked: it.checked }); } catch { /* ok */ }
    render();
  },
  addShopCategory() {
    openModal({
      title: 'New shopping category',
      submitLabel: 'ADD CATEGORY',
      fieldsHtml: `
        <label><span class="k">NAME</span><input name="name" required placeholder="e.g. Indian store, Household, Pet"></label>
        <div class="m" style="margin-top:8px">Shows in category filters and when you add or edit items.</div>`,
      async onSubmit(values) {
        const r = await HomeBaseAPI.addShopping({ addCategory: true, name: values.name });
        applyShopCategories(r.categories);
        render();
        toast(`Category “${r.category}” added`);
      },
    });
  },
  async addItem() {
    openModal({
      title: 'Add item',
      submitLabel: 'ADD',
      fieldsHtml: `
        <label><span class="k">NAME</span><input name="name" required placeholder="e.g. Milk"></label>
        <label><span class="k">QTY</span><input name="qty" value="1" placeholder="e.g. 2"></label>
        ${shopCategoryField('Other')}
        ${shopStoreField('store', '')}
        ${shopScheduleFields()}
        <label><span class="k">NOTE (optional)</span><input name="note" placeholder="Brand, size…"></label>`,
      async onSubmit(values) {
        const aisle = resolveShopCategory(values);
        const qty = values.qty || '1';
        const note = values.note || 'Added manually';
        const store = String(values.store || '').trim();
        const r = await HomeBaseAPI.addShopping({
          name: values.name,
          qty,
          aisle,
          note,
          store: store || null,
          needBy: values.needBy || null,
          priority: values.priority || 'normal',
          weekStart: weekStart || WEEK[0]?.dateStr,
        });
        applyShopCategories(r.categories);
        const item = {
          id: r.id, name: values.name, qty, aisle, note, store,
          needBy: r.needBy || values.needBy || null,
          needByOverride: !!values.needBy,
          priority: r.priority || values.priority || 'normal',
          priorityOverride: !!values.priority,
          checked: false, source: 'manual',
        };
        upsertShoppingItemLocal(item);
        state.selectedItemId = r.id;
        state.listFilter = 'all';
        render();
        toast('Added.');
      },
    });
  },
  async editItem(el) {
    const it = findShoppingItem(el.dataset.id);
    if (!it) return;
    state.selectedItemId = it.id;
    openModal({
      title: 'Edit item',
      submitLabel: 'SAVE',
      fieldsHtml: `
        <label><span class="k">NAME</span><input name="name" required value="${escapeHtml(it.name)}"></label>
        <label><span class="k">QTY</span><input name="qty" value="${escapeHtml(it.qty || '1')}"></label>
        ${shopCategoryField(it.aisle || 'Other')}
        ${shopStoreField('store', it.store || '')}
        ${shopScheduleFields(it)}
        <label><span class="k">NOTE</span><input name="note" value="${escapeHtml(it.note || '')}"></label>`,
      async onSubmit(values) {
        const aisle = resolveShopCategory(values, it.aisle || 'Other');
        const qty = values.qty || '1';
        const note = values.note || '';
        const store = String(values.store || '').trim();
        const r = await HomeBaseAPI.patchShopping({
          id: it.id,
          name: values.name,
          qty,
          aisle,
          note,
          store: store || null,
          needBy: values.needBy || null,
          priority: values.priority || 'normal',
          weekStart: weekStart || WEEK[0]?.dateStr,
        });
        applyShopCategories(r.categories);
        upsertShoppingItemLocal({
          ...it,
          name: values.name,
          qty,
          aisle,
          note,
          store,
          needBy: r.item?.needBy ?? (values.needBy || null),
          needByOverride: r.item?.needByOverride ?? !!values.needBy,
          priority: r.item?.priority ?? values.priority ?? 'normal',
          priorityOverride: r.item?.priorityOverride ?? true,
          manualOverride: r.item?.manualOverride ?? true,
        });
        render();
        toast('Updated.');
      },
    });
  },
  async resetShopSchedule(el) {
    const it = findShoppingItem(el.dataset.id);
    if (!it) return;
    try {
      const r = await HomeBaseAPI.patchShopping({
        id: it.id,
        resetAutoSchedule: true,
        weekStart: weekStart || WEEK[0]?.dateStr,
      });
      await loadBootstrap();
      state.selectedItemId = it.id;
      render();
      toast(r.item?.needBy ? `Need by ${formatNeedBy(r.item.needBy)}` : 'Schedule reset');
    } catch (err) {
      toast(err.message || 'Could not reset');
    }
  },
  async deleteItem(el) {
    const it = findShoppingItem(el.dataset.id);
    if (!it) return;
    if (it.source === 'meal_plan') {
      if (!confirm(`“${it.name}” comes from this week’s meals. Remove it anyway? (It may come back if you keep that recipe on the plan.)`)) return;
    } else if (!confirm(`Remove “${it.name}” from the list?`)) {
      return;
    }
    try {
      await HomeBaseAPI.deleteShopping({ id: it.id });
    } catch (err) {
      toast(err.message || 'Could not delete');
      return;
    }
    removeShoppingItemLocal(it.id);
    if (state.selectedItemId === it.id) state.selectedItemId = null;
    render();
    toast('Removed.');
  },
  async clearCheckedItems() {
    const n = SHOPPING_LIST.flatMap((g) => g.items).filter((i) => i.checked).length;
    if (!n) return;
    if (!confirm(`Remove ${n} checked item${n === 1 ? '' : 's'}?`)) return;
    try {
      await HomeBaseAPI.deleteShopping({ clearChecked: true, weekStart: weekStart || WEEK[0]?.dateStr });
    } catch (err) {
      toast(err.message || 'Could not clear');
      return;
    }
    for (const g of SHOPPING_LIST) {
      g.items = g.items.filter((i) => !i.checked);
    }
    SHOPPING_LIST = SHOPPING_LIST.filter((g) => g.items.length);
    state.selectedItemId = null;
    render();
    toast('Cleared done items.');
  },
  addPantryItem() {
    openModal({
      title: 'Add at home',
      submitLabel: 'ADD',
      fieldsHtml: `
        <label><span class="k">NAME</span><input name="name" required placeholder="e.g. Basmati"></label>
        ${shopCategoryField('Pantry')}
        ${shopStoreField('store', '')}
        <div class="m" style="margin-top:8px">Stays off the shopping list until you mark it OUT.</div>`,
      async onSubmit(values) {
        const r = await HomeBaseAPI.addPantry({
          name: values.name,
          aisle: resolveShopCategory(values, 'Pantry'),
          store: String(values.store || '').trim() || null,
          weekStart: weekStart || WEEK[0]?.dateStr,
        });
        applyShopCategories(r.categories);
        await loadBootstrap();
        render();
        toast('Added to at home.');
      },
    });
  },
  editPantryItem(el) {
    const id = el.dataset.id;
    const item = ALREADY_AT_HOME.find((p) => p.id === id || p.name === id);
    if (!item?.id) {
      toast('Refresh and try again');
      return;
    }
    openModal({
      title: 'Edit at home',
      submitLabel: 'SAVE',
      fieldsHtml: `
        <label><span class="k">NAME</span><input name="name" required value="${escapeHtml(item.name)}"></label>
        ${shopCategoryField(item.aisle || 'Pantry')}
        ${shopStoreField('store', item.store || '')}`,
      async onSubmit(values) {
        const r = await HomeBaseAPI.patchPantry({
          id: item.id,
          name: values.name,
          aisle: resolveShopCategory(values, item.aisle || 'Pantry'),
          store: String(values.store || '').trim() || null,
          weekStart: weekStart || WEEK[0]?.dateStr,
        });
        applyShopCategories(r.categories);
        await loadBootstrap();
        render();
        toast('Updated.');
      },
    });
  },
  async pantryRanOut(el) {
    const id = el.dataset.id;
    const item = ALREADY_AT_HOME.find((p) => p.id === id);
    if (!item?.id) {
      toast('Refresh and try again');
      return;
    }
    if (!confirm(`“${item.name}” ran out — move it to this week’s shopping list?`)) return;
    try {
      await HomeBaseAPI.deletePantry({
        id: item.id,
        moveToShopping: true,
        weekStart: weekStart || WEEK[0]?.dateStr,
      });
      await loadBootstrap();
      state.listFilter = 'all';
      render();
      toast(`${item.name} → shopping list`);
    } catch (err) {
      toast(err.message || 'Could not move');
    }
  },
  async deletePantryItem(el) {
    const id = el.dataset.id;
    const item = ALREADY_AT_HOME.find((p) => p.id === id);
    if (!item?.id) {
      toast('Refresh and try again');
      return;
    }
    if (!confirm(`Remove “${item.name}” from at home? (Won’t add to shopping.)`)) return;
    try {
      await HomeBaseAPI.deletePantry({
        id: item.id,
        moveToShopping: false,
        weekStart: weekStart || WEEK[0]?.dateStr,
      });
      await loadBootstrap();
      render();
      toast('Removed from at home.');
    } catch (err) {
      toast(err.message || 'Could not remove');
    }
  },
  sendInstacart() { toast('Prototype only — nothing was actually sent to Instacart.'); },

  connectGoogle(el) {
    const want = (el?.dataset?.person || '').toLowerCase();
    const who = (session?.name || '').toLowerCase();
    if (want && who && want !== who) {
      toast(`Log in as ${want.charAt(0).toUpperCase() + want.slice(1)} (PIN), then tap CONNECT ${want.toUpperCase()}`);
      return;
    }
    // Match Spotify: force 127.0.0.1 so OAuth redirect/cookies match APP_BASE_URL
    if (location.hostname === 'localhost') {
      location.href = `http://127.0.0.1:${location.port || '3000'}/api/oauth/google/start`;
      return;
    }
    location.href = '/api/oauth/google/start';
  },
  connectSpotify() {
    SpotifyWeb?.disconnect?.();
    if (location.hostname === 'localhost') {
      location.href = `http://127.0.0.1:${location.port || '3000'}/api/oauth/spotify/start`;
      return;
    }
    location.href = '/api/oauth/spotify/start';
  },
  toggleIpod() {
    state.ipodMinimized = !state.ipodMinimized;
    renderSpotifyIpod();
  },
  toggleIpodMenu() {
    state.ipodView = state.ipodView === 'menu' ? 'now' : 'menu';
    renderSpotifyIpod();
  },
  ipodBack() {
    if (state.ipodView === 'playlists') state.ipodView = 'menu';
    else state.ipodView = 'now';
    renderSpotifyIpod();
  },
  async openPlaylists() {
    if (state.spotify?.needsReconnect) {
      toast('Reconnect Spotify first (MENU → Reconnect)');
      state.ipodView = 'menu';
      renderSpotifyIpod();
      return;
    }
    state.ipodView = 'playlists';
    state.spotifyPlaylists = [];
    renderSpotifyIpod();
    try {
      if (!SpotifyWeb?.isReady?.()) await ensureSpotifyWebPlayer();
      const data = await HomeBaseAPI.spotifyPlaylists();
      state.spotifyPlaylists = data.playlists || [];
      if (!state.spotifyPlaylists.length) {
        toast('No playlists found on this account');
      }
      renderSpotifyIpod();
    } catch (err) {
      toast(err.message || 'Could not load playlists — RECONNECT Spotify');
      state.spotifyPlaylists = [];
      state.ipodView = 'menu';
      renderSpotifyIpod();
    }
  },
  async playSpotifyPlaylist(el) {
    const uri = el.dataset.uri;
    const name = el.dataset.name;
    if (!uri) return;
    try {
      toast(`Starting ${name}…`);
      state.ipodView = 'now';
      if (!SpotifyWeb?.isReady?.()) await ensureSpotifyWebPlayer();
      const updated = await SpotifyWeb.playPlaylist(uri, name);
      if (updated) applyWebPlayerNow(updated);
      else renderSpotifyIpod();
      toast(`Playing ${name} in browser`);
    } catch (err) {
      toast(err.message || 'Play failed — RECONNECT + Premium required');
    }
  },
  async spotifyPlayPause() {
    const now = state.spotify?.now;
    if (!now?.connected && !SpotifyWeb?.isReady?.()) {
      actions.connectSpotify();
      return;
    }
    try {
      if (!SpotifyWeb?.isReady?.()) await ensureSpotifyWebPlayer();
      const updated = await SpotifyWeb.playPause(now);
      if (updated) applyWebPlayerNow(updated);
      else await loadSpotify();
      renderSpotifyIpod();
    } catch (err) {
      toast(err.message || 'RECONNECT Spotify — Premium required for browser playback');
    }
  },
  async spotifyNext() {
    try {
      await ensureSpotifyWebPlayer();
      const updated = await SpotifyWeb.next();
      if (updated) applyWebPlayerNow(updated);
    } catch (err) {
      toast(err.message || 'Skip failed');
    }
  },
  async spotifyPrev() {
    try {
      await ensureSpotifyWebPlayer();
      const updated = await SpotifyWeb.previous();
      if (updated) applyWebPlayerNow(updated);
    } catch (err) {
      toast(err.message || 'Previous failed');
    }
  },
  spotifyVolume(el) {
    const v = Number(el.value) / 100;
    state.spotifyVolume = v;
    SpotifyWeb?.setVolume?.(v);
  },
  async refreshSpotify() {
    try {
      SpotifyWeb?.disconnect?.();
      await loadSpotify();
      await ensureSpotifyWebPlayer();
      renderSpotifyIpod();
      if (state.spotify?.needsReconnect) {
        toast('Reconnect Spotify for playlists + browser playback');
      } else if (SpotifyWeb?.isReady?.()) {
        toast('Browser player ready — MENU → Playlists');
      }
    } catch (err) {
      toast(err.message || 'Spotify refresh failed');
    }
  },
  async syncGoogle() {
    try {
      toast('Syncing Google Calendar…');
      const r = await HomeBaseAPI.syncCalendar({ weekStart: weekStart || WEEK[0]?.dateStr });
      if (r.connections) googleConnections = r.connections;
      await loadBootstrap();
      render();
      toast(r.message || `Synced ${r.synced || 0} events`);
    } catch (err) {
      toast(err.message || 'Sync failed — connect Google first.');
    }
  },
  async logout() {
    try { await HomeBaseAPI.logout(); } catch { /* ok */ }
    stopBackgroundSync();
    SpotifyWeb?.disconnect?.();
    session = null;
    renderSpotifyIpod();
    showLogin();
  },

  toast(el) { toast(el.dataset.value); },
};

document.getElementById('mainNav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  state.tab = btn.dataset.tab;
  state.selectedDayKey = null;
  render();
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) Promise.resolve(fn(el)).catch((err) => toast(err.message || 'Something went wrong'));
});

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-action="spotifyVolume"]');
  if (!el) return;
  actions.spotifyVolume(el);
});

document.getElementById('pinSubmit')?.addEventListener('click', async () => {
  const pin = document.getElementById('pinInput').value.trim();
  if (!pin) return;
  try {
    await tryLogin(pin);
  } catch (err) {
    document.getElementById('loginError').textContent = err.message || 'Invalid PIN';
  }
});

document.getElementById('pinInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('pinSubmit').click();
});

setInterval(tickClock, 1000 * 15);
setInterval(() => {
  if (session && state.spotify?.now?.connected && !state.ipodMinimized && !SpotifyWeb?.isReady()) {
    loadSpotify().then(() => renderSpotifyIpod()).catch(() => {});
  }
}, 15000);
initApp();
