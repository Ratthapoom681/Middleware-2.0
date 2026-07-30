const { verifyJwt: verifySharedJwt } = require('../../../packages/auth-client/index.cjs');
const { PERMISSION_BY_KEY, hasPermission } = require('../../../packages/access-control/index.cjs');
const { loadRuntimeSecrets } = require('./runtime-config.cjs');

const {
  jwtSecret: JWT_SECRET,
  authServiceToken: AUTH_SERVICE_TOKEN
} = loadRuntimeSecrets();
const TOKEN_ISSUER = process.env.JWT_ISSUER || 'middleware-hub';
const TOKEN_AUDIENCE = process.env.JWT_AUDIENCE || 'internal-security-middleware';
const REQUIRED_APP = process.env.AUTH_REQUIRED_APP || 'docs';
const AUTH_INTROSPECTION_URL = process.env.AUTH_INTROSPECTION_URL || '';
const AUTH_INTROSPECTION_TIMEOUT_MS = Number(process.env.AUTH_INTROSPECTION_TIMEOUT_MS || 1000);
const AUTH_CIRCUIT_OPEN_MS = Number(process.env.AUTH_CIRCUIT_OPEN_MS || 15000);

let authCircuitOpenUntil = 0;
let authValidationMode = 'live';

function verifyJwt(token, secret = JWT_SECRET) {
  return verifySharedJwt(token, secret);
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
    req.authValidationMode = 'local-fallback';
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
    req.authValidationMode = 'live';
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
    req.authValidationMode = 'local-fallback';
    req.user = payload;
    return next();
  }
}

const requirePermission = (permissionKey, options = {}) => (req, res, next) => {
  const permission = PERMISSION_BY_KEY.get(permissionKey);
  if (!permission || !hasPermission(req.user, permissionKey)) {
    return res.status(403).json({ error: 'Forbidden: Permission required', permission: permissionKey });
  }
  const mutating = options.mutating ?? permission.mutating;
  if (mutating && AUTH_INTROSPECTION_URL && req.authValidationMode !== 'live') {
    return res.status(503).json({ error: 'Live authorization is required for this action', permission: permissionKey });
  }
  next();
};

module.exports = { authenticateJwt, requirePermission, verifyJwt, isExpectedPayload };
