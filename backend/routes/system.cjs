const express = require('express');

module.exports = function(ctx) {
    const router = express.Router();

    router.get('/logs', (req, res) => {
        res.json(ctx.getLogs());
    });

    router.delete('/logs', (req, res) => {
        ctx.clearLogs();
        res.json({
            message: 'Logs cleared'
        });
    });

    router.get('/sync/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        const client = {
            id: ctx.crypto.randomUUID(),
            res
        };
        ctx.dashboardSyncClients.add(client);
        ctx.writeDashboardSyncEvent(res, 'dashboard-sync', ctx.getDashboardSyncState());
        const heartbeat = setInterval(() => {
            ctx.writeDashboardSyncEvent(res, 'heartbeat', {
                at: new Date().toISOString()
            });
        }, ctx.DASHBOARD_SYNC_HEARTBEAT_MS);
        req.on('close', () => {
            clearInterval(heartbeat);
            ctx.dashboardSyncClients.delete(client);
        });
    });

    return router;
};
