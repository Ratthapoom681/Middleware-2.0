const express = require('express');

module.exports = function(ctx) {
    const router = express.Router();

    router.post('/login', (req, res) => {
        const {username, password} = req.body;
        const users = ctx.getUsers();
        const user = users.find(u => u.username === username);
        if (!user || !ctx.verifyPassword(password, user.hash, user.salt)) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }
        const token = ctx.crypto.randomBytes(32).toString('hex');
        ctx.sessions.set(token, {
            username: user.username,
            role: user.role,
            products: user.products
        });
        res.json({
            token,
            user: {
                username: user.username,
                role: user.role,
                products: user.products
            }
        });
    });

    router.post('/logout', (req, res) => {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        ctx.sessions.delete(token);
        res.json({
            message: 'Logged out'
        });
    });

    router.get('/users', ctx.requireAuth, ctx.requireAdmin, (req, res) => {
        const users = ctx.getUsers();
        res.json(users.map(u => ({
            username: u.username,
            role: u.role,
            products: u.products
        })));
    });

    router.post('/users', ctx.requireAuth, ctx.requireAdmin, async (req, res) => {
        const {username, password, role, products} = req.body;
        if (!username || !role) {
            return res.status(400).json({
                error: 'Username and role are required'
            });
        }
        const users = ctx.getUsers();
        const existingIndex = users.findIndex(u => u.username === username);
        if (existingIndex >= 0) {
            users[existingIndex].role = role;
            users[existingIndex].products = Array.isArray(products) ? products : [];
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
                role,
                products: Array.isArray(products) ? products : []
            });
        }
        await ctx.saveUsers();
        for (const [token, session] of ctx.sessions.entries()) {
            if (session.username === username) {
                ctx.sessions.set(token, {
                    username,
                    role,
                    products: Array.isArray(products) ? products : []
                });
            }
        }
        res.json({
            message: 'User saved successfully'
        });
    });

    router.delete('/users/:username', ctx.requireAuth, ctx.requireAdmin, async (req, res) => {
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
