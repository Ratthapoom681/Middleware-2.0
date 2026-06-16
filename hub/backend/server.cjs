const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createAuthStore, DEFAULT_APP_KEY } = require('./auth-store.cjs');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-me-in-production';
const TOKEN_ISSUER = process.env.JWT_ISSUER || 'middleware-hub';
const TOKEN_AUDIENCE = 'internal-security-middleware';
const AUTH_SERVICE_TOKEN = process.env.AUTH_SERVICE_TOKEN || '';
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

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

function signJwt(payload, secret, expiresInSeconds = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };
  
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

function verifyJwt(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [encodedHeader, encodedPayload, signature] = parts;
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
      
    if (signature !== expectedSignature) return null;
    
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null; // Expired
    }
    
    return payload;
  } catch {
    return null;
  }
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

function buildTokenPayload(user, sid) {
  return {
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    sub: user.id,
    sid,
    username: user.username,
    email: user.email,
    role: user.role,
    products: user.products,
    status: user.status,
    apps: ['hub', DEFAULT_APP_KEY, 'wazuh']
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
      status: currentUser.status
    };
    next();
  } catch (err) {
    console.error('Session validation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
}

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
      await authStore.upsertUser({
        ...user,
        salt: upgraded.salt,
        hash: upgraded.hash,
        passwordAlgorithm: upgraded.algorithm
      });
    }

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

    const token = signJwt(buildTokenPayload(loggedInUser, sid), JWT_SECRET, expiresInSeconds);

    res.json({
      token,
      user: authStore.buildPublicUser(loggedInUser)
    });
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
      status: currentUser.status
    }
  });
});

// Users - List all users (Admins only)
app.get('/api/users', authenticateJwt, requireAdmin, async (req, res) => {
  try {
    const users = await authStore.listUsers();
    res.json(users.map(authStore.buildPublicUser));
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Users - Create or Update (Admins only)
app.post('/api/users', authenticateJwt, requireAdmin, async (req, res) => {
  const { username, password, role, products, email, status } = req.body;
  if (!username || !role) {
    return res.status(400).json({ error: 'Username and role are required' });
  }

  try {
    const normalizedUsername = String(username || '').trim();
    const existingUser = await authStore.getUserByUsername(normalizedUsername);
    const users = await authStore.listUsers();

    const nextStatus = String(status || 'active').trim().toLowerCase() === 'suspended' ? 'suspended' : 'active';
    const nextEmail = String(email || '').trim();
    const nextProducts = Array.isArray(products) ? products : [];

    // Prevent suspending yourself
    if (req.user.username === normalizedUsername && nextStatus === 'suspended') {
      return res.status(400).json({ error: 'Cannot suspend your own account' });
    }
    if (req.user.username === normalizedUsername && role !== req.user.role) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    if (!existingUser && !password) {
      return res.status(400).json({ error: 'Password is required for new users' });
    }

    if (existingUser?.role === 'admin' && role !== 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last administrator account' });
    }

    const nextUser = {
      ...(existingUser || {}),
      username: normalizedUsername,
      email: nextEmail,
      role,
      products: nextProducts,
      status: nextStatus,
      lastLoginAt: existingUser?.lastLoginAt || ''
    };

    if (password) {
      const { salt, hash, algorithm } = hashPassword(password);
      nextUser.salt = salt;
      nextUser.hash = hash;
      nextUser.passwordAlgorithm = algorithm;
    }

    const saved = await authStore.upsertUser(nextUser);
    await authStore.saveAuditEvent({
      actorUsername: req.user.username,
      targetUsername: normalizedUsername,
      action: existingUser ? 'user.updated' : 'user.created',
      metadata: { role, status: nextStatus }
    });
    res.json({
      message: 'User saved successfully',
      user: authStore.buildPublicUser(saved)
    });
  } catch (err) {
    console.error('Save user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Users - Delete (Admins only)
app.delete('/api/users/:username', authenticateJwt, requireAdmin, async (req, res) => {
  const { username } = req.params;

  try {
    const users = await authStore.listUsers();
    
    // Prevent deleting the last admin
    const targetUser = users.find(user => user.username === username);
    if (targetUser?.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last administrator account' });
    }

    // Prevent deleting yourself
    if (req.user.username === username) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const deleted = await authStore.deleteUser(username);
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    storage: authStore.isDbEnabled() ? 'auth-postgresql' : 'json'
  });
});

// ── SERVE STATIC REACT FILES ──
app.use(express.static(CLIENT_DIST_DIR));

// Fallback to React app index.html for frontend routing
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const indexPath = path.join(CLIENT_DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not Found');
  }
});


// Start Server
async function start() {
  await authStore.initialize();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hub Service backend listening on 0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Hub Service failed to start:', err);
  process.exit(1);
});
