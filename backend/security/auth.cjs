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

/**
 * Factory that returns an Express middleware which checks for a valid Bearer token.
 * @param {Map} sessions — the live session map (token → user)
 */
const createRequireAuth = (sessions) => (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = sessions.get(token);
    next();
};

/** Express middleware that requires req.user.role === 'admin'. */
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
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
    createRequireAuth,
    requireAdmin
};
