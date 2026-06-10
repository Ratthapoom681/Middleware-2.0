const express = require('express');

module.exports = function(ctx) {
    const router = express.Router();

    router.get('/dashboard/summary', async (req, res) => {
        try {
            const productId = ctx.cleanRouteValue(req.query.productId);
            const engagementId = ctx.cleanRouteValue(req.query.engagementId);
            const isAdmin = req.user.role === 'admin';
            const allowedProducts = isAdmin ? undefined : ctx.getAllowedProductsForUser(req.user);
            if (ctx.database.isEnabled()) {
                return res.json(await ctx.database.getDashboardSummary({
                    allowedProducts,
                    requireAllowedProducts: !isAdmin,
                    productId,
                    engagementId,
                    includeMitigationReview: isAdmin
                }));
            }
            const findings = await ctx.loadFindingsForUser(req.user);
            const scopedFindings = findings.filter(finding => {
                const route = ctx.getAutoDefectDojoRoute(finding);
                if (productId && !ctx.routeValueMatches(productId, route.projectId, route.projectName, ctx.getRouteEntityKey('product', route.projectId, route.projectName))) return false;
                if (engagementId && !ctx.routeValueMatches(engagementId, route.engagementId, route.engagementName, ctx.getRouteEntityKey('engagement', route.engagementId, route.engagementName))) return false;
                return true;
            });
            const products = new Map();
            const engagements = new Map();
            findings.forEach(finding => {
                const route = ctx.getAutoDefectDojoRoute(finding);
                const productKey = ctx.getRouteEntityKey('product', route.projectId, route.projectName);
                const engagementKey = ctx.getRouteEntityKey('engagement', route.engagementId, route.engagementName);
                if (route.projectId || route.projectName) {
                    products.set(route.projectId || productKey || route.projectName, {
                        id: route.projectId || '',
                        key: productKey,
                        name: route.projectName || route.projectId || 'Unknown product'
                    });
                }
                if ((!productId || ctx.routeValueMatches(productId, route.projectId, route.projectName, productKey)) && (route.engagementId || route.engagementName)) {
                    engagements.set(route.engagementId || engagementKey || route.engagementName, {
                        id: route.engagementId || '',
                        key: engagementKey,
                        name: route.engagementName || route.engagementId || 'Unknown engagement',
                        productId: route.projectId || '',
                        productKey
                    });
                }
            });
            const ticketValues = Object.values(ctx.getRedmineSyncStore().byTicket || ({})).filter(ticket => {
                const route = ticket.route || {};
                const productKey = ctx.getRouteEntityKey('product', route.projectId, route.projectName);
                const engagementKey = ctx.getRouteEntityKey('engagement', route.engagementId, route.engagementName);
                if (!isAdmin && !allowedProducts.some(product => ctx.routeValueMatches(product, route.projectId, route.projectName, productKey))) return false;
                if (productId && !ctx.routeValueMatches(productId, route.projectId, route.projectName, productKey)) return false;
                if (engagementId && !ctx.routeValueMatches(engagementId, route.engagementId, route.engagementName, engagementKey)) return false;
                return true;
            });
            const ticketCount = predicate => ticketValues.filter(predicate).length;
            const config = ctx.getConfig();
            const summary = {
                defectDojo: {
                    activeFindings: scopedFindings.filter(finding => ctx.isStoredFindingActive(finding) && !ctx.isStoredFindingMitigated(finding)).length,
                    mitigatedFindings: scopedFindings.filter(ctx.isStoredFindingMitigated).length
                },
                redmine: {
                    ticketNew: ticketCount(ticket => ctx.normalizeTicketStatus(ticket.status) === 'new'),
                    ticketInProgress: ticketCount(ticket => ctx.isInProgressStatus(ticket.status, ticket.statusId, {}, config)),
                    ticketFeedback: ticketCount(ticket => ctx.normalizeTicketStatus(ticket.status) === 'feedback'),
                    ticketResolve: ticketCount(ticket => ctx.isResolveStatus(ticket.status, ticket.statusId, {}, config)),
                    ticketClosed: ticketCount(ticket => Boolean(ticket.isClosed) || ctx.isClosedStatus(ticket.status, ticket.statusId, {}, config))
                },
                filters: {
                    products: Array.from(products.values()),
                    engagements: Array.from(engagements.values())
                }
            };
            if (isAdmin) {
                summary.mitigationReview = { pendingCount: 0 };
            }
            res.json(summary);
        } catch (error) {
            console.error('Error building dashboard summary:', error);
            res.status(500).json({
                error: 'Failed to build dashboard summary',
                details: error.message
            });
        }
    });

    router.get('/compacted-cves', async (req, res) => {
        try {
            const productId = ctx.cleanRouteValue(req.query.productId);
            const engagementId = ctx.cleanRouteValue(req.query.engagementId);
            const severity = ctx.cleanRouteValue(req.query.severity);
            const isAdmin = req.user.role === 'admin';
            const allowedProducts = isAdmin ? undefined : ctx.getAllowedProductsForUser(req.user);
            if (ctx.database.isEnabled()) {
                return res.json(await ctx.database.listCompactedCveFindings({
                    allowedProducts,
                    requireAllowedProducts: !isAdmin,
                    productId,
                    engagementId,
                    severity
                }));
            }
            const findings = await ctx.loadFindingsForUser(req.user);
            const groups = ctx.buildBackendCompactedRedmineTicketRefs(findings).filter(group => {
                const route = group.route || {};
                const productKey = ctx.getRouteEntityKey('product', route.projectId, route.projectName);
                const engagementKey = ctx.getRouteEntityKey('engagement', route.engagementId, route.engagementName);
                if (productId && !ctx.routeValueMatches(productId, route.projectId, route.projectName, productKey)) return false;
                if (engagementId && !ctx.routeValueMatches(engagementId, route.engagementId, route.engagementName, engagementKey)) return false;
                return true;
            }).map(group => {
                const storedSync = ctx.getRedmineSyncStore().byTicket[group.ticketKey] || ({});
                return {
                    ...group,
                    groupKey: group.ticketKey,
                    compactedSyncKey: group.ticketKey,
                    compactGroupId: group.ticketKey,
                    productId: group.route.projectId,
                    productName: group.route.projectName,
                    engagementId: group.route.engagementId,
                    engagementName: group.route.engagementName,
                    redmineTicketId: group.issueId || '',
                    redmineStatus: storedSync.status || '',
                    redmineStatusId: storedSync.statusId || '',
                    currentStatus: group.currentStatus || 'active'
                };
            });
            res.json(severity ? groups.filter(group => group.severity === severity) : groups);
        } catch (error) {
            console.error('Error listing compacted CVEs:', error);
            res.status(500).json({
                error: 'Failed to list compacted CVEs',
                details: error.message
            });
        }
    });

    router.post('/pull', ctx.requireAdmin, async (req, res) => {
        const {url, apiKey, filters} = req.body;
        if (!url || !apiKey) {
            return res.status(400).json({
                error: 'URL and API Key are required'
            });
        }
        try {
            const pullData = await ctx.runDefectDojoPull({
                url,
                apiKey,
                filters,
                user: req.user,
                createHistory: true,
                finishHistory: true,
                broadcastEvent: true
            });
            res.json(pullData);
        } catch (error) {
            console.error('Error pulling from DefectDojo:', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
            }
            res.status(500).json({
                error: 'Failed to pull from DefectDojo',
                details: error.response?.data || error.message,
                syncHistory: error.syncHistory || null
            });
        }
    });

    router.get('/findings', async (req, res) => {
        try {
            const findings = await ctx.loadFindingsForUser(req.user);
            res.json(findings);
        } catch (error) {
            console.error('Error reading findings:', error);
            res.status(error.status || 500).json({
                error: error.message || 'Failed to read findings'
            });
        }
    });

    router.post('/clear', ctx.requireAdmin, async (req, res) => {
        try {
            if (ctx.database.isEnabled()) {
                await ctx.database.clearAllData();
                await ctx.clearLocalFindingsStore();
                await ctx.resetRedmineSyncStore();
                ctx.emptyFindingsCache();
                ctx.broadcastDashboardSync('scan-store-cleared');
                return res.json({
                    message: 'Database scan, sync, ticket, and review data cleared'
                });
            }
            await ctx.clearLocalFindingsStore();
            await ctx.resetRedmineSyncStore();
            ctx.emptyFindingsCache();
            ctx.broadcastDashboardSync('scan-store-cleared');
            res.json({
                message: 'Local findings and sync data cleared'
            });
        } catch (error) {
            console.error('Failed to clear local data:', error);
            res.status(500).json({
                error: 'Failed to clear local data'
            });
        }
    });

    return router;
};
