const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-me-in-production';
const TOKEN_ISSUER = process.env.JWT_ISSUER || 'middleware-hub';
const TOKEN_AUDIENCE = process.env.JWT_AUDIENCE || 'internal-security-middleware';
const REQUIRED_APP = process.env.AUTH_REQUIRED_APP || 'docs';
const AUTH_INTROSPECTION_URL = process.env.AUTH_INTROSPECTION_URL || '';
const AUTH_SERVICE_TOKEN = process.env.AUTH_SERVICE_TOKEN || '';
const AUTH_INTROSPECTION_TIMEOUT_MS = Number(process.env.AUTH_INTROSPECTION_TIMEOUT_MS || 1000);
const AUTH_CIRCUIT_OPEN_MS = Number(process.env.AUTH_CIRCUIT_OPEN_MS || 15000);

let authCircuitOpenUntil = 0;
let authValidationMode = 'live';

function base64UrlDecode(value) {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}

function verifyJwt(token, secret = JWT_SECRET) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, signature] = parts;
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const expected = crypto.createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.exp || Date.now() / 1000 >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function isExpectedPayload(payload = {}) {
  if (!payload || payload.iss !== TOKEN_ISSUER || payload.aud !== TOKEN_AUDIENCE) return false;
  if (!payload.sid || !payload.sub || !payload.username) return false;
  if (payload.status && payload.status !== 'active') return false;
  if (payload.role === 'admin') return true;
  if (Array.isArray(payload.apps) && payload.apps.includes(REQUIRED_APP)) return true;
  // Tokens issued before auth-service extraction had no iat and omitted the docs app.
  return REQUIRED_APP === 'docs' && !payload.iat;
}

function setAuthValidationMode(mode) {
  if (authValidationMode === mode) return;
  const previous = authValidationMode;
  authValidationMode = mode;
  if (mode === 'live' && previous === 'local-fallback') {
    console.info('[AUTH] mode=live-restored');
    return;
  }
  console.warn(`[AUTH] mode=${mode}`);
}

class IntrospectionError extends Error {
  constructor(message, fallbackAllowed = false) {
    super(message);
    this.fallbackAllowed = fallbackAllowed;
  }
}

async function introspectToken(token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_INTROSPECTION_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(AUTH_INTROSPECTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AUTH_SERVICE_TOKEN ? { 'X-Auth-Service-Token': AUTH_SERVICE_TOKEN } : {}),
      },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new IntrospectionError(`Auth introspection unavailable: ${err.message}`, true);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new IntrospectionError(
      `Auth introspection failed with status ${response.status}`,
      [502, 503, 504].includes(response.status),
    );
  }
  return response.json();
}

async function authenticateJwt(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token' });

  const payload = verifyJwt(token);
  if (!payload || !isExpectedPayload(payload)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  if (!AUTH_INTROSPECTION_URL || Date.now() < authCircuitOpenUntil) {
    if (!AUTH_INTROSPECTION_URL) setAuthValidationMode('local-fallback');
    res.set('X-Auth-Validation', 'local-fallback');
    req.user = payload;
    return next();
  }

  try {
    const result = await introspectToken(token);
    if (!result?.active || !isExpectedPayload(result.payload)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or revoked token' });
    }
    authCircuitOpenUntil = 0;
    setAuthValidationMode('live');
    res.set('X-Auth-Validation', 'live');
    req.user = result.payload;
    return next();
  } catch (err) {
    console.error('Authentication check failed:', err.message);
    if (!err.fallbackAllowed) {
      return res.status(503).json({ error: 'Authentication validation failed closed' });
    }
    authCircuitOpenUntil = Date.now() + AUTH_CIRCUIT_OPEN_MS;
    setAuthValidationMode('local-fallback');
    res.set('X-Auth-Validation', 'local-fallback');
    req.user = payload;
    return next();
  }
}

module.exports = { authenticateJwt, verifyJwt, isExpectedPayload };
