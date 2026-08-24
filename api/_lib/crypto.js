import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function hashPin(pin) {
  const salt = process.env.PIN_SALT || '';
  return createHash('sha256').update(String(pin) + salt).digest('hex');
}

export function signSession(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomState() {
  return randomBytes(24).toString('hex');
}
