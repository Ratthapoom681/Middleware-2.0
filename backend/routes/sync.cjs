const express = require('express');

module.exports = function(ctx) {
    const router = express.Router();

    router.get('/sync-history', ctx.requireAdmin, async (req, res) => {
        try {
            if (!ctx.database.isEnabled()) return res.json([]);
            res.json(await ctx.database.listSyncHistory(req.query));
        } catch (error) {
            console.error('Error listing sync history:', error);
            res.status(500).json({
                error: 'Failed to list sync history',
                details: error.message
            });
        }
    });

    router.get('/sync-history/:id', ctx.requireAdmin, async (req, res) => {
        try {
            if (!ctx.database.isEnabled()) return res.status(404).json({
                error: 'Sync history is database-backed and PostgreSQL is not enabled'
            });
            const item = await ctx.database.getSyncHistory(req.params.id);
            if (!item) return res.status(404).json({
                error: 'Sync history not found'
            });
            res.json(item);
        } catch (error) {
            console.error('Error reading sync history:', error);
            res.status(500).json({
                error: 'Failed to read sync history',
                details: error.message
            });
        }
    });

    router.post('/sync-all', ctx.requireAdmin, async (req, res) => {
        const {url, apiKey, filters, redmine = {}} = req.body;
        const config = ctx.getConfig();
        const defectDojoUrl = String(url || config.defectDojoUrl || '').trim();
        const defectDojoApiKey = String(apiKey || config.defectDojoApiKey || '').trim();
        const normalizedFilters = ctx.normalizePullFilters(filters || config.pullFilters || ({}));
        const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
        const redmineApiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();
        const configuredProjectId = ctx.cleanRouteValue(redmine.projectId || config.redmineProjectId);
        const trackerId = ctx.cleanRouteValue(redmine.trackerId || config.redmineTrackerId);
        const requestedProductId = ctx.getEntityId(normalizedFilters.test__engagement__product);
        const requestedEngagementId = ctx.getEntityId(normalizedFilters.test__engagement);
        const shouldSplitSyncHistory = !requestedProductId && !requestedEngagementId;
        let syncHistory = null;
        const warnings = [];
        const errors = [];
        if (!defectDojoUrl || !defectDojoApiKey) {
            return res.status(400).json({
                error: 'DefectDojo URL and API Key are required'
            });
        }
        if (!redmineUrl || !redmineApiKey) {
            return res.status(400).json({
                error: 'Redmine URL and API Key are required'
            });
        }
        const sendSyncAllProgress = ctx.createSyncAllProgressBroadcaster();
        try {
            sendSyncAllProgress({
                phase: 'Starting',
                step: 0,
                message: 'Starting Sync All'
            });
            if (ctx.database.isEnabled()) {
                syncHistory = await ctx.database.createSyncHistory({
                    syncType: 'Sync All',
                    productId: requestedProductId,
                    engagementId: requestedEngagementId,
                    filters: normalizedFilters,
                    triggeredBy: req.user?.username || '',
                    triggeredRole: req.user?.role || ''
                });
            }
            sendSyncAllProgress({
                phase: 'Pulling DefectDojo',
                step: 1,
                message: 'Pulling DefectDojo findings'
            });
            const localBaseUrl = `http://127.0.0.1:${ctx.PORT}`;
            const pullData = await ctx.runDefectDojoPull({
                url: defectDojoUrl,
                apiKey: defectDojoApiKey,
                filters: normalizedFilters,
                user: req.user,
                syncHistoryId: syncHistory?.id || null,
                finishHistory: false,
                broadcastEvent: false,
                includeFindings: shouldSplitSyncHistory
            });
            sendSyncAllProgress({
                phase: 'Preparing Redmine',
                step: 2,
                message: `Pulled ${pullData.count || 0} DefectDojo finding${(pullData.count || 0) === 1 ? '' : 's'}`
            });
            const baseUrl = redmineUrl.replace(/\/$/, '');
            const statusIds = await ctx.resolveRedmineStatusIds({
                baseUrl,
                apiKey: redmineApiKey,
                config
            });
            let ticketRefs = await ctx.loadBackendRedmineCheckTicketRefs();
            ticketRefs = ctx.mergeStoredRedmineSyncTicketRefs(ticketRefs, {
                productId: requestedProductId,
                engagementId: requestedEngagementId
            });
            ticketRefs = ticketRefs.filter(ticket => {
                if (requestedProductId && ticket.route?.projectId !== requestedProductId) return false;
                if (requestedEngagementId && ticket.route?.engagementId !== requestedEngagementId) return false;
                return true;
            });
            const ticketRefByKey = new Map(ticketRefs.map(ticket => [ticket.ticketKey, ticket]));
            sendSyncAllProgress({
                phase: 'Checking Redmine',
                step: 3,
                message: `Checking ${ticketRefs.length} Redmine ticket reference${ticketRefs.length === 1 ? '' : 's'}`
            });
            const {results, stats} = await ctx.checkRedmineTicketRefsForDashboard({
                baseUrl,
                apiKey: redmineApiKey,
                configuredProjectId,
                trackerId,
                ticketRefs,
                logPrefix: 'SYNC_ALL',
                persist: true,
                statusIds,
                pruneScope: {
                    productId: requestedProductId,
                    engagementId: requestedEngagementId
                }
            });
            sendSyncAllProgress({
                phase: 'Updating Priorities',
                step: 4,
                message: `Checked ${stats.checkedCount || 0} Redmine ticket${(stats.checkedCount || 0) === 1 ? '' : 's'}`
            });
            let createdOrUpdated = 0;
            let priorityUpdated = 0;
            const createdOrUpdatedTicketKeys = new Set();
            const priorityUpdatedTicketKeys = new Set();
            const statusByTicketKey = new Map(results.map(result => [result.ticketKey, result]));
            const ticketsToUpdatePriority = ticketRefs.filter(ticket => {
                const status = statusByTicketKey.get(ticket.ticketKey);
                const priorityId = ctx.getRedminePriorityIdForSeverity(ticket.severity || '', config);
                return status?.action === 'existing_open' && status.issueId && priorityId && ctx.getRedmineIssuePriorityId(status.issue) !== priorityId;
            });
            const ticketsToCreate = ticketRefs.filter(ticket => statusByTicketKey.get(ticket.ticketKey)?.action === 'not_found');
            await ctx.runWithConcurrency(ticketsToUpdatePriority, ctx.REDMINE_CHECK_CONCURRENCY, async ticket => {
                const status = statusByTicketKey.get(ticket.ticketKey);
                const priorityId = ctx.getRedminePriorityIdForSeverity(ticket.severity || '', config);
                try {
                    const changed = await ctx.updateOpenRedmineIssuePriorityIfNeeded({
                        baseUrl,
                        apiKey: redmineApiKey,
                        issue: status.issue,
                        issueId: status.issueId,
                        priorityId,
                        severity: ticket.severity || ''
                    });
                    if (changed) priorityUpdated += 1;
                    if (changed) priorityUpdatedTicketKeys.add(ticket.ticketKey);
                } catch (error) {
                    const detail = error.response?.data || error.message;
                    errors.push(detail);
                    console.warn(`[SYNC_ALL] Could not update Redmine ticket priority ${ticket.ticketKey}: ${JSON.stringify(detail)}`);
                }
            }, {
                onProgress: ctx.createProgressLogger('Sync All Redmine ticket priorities updated', ticketsToUpdatePriority.length, 'SYNC_ALL')
            });
            sendSyncAllProgress({
                phase: 'Creating Tickets',
                step: 5,
                message: `Updated ${priorityUpdated} Redmine ticket priorit${priorityUpdated === 1 ? 'y' : 'ies'}`
            });
            await ctx.runWithConcurrency(ticketsToCreate, ctx.REDMINE_CHECK_CONCURRENCY, async ticket => {
                const detailedTicket = ticketRefByKey.get(ticket.ticketKey) || ticket;
                const description = detailedTicket.superTicketMarkdown || ctx.buildAutoSuperTicketMarkdown({
                    ...detailedTicket,
                    defectDojoProjectId: detailedTicket.defectDojoProjectId || detailedTicket.route?.projectId || '',
                    defectDojoProjectName: detailedTicket.defectDojoProjectName || detailedTicket.route?.projectName || '',
                    defectDojoEngagementId: detailedTicket.defectDojoEngagementId || detailedTicket.route?.engagementId || '',
                    defectDojoEngagementName: detailedTicket.defectDojoEngagementName || detailedTicket.route?.engagementName || ''
                });
                try {
                    const severity = detailedTicket.severity || ticket.severity || '';
                    await ctx.axios.post(`${localBaseUrl}/api/redmine/issues`, {
                        redmine: {
                            url: redmineUrl,
                            apiKey: redmineApiKey,
                            projectId: configuredProjectId,
                            trackerId,
                            priorityId: ctx.getRedminePriorityIdForSeverity(severity, config)
                        },
                        issue: {
                            subject: detailedTicket.title || ticket.title || detailedTicket.subject || ticket.subject,
                            description,
                            severity,
                            syncKey: ticket.syncKey,
                            legacySyncKeys: ticket.legacySyncKeys || [],
                            findingIds: ticket.findingIds,
                            route: ticket.route,
                            cveId: ticket.cveId
                        }
                    }, {
                        headers: {
                            Authorization: req.headers.authorization || ''
                        },
                        timeout: 0
                    });
                    createdOrUpdated += 1;
                    createdOrUpdatedTicketKeys.add(ticket.ticketKey);
                } catch (error) {
                    const detail = error.response?.data || error.message;
                    errors.push(detail);
                    console.warn(`[SYNC_ALL] Could not create Redmine ticket ${ticket.ticketKey}: ${JSON.stringify(detail)}`);
                }
            }, {
                onProgress: ctx.createProgressLogger('Sync All Redmine tickets created', ticketsToCreate.length, 'SYNC_ALL')
            });
            sendSyncAllProgress({
                phase: 'Rechecking Mitigations',
                step: 6,
                message: `Created or updated ${createdOrUpdated} Redmine ticket${createdOrUpdated === 1 ? '' : 's'}`
            });
            const recheckSourceRecords = ticketRefs.map(ticket => {
                const status = statusByTicketKey.get(ticket.ticketKey);
                if (!status?.issueId) return null;
                return {
                    ...(ctx.getRedmineSyncStore().byTicket?.[ticket.syncKey || ticket.ticketKey] || {}),
                    syncKey: ticket.syncKey || ticket.ticketKey,
                    ticketKey: ticket.ticketKey,
                    issueId: status.issueId,
                    issueUrl: status.issueUrl,
                    status: status.status || status.issue?.status?.name || '',
                    statusId: status.statusId || status.issue?.status?.id || '',
                    findingIds: ticket.findingIds,
                    legacySyncKeys: ticket.legacySyncKeys || [],
                    route: ticket.route || ({}),
                    subject: ticket.subject || ticket.title || '',
                    cveId: ticket.cveId || ''
                };
            }).filter(Boolean);
            const recheck = await ctx.runMitigationRecheck({
                baseUrl,
                apiKey: redmineApiKey,
                syncHistoryId: syncHistory?.id || null,
                statusIds,
                defectDojoBaseUrl: defectDojoUrl,
                defectDojoApiKey,
                filters: normalizedFilters,
                recheckSourceRecords
            });
            sendSyncAllProgress({
                phase: 'Saving History',
                step: 7,
                message: `Mitigation recheck complete: ${recheck.reopened || 0} reopened, ${recheck.reviewQueued || 0} queued`
            });
            warnings.push(...recheck.warnings);
            const finalStatus = errors.length > 0 ? 'partial' : 'success';
            let splitSyncHistories = [];
            if (syncHistory && ctx.database.isEnabled()) {
                syncHistory = await ctx.database.finishSyncHistory(syncHistory.id, {
                    status: finalStatus,
                    findingsPulled: pullData.count || 0,
                    ticketsPulled: stats.checkedCount || 0,
                    findingsUpdated: (pullData.updated || 0) + (pullData.staleActiveUpdated || 0),
                    ticketsUpdated: (stats.changedCount || 0) + createdOrUpdated + priorityUpdated + recheck.reopened,
                    findingsMitigated: recheck.reviewQueued,
                    findingsStillActive: recheck.reopened,
                    severityBreakdown: pullData.severityBreakdown || {},
                    warnings,
                    errors
                });
                if (shouldSplitSyncHistory) {
                    splitSyncHistories = await ctx.createSyncAllSplitHistoryRows({
                        parentSyncHistory: syncHistory,
                        normalizedFilters,
                        findings: pullData.findings || [],
                        ticketRefs,
                        checkResults: results,
                        priorityUpdatedTicketKeys,
                        createdOrUpdatedTicketKeys,
                        recheckRecords: recheck.records || [],
                        pullData,
                        redmineChangedCount: stats.changedCount || 0,
                        status: finalStatus,
                        warnings,
                        errors,
                        user: req.user
                    });
                }
            }
            const pullResponseData = {
                ...pullData
            };
            delete pullResponseData.findings;
            sendSyncAllProgress({
                phase: 'Complete',
                step: 8,
                message: 'Sync All complete'
            });
            ctx.broadcastDashboardSync('sync-all-complete');
            res.json({
                message: 'Sync All complete',
                syncHistory,
                syncHistories: splitSyncHistories,
                pull: pullResponseData,
                redmine: {
                    checked: stats.checkedCount || 0,
                    changed: stats.changedCount || 0,
                    priorityUpdated,
                    createdOrUpdated,
                    failed: errors.length
                },
                mitigationRecheck: recheck
            });
        } catch (error) {
            console.error('Error during Sync All:', error.message);
            sendSyncAllProgress({
                phase: 'Failed',
                step: 8,
                message: error.message || 'Sync All failed'
            });
            if (syncHistory && ctx.database.isEnabled()) {
                try {
                    syncHistory = await ctx.database.finishSyncHistory(syncHistory.id, {
                        status: 'failed',
                        errors: [error.response?.data || error.message]
                    });
                } catch (historyError) {
                    console.warn(`Could not finish failed Sync All history: ${historyError.message}`);
                }
            }
            res.status(error.response?.status || 500).json({
                error: 'Sync All failed',
                details: error.response?.data || error.message,
                syncHistory
            });
        }
    });

    return router;
};
