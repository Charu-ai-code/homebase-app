export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export function redirect(res, location, status = 302) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.end();
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    }).filter(([k]) => k),
  );
}

export function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  const base = process.env.APP_BASE_URL || '';
  const isLocal = base.includes('localhost') || base.includes('127.0.0.1');
  if (!isLocal && process.env.VERCEL_ENV === 'production') {
    parts.push('Secure');
  }
  const existing = res.getHeader('Set-Cookie');
  const next = Array.isArray(existing) ? [...existing, parts.join('; ')] : existing ? [existing, parts.join('; ')] : [parts.join('; ')];
  res.setHeader('Set-Cookie', next);
}

export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

export async function readJson(req) {
  // Vercel/@vercel/node pre-parses JSON bodies onto req.body
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    if (typeof req.body === 'object') return req.body;
  }

  // Web Request API (some runtimes)
  if (typeof req.json === 'function') {
    try { return await req.json(); } catch { return {}; }
  }

  // Node stream fallback
  if (typeof req[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  return {};
}
