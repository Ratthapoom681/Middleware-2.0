// Authentication — password hashing, user management helpers, and Express middleware factories.

const crypto = require('crypto');
const fs = require('fs-extra');

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
};

const verifyPassword = (password, hash, salt) => {
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
};

const normalizeUserStatus = (status = '') => (
    String(status || '').trim().toLowerCase() === 'suspended' ? 'suspended' : 'active'
);

const normalizeUserRecord = (user = {}) => ({
    username: String(user.username || '').trim(),
    salt: user.salt || '',
    hash: user.hash || user.password_hash || '',
    email: String(user.email || '').trim(),
    role: String(user.role || 'viewer').trim() || 'viewer',
    products: Array.isArray(user.products) ? user.products : [],
    status: normalizeUserStatus(user.status || user.accountStatus),
    lastLoginAt: user.lastLoginAt || user.last_login_at || ''
});

const getUserPresenceStatus = (user = {}, sessions = new Map()) => (
    Array.from(sessions.values()).some(session => session.username === user.username)
        ? 'online'
        : 'offline'
);

const buildPublicUser = (user = {}, sessions = new Map()) => {
    const normalizedUser = normalizeUserRecord(user);
    const accountStatus = normalizeUserStatus(normalizedUser.status);
    const presenceStatus = accountStatus === 'suspended' ? 'offline' : getUserPresenceStatus(normalizedUser, sessions);
    return {
        username: normalizedUser.username,
        email: normalizedUser.email,
        role: normalizedUser.role,
        products: normalizedUser.products,
        status: accountStatus === 'suspended' ? 'suspended' : presenceStatus,
        accountStatus,
        presenceStatus,
        lastLoginAt: normalizedUser.lastLoginAt || ''
    };
};

const readUsersFromDisk = (usersPath) => {
    if (fs.existsSync(usersPath)) {
        try {
            const diskUsers = fs.readJsonSync(usersPath);
            return Array.isArray(diskUsers) ? diskUsers.map(normalizeUserRecord).filter(user => user.username) : [];
        } catch (err) {
            console.error('Error loading users:', err);
        }
    }
    return [];
};

const createDefaultAdminUser = () => {
    const { salt, hash } = hashPassword('admin');
    return {
        username: 'admin',
        salt,
        hash,
        email: '',
        role: 'admin',
        products: [],
        status: 'active',
        lastLoginAt: ''
    };
};

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-me-in-production';
const DEFAULT_JWT_EXPIRES_SECONDS = 3600;
const TOKEN_ISSUER = process.env.JWT_ISSUER || 'middleware-hub';
const TOKEN_AUDIENCE = process.env.JWT_AUDIENCE || 'internal-security-middleware';
const REQUIRED_APP = process.env.AUTH_REQUIRED_APP || 'defectdojo';
const AUTH_INTROSPECTION_URL = process.env.AUTH_INTROSPECTION_URL || '';
const AUTH_SERVICE_TOKEN = process.env.AUTH_SERVICE_TOKEN || '';
const ENABLE_LEGACY_LOCAL_AUTH = String(process.env.ENABLE_LEGACY_LOCAL_AUTH || '').toLowerCase() === 'true';

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

function signJwt(payload, secret = JWT_SECRET, expiresInSeconds = DEFAULT_JWT_EXPIRES_SECONDS) {
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

const isExpectedHubPayload = (payload = {}) => {
    if (!payload || payload.iss !== TOKEN_ISSUER || payload.aud !== TOKEN_AUDIENCE || !payload.sid) return false;
    if (payload.role === 'admin') return true;
    if (!Array.isArray(payload.apps)) return true;
    return payload.apps.includes(REQUIRED_APP);
};

const introspectToken = async (token) => {
    if (!AUTH_INTROSPECTION_URL) return null;
    const response = await fetch(AUTH_INTROSPECTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(AUTH_SERVICE_TOKEN ? { 'X-Auth-Service-Token': AUTH_SERVICE_TOKEN } : {})
        },
        body: JSON.stringify({ token })
    });
    if (!response.ok) {
        throw new Error(`Auth introspection failed with status ${response.status}`);
    }
    return response.json();
};

/**
 * Factory that returns an Express middleware which checks for a valid Bearer token.
 * Hub-issued JWTs are accepted after issuer/audience validation. When configured,
 * the Hub introspection endpoint is used so logout, suspension, and role changes
 * take effect before the access token naturally expires.
 */
const createRequireAuth = (sessions) => async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const payload = verifyJwt(token, JWT_SECRET);
    if (payload && isExpectedHubPayload(payload)) {
        if (AUTH_INTROSPECTION_URL) {
            try {
                const result = await introspectToken(token);
                if (!result?.active || !isExpectedHubPayload(result.payload)) {
                    return res.status(401).json({ error: 'Unauthorized: Invalid or revoked token' });
                }
                req.user = result.payload;
                return next();
            } catch (err) {
                console.error('Auth introspection error:', err.message);
                return res.status(503).json({ error: 'Authentication service unavailable' });
            }
        }
        req.user = payload;
        return next();
    }

    const session = ENABLE_LEGACY_LOCAL_AUTH ? sessions.get(token) : null;
    if (session && payload?.sid) {
        req.user = session;
        return next();
    }

    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
};

/** Express middleware that requires req.user.role === 'admin'. */
const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admins only' });
    }
    next();
};

module.exports = {
    hashPassword,
    verifyPassword,
    normalizeUserStatus,
    normalizeUserRecord,
    getUserPresenceStatus,
    buildPublicUser,
    readUsersFromDisk,
    createDefaultAdminUser,
    signJwt,
    createRequireAuth,
    requireAdmin
};
