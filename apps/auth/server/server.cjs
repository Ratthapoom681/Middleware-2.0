const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { verifyJwt } = require('../../../packages/auth-client/index.cjs');
const {
  PERMISSION_CATALOG,
  SYSTEM_ADMIN_ROLE_ID,
  getAccess,
  hasPermission,
  isSystemAdmin,
  normalizeProductScope
} = require('../../../packages/access-control/index.cjs');
const { createAuthStore, DEFAULT_APP_KEY } = require('./auth-store.cjs');
const { loadRuntimeSecrets } = require('./runtime-config.cjs');
const { createMfaService } = require('./mfa-service.cjs');
const { createAdminSecurityStore } = require('./admin-security-store.cjs');
const { createSecurityCrypto } = require('./security-crypto.cjs');
const { createEmailWorker } = require('./mailer.cjs');
const {
  isValidEmail,
  parseAdminMfaProvider,
  queueMfaEnrollmentInvitation,
  registerProfileRoutes
} = require('./profile-routes.cjs');

const PORT = process.env.PORT || 3000;
const {
  jwtSecret: JWT_SECRET,
  authServiceToken: AUTH_SERVICE_TOKEN,
  mfaEncryptionKey: MFA_ENCRYPTION_KEY
} = loadRuntimeSecrets();
const TOKEN_ISSUER = process.env.JWT_ISSUER || 'middleware-hub';
const TOKEN_AUDIENCE = 'internal-security-middleware';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..');
const CLIENT_DIST_DIR = process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : path.resolve(__dirname, '..', 'dist');

const app = express();
app.use(cors());
app.use(express.json());


// ── JWT HELPERS (CRYPTO-BASED) ──
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret, expiresInSeconds = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;
  const fullPayload = { ...payload, iat, exp };
  
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
    
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// ── PASSWORD HELPERS ──
const CURRENT_PASSWORD_ALGORITHM = 'pbkdf2-sha512:310000';
const LEGACY_PASSWORD_ALGORITHM = 'pbkdf2-sha512:1000';

function getPasswordIterations(algorithm = LEGACY_PASSWORD_ALGORITHM) {
  const match = String(algorithm || '').match(/:(\d+)$/);
  return match ? Number(match[1]) : 1000;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), algorithm = CURRENT_PASSWORD_ALGORITHM) {
  const iterations = getPasswordIterations(algorithm);
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return { salt, hash, algorithm };
}

function verifyPassword(password, user = {}) {
  const algorithm = user.passwordAlgorithm || LEGACY_PASSWORD_ALGORITHM;
  const iterations = getPasswordIterations(algorithm);
  const verifyHash = crypto.pbkdf2Sync(password, user.salt || '', iterations, 64, 'sha512');
  const expectedHash = Buffer.from(user.hash || '', 'hex');
  if (expectedHash.length !== verifyHash.length) return false;
  return crypto.timingSafeEqual(expectedHash, verifyHash);
}

const authStore = createAuthStore({ dataDir: DATA_DIR, hashPassword });
const mfaService = createMfaService({ encryptionKey: MFA_ENCRYPTION_KEY });
const securityStore = createAdminSecurityStore({ dataDir: DATA_DIR });
const securityCrypto = createSecurityCrypto({ encryptionKey: MFA_ENCRYPTION_KEY });

function getRequestOrigin(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProto === 'https' ? 'https' : 'http';
  if (!forwardedHost || forwardedHost.length > 255 || !/^[a-z0-9.\-:[\]]+$/i.test(forwardedHost)) {
    throw new Error('Unable to determine the application origin');
  }
  let derived;
  try {
    const parsed = new URL(`${protocol}://${forwardedHost}`);
    if (parsed.username || parsed.password || !parsed.hostname) throw new Error('Invalid authority');
    derived = parsed.origin;
  } catch {
    throw new Error('Unable to determine the application origin');
  }
  try {
    const supplied = new URL(String(req.headers.origin || ''));
    if (supplied.protocol === `${protocol}:` && supplied.origin.toLowerCase() === derived.toLowerCase()) {
      return supplied.origin;
    }
  } catch { /* Requests without Origin use validated proxy headers. */ }
  return derived;
}

