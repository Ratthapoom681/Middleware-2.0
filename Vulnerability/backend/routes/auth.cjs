const express = require('express');

module.exports = function(ctx) {
    const router = express.Router();
    const legacyLocalAuthEnabled = String(process.env.ENABLE_LEGACY_LOCAL_AUTH || '').toLowerCase() === 'true';
    const localAuthDisabled = (_req, res) => res.status(410).json({
        error: 'DefectDojo local authentication is disabled. Sign in through the Middleware Hub.',
        loginUrl: '/'
    });

    router.post('/login', async (req, res) => {
        if (!legacyLocalAuthEnabled) return localAuthDisabled(req, res);
        const {username, password} = req.body;
        const normalizedUsername = String(username || '').trim();
        if (!normalizedUsername || !password) {
            return res.status(400).json({
                error: 'Username and password are required'
            });
        }
        const users = ctx.getUsers();
        const userIndex = users.findIndex(u => u.username === normalizedUsername);
        const user = userIndex >= 0 ? ctx.normalizeUserRecord(users[userIndex]) : null;
        if (!user || !ctx.verifyPassword(password, user.hash, user.salt)) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }
        if (ctx.normalizeUserStatus(user.status) === 'suspended') {
            return res.status(403).json({
                error: 'User account is suspended'
            });
        }
        user.lastLoginAt = new Date().toISOString();
        users[userIndex] = user;
        await ctx.saveUsers();
        const sid = ctx.crypto.randomBytes(16).toString('hex');
        const session = {
            sid,
            username: user.username,
            email: user.email,
            role: user.role,
            products: user.products,
            status: user.status,
            lastLoginAt: user.lastLoginAt
        };
        const token = ctx.signJwt(session);
        ctx.sessions.set(token, session);
        res.json({
            token,
            user: ctx.buildPublicUser(user, ctx.sessions)
        });
    });

    router.post('/logout', (req, res) => {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        if (legacyLocalAuthEnabled) ctx.sessions.delete(token);
        res.json({
            message: 'Logged out'
        });
    });

    router.get('/users', ctx.requireAuth, ctx.requireAdmin, (req, res) => {
        if (!legacyLocalAuthEnabled) return localAuthDisabled(req, res);
        const users = ctx.getUsers();
        res.json(users.map(u => ctx.buildPublicUser(u, ctx.sessions)));
    });

    router.post('/users', ctx.requireAuth, ctx.requireAdmin, async (req, res) => {
        if (!legacyLocalAuthEnabled) return localAuthDisabled(req, res);
        const {username, password, role, products, email, status} = req.body;
        if (!username || !role) {
            return res.status(400).json({
                error: 'Username and role are required'
            });
        }
        const users = ctx.getUsers();
        const existingIndex = users.findIndex(u => u.username === username);
        const nextStatus = ctx.normalizeUserStatus(status);
        const nextEmail = String(email || '').trim();
        const nextProducts = Array.isArray(products) ? products : [];
        if (req.user.username === username && nextStatus === 'suspended') {
            return res.status(400).json({
                error: 'Cannot suspend yourself'
            });
        }
        if (existingIndex >= 0) {
            const existingUser = ctx.normalizeUserRecord(users[existingIndex]);
            users[existingIndex] = {
                ...existingUser,
                email: nextEmail,
                role,
                products: nextProducts,
                status: nextStatus
            };
            if (password) {
                const {salt, hash} = ctx.hashPassword(password);
                users[existingIndex].salt = salt;
                users[existingIndex].hash = hash;
            }
        } else {
            if (!password) return res.status(400).json({
                error: 'Password is required for new users'
            });
            const {salt, hash} = ctx.hashPassword(password);
            users.push({
                username,
                salt,
                hash,
                email: nextEmail,
                role,
                products: nextProducts,
                status: nextStatus,
                lastLoginAt: ''
            });
        }
        await ctx.saveUsers();
        const savedUser = users.find(u => u.username === username);
        for (const [token, session] of ctx.sessions.entries()) {
            if (session.username === username) {
                if (nextStatus === 'suspended') {
                    ctx.sessions.delete(token);
                } else {
                    ctx.sessions.set(token, {
                        username,
                        email: nextEmail,
                        role,
                        products: nextProducts,
                        status: nextStatus,
                        lastLoginAt: savedUser?.lastLoginAt || ''
                    });
                }
            }
        }
        res.json({
            message: 'User saved successfully',
            user: ctx.buildPublicUser(savedUser, ctx.sessions)
        });
    });

    router.delete('/users/:username', ctx.requireAuth, ctx.requireAdmin, async (req, res) => {
        if (!legacyLocalAuthEnabled) return localAuthDisabled(req, res);
        const {username} = req.params;
        let users = ctx.getUsers();
        if (username === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
            return res.status(400).json({
                error: 'Cannot delete the last admin user'
            });
        }
        if (req.user.username === username) {
            return res.status(400).json({
                error: 'Cannot delete yourself'
            });
        }
        users = users.filter(u => u.username !== username);
        ctx.setUsers(users);
        await ctx.saveUsers();
        for (const [token, session] of ctx.sessions.entries()) {
            if (session.username === username) ctx.sessions.delete(token);
        }
        res.json({
            message: 'User deleted'
        });
    });

    return router;
};
