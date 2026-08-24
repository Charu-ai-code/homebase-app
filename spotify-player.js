/**
 * Spotify Web Playback SDK — plays audio in the browser (Premium required).
 */
const SpotifyWeb = (() => {
  let player = null;
  let deviceId = null;
  let ready = false;
  let premiumError = false;
  let initPromise = null;
  let onStateChange = null;
  let progressTimer = null;
  let readyWaiter = null;

  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (window.Spotify) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-spotify-sdk]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', reject);
        return;
      }
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      const s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      s.async = true;
      s.dataset.spotifySdk = '1';
      s.onerror = () => reject(new Error('Could not load Spotify SDK'));
      document.body.appendChild(s);
    });
  }

  function mapPlayerState(ps) {
    if (!ps || !ps.track) return null;
    const img = ps.track.album?.images || [];
    return {
      connected: true,
      webPlayer: true,
      playing: !ps.paused,
      title: ps.track.name,
      artist: (ps.track.artists || []).map((a) => a.name).join(', '),
      albumArt: img[1]?.url || img[0]?.url || null,
      trackUri: ps.track.uri,
      trackUrl: ps.track.uri ? `https://open.spotify.com/track/${ps.track.uri.split(':').pop()}` : null,
      progressMs: ps.position,
      durationMs: ps.duration,
      message: 'Playing from browser · route to speakers in Sound settings',
    };
  }

  function waitForReady(timeoutMs = 15000) {
    if (ready && deviceId) return Promise.resolve(deviceId);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Browser player timed out — RECONNECT Spotify')), timeoutMs);
      readyWaiter = (id) => {
        clearTimeout(t);
        readyWaiter = null;
        resolve(id);
      };
    });
  }

  function startProgressTick() {
    clearInterval(progressTimer);
    progressTimer = setInterval(async () => {
      if (!player || !onStateChange) return;
      const ps = await player.getCurrentState();
      if (ps && !ps.paused) onStateChange(mapPlayerState(ps));
    }, 1000);
  }

  async function ensureInit(stateCallback) {
    onStateChange = stateCallback;
    if (ready && player && deviceId) return { deviceId, ready: true };
    if (initPromise) {
      await initPromise;
      if (!deviceId) await waitForReady();
      return { deviceId, ready: true };
    }

    initPromise = (async () => {
      premiumError = false;
      await loadSdk();

      player = new window.Spotify.Player({
        name: 'HomeBase iPod',
        getOAuthToken: (cb) => {
          HomeBaseAPI.spotifyToken()
            .then((d) => cb(d.accessToken))
            .catch(() => cb(''));
        },
        volume: 0.85,
      });

      player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        ready = true;
        if (readyWaiter) readyWaiter(device_id);
        if (onStateChange) {
          onStateChange({
            connected: true,
            webPlayer: true,
            playing: false,
            title: 'HomeBase iPod',
            artist: 'Pick a playlist in MENU',
            message: 'Browser player ready',
          });
        }
      });

      player.addListener('not_ready', () => { ready = false; });

      player.addListener('player_state_changed', (ps) => {
        if (onStateChange) {
          onStateChange(mapPlayerState(ps) || {
            connected: true,
            webPlayer: true,
            playing: false,
            message: 'Paused',
          });
        }
        if (ps && !ps.paused) startProgressTick();
        else clearInterval(progressTimer);
      });

      player.addListener('initialization_error', ({ message }) => {
        console.error('Spotify init error', message);
        initPromise = null;
      });

      player.addListener('authentication_error', ({ message }) => {
        ready = false;
        initPromise = null;
        if (onStateChange) {
          onStateChange({
            connected: false,
            message: message || 'Reconnect Spotify (needs streaming permission)',
          });
        }
      });

      player.addListener('account_error', ({ message }) => {
        premiumError = true;
        ready = false;
        if (onStateChange) {
          onStateChange({
            connected: true,
            playing: false,
            title: 'Premium required',
            artist: message || 'Browser playback needs Spotify Premium',
            message: 'Upgrade account or RECONNECT',
          });
        }
      });

      const ok = await player.connect();
      if (!ok) throw new Error('Could not connect Spotify web player');
      await waitForReady();
      return { deviceId, ready: true };
    })();

    try {
      return await initPromise;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  }

  async function activate(stateCallback) {
    return ensureInit(stateCallback);
  }

  async function startPlayback({ uris, contextUri } = {}) {
    await ensureInit(onStateChange);
    if (premiumError) throw new Error('Spotify Premium required for browser playback');
    if (!deviceId) throw new Error('Browser player not ready — wait a few seconds');

    await HomeBaseAPI.spotifyPlay({ deviceId, uris, contextUri });
    // Poll until track starts (SDK state can lag)
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 350));
      const ps = await player.getCurrentState();
      if (ps?.track) return mapPlayerState(ps);
    }
    return mapPlayerState(await player.getCurrentState());
  }

  async function playPause(fallbackNow) {
    await ensureInit(onStateChange);
    if (premiumError) throw new Error('Spotify Premium required');
    if (!deviceId) throw new Error('Browser player not ready');

    const ps = await player.getCurrentState();
    if (ps?.track) {
      await player.togglePlay();
      return mapPlayerState(await player.getCurrentState());
    }

    let uri = fallbackNow?.trackUri;
    if (!uri) {
      const recent = await HomeBaseAPI.spotifyNow();
      uri = recent?.now?.trackUri;
    }
    if (!uri) throw new Error('Pick a playlist in MENU first');

    return startPlayback({ uris: [uri] });
  }

  async function playPlaylist(contextUri, name) {
    const state = await startPlayback({ contextUri });
    if (state && name) {
      state.playlistName = name;
      state.message = `Playlist · ${name}`;
    }
    return state;
  }

  async function next() {
    await ensureInit(onStateChange);
    if (!player) throw new Error('Player not ready');
    await player.nextTrack();
    return mapPlayerState(await player.getCurrentState());
  }

  async function previous() {
    await ensureInit(onStateChange);
    if (!player) throw new Error('Player not ready');
    await player.previousTrack();
    return mapPlayerState(await player.getCurrentState());
  }

  async function setVolume(v) {
    if (player) await player.setVolume(v);
  }

  function disconnect() {
    clearInterval(progressTimer);
    if (player) {
      player.disconnect();
      player = null;
    }
    deviceId = null;
    ready = false;
    initPromise = null;
    readyWaiter = null;
  }

  function isReady() { return ready && !!deviceId; }

  return {
    activate,
    playPause,
    playPlaylist,
    next,
    previous,
    setVolume,
    disconnect,
    isReady,
    getDeviceId: () => deviceId,
  };
})();

window.SpotifyWeb = SpotifyWeb;