async function enrichPublicUser(user) {
  if (!user) return null;
  const [identity, policy, mfa] = await Promise.all([
    securityStore.getIdentity(user.username),
    securityStore.getMfaPolicy(user.username),
    authStore.getMfaConfig(user.username)
  ]);
  const base = authStore.buildPublicUser(user);
  const mode = policy?.mode === 'authenticator' || mfa ? 'authenticator' : 'disabled';
  return {
    ...base,
    fullName: identity?.fullName || '',
    company: identity?.company || '',
    department: identity?.department || '',
    mfaMode: mode,
    mfaStatus: mode === 'disabled' ? 'disabled' : (mfa ? 'enabled' : 'pending'),
    mfaProvider: mfa?.provider || policy?.provider || '',
    mfaRequestedAt: policy?.requestedAt || '',
    mfaNotificationStatus: policy?.notificationStatus || 'none',
    mfaNotificationAttemptedAt: policy?.notificationAttemptedAt || '',
    mfaNotificationSentAt: policy?.notificationSentAt || '',
    mfaNotificationError: policy?.notificationError || ''
  };
}

async function issuePasswordChangeChallenge(user) {
  const challengeToken = mfaService.createOpaqueToken();
  const expiresIn = 10 * 60;
  await authStore.createMfaChallenge({
    id: crypto.randomUUID(),
    username: user.username,
    purpose: 'password_change',
    tokenHash: mfaService.tokenHash(challengeToken),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
  });
  return { passwordChangeRequired: true, challengeToken, expiresIn, user: await enrichPublicUser(user) };
}

const emailWorker = createEmailWorker({
  store: securityStore,
  securityCrypto,
  saveAuditEvent: event => authStore.saveAuditEvent(event)
});

function buildTokenPayload(user, sid) {
  const access = getAccess(user);
  return {
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    sub: user.id,
    sid,
    username: user.username,
    email: user.email,
    role: user.role,
    products: access.productScope.products,
    roleId: access.role.id,
    roleName: access.role.name,
    productScopeMode: access.productScope.mode,
    access,
    status: user.status,
    apps: ['hub', DEFAULT_APP_KEY, 'wazuh', 'docs']
  };
}

async function issueSession(user, req) {
  const lastLoginAt = new Date().toISOString();
  const sid = crypto.randomBytes(24).toString('hex');
  const expiresInSeconds = 3600;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await authStore.recordLogin(user.username, lastLoginAt);
  const loggedInUser = {
    ...user,
    lastLoginAt,
    online: true,
    presenceStatus: 'online'
  };
  await authStore.createSession({
    user: loggedInUser,
    sid,
    expiresAt,
    userAgent: req.headers['user-agent'] || '',
    ipAddress: req.ip || req.socket?.remoteAddress || ''
  });
  return {
    token: signJwt(buildTokenPayload(loggedInUser, sid), JWT_SECRET, expiresInSeconds),
    user: await enrichPublicUser(loggedInUser)
  };
}

