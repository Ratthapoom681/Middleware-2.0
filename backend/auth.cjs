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

const readUsersFromDisk = (usersPath) => {
    if (fs.existsSync(usersPath)) {
        try {
            const diskUsers = fs.readJsonSync(usersPath);
            return Array.isArray(diskUsers) ? diskUsers : [];
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
        role: 'admin',
        products: []
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
    readUsersFromDisk,
    createDefaultAdminUser,
    createRequireAuth,
    requireAdmin
};
