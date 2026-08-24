import { json } from '../_lib/response.js';
import { requireAuth } from '../_lib/auth.js';

const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Snow', 80: 'Showers', 95: 'Thunderstorm',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const lat = process.env.WEATHER_LAT || '30.2672';
    const lon = process.env.WEATHER_LON || '-97.7431';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,precipitation_probability&temperature_unit=fahrenheit&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Weather fetch failed');
    const data = await r.json();
    const cur = data.current || {};
    const code = cur.weather_code ?? 0;
    json(res, 200, {
      tempF: Math.round(cur.temperature_2m ?? 0),
      label: WMO[code] || 'Partly cloudy',
      rainPct: cur.precipitation_probability ?? 0,
      lat: Number(lat),
      lon: Number(lon),
    });
  } catch (err) {
    console.error('weather error', err);
    json(res, 200, { tempF: 78, label: 'Partly cloudy', rainPct: 12, fallback: true });
  }
}