// ── EXPRESS AUTHENTICATION MIDDLEWARES ──
async function authenticateJwt(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const payload = verifyJwt(token, JWT_SECRET);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  if (payload.iss !== TOKEN_ISSUER || payload.aud !== TOKEN_AUDIENCE || !payload.sid) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token issuer or session' });
  }

  try {
    const session = await authStore.getActiveSession(payload.sid);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or revoked session' });
    }
    const currentUser = await authStore.getUserByUsername(payload.username);
    if (!currentUser || currentUser.status === 'suspended') {
      return res.status(401).json({ error: 'Unauthorized: Invalid user' });
    }
    req.user = {
      ...payload,
      sub: currentUser.id,
      username: currentUser.username,
      email: currentUser.email,
      role: currentUser.role,
      products: currentUser.products,
      roleId: currentUser.roleId,
      roleName: currentUser.roleName,
      productScopeMode: currentUser.productScopeMode,
      access: currentUser.access,
      status: currentUser.status
    };
    next();
  } catch (err) {
    console.error('Session validation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function requireSystemAdmin(req, res, next) {
  if (!isSystemAdmin(req.user)) {
    return res.status(403).json({ error: 'Forbidden: System Administrator access required' });
  }
  next();
}

const requirePermission = permissionKey => (req, res, next) => {
  if (!hasPermission(req.user, permissionKey)) {
    return res.status(403).json({ error: 'Forbidden: Permission required', permission: permissionKey });
  }
  next();
};

const requireAdmin = requireSystemAdmin;

// ── API ROUTES ──

// Auth - Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const normalizedUsername = String(username || '').trim();
  if (!normalizedUsername || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await authStore.getUserByUsername(normalizedUsername);

    if (!user || !verifyPassword(password, user)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'User account is suspended' });
    }

    if (user.passwordAlgorithm !== CURRENT_PASSWORD_ALGORITHM) {
      const upgraded = hashPassword(password);
      await authStore.updatePassword(user.username, {
        salt: upgraded.salt,
        hash: upgraded.hash,
        passwordAlgorithm: upgraded.algorithm
      });
    }

    const mfa = await authStore.getMfaConfig(user.username);
    if (mfa) {
      if (mfa.lockedUntil && Date.parse(mfa.lockedUntil) > Date.now()) {
        return res.status(429).json({ error: 'Authenticator verification is temporarily locked. Try again later.' });
      }
      const challengeToken = mfaService.createOpaqueToken();
      const expiresIn = 5 * 60;
      await authStore.createMfaChallenge({
        id: crypto.randomUUID(),
        username: user.username,
        purpose: 'login',
        tokenHash: mfaService.tokenHash(challengeToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
      });
      res.set('Cache-Control', 'no-store');
      return res.json({
        mfaRequired: true,
        challengeToken,
        expiresIn,
        authenticatorApp: mfa.provider
      });
    }

    const temporary = await securityStore.getTemporaryCredential(user.username);
    if (temporary) {
      if (Date.parse(temporary.expiresAt) <= Date.now()) {
        return res.status(401).json({ error: 'Temporary password expired. Contact an administrator.' });
      }
      res.set('Cache-Control', 'no-store');
      return res.json(await issuePasswordChangeChallenge(user));
    }

    res.json(await issueSession(user, req));
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auth - Logout
app.post('/api/logout', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const payload = token ? verifyJwt(token, JWT_SECRET) : null;
  if (payload?.sid) {
    await authStore.revokeSession(payload.sid);
  }
  res.json({ message: 'Logged out successfully' });
});

registerProfileRoutes({
  app,
  authenticateJwt,
  requireAdmin,
  requirePermission,
  authStore,
  securityStore,
  securityCrypto,
  mfaService,
  verifyPassword,
  hashPassword,
  issueSession,
  issuePasswordChangeChallenge,
  enrichPublicUser,
  getRequestOrigin
});

// Auth - Internal token introspection for protected services
app.post('/api/auth/introspect', async (req, res) => {
  if (AUTH_SERVICE_TOKEN) {
    const serviceToken = req.headers['x-auth-service-token'] || '';
    if (serviceToken !== AUTH_SERVICE_TOKEN) {
      return res.status(403).json({ active: false, error: 'Forbidden' });
    }
  }

  const token = req.body?.token || '';
  const payload = verifyJwt(token, JWT_SECRET);
  if (!payload || payload.iss !== TOKEN_ISSUER || payload.aud !== TOKEN_AUDIENCE || !payload.sid) {
    return res.json({ active: false });
  }

  const session = await authStore.getActiveSession(payload.sid);
  if (!session) {
    return res.json({ active: false });
  }
  const currentUser = await authStore.getUserByUsername(payload.username);
  if (!currentUser || currentUser.status === 'suspended') {
    return res.json({ active: false });
  }

  res.json({
    active: true,
    payload: {
      ...payload,
      sub: currentUser.id,
      username: currentUser.username,
      email: currentUser.email,
      role: currentUser.role,
      products: currentUser.products,
      roleId: currentUser.roleId,
      roleName: currentUser.roleName,
      productScopeMode: currentUser.productScopeMode,
      access: currentUser.access,
      status: currentUser.status
    }
  });
});

