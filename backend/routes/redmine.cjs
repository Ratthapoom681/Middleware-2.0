const express = require('express');

module.exports = function(ctx) {
    const router = express.Router();

    router.get('/sync/status', (req, res) => {
        res.json(ctx.getRedmineSyncStatusPayload());
    });

    router.post('/rebuild-status', ctx.requireAdmin, async (req, res) => {
        try {
            const stats = await ctx.rebuildRedmineStatusFromCurrentFindings({
                logPrefix: 'REDMINE_REBUILD'
            });
            res.json({
                message: 'Redmine status rebuilt from current DefectDojo findings',
                stats,
                syncRecords: Object.keys(ctx.getRedmineSyncStore().byTicket || ({})).length
            });
        } catch (error) {
            console.error('Error rebuilding Redmine status:', error);
            res.status(error.status || 500).json({
                error: error.message || 'Failed to rebuild Redmine status',
                details: error.response?.data || undefined
            });
        }
    });

    router.post('/issues/status', ctx.requireAdmin, async (req, res) => {
        const {redmine = {}, issues = []} = req.body;
        const config = ctx.getConfig();
        const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
        const apiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();
        if (!redmineUrl || !apiKey) {
            return res.status(400).json({
                error: 'Redmine URL and API Key are required'
            });
        }
        const issueRefs = Array.isArray(issues) ? issues.map(item => ({
            ticketKey: String(item.ticketKey || ''),
            issueId: Number.parseInt(item.issueId, 10)
        })).filter(item => item.ticketKey && Number.isInteger(item.issueId) && item.issueId > 0) : [];
        if (issueRefs.length === 0) {
            return res.json({
                issues: []
            });
        }
        try {
            const baseUrl = redmineUrl.replace(/\/$/, '');
            const statusIds = await ctx.resolveRedmineStatusIds({
                baseUrl,
                apiKey,
                config
            });
            const statusMap = await ctx.fetchRedmineIssueStatusMap({
                baseUrl,
                apiKey
            });
            console.log(`[REDMINE] Refreshing ${issueRefs.length} known issue statuses (concurrency ${ctx.REDMINE_CHECK_CONCURRENCY})`);
            const results = await ctx.runWithConcurrency(issueRefs, ctx.REDMINE_CHECK_CONCURRENCY, async ref => {
                try {
                    const status = await ctx.fetchRedmineIssueStatus({
                        baseUrl,
                        apiKey,
                        issueId: ref.issueId,
                        statusMap,
                        statusIds,
                        config
                    });
                    return {
                        ...status,
                        ticketKey: ref.ticketKey
                    };
                } catch (error) {
                    if (ctx.isRedmineNotFoundError(error)) {
                        return {
                            ticketKey: ref.ticketKey,
                            action: 'not_found',
                            status: 'Redmine issue or project not found',
                            projectMissing: true
                        };
                    }
                    return {
                        ticketKey: ref.ticketKey,
                        issueId: ref.issueId,
                        error: error.response?.data || error.message
                    };
                }
            }, {
                onProgress: ctx.createProgressLogger('Redmine issue statuses checked', issueRefs.length)
            });
            res.json({
                issues: results
            });
        } catch (error) {
            console.error('Error refreshing Redmine issue statuses:', error.message);
            res.status(error.response?.status || 500).json({
                error: 'Failed to refresh Redmine issue statuses',
                details: error.response?.data || error.message
            });
        }
    });

    router.post('/issues/check', ctx.requireAdmin, async (req, res) => {
        const {redmine = {}, tickets = []} = req.body;
        let syncHistory = null;
        const config = ctx.getConfig();
        const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
        const apiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();
        const configuredProjectId = String(redmine.projectId || config.redmineProjectId || '').trim();
        const trackerId = String(redmine.trackerId || config.redmineTrackerId || '').trim();
        if (!redmineUrl || !apiKey) {
            return res.status(400).json({
                error: 'Redmine URL and API Key are required'
            });
        }
        const ticketRefs = Array.isArray(tickets) ? tickets.map(ticket => ({
            ticketKey: String(ticket.ticketKey || ''),
            subject: String(ticket.subject || '').trim(),
            syncKey: String(ticket.syncKey || '').trim(),
            issueId: Number.parseInt(ticket.issueId, 10),
            findingIds: ctx.normalizeFindingIds(ticket.findingIds || []),
            legacySyncKeys: ctx.asArray(ticket.legacySyncKeys || ticket.legacyTicketKeys).map(ctx.cleanRouteValue).filter(Boolean),
            route: ticket.route || ({}),
            cveId: String(ticket.cveId || '').trim()
        })).filter(ticket => ticket.ticketKey && ticket.subject) : [];
        if (ticketRefs.length === 0) {
            return res.json({
                tickets: []
            });
        }
        try {
            const baseUrl = redmineUrl.replace(/\/$/, '');
            const statusIds = await ctx.resolveRedmineStatusIds({
                baseUrl,
                apiKey,
                config
            });
            if (ctx.database.isEnabled()) {
                syncHistory = await ctx.database.createSyncHistory({
                    syncType: 'Redmine Pull',
                    productId: ticketRefs[0]?.route?.projectId || '',
                    productName: ticketRefs[0]?.route?.projectName || '',
                    engagementId: ticketRefs[0]?.route?.engagementId || '',
                    engagementName: ticketRefs[0]?.route?.engagementName || '',
                    filters: {
                        ticketCount: ticketRefs.length
                    },
                    triggeredBy: req.user?.username || '',
                    triggeredRole: req.user?.role || ''
                });
            }
            const statusMap = await ctx.fetchRedmineIssueStatusMap({
                baseUrl,
                apiKey
            });
            const projectCache = new Map();
            const resultsByTicketKey = new Map();
            const ticketsNeedingSearch = [];
            console.log(`[REDMINE] Checking ${ticketRefs.length} compacted tickets (concurrency ${ctx.REDMINE_CHECK_CONCURRENCY})`);
            await ctx.runWithConcurrency(ticketRefs, ctx.REDMINE_CHECK_CONCURRENCY, async ticket => {
                const knownIssueId = ctx.getKnownRedmineIssueId(ticket, ctx.getRedmineSyncStore());
                if (!knownIssueId) {
                    ticketsNeedingSearch.push(ticket);
                    return;
                }
                try {
                    const issueStatus = await ctx.fetchRedmineIssueStatus({
                        baseUrl,
                        apiKey,
                        issueId: knownIssueId,
                        statusMap,
                        statusIds,
                        config
                    });
                    resultsByTicketKey.set(ticket.ticketKey, ctx.buildTicketStatusFromIssue({
                        ticket,
                        issueStatus,
                        baseUrl
                    }));
                } catch (error) {
                    const missingMessage = ctx.isRedmineNotFoundError(error) ? 'known issue was not found; the issue or its Redmine project may have been deleted' : error.message;
                    console.warn(`[REDMINE] Known issue ${knownIssueId} for ${ticket.ticketKey} could not be checked; falling back to grouped search: ${missingMessage}`);
                    ticketsNeedingSearch.push(ticket);
                }
            }, {
                onProgress: ctx.createProgressLogger('Known Redmine issue IDs checked', ticketRefs.length)
            });
            const ticketsByProject = new Map();
            if (ticketsNeedingSearch.length > 0) {
                console.log(`[REDMINE] Resolving projects for ${ticketsNeedingSearch.length} tickets needing search`);
            }
            await ctx.runWithConcurrency(ticketsNeedingSearch, ctx.REDMINE_CHECK_CONCURRENCY, async ticket => {
                try {
                    const resolvedProject = await ctx.resolveRedmineProjectCached({
                        cache: projectCache,
                        baseUrl,
                        apiKey,
                        configuredProjectId,
                        route: ticket.route,
                        allowCreate: false
                    });
                    if (!resolvedProject) {
                        resultsByTicketKey.set(ticket.ticketKey, ctx.buildRedmineProjectMissingStatus({
                            ticket,
                            configuredProjectId,
                            route: ticket.route,
                            status: 'Project not found'
                        }));
                        return;
                    }
                    const projectId = resolvedProject.id;
                    if (!ticketsByProject.has(projectId)) {
                        ticketsByProject.set(projectId, {
                            projectId,
                            resolvedProject,
                            tickets: []
                        });
                    }
                    ticketsByProject.get(projectId).tickets.push(ticket);
                } catch (error) {
                    if (ctx.isRedmineProjectReferenceError(error)) {
                        resultsByTicketKey.set(ticket.ticketKey, ctx.buildRedmineProjectMissingStatus({
                            ticket,
                            configuredProjectId,
                            route: ticket.route,
                            status: 'Project not found',
                            fallbackProjectName: ctx.extractMissingRedmineProjectNameFromError(error)
                        }));
                    } else {
                        resultsByTicketKey.set(ticket.ticketKey, {
                            ticketKey: ticket.ticketKey,
                            error: error.response?.data || error.message
                        });
                    }
                }
            }, {
                onProgress: ctx.createProgressLogger('Redmine projects resolved', ticketsNeedingSearch.length)
            });
            const groups = Array.from(ticketsByProject.values());
            if (groups.length > 0) {
                console.log(`[REDMINE] Checking ${ticketsNeedingSearch.length} tickets grouped by ${groups.length} project${groups.length === 1 ? '' : 's'}`);
            }
            for (let i = 0; i < groups.length; i++) {
                const group = groups[i];
                console.log(`[REDMINE] Checking ${group.tickets.length} tickets in project ${group.projectId} (${i + 1}/${groups.length})`);
                await ctx.runWithConcurrency(group.tickets, ctx.REDMINE_CHECK_CONCURRENCY, async ticket => {
                    try {
                        const searchArgs = {
                            baseUrl,
                            apiKey,
                            projectId: group.projectId,
                            trackerId,
                            subject: ticket.subject,
                            syncKey: ticket.syncKey,
                            legacySyncKeys: ticket.legacySyncKeys,
                            findingIds: ticket.findingIds
                        };
                        const openIssue = await ctx.findMatchingRedmineIssue({
                            ...searchArgs,
                            statusId: 'open'
                        });
                        if (openIssue) {
                            resultsByTicketKey.set(ticket.ticketKey, ctx.buildTicketStatusFromIssue({
                                ticket,
                                issueStatus: {
                                    issue: openIssue,
                                    issueUrl: ctx.getRedmineIssueUrl(baseUrl, openIssue),
                                    isClosed: false,
                                    status: openIssue.status?.name || 'Open',
                                    statusId: openIssue.status?.id || ''
                                },
                                baseUrl
                            }));
                            return;
                        }
                        const closedIssue = await ctx.findMatchingRedmineIssue({
                            ...searchArgs,
                            statusId: 'closed'
                        });
                        if (closedIssue) {
                            resultsByTicketKey.set(ticket.ticketKey, ctx.buildTicketStatusFromIssue({
                                ticket,
                                issueStatus: {
                                    issue: closedIssue,
                                    issueUrl: ctx.getRedmineIssueUrl(baseUrl, closedIssue),
                                    isClosed: true,
                                    status: closedIssue.status?.name || 'Closed',
                                    statusId: closedIssue.status?.id || ''
                                },
                                baseUrl
                            }));
                            return;
                        }
                        resultsByTicketKey.set(ticket.ticketKey, {
                            ticketKey: ticket.ticketKey,
                            action: 'not_found',
                            status: 'Redmine issue not found',
                            resolvedProject: group.resolvedProject,
                            subject: ticket.subject,
                            cveId: ticket.cveId || ''
                        });
                    } catch (error) {
                        resultsByTicketKey.set(ticket.ticketKey, {
                            ticketKey: ticket.ticketKey,
                            error: error.response?.data || error.message
                        });
                    }
                }, {
                    onProgress: ctx.createProgressLogger(`Redmine issues checked in project ${group.projectId}`, group.tickets.length)
                });
            }
            const results = ticketRefs.map(ticket => resultsByTicketKey.get(ticket.ticketKey) || {
                ticketKey: ticket.ticketKey,
                action: 'not_found',
                status: 'Not checked'
            });
            const stats = ctx.calculateRedmineCheckStats(results);
            const persistStats = await ctx.persistRedmineCheckResults(results, ctx.getRedmineSyncStore(), ticketRefs);
            stats.changedCount = persistStats.changedCount;
            if (syncHistory && ctx.database.isEnabled()) {
                syncHistory = await ctx.database.finishSyncHistory(syncHistory.id, {
                    status: 'success',
                    ticketsPulled: stats.checkedCount,
                    ticketsUpdated: stats.changedCount,
                    errors: stats.errorCount > 0 ? [`${stats.errorCount} ticket(s) failed to check`] : []
                });
            }
            res.json({
                tickets: results,
                stats,
                syncHistory
            });
        } catch (error) {
            console.error('Error checking Redmine issues:', error.message);
            if (syncHistory && ctx.database.isEnabled()) {
                try {
                    syncHistory = await ctx.database.finishSyncHistory(syncHistory.id, {
                        status: 'failed',
                        errors: [error.response?.data || error.message]
                    });
                } catch (historyError) {
                    console.warn(`Could not finish failed sync history: ${historyError.message}`);
                }
            }
            res.status(error.response?.status || 500).json({
                error: 'Failed to check Redmine issues',
                details: error.response?.data || error.message,
                syncHistory
            });
        }
    });

    router.post('/issues', ctx.requireAdmin, async (req, res) => {
        const {redmine = {}, issue = {}} = req.body;
        const config = ctx.getConfig();
        const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
        const apiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();
        const configuredProjectId = String(redmine.projectId || config.redmineProjectId || '').trim();
        const trackerId = String(redmine.trackerId || config.redmineTrackerId || '').trim();
        const subject = String(issue.subject || '').trim();
        const description = String(issue.description || '').trim();
        const severity = String(issue.severity || '').trim();
        const priorityId = String(redmine.priorityId || ctx.getRedminePriorityIdForSeverity(severity, config) || '').trim();
        const syncKey = String(issue.syncKey || '').trim();
        const findingIds = ctx.normalizeFindingIds(issue.findingIds || []);
        const legacySyncKeys = ctx.asArray(issue.legacySyncKeys || issue.legacyTicketKeys).map(ctx.cleanRouteValue).filter(Boolean);
        const route = issue.route || ({});
        const cveId = String(issue.cveId || '').trim();
        if (!redmineUrl || !apiKey) {
            return res.status(400).json({
                error: 'Redmine URL and API Key are required'
            });
        }
        if (!subject || !description) {
            return res.status(400).json({
                error: 'Issue subject and description are required'
            });
        }
        try {
            const baseUrl = redmineUrl.replace(/\/$/, '');
            const descriptionWithSync = ctx.appendSyncMetadata(description, syncKey, findingIds);
            const knownIssueId = ctx.getKnownRedmineIssueId({
                ticketKey: syncKey,
                syncKey,
                issueId: issue.issueId,
                legacySyncKeys,
                findingIds
            }, ctx.getRedmineSyncStore());
            if (knownIssueId) {
                try {
                    const statusMap = await ctx.fetchRedmineIssueStatusMap({
                        baseUrl,
                        apiKey
                    });
                    const issueStatus = await ctx.fetchRedmineIssueStatus({
                        baseUrl,
                        apiKey,
                        issueId: knownIssueId,
                        statusMap,
                        config
                    });
                    const issueUrl = issueStatus.issueUrl;
                    if (!issueStatus.isClosed) {
                        const priorityUpdated = await ctx.updateOpenRedmineIssuePriorityIfNeeded({
                            baseUrl,
                            apiKey,
                            issue: issueStatus.issue,
                            issueId: knownIssueId,
                            priorityId,
                            severity
                        });
                        const serverSync = await ctx.writeStoredRedmineSyncRecord(syncKey, ctx.buildStoredRedmineSyncRecord({
                            action: 'existing_open',
                            issue: issueStatus.issue,
                            issueUrl,
                            statusId: issueStatus.statusId,
                            resolvedProject: ctx.getIssueResolvedProject(issueStatus.issue),
                            findingIds,
                            legacySyncKeys,
                            route,
                            subject,
                            cveId
                        }));
                        console.log(`Found known open Redmine issue ${knownIssueId}; not searching`);
                        return res.json({
                            action: 'existing_open',
                            message: priorityUpdated ? 'Known open Redmine issue found; priority updated' : 'Known open Redmine issue found; no duplicate created',
                            issue: issueStatus.issue,
                            issueUrl,
                            resolvedProject: ctx.getIssueResolvedProject(issueStatus.issue),
                            serverSync
                        });
                    }
                    const updatedIssuePayload = {
                        subject: subject.slice(0, 255),
                        description: descriptionWithSync,
                        notes: 'Synchronized latest compacted ticket metadata. Existing Redmine issue is already closed.'
                    };
                    console.log(`Found known closed Redmine issue ${knownIssueId}; updating compacted body`);
                    await ctx.updateRedmineIssue({
                        baseUrl,
                        apiKey,
                        issueId: knownIssueId,
                        issue: updatedIssuePayload
                    });
                    const serverSync = await ctx.writeStoredRedmineSyncRecord(syncKey, ctx.buildStoredRedmineSyncRecord({
                        action: 'existing_closed',
                        issue: issueStatus.issue,
                        issueUrl,
                        isClosed: true,
                        statusId: issueStatus.statusId,
                        resolvedProject: ctx.getIssueResolvedProject(issueStatus.issue),
                        findingIds,
                        legacySyncKeys,
                        route,
                        subject,
                        cveId
                    }));
                    return res.json({
                        action: 'existing_closed',
                        message: 'Known closed Redmine issue found; updated Redmine body only',
                        issue: issueStatus.issue,
                        issueUrl,
                        resolvedProject: ctx.getIssueResolvedProject(issueStatus.issue),
                        serverSync
                    });
                } catch (knownError) {
                    const missingMessage = ctx.isRedmineNotFoundError(knownError) ? 'known issue was not found; the issue or its Redmine project may have been deleted' : knownError.message;
                    console.warn(`Known Redmine issue ${knownIssueId} could not be checked; falling back to project search: ${missingMessage}`);
                }
            }
            const redmineProjectResolveCache = ctx.redmineProjectResolveCache || new Map();
            const resolvedProject = await ctx.resolveRedmineProjectCached({
                cache: redmineProjectResolveCache,
                baseUrl,
                apiKey,
                configuredProjectId,
                route,
                retain: true
            });
            const projectId = resolvedProject.id;
            const searchArgs = {
                baseUrl,
                apiKey,
                projectId,
                trackerId,
                subject,
                syncKey,
                legacySyncKeys,
                findingIds
            };
            const openIssue = await ctx.findMatchingRedmineIssue({
                ...searchArgs,
                statusId: 'open'
            });
            if (openIssue) {
                const issueUrl = ctx.getRedmineIssueUrl(baseUrl, openIssue);
                const priorityUpdated = await ctx.updateOpenRedmineIssuePriorityIfNeeded({
                    baseUrl,
                    apiKey,
                    issue: openIssue,
                    issueId: openIssue.id,
                    priorityId,
                    severity
                });
                const serverSync = await ctx.writeStoredRedmineSyncRecord(syncKey, ctx.buildStoredRedmineSyncRecord({
                    action: 'existing_open',
                    issue: openIssue,
                    issueUrl,
                    resolvedProject,
                    findingIds,
                    legacySyncKeys,
                    route,
                    subject,
                    cveId
                }));
                console.log(`Found existing open Redmine issue ${openIssue.id}; not creating duplicate`);
                return res.json({
                    action: 'existing_open',
                    message: priorityUpdated ? 'Existing open Redmine issue found; priority updated' : 'Existing open Redmine issue found; no duplicate created',
                    issue: openIssue,
                    issueUrl,
                    resolvedProject,
                    serverSync
                });
            }
            const closedIssue = await ctx.findMatchingRedmineIssue({
                ...searchArgs,
                statusId: 'closed'
            });
            if (closedIssue) {
                const issueUrl = ctx.getRedmineIssueUrl(baseUrl, closedIssue);
                const updatedIssuePayload = {
                    subject: subject.slice(0, 255),
                    description: descriptionWithSync,
                    notes: 'Synchronized latest compacted ticket metadata. Existing Redmine issue is already closed.'
                };
                console.log(`Found existing closed Redmine issue ${closedIssue.id}; updating compacted body`);
                await ctx.updateRedmineIssue({
                    baseUrl,
                    apiKey,
                    issueId: closedIssue.id,
                    issue: updatedIssuePayload
                });
                const serverSync = await ctx.writeStoredRedmineSyncRecord(syncKey, ctx.buildStoredRedmineSyncRecord({
                    action: 'existing_closed',
                    issue: closedIssue,
                    issueUrl,
                    isClosed: true,
                    resolvedProject,
                    findingIds,
                    legacySyncKeys,
                    route,
                    subject,
                    cveId
                }));
                return res.json({
                    action: 'existing_closed',
                    message: 'Existing closed Redmine issue found; updated Redmine body only',
                    issue: closedIssue,
                    issueUrl,
                    resolvedProject,
                    serverSync
                });
            }
            const redmineIssue = {
                project_id: projectId,
                subject: subject.slice(0, 255),
                description: descriptionWithSync
            };
            if (trackerId) redmineIssue.tracker_id = trackerId;
            if (priorityId) redmineIssue.priority_id = priorityId;
            console.log(`Creating Redmine issue in project identifier ${projectId}: ${redmineIssue.subject}`);
            let response;
            try {
                response = await ctx.axios.post(`${baseUrl}/issues.json`, {
                    issue: redmineIssue
                }, {
                    headers: ctx.getRedmineHeaders(apiKey)
                });
            } catch (createError) {
                if (ctx.isRedmineProjectReferenceError(createError)) {
                    redmineProjectResolveCache.delete(ctx.getRedmineProjectCacheKey({
                        baseUrl,
                        configuredProjectId,
                        route
                    }));
                    const serverSync = await ctx.writeStoredRedmineSyncRecord(syncKey, ctx.buildStoredRedmineSyncRecord({
                        action: 'not_found',
                        status: 'Project not found',
                        resolvedProject: ctx.buildMissingRedmineProject({
                            configuredProjectId,
                            route,
                            fallback: resolvedProject.name
                        }),
                        projectMissing: true,
                        findingIds,
                        legacySyncKeys,
                        route,
                        subject,
                        cveId
                    }));
                    return res.status(409).json({
                        error: 'Redmine project was not found',
                        details: 'The Redmine project for this ticket may have been deleted. Re-run the action to resolve or recreate the project, or update the Redmine Project Identifier override in Settings.',
                        action: 'not_found',
                        projectMissing: true,
                        resolvedProject: serverSync.projectName ? {
                            name: serverSync.projectName
                        } : undefined,
                        serverSync
                    });
                }
                throw createError;
            }
            const createdIssue = response.data.issue;
            const issueUrl = ctx.getRedmineIssueUrl(baseUrl, createdIssue);
            const serverSync = await ctx.writeStoredRedmineSyncRecord(syncKey, ctx.buildStoredRedmineSyncRecord({
                action: 'created',
                issue: createdIssue,
                issueUrl,
                resolvedProject,
                findingIds,
                legacySyncKeys,
                route,
                subject,
                cveId
            }));
            console.log(`Created Redmine issue ${createdIssue?.id || '(unknown id)'}`);
            res.json({
                action: 'created',
                message: 'Redmine issue created',
                issue: createdIssue,
                issueUrl,
                resolvedProject,
                serverSync
            });
        } catch (error) {
            console.error('Error creating Redmine issue:', error.message);
            if (error.response) {
                console.error('Redmine response status:', error.response.status);
                console.error('Redmine response data:', JSON.stringify(error.response.data));
            }
            res.status(error.status || error.response?.status || 500).json({
                error: 'Failed to create Redmine issue',
                details: error.response?.data || error.message
            });
        }
    });

    return router;
};