const sendAccessStoreError = (res, error, fallback = 'Unable to update access') => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({
    error: status >= 500 ? fallback : error.message,
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.details && Object.keys(error.details).length > 0 ? { details: error.details } : {})
  });
};

app.get('/api/access/permissions', authenticateJwt, requireSystemAdmin, (_req, res) => {
  res.json(PERMISSION_CATALOG);
});

app.get('/api/roles', authenticateJwt, requireSystemAdmin, async (_req, res) => {
  try {
    res.json(await authStore.listRoles());
  } catch (error) {
    sendAccessStoreError(res, error, 'Unable to list roles');
  }
});

app.post('/api/roles', authenticateJwt, requireSystemAdmin, async (req, res) => {
  try {
    const role = await authStore.createRole({
      name: req.body?.name,
      description: req.body?.description,
      permissions: req.body?.permissions,
      actorUsername: req.user.username
    });
    res.status(201).json({ message: 'Role created', role });
  } catch (error) {
    sendAccessStoreError(res, error, 'Unable to create role');
  }
});

app.patch('/api/roles/:roleId', authenticateJwt, requireSystemAdmin, async (req, res) => {
  try {
    const role = await authStore.updateRole(req.params.roleId, {
      name: req.body?.name,
      description: req.body?.description,
      permissions: req.body?.permissions,
      actorUsername: req.user.username
    });
    res.json({ message: 'Role updated. Affected users must sign in again.', role });
  } catch (error) {
    sendAccessStoreError(res, error, 'Unable to update role');
  }
});

app.post('/api/roles/:roleId/retire', authenticateJwt, requireSystemAdmin, async (req, res) => {
  try {
    const result = await authStore.retireRole(req.params.roleId, {
      replacementRoleId: String(req.body?.replacementRoleId || '').trim(),
      actorUsername: req.user.username
    });
    res.json({ message: 'Role retired', ...result });
  } catch (error) {
    sendAccessStoreError(res, error, 'Unable to retire role');
  }
});

app.get('/api/access/audit', authenticateJwt, requireSystemAdmin, async (req, res) => {
  try {
    res.json(await authStore.listAuditEvents({
      limit: req.query.limit,
      before: String(req.query.before || '').trim()
    }));
  } catch (error) {
    sendAccessStoreError(res, error, 'Unable to load access activity');
  }
});

// Users - List all users (Admins only)
app.get('/api/users', authenticateJwt, requireSystemAdmin, async (req, res) => {
  try {
    const users = await authStore.listUsers();
    res.json(await Promise.all(users.map(enrichPublicUser)));
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const resolveUserAccessInput = async (body = {}, existingUser = null) => {
  const legacyRole = String(body.role || '').trim().toLowerCase();
  const roleId = String(
    body.roleId
      || existingUser?.roleId
      || (legacyRole === 'admin' ? SYSTEM_ADMIN_ROLE_ID : legacyRole === 'viewer' ? 'viewer' : '')
  ).trim();
  if (!roleId) {
    const error = new Error('Role is required');
    error.status = 400;
    error.code = 'role_required';
    throw error;
  }
  const role = await authStore.getRole(roleId);
  if (!role) {
    const error = new Error('Selected role was not found');
    error.status = 400;
    error.code = 'role_not_found';
    throw error;
  }
  const hasExplicitScope = body.productScope && typeof body.productScope === 'object'
    || Object.prototype.hasOwnProperty.call(body, 'productScopeMode');
  const hasLegacyProducts = Object.prototype.hasOwnProperty.call(body, 'products');
  const requestedScopeMode = String(body.productScope?.mode ?? body.productScopeMode ?? '').trim().toLowerCase();
  if (!existingUser && !hasExplicitScope) {
    const error = new Error('Product scope is required');
    error.status = 400;
    error.code = 'product_scope_required';
    throw error;
  }
  if (hasExplicitScope && !['all', 'selected', 'none'].includes(requestedScopeMode)) {
    const error = new Error('Product scope must be All products, Selected products, or No products');
    error.status = 400;
    error.code = 'invalid_product_scope';
    throw error;
  }
  if (role.system && hasExplicitScope && requestedScopeMode !== 'all') {
    const error = new Error('System Administrator must use All products');
    error.status = 400;
    error.code = 'system_scope_protected';
    throw error;
  }
  const scope = role.system
    ? { mode: 'all', products: [] }
    : normalizeProductScope(
      hasExplicitScope
        ? (body.productScope || { mode: body.productScopeMode, products: body.products })
        : hasLegacyProducts
          ? { mode: Array.isArray(body.products) && body.products.length > 0 ? 'selected' : 'none', products: body.products }
          : (existingUser?.access?.productScope || { products: body.products }),
      Array.isArray(body.products) ? body.products : existingUser?.products,
      ''
    );
  if (scope.mode === 'selected' && scope.products.length === 0) {
    const error = new Error('Choose at least one product for Selected products');
    error.status = 400;
    error.code = 'products_required';
    throw error;
  }
  return { role, scope };
};

// Users - Create or Update (Admins only)
app.post('/api/users', authenticateJwt, requireSystemAdmin, async (req, res) => {
  const { username, email, status, fullName, company, department } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const normalizedUsername = String(username || '').trim();
    const existingUser = await authStore.getUserByUsername(normalizedUsername);
    const { role: selectedRole, scope: productScope } = await resolveUserAccessInput(req.body, existingUser);

    const nextStatus = String(status || 'active').trim().toLowerCase() === 'suspended' ? 'suspended' : 'active';
    const nextEmail = String(email || '').trim();
    const identity = {
      fullName: String(fullName || '').trim(),
      company: String(company || '').trim(),
      department: String(department || '').trim()
    };
    const nextProducts = productScope.products;
    const requestedMfaProvider = parseAdminMfaProvider(req.body, 'disabled');
    if (!requestedMfaProvider) {
      return res.status(400).json({ error: 'MFA provider must be disabled, google, microsoft, or other' });
    }
    const requestedMfaMode = requestedMfaProvider === 'disabled' ? 'disabled' : 'authenticator';

    if (!isValidEmail(nextEmail)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (Object.values(identity).some(value => value.length > 120)) {
      return res.status(400).json({ error: 'Full name, company, and department must be 120 characters or fewer' });
    }

    // Prevent suspending yourself
    if (req.user.username === normalizedUsername && nextStatus === 'suspended') {
      return res.status(400).json({ error: 'Cannot suspend your own account' });
    }
    if (req.user.username === normalizedUsername && selectedRole.id !== req.user.roleId) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    if (!existingUser && requestedMfaMode === 'authenticator' && !nextEmail) {
      return res.status(400).json({ error: 'Email is required for Authenticator MFA' });
    }

    if (existingUser?.roleId === SYSTEM_ADMIN_ROLE_ID
      && existingUser.status !== 'suspended'
      && (selectedRole.id !== SYSTEM_ADMIN_ROLE_ID || nextStatus === 'suspended')
      && await authStore.countActiveSystemAdministrators() <= 1) {
      return res.status(400).json({ error: 'Cannot demote or suspend the last System Administrator' });
    }

    const notificationOrigin = !existingUser && (nextEmail || requestedMfaMode === 'authenticator')
      ? getRequestOrigin(req)
      : '';
    const temporaryPassword = existingUser ? '' : crypto.randomBytes(18).toString('base64url');
    const nextUser = {
      ...(existingUser || {}),
      username: normalizedUsername,
      email: nextEmail,
      role: selectedRole.system ? 'admin' : 'viewer',
      roleId: selectedRole.id,
      products: nextProducts,
      productScopeMode: productScope.mode,
      status: nextStatus,
      lastLoginAt: existingUser?.lastLoginAt || ''
    };

    if (temporaryPassword) {
      const { salt, hash, algorithm } = hashPassword(temporaryPassword);
      nextUser.salt = salt;
      nextUser.hash = hash;
      nextUser.passwordAlgorithm = algorithm;
    }

    const accessChanged = Boolean(existingUser)
      && (existingUser.roleId !== selectedRole.id
        || existingUser.productScopeMode !== productScope.mode
        || JSON.stringify(existingUser.products || []) !== JSON.stringify(nextProducts));
    const saved = await authStore.upsertUser(nextUser, { assignedBy: req.user.username });
    if (accessChanged) await authStore.revokeUserSessions(normalizedUsername);
    await securityStore.setIdentity(normalizedUsername, identity);
    let expiresAt = '';
    const deliveries = [];
    if (!existingUser) {
      expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await securityStore.setTemporaryCredential(normalizedUsername, { expiresAt, createdBy: req.user.username });
      if (requestedMfaMode === 'disabled') {
        await securityStore.setMfaPolicy(normalizedUsername, {
          mode: 'disabled', provider: '', enrollmentGeneration: '', requestedAt: '', requestedBy: '', notificationStatus: 'none'
        });
      }
      if (nextEmail) {
        const encrypted = securityCrypto.encryptOutboxSecret(temporaryPassword);
        deliveries.push(await securityStore.enqueueEmail({
          type: 'temporary_password', targetUsername: normalizedUsername, recipient: nextEmail,
          subject: 'Your temporary password',
          metadata: { fullName: identity.fullName, loginUrl: `${notificationOrigin}/login/`, expiresAt },
          secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretTag: encrypted.tag
        }));
      }
      if (requestedMfaMode === 'authenticator') {
        deliveries.push(await queueMfaEnrollmentInvitation({
          user: saved,
          provider: requestedMfaProvider,
          actorUsername: req.user.username,
          request: req,
          authStore,
          securityStore,
          securityCrypto,
          mfaService,
          getRequestOrigin
        }));
      }
    }
    await authStore.saveAuditEvent({
      actorUsername: req.user.username,
      targetUsername: normalizedUsername,
      action: existingUser ? 'user.updated' : 'user.created',
      metadata: {
        roleId: selectedRole.id,
        roleName: selectedRole.name,
        productScope,
        status: nextStatus,
        accessChanged,
        before: existingUser ? {
          roleId: existingUser.roleId,
          roleName: existingUser.roleName,
          productScope: existingUser.access?.productScope
        } : null,
        ...(existingUser ? {} : { mfaMode: requestedMfaMode, mfaProvider: requestedMfaProvider, emailQueued: Boolean(nextEmail) })
      }
    });
    if (!existingUser) res.set('Cache-Control', 'no-store');
    res.json({
      message: 'User saved successfully',
      user: await enrichPublicUser(saved),
      ...(existingUser ? {} : {
        temporaryPassword,
        expiresAt,
        deliveryMode: nextEmail ? 'queued' : 'manual_only',
        deliveries: deliveries.map(job => ({ id: job.id, type: job.type, status: job.status }))
      })
    });
  } catch (err) {
    console.error('Save user error:', err);
    if (err.status) return sendAccessStoreError(res, err, 'Unable to save user');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/users/:username', authenticateJwt, requireSystemAdmin, async (req, res) => {
  const username = String(req.params.username || '').trim();
  try {
    const [target, users, mfaPolicy, mfaConfig, temporaryCredential] = await Promise.all([
      authStore.getUserByUsername(username),
      authStore.listUsers(),
      securityStore.getMfaPolicy(username),
      authStore.getMfaConfig(username),
      securityStore.getTemporaryCredential(username)
    ]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const { role: selectedRole, scope: productScope } = await resolveUserAccessInput(req.body, target);
    const email = String(req.body?.email ?? target.email).trim();
    const identity = {
      fullName: String(req.body?.fullName || '').trim(),
      company: String(req.body?.company || '').trim(),
      department: String(req.body?.department || '').trim()
    };
    const status = String(req.body?.status || target.status).trim().toLowerCase() === 'suspended' ? 'suspended' : 'active';
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if ((mfaPolicy?.mode === 'authenticator' || mfaConfig) && !email) {
      return res.status(400).json({ error: 'A valid email address is required while Authenticator MFA is selected' });
    }
    if (Object.values(identity).some(value => value.length > 120)) return res.status(400).json({ error: 'Identity fields must be 120 characters or fewer' });
    if (req.user.username === username && status === 'suspended') return res.status(400).json({ error: 'Cannot suspend your own account' });
    if (req.user.username === username && selectedRole.id !== req.user.roleId) return res.status(400).json({ error: 'Cannot change your own role' });
    if (target.roleId === SYSTEM_ADMIN_ROLE_ID
      && target.status !== 'suspended'
      && (selectedRole.id !== SYSTEM_ADMIN_ROLE_ID || status === 'suspended')
      && await authStore.countActiveSystemAdministrators() <= 1) {
      return res.status(400).json({ error: 'Cannot demote or suspend the last System Administrator' });
    }
    const pendingEnrollment = mfaPolicy?.mode === 'authenticator' && !mfaConfig;
    const emailChanged = email !== String(target.email || '').trim();
    const suspending = target.status !== 'suspended' && status === 'suspended';
    const invalidatePendingEnrollment = pendingEnrollment && (emailChanged || suspending);
    const rotateTemporaryCredential = emailChanged && Boolean(temporaryCredential);
    const temporaryNotificationOrigin = rotateTemporaryCredential && email ? getRequestOrigin(req) : '';
    let replacementTemporaryPassword = '';
    let replacementTemporaryExpiresAt = '';
    let replacementTemporaryPasswordHash = null;
    let replacementTemporaryDelivery = null;
    const accessChanged = target.roleId !== selectedRole.id
      || target.productScopeMode !== productScope.mode
      || JSON.stringify(target.products || []) !== JSON.stringify(productScope.products);
    const saveUser = () => authStore.upsertUser({
      ...target,
      email,
      role: selectedRole.system ? 'admin' : 'viewer',
      roleId: selectedRole.id,
      productScopeMode: productScope.mode,
      status,
      ...(replacementTemporaryPasswordHash ? {
        salt: replacementTemporaryPasswordHash.salt,
        hash: replacementTemporaryPasswordHash.hash,
        passwordAlgorithm: replacementTemporaryPasswordHash.algorithm
      } : {}),
      products: productScope.products
    }, { assignedBy: req.user.username });
    const saved = invalidatePendingEnrollment || suspending || rotateTemporaryCredential || accessChanged
      ? await securityStore.withMfaMutationLock(username, async () => {
        if (invalidatePendingEnrollment) {
          await securityStore.invalidateMfaInvitations(username);
          await securityStore.cancelEmails(username, 'mfa_setup');
        }
        if (rotateTemporaryCredential) {
          replacementTemporaryPassword = crypto.randomBytes(18).toString('base64url');
          replacementTemporaryExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          replacementTemporaryPasswordHash = hashPassword(replacementTemporaryPassword);
          await securityStore.cancelEmails(username, 'temporary_password');
        }
        const updated = await saveUser();
        if (rotateTemporaryCredential) {
          await securityStore.setTemporaryCredential(username, {
            expiresAt: replacementTemporaryExpiresAt,
            createdBy: req.user.username
          });
        }
        if (suspending || rotateTemporaryCredential || accessChanged) await authStore.revokeUserSessions(username);
        if (invalidatePendingEnrollment) {
          await securityStore.setMfaPolicy(username, {
            notificationStatus: 'failed',
            notificationSentAt: '',
            notificationError: suspending
              ? 'Authenticator setup email must be resent after the account is reactivated'
              : 'Authenticator setup email must be resent after the email address changed'
          });
        }
        if (rotateTemporaryCredential && email) {
          try {
            const encrypted = securityCrypto.encryptOutboxSecret(replacementTemporaryPassword);
            replacementTemporaryDelivery = await securityStore.enqueueEmail({
              type: 'temporary_password',
              targetUsername: username,
              recipient: email,
              subject: 'Your temporary password',
              metadata: {
                fullName: identity.fullName,
                loginUrl: `${temporaryNotificationOrigin}/login/`,
                expiresAt: replacementTemporaryExpiresAt
              },
              secretCiphertext: encrypted.ciphertext,
              secretIv: encrypted.iv,
              secretTag: encrypted.tag
            });
          } catch (deliveryError) {
            console.error('Temporary-password replacement email could not be queued:', deliveryError.message);
          }
        }
        return updated;
      })
      : await saveUser();
    await securityStore.setIdentity(username, identity);
    await authStore.saveAuditEvent({
      actorUsername: req.user.username,
      targetUsername: username,
      action: 'user.identity_updated',
      metadata: {
        roleId: selectedRole.id,
        roleName: selectedRole.name,
        productScope,
        status,
        accessChanged,
        before: {
          roleId: target.roleId,
          roleName: target.roleName,
          productScope: target.access?.productScope
        },
        emailChanged,
        pendingInvitationInvalidated: invalidatePendingEnrollment,
        temporaryCredentialRotated: rotateTemporaryCredential,
        temporaryPasswordEmailQueued: Boolean(replacementTemporaryDelivery)
      }
    });
    if (replacementTemporaryPassword) res.set('Cache-Control', 'no-store');
    res.json({
      message: 'User updated',
      user: await enrichPublicUser(saved),
      ...(replacementTemporaryPassword ? {
        temporaryPassword: replacementTemporaryPassword,
        expiresAt: replacementTemporaryExpiresAt,
        deliveryMode: replacementTemporaryDelivery ? 'queued' : 'manual_only'
      } : {})
    });
  } catch (error) {
    console.error('Update user error:', error.message);
    if (error.status) return sendAccessStoreError(res, error, 'Unable to update user');
    res.status(500).json({ error: 'Unable to update user' });
  }
});

// Users - Delete (Admins only)
app.delete('/api/users/:username', authenticateJwt, requireSystemAdmin, async (req, res) => {
  const { username } = req.params;

  try {
    const users = await authStore.listUsers();
    
    // Prevent deleting the last admin
    const targetUser = users.find(user => user.username === username);
    if (targetUser?.roleId === SYSTEM_ADMIN_ROLE_ID
      && targetUser.status !== 'suspended'
      && await authStore.countActiveSystemAdministrators() <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last System Administrator account' });
    }

    // Prevent deleting yourself
    if (req.user.username === username) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const deleted = await securityStore.withMfaMutationLock(username, async () => {
      await securityStore.deleteUserData(username);
      return authStore.deleteUser(username);
    });
    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    await authStore.saveAuditEvent({
      actorUsername: req.user.username,
      targetUsername: username,
      action: 'user.deleted'
    });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health checks: liveness only checks the process; readiness checks auth storage.
app.get(['/api/health', '/api/auth/health/live'], (_req, res) => {
  res.json({
    ok: true,
    storage: authStore.isDbEnabled() ? 'auth-postgresql' : 'json'
  });
});

app.get('/api/auth/health/ready', async (_req, res) => {
  try {
    res.json(await authStore.checkHealth());
  } catch (err) {
    console.error('Auth readiness check failed:', err.message);
    res.status(503).json({ ok: false, error: 'Authentication storage unavailable' });
  }
});

// ── SERVE STANDALONE LOGIN UI ──
app.use('/login', express.static(CLIENT_DIST_DIR));

// Fallback to React app index.html for frontend routing
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path !== '/login' && !req.path.startsWith('/login/')) return next();
  const indexPath = path.join(CLIENT_DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not Found');
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));


// Start Server
async function start(port = PORT) {
  await authStore.initialize();
  await securityStore.initialize();
  emailWorker.start();
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    const admin = await authStore.getUserByUsername('admin');
    if (admin && verifyPassword('admin', admin)) {
      console.warn('Auth Service: The existing admin account still uses the default password; change it immediately');
    }
  }
  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Auth Service listening on 0.0.0.0:${server.address().port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Auth Service failed to start:', err);
    process.exit(1);
  });
}

module.exports = { app, authStore, securityStore, emailWorker, enrichPublicUser, getRequestOrigin, start };
