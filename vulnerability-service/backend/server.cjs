const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const database = require('./data/database.cjs');

const utils = require('./lib/utils.cjs');
const auth = require('./security/auth.cjs');
const logger = require('./lib/logger.cjs');
const syncUtils = require('./domain/sync-utils.cjs');
const syncHistoryUtils = require('./domain/sync-history-utils.cjs');
const defectdojoClient = require('./integrations/defectdojo-client.cjs');
const redmineClient = require('./integrations/redmine-client.cjs');
const compaction = require('./domain/compaction.cjs');
const { registerApiRoutes } = require('./routes/index.cjs');

// Expose these into the global or module scope
const { cleanRouteValue, asArray, asFindingIdArray, normalizeFindingIds, isPlainObject } = utils;
const { createLogCapture } = logger;
const { SEVERITY_VALUES, normalizeSeverityFilter, normalizePullFilters, shouldMarkUnseenActiveFindingsInactive, splitDelimitedFilterValue, runWithConcurrency, createProgressLogger, createDashboardSync } = syncUtils;
const { allocateCountByWeight, createSyncHistorySplitGroups } = syncHistoryUtils;
const { CONFIG_FIELDS, DEFECTDOJO_CONTEXT_CONCURRENCY, buildFindingFilterQuery, getFindingKey, getEntityId, getEntityName, withPullProductContext, fetchDefectDojoEntity, enrichFindingsWithDefectDojoContext } = defectdojoClient;
const { REDMINE_ISSUE_SEARCH_LIMIT, REDMINE_ISSUE_SEARCH_MAX_PAGES, getRedmineHeaders, getRedmineIssueUrl, appendSyncMetadata, REDMINE_PRIORITY_FIELD_BY_SEVERITY, getRedminePriorityIdForSeverity, normalizeProjectToken, redmineProjectMatches, getProjectIssueValue, isRedmineNotFoundError, isRedmineProjectReferenceError, extractMissingRedmineProjectNameFromError, getMissingRedmineProjectLabel, buildMissingRedmineProject, buildRedmineProjectMissingStatus, makeRedmineProjectIdentifier, getRouteCandidates, getRouteProjectName, isRedmineProjectDuplicateError, createRedmineProject, fetchRedmineProjectDirect, findRedmineProjectByCandidates, resolveRedmineProject, getRedmineProjectCacheKey, resolveRedmineProjectCached, extractRedmineIssueFindingIds, extractRedmineIssueSyncKey, redmineIssueMatchesSyncKey, compareFindingIdsWithRedmineIssue, redmineIssueFindingIdsAreSubsetOfCurrent, findIssueInList, fetchRedmineIssuesForProjectStatus, findMatchingRedmineIssue, updateRedmineIssue, getRedmineIssuePriorityId, updateOpenRedmineIssuePriorityIfNeeded, normalizeTicketStatus, isResolveStatus, isInProgressStatus, isClosedStatus, getStatusNameIsClosed, fetchRedmineIssueStatuses, resolveRedmineStatusIds, fetchRedmineIssueStatusMap, fetchRedmineIssueStatus, getKnownRedmineIssueId, getIssueResolvedProject, buildTicketStatusFromIssue } = redmineClient;
const { AUTO_UPGRADE_TARGET_RE, AUTO_TITLE_VERSION_RE, AUTO_LESS_THAN_VERSION_RE, AUTO_SEVERITY_RANK, normalizeAutoText, normalizeAutoGroupText, highestSeverity, isStoredFindingMitigated, isStoredFindingActive, cleanAutoBlockText, compactAutoDefectDojoText, getAutoDescriptionText, getAutoImpactText, getAutoMitigationText, getAutoStrictFindingKey, parseAutoUpgradeText, parseAutoUpgradeTarget, getAutoLegacyCompactGroupKey, getAutoKnownNoCveFamily, tokenizeAutoVersion, compareAutoVersions, firstAutoRouteValue, firstAutoRouteName, getAutoDefectDojoRoute, stableAutoHash, sortAutoStrings, sortAutoFindingIds, collectAutoCveIds, resolveAutoCompactionFamily, extractAutoTextSourceEvidenceLines, normalizeAutoTextSourceKey, getAutoCompactionDetailKey, buildAutoFindingFingerprint, buildAutoLegacyFindingGroupKey, buildAutoCompactedSyncKey, buildAutoCompactedLegacySyncKey, extractAutoTitleVersion, chooseAutoDisplayTitle, getAutoSoftwareFamilyTitle, parseAutoTitleUpgradeTarget, collectAutoTicketUpgradeTargets, getAutoTicketUpgradeTarget, buildAutoActionRequiredSubject, addAutoTextSource, getAutoEndpointParts, getAutoEndpointLabel, getAutoEndpointHost, groupAutoEndpointDetailsByCves, sortAutoSourceGroupsByTitleVersion, finalizeAutoEndpointDetails, sortAutoTextSources, finalizeAutoSourceGroups, formatAutoTextSourceLabel, formatAutoEvidenceLine, formatAutoSourceGroupAssets, formatAutoSourceFindingAssets, getAutoEndpointPort, formatAutoAffectedAssetsAndPorts, formatAutoTicketTextSection, formatAutoRouteValue, formatAutoDefectDojoContext, buildAutoSourceTitlesBlock, buildAutoCveBlock, formatAutoSourceGroupTextBlock, normalizeAutoTextSource, collectAutoAppendixSources, formatAutoQuoteBlock, formatAutoAppendixTextBlock, buildAutoSourceGroupSection, buildAutoSourceGroupsBlock, buildAutoActionRequiredMarkdown, buildAutoSuperTicketMarkdown, buildBackendCompactedRedmineTicketRefs } = compaction;

// Special cases for auth
const { hashPassword, verifyPassword, normalizeUserStatus, normalizeUserRecord, buildPublicUser, readUsersFromDisk, createDefaultAdminUser, signJwt, createRequireAuth, requireAdmin } = auth;


const logCapture = createLogCapture();
logCapture.installConsoleOverrides();
const addLog = logCapture.addLog;
const getLogs = logCapture.getLogs;
const clearLogs = logCapture.clearLogs;

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..');
const CLIENT_DIST_DIR = process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : path.resolve(__dirname, '..', 'dist');
const DASHBOARD_SYNC_HEARTBEAT_MS = 25000;
const REDMINE_SYNC_STORE_VERSION = 1;
const DEFECTDOJO_PULL_PAGE_LIMIT = 500;
const DEFECTDOJO_ENDPOINT_CHUNK_CONCURRENCY = 5;
const DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT = Number.parseInt(process.env.DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT || '0', 10);
const REDMINE_CHECK_CONCURRENCY = 5;
const CONFIG_BACKUP_KIND = 'defectdojo-viewer-config-backup';
const CONFIG_BACKUP_VERSION = 1;
app.use(cors());
app.use(express.json());
const usersPath = path.join(DATA_DIR, 'users.json');
const legacyLocalAuthEnabled = String(process.env.ENABLE_LEGACY_LOCAL_AUTH || '').toLowerCase() === 'true';
let users = [];
const sessions = new Map();
const requireAuth = createRequireAuth(sessions);
const loadUsers = async () => {
    if (!legacyLocalAuthEnabled) {
        users = [];
        return;
    }
    let shouldPersistUsers = false;
    if (database.isEnabled()) {
        users = await database.loadUsers();
        users = users.map(normalizeUserRecord).filter(user => user.username);
        if (users.length === 0) {
                users = readUsersFromDisk(usersPath);
            if (users.length > 0) {
                console.log(`Imported ${users.length} users from users.json into PostgreSQL`);
                shouldPersistUsers = true;
            }
        }
    } else {
        users = readUsersFromDisk(usersPath);
    }
    users = users.map(normalizeUserRecord).filter(user => user.username);
    if (users.length === 0) {
        users.push(createDefaultAdminUser());
        console.log('Created default admin user (password: admin)');
        shouldPersistUsers = true;
    }
    if (shouldPersistUsers) await saveUsers();
};
const saveUsers = async () => {
    if (!legacyLocalAuthEnabled) return;
    if (database.isEnabled()) {
        await database.saveUsers(users.map(normalizeUserRecord));
        return;
    }
    await fs.writeJson(usersPath, users.map(normalizeUserRecord), {
        spaces: 2
    });
};
app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        storage: database.isEnabled() ? 'postgresql' : 'json'
    });
});

const dashboardSyncClients = new Set();
let dashboardSyncVersion = 0;
let dashboardSyncState = {
    version: dashboardSyncVersion,
    reason: 'startup',
    updatedAt: new Date().toISOString()
};
const writeDashboardSyncEvent = (res, event, payload = {}) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};
const broadcastDashboardSync = (reason, metadata = {}) => {
    dashboardSyncVersion += 1;
    dashboardSyncState = {
        version: dashboardSyncVersion,
        reason,
        updatedAt: new Date().toISOString(),
        ...metadata
    };
    for (const client of dashboardSyncClients) {
        writeDashboardSyncEvent(client.res, 'dashboard-sync', dashboardSyncState);
    }
};
const createSyncAllProgressBroadcaster = () => {
    const startedAt = Date.now();
    const total = 8;
    let current = 0;

    return ({ phase = 'Syncing', message = '', step = current, extra = {} } = {}) => {
        const nextStep = Math.max(0, Math.min(total, Number(step) || 0));
        current = Math.max(current, nextStep);
        broadcastDashboardSync('sync-all-progress', {
            syncAllProgress: {
                phase,
                current,
                total,
                message,
                startedAt,
                updatedAt: Date.now(),
                ...extra
            }
        });
    };
};
let config = {
    defectDojoUrl: '',
    defectDojoApiKey: '',
    redmineUrl: '',
    redmineApiKey: '',
    redmineProjectId: '',
    redmineTrackerId: '',
    redminePriorityId: '',
    redminePriorityCriticalId: '',
    redminePriorityHighId: '',
    redminePriorityMediumId: '',
    redminePriorityLowId: '',
    redminePriorityInfoId: '',
    redmineStatusNewId: '',
    redmineStatusFeedbackId: '',
    redmineStatusInProgressId: '',
    redmineStatusResolveId: '',
    redmineStatusClosedId: '',
    redmineStatusPollIntervalSeconds: 60,
    pullFilters: {
        severity: [],
        active: 'true',
        verified: '',
        is_mitigated: 'false',
        test__engagement__product: '',
        test__engagement: ''
    },
    notifyIpMappings: []
};
const configPath = path.join(DATA_DIR, 'config.json');
const configBackupDir = path.join(DATA_DIR, 'config-backups');
const findingsStorePath = path.join(DATA_DIR, 'findings.json');
const redmineSyncStorePath = path.join(DATA_DIR, 'sync-state.json');
let redmineSyncStore = {
    version: REDMINE_SYNC_STORE_VERSION,
    byTicket: {},
    byFindingId: {}
};
let redmineSyncStoreSaveQueue = Promise.resolve();
let findingsCache = {
    signature: '',
    findings: []
};
let redmineSyncPollTimer = null;
let redmineSyncPollRunning = false;
let syncAllRunning = false;
let redmineSyncScheduler = {
    enabled: false,
    configured: false,
    mitigationReviewConfigured: false,
    intervalSeconds: 60,
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    nextRunAt: null,
    lastError: '',
    mitigationReviewLastError: '',
    mitigationReviewLastCheckedAt: null,
    mitigationReviewChecked: 0,
    mitigationReviewQueued: 0,
    mitigationReviewSkippedActive: 0,
    mitigationReviewWarnings: 0,
    checkedCount: 0,
    changedCount: 0,
    redmineMetadataRequests: 0,
    redmineIssueRequests: 0,
    redmineProjectIssueRequests: 0,
    redmineNotFoundCount: 0,
    redmineErrorCount: 0
};
const redmineProjectResolveCache = new Map();
const emptyFindingsCache = () => {
    findingsCache = {
        signature: '',
        findings: []
    };
};
const resetRedmineSyncStore = async () => {
    redmineSyncStore = {
        version: REDMINE_SYNC_STORE_VERSION,
        byTicket: {},
        byFindingId: {}
    };
    await saveRedmineSyncStore();
    await fs.writeJson(redmineSyncStorePath, redmineSyncStore, {
        spaces: 2
    });
};
const clearLocalFindingsStore = async () => {
    if (!await fs.pathExists(findingsStorePath)) return 0;
    await fs.remove(findingsStorePath);
    return 1;
};
const getStoredSyncProjectName = (record = {}) => record.resolvedProject?.project?.name || record.resolvedProject?.name || record.resolvedProject?.identifier || record.resolvedProject?.id || record.projectName || '';
const buildStoredRedmineSyncRecord = ({action, issue = {}, issueId, issueUrl, isClosed, status, statusId, resolvedProject, projectMissing = false, findingIds = [], legacySyncKeys = [], route = {}, subject = '', cveId = '', lastCheckError = ''}) => ({
    action: action || 'unknown',
    issueId: issueId || issue?.id,
    status: status || issue?.status?.name || '',
    statusId: statusId || issue?.status?.id || '',
    issueUrl: issueUrl || '',
    isClosed: action === 'existing_closed' || Boolean(isClosed),
    projectName: getStoredSyncProjectName({
        resolvedProject
    }),
    projectMissing: Boolean(projectMissing),
    findingIds: normalizeFindingIds(findingIds),
    legacySyncKeys: asArray(legacySyncKeys).map(cleanRouteValue).filter(Boolean),
    route,
    subject,
    cveId,
    lastCheckError,
    updatedAt: new Date().toISOString()
});
const rebuildRedmineSyncStoreFromRecords = (records = []) => {
    const byTicket = {};
    const byFindingId = {};
    records.forEach(record => {
        const ticketKey = String(record?.syncKey || '').trim();
        if (!ticketKey) return;
        const storedRecord = {
            ...record,
            syncKey: ticketKey,
            findingIds: normalizeFindingIds(record.findingIds || [])
        };
        byTicket[ticketKey] = storedRecord;
        storedRecord.findingIds.forEach(id => {
            byFindingId[String(id)] = storedRecord;
        });
    });
    redmineSyncStore = {
        version: REDMINE_SYNC_STORE_VERSION,
        byTicket,
        byFindingId
    };
};
const readRedmineSyncStoreFromDisk = () => {
    if (!fs.existsSync(redmineSyncStorePath)) return null;
    try {
        const diskStore = fs.readJsonSync(redmineSyncStorePath);
        const ticketRecords = Object.entries(diskStore.byTicket || ({})).map(([syncKey, record]) => ({
            ...record,
            syncKey: record.syncKey || syncKey
        }));
        return ticketRecords;
    } catch (err) {
        console.error('Error loading Redmine dashboard sync state:', err);
        return null;
    }
};
const loadRedmineSyncStore = async () => {
    if (database.isEnabled()) {
        const records = await database.loadRedmineSyncRecords();
        if (records.length > 0) {
            rebuildRedmineSyncStoreFromRecords(records);
            console.log('Loaded Redmine dashboard sync state from PostgreSQL');
            return;
        }
        const diskRecords = readRedmineSyncStoreFromDisk();
        if (diskRecords && diskRecords.length > 0) {
            rebuildRedmineSyncStoreFromRecords(diskRecords);
            await saveRedmineSyncStore();
            console.log(`Imported ${diskRecords.length} Redmine sync records from sync-state.json into PostgreSQL`);
            return;
        }
    } else {
        const diskRecords = readRedmineSyncStoreFromDisk();
        if (diskRecords) {
            rebuildRedmineSyncStoreFromRecords(diskRecords);
            console.log('Loaded Redmine dashboard sync state from disk');
        }
    }
};
const persistRedmineSyncStore = async () => {
    if (database.isEnabled()) {
        const records = Object.values(redmineSyncStore.byTicket || ({}));
        await database.saveRedmineSyncRecords(records);
        await database.upsertRedmineTickets(records.map(record => ({
            ticketKey: record.syncKey,
            syncKey: record.syncKey,
            issueId: record.issueId,
            statusName: record.status,
            statusId: record.statusId,
            isClosed: record.isClosed,
            issueUrl: record.issueUrl,
            findingIds: record.findingIds,
            route: record.route || ({}),
            subject: record.subject || '',
            cveId: record.cveId || '',
            raw: record
        })));
        return;
    }
    await fs.writeJson(redmineSyncStorePath, redmineSyncStore, {
        spaces: 2
    });
};
const saveRedmineSyncStore = async () => {
    const saveTask = redmineSyncStoreSaveQueue.then(persistRedmineSyncStore, persistRedmineSyncStore);
    redmineSyncStoreSaveQueue = saveTask.catch(error => {
        console.warn(`Redmine sync store persistence failed: ${error.message}`);
    });
    return saveTask;
};
const comparableStoredSync = (record = {}) => JSON.stringify({
    action: record.action || '',
    issueId: record.issueId || '',
    status: record.status || '',
    statusId: record.statusId || '',
    issueUrl: record.issueUrl || '',
    isClosed: Boolean(record.isClosed),
    projectName: record.projectName || '',
    projectMissing: Boolean(record.projectMissing),
    lastCheckError: record.lastCheckError || ''
});
const rebuildRedmineSyncFindingIndex = () => {
    const byFindingId = {};
    Object.values(redmineSyncStore.byTicket || ({})).forEach(record => {
        normalizeFindingIds(record.findingIds || []).forEach(id => {
            byFindingId[String(id)] = record;
        });
    });
    redmineSyncStore.byFindingId = byFindingId;
};
const removeFindingIdsFromOtherRedmineSyncRecords = (ticketKey, findingIds = []) => {
    const idSet = new Set(normalizeFindingIds(findingIds).map(String));
    if (idSet.size === 0) return 0;
    let cleanedCount = 0;
    Object.entries(redmineSyncStore.byTicket || ({})).forEach(([otherKey, otherRecord]) => {
        if (otherKey === ticketKey) return;
        const beforeIds = normalizeFindingIds(otherRecord.findingIds || []);
        const afterIds = beforeIds.filter(id => !idSet.has(String(id)));
        if (afterIds.length === beforeIds.length) return;
        cleanedCount += 1;
        if (afterIds.length === 0) {
            delete redmineSyncStore.byTicket[otherKey];
            return;
        }
        redmineSyncStore.byTicket[otherKey] = {
            ...otherRecord,
            findingIds: afterIds
        };
    });
    return cleanedCount;
};
const redmineSyncRecordMatchesScope = (record = {}, {productId = '', engagementId = ''} = {}) => {
    const scopedProductId = cleanRouteValue(productId);
    const scopedEngagementId = cleanRouteValue(engagementId);
    if (!scopedProductId && !scopedEngagementId) return true;
    const route = record.route || ({});
    if (scopedProductId && cleanRouteValue(route.projectId) !== scopedProductId) return false;
    if (scopedEngagementId && cleanRouteValue(route.engagementId) !== scopedEngagementId) return false;
    return true;
};
const getRouteEntityKey = (prefix, id, name) => {
    const entityId = cleanRouteValue(id);
    if (entityId) return `${prefix}:id:${entityId}`;
    const entityName = cleanRouteValue(name);
    return entityName ? `${prefix}:name:${entityName.toLowerCase()}` : '';
};
const routeValueMatches = (selectedValue, ...candidates) => {
    const selected = cleanRouteValue(selectedValue).toLowerCase();
    if (!selected) return true;
    return candidates.some(candidate => cleanRouteValue(candidate).toLowerCase() === selected);
};
const pruneStaleRedmineSyncRecords = (currentSyncKeys = new Set(), scope = {}) => {
    let prunedCount = 0;
    Object.entries(redmineSyncStore.byTicket || ({})).forEach(([ticketKey, record]) => {
        if (currentSyncKeys.has(ticketKey)) return;
        if (!redmineSyncRecordMatchesScope(record, scope)) return;
        delete redmineSyncStore.byTicket[ticketKey];
        prunedCount += 1;
    });
    if (prunedCount > 0) rebuildRedmineSyncFindingIndex();
    return prunedCount;
};
const writeStoredRedmineSyncRecord = async (syncKey, record, {notify = true, save = true} = {}) => {
    const ticketKey = String(syncKey || '').trim();
    const findingIds = normalizeFindingIds(record.findingIds || []);
    const previousRecord = ticketKey ? redmineSyncStore.byTicket[ticketKey] : null;
    const storedRecord = {
        ...record,
        syncKey: ticketKey,
        findingIds
    };
    if (previousRecord?.findingIds) {
        normalizeFindingIds(previousRecord.findingIds).filter(id => !findingIds.includes(id)).forEach(id => {
            delete redmineSyncStore.byFindingId[String(id)];
        });
    }
    removeFindingIdsFromOtherRedmineSyncRecords(ticketKey, findingIds);
    if (ticketKey) redmineSyncStore.byTicket[ticketKey] = storedRecord;
    rebuildRedmineSyncFindingIndex();
    if (save) await saveRedmineSyncStore();
    if (notify) broadcastDashboardSync('redmine-sync-updated');
    return storedRecord;
};
const afterConfigChanged = async (reason = 'config-updated') => {
    startRedmineSyncPoller();
    broadcastDashboardSync(reason);
};
const getBackupTimestamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const isSafeConfigBackupFileName = value => {
    const fileName = String(value || '');
    return Boolean(fileName && fileName.endsWith('.json') && path.basename(fileName) === fileName && !(/["\r\n]/).test(fileName) && !fileName.includes('/') && !fileName.includes('\\'));
};
const extractConfigFromBackupPayload = payload => {
    if (!isPlainObject(payload)) return null;
    const sourceConfig = isPlainObject(payload.config) ? payload.config : payload;
    const configPayload = {...sourceConfig};
    delete configPayload.scanPath;
    return configPayload;
};
const normalizeNotifyIpMappings = value => {
    const entries = Array.isArray(value) ? value : [];
    const seen = new Set();

    return entries
        .map(item => ({
            productValue: cleanRouteValue(item?.productValue),
            productName: cleanRouteValue(item?.productName),
            domainName: cleanRouteValue(item?.domainName || item?.domain || item?.fqdn || item?.dnsName),
            host: cleanRouteValue(item?.host || item?.ip),
            label: cleanRouteValue(item?.label || item?.name)
        }))
        .filter(item => item.productValue && item.host && item.label)
        .filter(item => {
            const key = `${item.productValue.toLowerCase()}::${item.host.toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};
const createConfigBackupExport = ({fileName, label = 'manual', sourceConfig = config, createdAt} = {}) => ({
    kind: CONFIG_BACKUP_KIND,
    version: CONFIG_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    backup: {
        fileName: fileName || `config-${getBackupTimestamp()}-${label}.json`,
        label,
        createdAt: createdAt || new Date().toISOString()
    },
    config: sourceConfig
});
const getBackupLabelFromFileName = fileName => {
    const match = String(fileName || '').match(/^config-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(.+)\.json$/i);
    return match?.[1] || 'imported';
};
const readLocalConfigBackupEntries = async () => {
    if (!await fs.pathExists(configBackupDir)) return [];
    const files = await fs.readdir(configBackupDir);
    const entries = [];
    for (const fileName of files.filter(isSafeConfigBackupFileName)) {
        const filePath = path.join(configBackupDir, fileName);
        const stats = await fs.stat(filePath);
        entries.push({
            fileName,
            filePath,
            stats
        });
    }
    return entries;
};
const normalizeConfigObject = (data = {}) => {
    const nextConfig = {
        ...config
    };
    CONFIG_FIELDS.forEach(field => {
        if (data[field] !== undefined) nextConfig[field] = data[field];
    });
    nextConfig.pullFilters = normalizePullFilters({
        ...config.pullFilters,
        ...nextConfig.pullFilters || ({})
    });
    nextConfig.notifyIpMappings = normalizeNotifyIpMappings(nextConfig.notifyIpMappings);
    delete nextConfig.scanPath;
    const pollInterval = Number.parseInt(nextConfig.redmineStatusPollIntervalSeconds, 10);
    nextConfig.redmineStatusPollIntervalSeconds = Number.isInteger(pollInterval) && pollInterval > 0 ? Math.max(60, pollInterval) : pollInterval === 0 ? 0 : 60;
    return nextConfig;
};
const saveConfigToDisk = async () => {
    if (database.isEnabled()) {
        await database.saveConfig(config);
        return;
    }
    await fs.writeJson(configPath, config, {
        spaces: 2
    });
};
const writeConfigBackup = async (sourceConfig = config, label = 'manual') => {
    const safeLabel = String(label || 'manual').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const fileName = `config-${getBackupTimestamp()}-${safeLabel}.json`;
    if (database.isEnabled()) {
        return database.writeConfigBackup({
            fileName,
            label: safeLabel,
            config: sourceConfig
        });
    }
    await fs.ensureDir(configBackupDir);
    const filePath = path.join(configBackupDir, fileName);
    await fs.writeJson(filePath, sourceConfig, {
        spaces: 2
    });
    return {
        fileName,
        filePath
    };
};
const listConfigBackups = async () => {
    if (database.isEnabled()) return database.listConfigBackups();
    const entries = await readLocalConfigBackupEntries();
    return entries.map(({fileName, stats}) => ({
        fileName,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
        storage: 'json'
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
const readConfigBackup = async fileName => {
    if (!isSafeConfigBackupFileName(fileName)) return null;
    if (database.isEnabled()) return database.getConfigBackup(fileName);
    const backupPath = path.join(configBackupDir, fileName);
    if (!await fs.pathExists(backupPath)) return null;
    return extractConfigFromBackupPayload(await fs.readJson(backupPath));
};
const importLocalConfigBackupsToPostgresIfEmpty = async () => {
    if (!database.isEnabled()) return;
    if ((await database.listConfigBackups()).length > 0) return;
    const entries = await readLocalConfigBackupEntries();
    if (entries.length === 0) return;
    let importedCount = 0;
    for (const {fileName, filePath, stats} of entries) {
        try {
            const payload = await fs.readJson(filePath);
            const backupConfig = extractConfigFromBackupPayload(payload);
            if (!backupConfig) continue;
            const imported = await database.importConfigBackup({
                fileName,
                label: getBackupLabelFromFileName(fileName),
                config: backupConfig,
                createdAt: stats.mtime.toISOString()
            });
            if (imported) importedCount += 1;
        } catch (error) {
            console.warn(`Unable to import config backup ${fileName} into PostgreSQL: ${error.message}`);
        }
    }
    if (importedCount > 0) {
        console.log(`Imported ${importedCount} config backup JSON files into PostgreSQL`);
    }
};
const readConfigFromDisk = () => {
    if (!fs.existsSync(configPath)) return null;
    try {
        return fs.readJsonSync(configPath);
    } catch (err) {
        console.error('Error loading config:', err);
        return null;
    }
};
const loadConfig = async () => {
    let storedConfig = null;
    let shouldPersistConfig = false;
    let legacyScanPath = '';
    if (database.isEnabled()) {
        storedConfig = await database.loadConfig();
        if (storedConfig) {
            console.log('Loaded config from PostgreSQL');
        } else {
            storedConfig = readConfigFromDisk();
            if (storedConfig) console.log('Imported config.json into PostgreSQL');
            shouldPersistConfig = true;
        }
    } else {
        storedConfig = readConfigFromDisk();
        if (storedConfig) console.log('Loaded config from disk');
    }
    legacyScanPath = storedConfig?.scanPath || '';
    config = normalizeConfigObject(storedConfig || config);
    await migrateLegacyScanPathFindings(legacyScanPath);
    if (database.isEnabled() && shouldPersistConfig) await saveConfigToDisk();
};
const readFindingsPayload = async filePath => {
    const content = await fs.readJson(filePath);
    if (content && Array.isArray(content.findings)) return content.findings;
    if (Array.isArray(content)) return content;
    return [];
};
const dedupeFindings = findings => {
    const uniqueFindings = Array.from(new Map(findings.map(finding => [getFindingKey(finding), finding])).values());
    if (uniqueFindings.length !== findings.length) {
        console.log(`[DEBUG] Removed ${findings.length - uniqueFindings.length} duplicate local finding records`);
    }
    return uniqueFindings;
};
const migrateLegacyScanPathFindings = async legacyScanPath => {
    if (!legacyScanPath || await fs.pathExists(findingsStorePath)) return;
    const resolvedScanPath = path.isAbsolute(legacyScanPath) ? legacyScanPath : path.resolve(legacyScanPath);
    if (!await fs.pathExists(resolvedScanPath)) return;
    try {
        const files = await fs.readdir(resolvedScanPath);
        const jsonFiles = files.filter(file => file.toLowerCase().endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, {
            numeric: true
        }));
        let allFindings = [];
        for (const file of jsonFiles) {
            allFindings = [...allFindings, ...await readFindingsPayload(path.join(resolvedScanPath, file))];
        }
        if (allFindings.length === 0) return;
        const uniqueFindings = dedupeFindings(allFindings);
        await fs.ensureDir(DATA_DIR);
        await fs.writeJson(findingsStorePath, {
            findings: uniqueFindings
        }, {
            spaces: 2
        });
        console.log(`Migrated ${uniqueFindings.length} legacy local findings into ${findingsStorePath}`);
    } catch (error) {
        console.warn(`Unable to migrate legacy scan path findings: ${error.message}`);
    }
};
const getFindingsStoreSignature = async () => {
    if (!await fs.pathExists(findingsStorePath)) return 'missing';
    const stats = await fs.stat(findingsStorePath);
    return `${findingsStorePath}:${stats.size}:${stats.mtimeMs}`;
};
const loadFindingsFromFileStore = async () => {
    const signature = await getFindingsStoreSignature();
    if (findingsCache.signature === signature) {
        return findingsCache.findings;
    }
    const allFindings = signature === 'missing' ? [] : await readFindingsPayload(findingsStorePath);
    const uniqueFindings = dedupeFindings(allFindings);
    findingsCache = {
        signature,
        findings: uniqueFindings
    };
    return uniqueFindings;
};
const mapFindingsForDatabase = (findings = []) => findings.map((finding, index) => {
    const route = getAutoDefectDojoRoute(finding);
    const cveIds = Array.from(new Set([...Array.isArray(finding.vulnerability_ids) ? finding.vulnerability_ids.map(value => typeof value === 'object' ? value.vulnerability_id || value.name || value.id : value) : [], ...Array.isArray(finding.cves) ? finding.cves : [], finding.cve || finding.CVE || ''].map(value => String(value || '').trim()).filter(Boolean)));
    const mitigated = finding.is_mitigated === true || finding.mitigated === true || String(finding.is_mitigated || '').toLowerCase() === 'true' || String(finding.mitigated || '').toLowerCase() === 'true' || Boolean(finding.mitigated_at || finding.mitigation_confirmed || finding.mitigation_confirmed_at);
    const active = finding.active === false || String(finding.active || '').toLowerCase() === 'false' ? false : !mitigated;
    return {
        findingKey: getFindingKey(finding),
        findingId: finding.id === undefined || finding.id === null ? null : String(finding.id),
        productId: route.projectId || null,
        productName: route.projectName || finding.product_name || null,
        engagementId: route.engagementId || null,
        engagementName: route.engagementName || finding.engagement_name || null,
        title: finding.title || finding.name || 'Untitled finding',
        severity: finding.severity || 'Info',
        active,
        mitigated,
        mitigationConfirmedAt: finding.mitigation_confirmed || finding.mitigation_confirmed_at || finding.mitigated_at || null,
        cveIds,
        endpoints: Array.isArray(finding.endpoints) ? finding.endpoints : [],
        sortIndex: index,
        data: finding
    };
});
const saveFindingsToStore = async (findings = [], {syncHistoryId = null} = {}) => {
    if (database.isEnabled()) {
        const upsertResult = await database.upsertFindingsForSync(mapFindingsForDatabase(findings), syncHistoryId);
        return {
            storage: 'postgresql',
            ...upsertResult
        };
    }
    await fs.ensureDir(DATA_DIR);
    let existingFindings = [];
    existingFindings = await loadFindingsFromFileStore();
    const merged = new Map(existingFindings.map(finding => [getFindingKey(finding), finding]));
    findings.forEach(finding => merged.set(getFindingKey(finding), finding));
    const mergedFindings = Array.from(merged.values());
    await fs.writeJson(findingsStorePath, {
        findings: mergedFindings
    }, {
        spaces: 2
    });
    return {
        storage: 'json',
        file: path.basename(findingsStorePath),
        inserted: findings.length,
        updated: Math.max(0, mergedFindings.length - findings.length),
        total: mergedFindings.length
    };
};
const importFileFindingsToPostgresIfEmpty = async () => {
    if (!database.isEnabled()) return;
    if (await database.countFindings() > 0) return;
    try {
        const existingFindings = await loadFindingsFromFileStore();
        if (existingFindings.length === 0) return;
        await database.replaceFindings(mapFindingsForDatabase(existingFindings));
        emptyFindingsCache();
        console.log(`Imported ${existingFindings.length} local findings into PostgreSQL`);
    } catch (error) {
        if (error.status === 404) return;
        console.warn(`Unable to import local findings into PostgreSQL: ${error.message}`);
    }
};
const appendRedmineSyncToFindings = (findings = []) => findings.map(finding => {
    const storedSync = redmineSyncStore.byFindingId[String(finding.id || '')];
    return storedSync ? {
        ...finding,
        redmineSync: storedSync
    } : finding;
});
const getAllowedProductsForUser = (user = {}) => Array.isArray(user.products) ? user.products.map(product => String(product || '').trim()).filter(Boolean) : [];
const filterFindingsForUser = (findings, user) => {
    let filteredFindings = findings;
    if (user.role !== 'admin') {
        const allowedProducts = getAllowedProductsForUser(user);
        filteredFindings = findings.filter(finding => {
            const route = getAutoDefectDojoRoute(finding);
            const productKey = getRouteEntityKey('product', route.projectId, route.projectName);
            return allowedProducts.some(product => routeValueMatches(product, route.projectId, route.projectName, productKey));
        });
    }
    return appendRedmineSyncToFindings(filteredFindings);
};
const loadFindingsForUser = async user => {
    if (database.isEnabled()) {
        const isAdmin = user.role === 'admin';
        const findings = await database.loadFindings({
            allowedProducts: isAdmin ? undefined : getAllowedProductsForUser(user),
            requireAllowedProducts: !isAdmin
        });
        return appendRedmineSyncToFindings(findings);
    }
    const findings = await loadFindingsFromFileStore();
    return filterFindingsForUser(findings, user);
};
const AUTO_SOURCE_EVIDENCE_RE = /\b(?:URL|URI)\s*:\s*https?:\/\/\S+(?:\s+\([^)]*\))?(?:\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:\s*\S+)*|\bVersion source\s*:\s*\S+(?:\s+(?!(?:Installed|Detected|Current|Fixed|Affected) version\s*:)\S+)*(?:\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:\s*\S+)*/gi;
const cleanAutoTextSourceBody = (text = '') => compactAutoDefectDojoText(text).replace(AUTO_SOURCE_EVIDENCE_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const loadBackendRedmineCheckTicketRefs = async () => {
    const findings = database.isEnabled() ? await database.loadFindings() : await loadFindingsFromFileStore();
    return buildBackendCompactedRedmineTicketRefs(findings);
};
const buildTicketRefFromStoredRedmineSyncRecord = (record = {}) => {
    const syncKey = cleanRouteValue(record.syncKey || record.ticketKey);
    const findingIds = normalizeFindingIds(record.findingIds || []);
    if (!syncKey || !record.issueId || findingIds.length === 0) return null;
    return {
        ticketKey: syncKey,
        syncKey,
        issueId: record.issueId,
        findingIds,
        legacySyncKeys: asArray(record.legacySyncKeys || record.legacyTicketKeys).map(cleanRouteValue).filter(Boolean),
        route: record.route || ({}),
        subject: record.subject || '',
        cveId: record.cveId || ''
    };
};
const ticketRefMatchesScope = (ticket = {}, {productId = '', engagementId = ''} = {}) => {
    const route = ticket.route || ({});
    if (productId && cleanRouteValue(route.projectId) !== productId) return false;
    if (engagementId && cleanRouteValue(route.engagementId) !== engagementId) return false;
    return true;
};
const mergeStoredRedmineSyncTicketRefs = (ticketRefs = [], scope = {}) => {
    const byKey = new Map();
    const currentFindingIds = new Set();
    ticketRefs.forEach(ticket => {
        const key = cleanRouteValue(ticket.syncKey || ticket.ticketKey);
        if (key) byKey.set(key, ticket);
        normalizeFindingIds(ticket.findingIds || []).forEach(findingId => currentFindingIds.add(String(findingId)));
    });
    Object.values(redmineSyncStore.byTicket || ({})).forEach(record => {
        const ticket = buildTicketRefFromStoredRedmineSyncRecord(record);
        if (!ticket || !ticketRefMatchesScope(ticket, scope)) return;
        if (ticket.findingIds.some(findingId => currentFindingIds.has(String(findingId)))) return;
        if (!byKey.has(ticket.syncKey)) byKey.set(ticket.syncKey, ticket);
    });
    return Array.from(byKey.values());
};
const getFindingCveIds = (finding = {}) => collectAutoCveIds(finding);
const getFindingEndpointLabel = (finding = {}) => {
    const endpoint = Array.isArray(finding.endpoints) && finding.endpoints.length > 0 ? finding.endpoints[0] : null;
    if (!endpoint) return '';
    if (typeof endpoint === 'object') {
        const host = endpoint.host || endpoint.hostname || endpoint.fqdn || endpoint.ip || endpoint.address || '';
        const protocol = endpoint.protocol ? `${endpoint.protocol}://` : '';
        const port = endpoint.port ? `:${endpoint.port}` : '';
        return host ? `${protocol}${host}${port}` : cleanRouteValue(endpoint.url || endpoint.uri || endpoint.display_name || endpoint.name || endpoint.id);
    }
    return cleanRouteValue(endpoint);
};
const buildReviewKey = ({issueId, findingId, cveId}) => `review:${issueId || 'unknown'}:${findingId || 'unknown'}:${cveId || 'none'}`;
const getRecheckRoute = (finding = {}, record = {}, storedFinding = {}) => {
    const findingRoute = getAutoDefectDojoRoute(finding || ({}));
    const recordRoute = record.route || ({});
    const storedRoute = storedFinding ? getAutoDefectDojoRoute(storedFinding) : {};
    return {
        projectId: findingRoute.projectId || cleanRouteValue(recordRoute.projectId) || storedRoute.projectId || '',
        projectName: findingRoute.projectName || cleanRouteValue(recordRoute.projectName) || storedRoute.projectName || '',
        engagementId: findingRoute.engagementId || cleanRouteValue(recordRoute.engagementId) || storedRoute.engagementId || '',
        engagementName: findingRoute.engagementName || cleanRouteValue(recordRoute.engagementName) || storedRoute.engagementName || ''
    };
};
const applyRecheckFindingContext = (finding = {}, record = {}, storedFinding = {}) => {
    const route = getRecheckRoute(finding, record, storedFinding);
    const explicitRoute = finding.defectdojo_route && typeof finding.defectdojo_route === 'object' ? finding.defectdojo_route : {};
    return {
        ...finding,
        product_id: finding.product_id || route.projectId,
        product_name: finding.product_name || route.projectName,
        engagement_id: finding.engagement_id || route.engagementId,
        engagement_name: finding.engagement_name || route.engagementName,
        defectdojo_route: {
            ...explicitRoute,
            projectId: explicitRoute.projectId || route.projectId,
            projectName: explicitRoute.projectName || route.projectName,
            engagementId: explicitRoute.engagementId || route.engagementId,
            engagementName: explicitRoute.engagementName || route.engagementName
        }
    };
};
const fetchDefectDojoFindingById = async ({baseUrl, apiKey, findingId}) => {
    const id = Number.parseInt(findingId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    try {
        const response = await axios.get(`${baseUrl}/api/v2/findings/${id}/`, {
            headers: {
                'Authorization': `Token ${apiKey}`,
                'Accept': 'application/json'
            }
        });
        return response.data || null;
    } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
    }
};
const refreshRecheckFindingsFromDefectDojo = async ({baseUrl, apiKey, records = [], findingsById, filters = {}, syncHistoryId = null} = {}) => {
    const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/$/, '').replace(/\/api\/v2$/, '');
    if (!normalizedBaseUrl || !apiKey || !findingsById) return {
        refreshed: 0,
        warnings: []
    };
    const recordByFindingId = new Map();
    records.forEach(record => {
        normalizeFindingIds(record.findingIds || []).forEach(findingId => {
            const key = String(findingId);
            if (!recordByFindingId.has(key)) recordByFindingId.set(key, record);
        });
    });
    const findingIds = Array.from(recordByFindingId.keys());
    if (findingIds.length === 0) return {
        refreshed: 0,
        warnings: []
    };
    const fetchedFindings = [];
    const warnings = [];
    await runWithConcurrency(findingIds, DEFECTDOJO_CONTEXT_CONCURRENCY, async findingId => {
        try {
            const finding = await fetchDefectDojoFindingById({
                baseUrl: normalizedBaseUrl,
                apiKey,
                findingId
            });
            if (!finding) {
                warnings.push(`DefectDojo finding ${findingId} was not found during Resolve recheck.`);
                return;
            }
            fetchedFindings.push(finding);
        } catch (error) {
            warnings.push(`Could not refresh DefectDojo finding ${findingId} during Resolve recheck: ${error.message}`);
        }
    }, {
        onProgress: createProgressLogger('Resolve recheck DefectDojo findings refreshed', findingIds.length, 'SYNC_ALL')
    });
    if (fetchedFindings.length === 0) return {
        refreshed: 0,
        warnings
    };
    await enrichFindingsWithDefectDojoContext({
        baseUrl: normalizedBaseUrl,
        apiKey,
        findings: fetchedFindings,
        filters
    });
    const contextualFindings = fetchedFindings.map(finding => {
        const findingId = String(finding.id || finding.findingId || '');
        const record = recordByFindingId.get(findingId) || ({});
        const storedFinding = findingsById.get(findingId);
        return applyRecheckFindingContext(finding, record, storedFinding);
    });
    await saveFindingsToStore(contextualFindings, {
        syncHistoryId
    });
    emptyFindingsCache();
    contextualFindings.forEach(finding => {
        const findingId = String(finding.id || finding.findingId || '');
        if (findingId) findingsById.set(findingId, finding);
    });
    return {
        refreshed: contextualFindings.length,
        warnings
    };
};
const runMitigationRecheck = async ({baseUrl, apiKey, syncHistoryId = null, statusIds = {}, defectDojoBaseUrl = '', defectDojoApiKey = '', filters = {}, recheckSourceRecords = [], allowReopen = true, logPrefix = 'SYNC_ALL_RECHECK'} = {}) => {
    const findings = database.isEnabled() ? await database.loadFindings() : await loadFindingsFromFileStore();
    const findingsById = new Map(findings.map(finding => [String(finding.id || finding.findingId || ''), finding]).filter(([id]) => id));
    const recheckRecords = [];
    const reviewItems = [];
    const reopened = [];
    const warnings = [];
    const skippedNoLinkedFindings = [];
    const skippedNoActiveLinkedFindings = [];
    const skippedActiveLinkedFindings = [];
    const attemptedFeedback = [];
    const feedbackStatusId = cleanRouteValue(statusIds.feedback || config.redmineStatusFeedbackId);
    const resolveRecordByKey = new Map();
    const addResolveRecord = (record = {}) => {
        if (!record.issueId || !isResolveStatus(record.status, record.statusId, statusIds, config)) return;
        const key = `${cleanRouteValue(record.syncKey || record.ticketKey)}|${cleanRouteValue(record.issueId)}`;
        resolveRecordByKey.set(key, {
            ...record,
            syncKey: cleanRouteValue(record.syncKey || record.ticketKey)
        });
    };
    Object.values(redmineSyncStore.byTicket || ({})).forEach(addResolveRecord);
    asArray(recheckSourceRecords).forEach(addResolveRecord);
    const resolveRecords = Array.from(resolveRecordByKey.values());
    console.log(`[${logPrefix}] Resolve compacted records selected=${resolveRecords.length}; Feedback status ID=${feedbackStatusId || '(missing)'}`);
    const refreshResult = await refreshRecheckFindingsFromDefectDojo({
        baseUrl: defectDojoBaseUrl,
        apiKey: defectDojoApiKey,
        records: resolveRecords,
        findingsById,
        filters,
        syncHistoryId
    });
    console.log(`[${logPrefix}] DefectDojo findings refreshed=${refreshResult.refreshed || 0}; warnings=${refreshResult.warnings.length}`);
    warnings.push(...refreshResult.warnings);
    for (const record of resolveRecords) {
        const linkedFindings = normalizeFindingIds(record.findingIds || []).map(findingId => ({
            findingId,
            finding: findingsById.get(String(findingId))
        })).filter(item => item.finding);
        console.log(`[${logPrefix}] Issue #${record.issueId} (${record.syncKey || record.ticketKey || 'unknown-key'}) status="${record.status || ''}" statusId="${record.statusId || ''}" linkedFindingIds=${normalizeFindingIds(record.findingIds || []).join(',') || '(none)'} linkedFound=${linkedFindings.length}`);
        if (linkedFindings.length === 0) {
            skippedNoLinkedFindings.push(record.issueId);
            console.warn(`[${logPrefix}] Issue #${record.issueId} skipped: no linked DefectDojo findings found in local store after pull.`);
            continue;
        }
        const activeLinkedFindings = linkedFindings.filter(item => isStoredFindingActive(item.finding));
        const mitigatedLinkedFindings = linkedFindings.filter(item => isStoredFindingMitigated(item.finding));
        console.log(`[${logPrefix}] Issue #${record.issueId} linked active/not-mitigated=${activeLinkedFindings.map(item => item.findingId).join(',') || '(none)'} mitigated=${mitigatedLinkedFindings.map(item => item.findingId).join(',') || '(none)'}`);
        if (activeLinkedFindings.length > 0) {
            const activeFindingIds = normalizeFindingIds(activeLinkedFindings.map(item => item.findingId));
            const reason = activeFindingIds.length === 1
                ? `DefectDojo finding ${activeFindingIds[0]} is still active after the latest scan; reopening Redmine issue ${record.issueId}.`
                : `DefectDojo findings ${activeFindingIds.join(', ')} are still active after the latest scan; reopening Redmine issue ${record.issueId}.`;
            if (!allowReopen) {
                skippedActiveLinkedFindings.push({
                    issueId: record.issueId,
                    findingIds: activeFindingIds
                });
                activeLinkedFindings.forEach(({findingId, finding}) => {
                    const route = getAutoDefectDojoRoute(finding);
                    recheckRecords.push({
                        syncHistoryId,
                        ticketKey: record.syncKey,
                        issueId: String(record.issueId),
                        defectdojoFindingId: String(findingId),
                        productKey: route.projectId ? `product:id:${route.projectId}` : '',
                        productId: route.projectId || '',
                        productName: route.projectName || '',
                        engagementKey: route.engagementId ? `engagement:id:${route.engagementId}` : '',
                        engagementId: route.engagementId || '',
                        engagementName: route.engagementName || '',
                        cveId: getFindingCveIds(finding)[0] || record.cveId || '',
                        previousStatus: record.status || 'Resolve',
                        result: 'active_skipped',
                        reason: `${reason} Background mitigation auto-check does not reopen Redmine issues.`
                    });
                });
                console.log(`[${logPrefix}] Issue #${record.issueId} skipped for Mitigation Review: linked finding(s) still active; background mode will not reopen.`);
                continue;
            }
            const addReopenFailureRecords = (failureReason, raw = {}) => {
                activeLinkedFindings.forEach(({findingId, finding}) => {
                    const route = getAutoDefectDojoRoute(finding);
                    recheckRecords.push({
                        syncHistoryId,
                        ticketKey: record.syncKey,
                        issueId: String(record.issueId),
                        defectdojoFindingId: String(findingId),
                        productKey: route.projectId ? `product:id:${route.projectId}` : '',
                        productId: route.projectId || '',
                        productName: route.projectName || '',
                        engagementKey: route.engagementId ? `engagement:id:${route.engagementId}` : '',
                        engagementId: route.engagementId || '',
                        engagementName: route.engagementName || '',
                        cveId: getFindingCveIds(finding)[0] || record.cveId || '',
                        previousStatus: record.status || 'Resolve',
                        result: 'reopen_failed',
                        reason: failureReason,
                        raw
                    });
                });
            };
            if (!feedbackStatusId) {
                warnings.push(`Could not reopen Redmine #${record.issueId}: Feedback status ID is not configured or discoverable.`);
                console.warn(`[${logPrefix}] Issue #${record.issueId} cannot change to Feedback: Feedback status ID is missing.`);
                addReopenFailureRecords(reason, {
                    missingStatus: 'feedback'
                });
                continue;
            }
            let issueStatus;
            try {
                attemptedFeedback.push(record.issueId);
                console.log(`[${logPrefix}] Issue #${record.issueId}: attempting Redmine status change Resolved -> Feedback (${feedbackStatusId}).`);
                issueStatus = await updateRedmineIssueStatusAndConfirm({
                    baseUrl,
                    apiKey,
                    issueId: record.issueId,
                    statusId: feedbackStatusId,
                    notes: reason,
                    statusIds,
                    expectedStatusLabel: 'Feedback',
                    matchesExpectedStatus: status => cleanRouteValue(status.statusId) === feedbackStatusId || normalizeTicketStatus(status.status) === 'feedback'
                });
            } catch (error) {
                const detail = error.response?.data || error.message;
                const currentStatus = error.issueStatus?.status || error.issueStatus?.statusId || '';
                warnings.push(`Could not change Redmine #${record.issueId} to Feedback: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
                console.warn(`[${logPrefix}] Issue #${record.issueId}: Feedback update failed. currentStatus="${currentStatus || 'unknown'}" detail=${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
                addReopenFailureRecords(reason, {
                    targetStatus: 'Feedback',
                    targetStatusId: feedbackStatusId,
                    currentStatus,
                    error: detail,
                    allowedStatuses: asArray(error.allowedStatuses).map(status => ({
                        id: status.id,
                        name: status.name,
                        isClosed: status.is_closed
                    }))
                });
                continue;
            }
            const nextStatusName = issueStatus.status || 'Feedback';
            const nextStatusId = issueStatus.statusId || feedbackStatusId;
            const issueUrl = issueStatus.issueUrl || record.issueUrl || getRedmineIssueUrl(baseUrl, {
                id: record.issueId
            });
            const updatedRecord = await writeStoredRedmineSyncRecord(record.syncKey, {
                ...record,
                action: 'existing_open',
                issueUrl,
                status: nextStatusName,
                statusId: nextStatusId,
                isClosed: false,
                lastCheckError: '',
                updatedAt: new Date().toISOString()
            });
            console.log(`[${logPrefix}] Issue #${record.issueId}: middleware and Redmine status updated to "${nextStatusName}" (${nextStatusId}).`);
            reopened.push(updatedRecord);
            activeLinkedFindings.forEach(({findingId, finding}) => {
                const route = getAutoDefectDojoRoute(finding);
                recheckRecords.push({
                    syncHistoryId,
                    ticketKey: record.syncKey,
                    issueId: String(record.issueId),
                    defectdojoFindingId: String(findingId),
                    productKey: route.projectId ? `product:id:${route.projectId}` : '',
                    productId: route.projectId || '',
                    productName: route.projectName || '',
                    engagementKey: route.engagementId ? `engagement:id:${route.engagementId}` : '',
                    engagementId: route.engagementId || '',
                    engagementName: route.engagementName || '',
                    cveId: getFindingCveIds(finding)[0] || record.cveId || '',
                    previousStatus: record.status || 'Resolve',
                    nextStatus: nextStatusName,
                    result: 'reopened',
                    reason,
                    raw: {
                        reopenStatus: 'feedback',
                        reopenStatusId: feedbackStatusId
                    }
                });
            });
            continue;
        }
        let queuedReviewForRecord = false;
        for (const {findingId, finding} of linkedFindings) {
            const route = getAutoDefectDojoRoute(finding);
            const cveIds = getFindingCveIds(finding);
            const cveId = cveIds[0] || record.cveId || '';
            const baseRecord = {
                syncHistoryId,
                ticketKey: record.syncKey,
                issueId: String(record.issueId),
                defectdojoFindingId: String(findingId),
                productKey: route.projectId ? `product:id:${route.projectId}` : '',
                productId: route.projectId || '',
                productName: route.projectName || '',
                engagementKey: route.engagementId ? `engagement:id:${route.engagementId}` : '',
                engagementId: route.engagementId || '',
                engagementName: route.engagementName || '',
                cveId,
                previousStatus: record.status || 'Resolve'
            };
            if (isStoredFindingMitigated(finding)) {
                const reason = `DefectDojo finding ${findingId} is mitigated while Redmine issue ${record.issueId} is Resolve; waiting for admin closure review.`;
                const mitigationMessage = cleanRouteValue(finding.mitigation || finding.solution || finding.remediation || '');
                recheckRecords.push({
                    ...baseRecord,
                    nextStatus: record.status || 'Resolve',
                    result: 'manual_review',
                    reason
                });
                reviewItems.push({
                    reviewKey: buildReviewKey({
                        issueId: record.issueId,
                        findingId,
                        cveId
                    }),
                    syncHistoryId,
                    ticketKey: record.syncKey,
                    issueId: String(record.issueId),
                    defectdojoFindingId: String(findingId),
                    productKey: baseRecord.productKey,
                    productId: baseRecord.productId,
                    productName: baseRecord.productName,
                    engagementKey: baseRecord.engagementKey,
                    engagementId: baseRecord.engagementId,
                    engagementName: baseRecord.engagementName,
                    cveId,
                    title: record.subject || finding.title || finding.name || '',
                    endpoint: getFindingEndpointLabel(finding),
                    severity: finding.severity || '',
                    redmineStatusId: record.statusId || '',
                    redmineStatusName: record.status || 'Resolve',
                    mitigationConfirmedAt: finding.mitigation_confirmed_at || finding.mitigation_confirmed || finding.mitigated_at || null,
                    lastSyncHistoryId: syncHistoryId,
                    raw: {
                        reason,
                        mitigationMessage,
                        ticketSubject: record.subject || '',
                        sourceFindingTitle: finding.title || finding.name || '',
                        cweIds: collectAutoCweIds(finding)
                    }
                });
                queuedReviewForRecord = true;
            }
        }
        if (!queuedReviewForRecord) {
            skippedNoActiveLinkedFindings.push({
                issueId: record.issueId,
                findingIds: linkedFindings.map(item => String(item.findingId))
            });
            console.log(`[${logPrefix}] Issue #${record.issueId} skipped: linked findings exist but none are active/not mitigated.`);
        }
    }
    if (skippedNoLinkedFindings.length > 0) {
        warnings.push(`Skipped ${skippedNoLinkedFindings.length} Resolve Redmine issue(s) because no linked DefectDojo findings were found in the local store: ${skippedNoLinkedFindings.join(', ')}.`);
    }
    if (database.isEnabled()) {
        await database.recordMitigationRechecks(recheckRecords);
        await database.upsertMitigationReviewItems(reviewItems);
    }
    return {
        checked: recheckRecords.length,
        reopened: reopened.length,
        reviewQueued: reviewItems.length,
        attemptedFeedback: attemptedFeedback.length,
        skippedNoLinkedFindings: skippedNoLinkedFindings.length,
        skippedNoActiveLinkedFindings: skippedNoActiveLinkedFindings.length,
        skippedActiveLinkedFindings: skippedActiveLinkedFindings.length,
        warnings,
        records: recheckRecords
    };
};
const buildMitigationRecheckSourceRecords = ({ticketRefs = [], checkResults = []} = {}) => {
    const statusByTicketKey = new Map(checkResults.map(result => [result.ticketKey, result]));
    return ticketRefs.map(ticket => {
        const status = statusByTicketKey.get(ticket.ticketKey);
        const issueId = status?.issueId || redmineSyncStore.byTicket?.[ticket.syncKey || ticket.ticketKey]?.issueId || '';
        if (!issueId) return null;
        return {
            ...(redmineSyncStore.byTicket?.[ticket.syncKey || ticket.ticketKey] || {}),
            syncKey: ticket.syncKey || ticket.ticketKey,
            ticketKey: ticket.ticketKey,
            issueId,
            issueUrl: status?.issueUrl || redmineSyncStore.byTicket?.[ticket.syncKey || ticket.ticketKey]?.issueUrl || '',
            status: status?.status || status?.issue?.status?.name || redmineSyncStore.byTicket?.[ticket.syncKey || ticket.ticketKey]?.status || '',
            statusId: status?.statusId || status?.issue?.status?.id || redmineSyncStore.byTicket?.[ticket.syncKey || ticket.ticketKey]?.statusId || '',
            findingIds: ticket.findingIds,
            legacySyncKeys: ticket.legacySyncKeys || [],
            route: ticket.route || ({}),
            subject: ticket.subject || ticket.title || '',
            cveId: ticket.cveId || ''
        };
    }).filter(Boolean);
};
const runBackgroundMitigationReviewCheck = async ({baseUrl, apiKey, statusIds = {}, ticketRefs = [], checkResults = []} = {}) => {
    const defectDojoBaseUrl = String(config.defectDojoUrl || '').trim();
    const defectDojoApiKey = String(config.defectDojoApiKey || '').trim();
    const configured = Boolean(database.isEnabled() && defectDojoBaseUrl && defectDojoApiKey);
    redmineSyncScheduler = {
        ...redmineSyncScheduler,
        mitigationReviewConfigured: configured,
        mitigationReviewLastError: configured ? redmineSyncScheduler.mitigationReviewLastError : '',
    };
    if (!configured) {
        console.log('[MITIGATION_AUTO] Background mitigation review check skipped: PostgreSQL, DefectDojo URL, or DefectDojo API key is not configured');
        return {
            skipped: true,
            checked: 0,
            reviewQueued: 0,
            warnings: []
        };
    }

    const recheckSourceRecords = buildMitigationRecheckSourceRecords({
        ticketRefs,
        checkResults
    });
    const resolveRecords = recheckSourceRecords.filter(record => (
        isResolveStatus(record.status, record.statusId, statusIds, config)
    ));
    if (resolveRecords.length === 0) {
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            mitigationReviewLastCheckedAt: new Date().toISOString(),
            mitigationReviewChecked: 0,
            mitigationReviewQueued: 0,
            mitigationReviewSkippedActive: 0,
            mitigationReviewWarnings: 0,
            mitigationReviewLastError: ''
        };
        console.log('[MITIGATION_AUTO] No Resolve Redmine tickets found for mitigation review check');
        return {
            checked: 0,
            reviewQueued: 0,
            warnings: []
        };
    }

    try {
        console.log(`[MITIGATION_AUTO] Checking ${resolveRecords.length} Resolve ticket${resolveRecords.length === 1 ? '' : 's'} against DefectDojo mitigated state`);
        const result = await runMitigationRecheck({
            baseUrl,
            apiKey,
            statusIds,
            defectDojoBaseUrl,
            defectDojoApiKey,
            filters: config.pullFilters || {},
            recheckSourceRecords: resolveRecords,
            allowReopen: false,
            logPrefix: 'MITIGATION_AUTO'
        });
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            mitigationReviewLastCheckedAt: new Date().toISOString(),
            mitigationReviewChecked: result.checked || 0,
            mitigationReviewQueued: result.reviewQueued || 0,
            mitigationReviewSkippedActive: result.skippedActiveLinkedFindings || 0,
            mitigationReviewWarnings: result.warnings?.length || 0,
            mitigationReviewLastError: ''
        };
        if ((result.checked || 0) > 0 || (result.reviewQueued || 0) > 0) {
            broadcastDashboardSync((result.reviewQueued || 0) > 0 ? 'mitigation-review-updated' : 'mitigation-auto-updated');
        }
        console.log(`[MITIGATION_AUTO] Mitigation review check complete: checked=${result.checked || 0}, queued=${result.reviewQueued || 0}, activeSkipped=${result.skippedActiveLinkedFindings || 0}`);
        return result;
    } catch (error) {
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            mitigationReviewLastError: error.message || 'Background mitigation review check failed'
        };
        console.warn(`[MITIGATION_AUTO] Mitigation review check failed: ${redmineSyncScheduler.mitigationReviewLastError}`);
        throw error;
    }
};
const enrichMitigationReviewItem = (item = {}) => {
    const storedRecord = redmineSyncStore.byTicket?.[item.ticketKey] || ({});
    const compactedTitle = cleanRouteValue(storedRecord.subject || item.raw?.ticketSubject || item.title);
    return {
        ...item,
        compactedTitle,
        title: compactedTitle || item.title || '',
        issueId: item.issueId || storedRecord.issueId || '',
        issueUrl: item.issueUrl || storedRecord.issueUrl || '',
        redmineStatusName: item.redmineStatusName || storedRecord.status || '',
        redmineStatusId: item.redmineStatusId || storedRecord.statusId || ''
    };
};
const buildRedmineStatusMapFromResolvedStatuses = (statusIds = {}) => new Map(asArray(statusIds.statuses)
    .map(status => [cleanRouteValue(status.id), Boolean(status.is_closed)])
    .filter(([id]) => id));

const createEmptySeverityBreakdown = () => ({
    pulled: Object.fromEntries(SEVERITY_VALUES.map(severity => [severity, 0])),
    active: Object.fromEntries(SEVERITY_VALUES.map(severity => [severity, 0])),
    mitigated: Object.fromEntries(SEVERITY_VALUES.map(severity => [severity, 0]))
});

const getFindingSeverityLabel = (finding = {}) => (
    SEVERITY_VALUES.find(severity => severity.toLowerCase() === cleanRouteValue(finding.severity || 'Info').toLowerCase()) || 'Info'
);

const isPulledFindingMitigated = (finding = {}) => (
    finding.is_mitigated === true
    || finding.mitigated === true
    || String(finding.is_mitigated || '').toLowerCase() === 'true'
    || String(finding.mitigated || '').toLowerCase() === 'true'
    || Boolean(finding.mitigated_at || finding.mitigation_confirmed || finding.mitigation_confirmed_at)
);

const isPulledFindingActive = (finding = {}) => (
    finding.active !== false
    && String(finding.active || '').toLowerCase() !== 'false'
    && !isPulledFindingMitigated(finding)
);

const buildSeverityBreakdown = (findings = []) => {
    const breakdown = createEmptySeverityBreakdown();
    asArray(findings).forEach(finding => {
        const severity = getFindingSeverityLabel(finding);
        breakdown.pulled[severity] += 1;
        if (isPulledFindingActive(finding)) breakdown.active[severity] += 1;
        if (isPulledFindingMitigated(finding)) breakdown.mitigated[severity] += 1;
    });
    return breakdown;
};

const createSyncAllSplitHistoryRows = async ({
    parentSyncHistory,
    normalizedFilters,
    findings = [],
    ticketRefs = [],
    checkResults = [],
    priorityUpdatedTicketKeys = new Set(),
    createdOrUpdatedTicketKeys = new Set(),
    recheckRecords = [],
    pullData = {},
    redmineChangedCount = 0,
    status = 'success',
    warnings = [],
    errors = [],
    user = null
} = {}) => {
    if (!database.isEnabled() || !parentSyncHistory?.id) return [];
    const splitPlan = createSyncHistorySplitGroups({
        findings,
        ticketRefs,
        checkResults,
        priorityUpdatedTicketKeys,
        createdOrUpdatedTicketKeys,
        recheckRecords,
        getFindingRoute: getAutoDefectDojoRoute
    });
    const groups = splitPlan.groups;
    if (splitPlan.warning && !warnings.includes(splitPlan.warning)) {
        warnings.push(splitPlan.warning);
    }

    if (splitPlan.warning) {
        await database.finishSyncHistory(parentSyncHistory.id, {
            finishedAt: parentSyncHistory.finishedAt || undefined,
            warnings
        });
        console.warn(`[SYNC_HISTORY] ${splitPlan.warning}`);
    }

    const findingsUpdatedByGroup = allocateCountByWeight(
        (pullData.updated || 0) + (pullData.staleActiveUpdated || 0),
        groups,
        group => group.findings.length
    );
    const redmineChangedByGroup = allocateCountByWeight(
        redmineChangedCount,
        groups,
        group => group.ticketRefs.length
    );

    const childRows = [];
    for (const group of groups) {
        const severityBreakdown = buildSeverityBreakdown(group.findings);
        const childHistory = await database.createSyncHistory({
            syncType: 'Sync All',
            productId: group.route.projectId,
            productName: group.route.projectName,
            engagementId: group.route.engagementId,
            engagementName: group.route.engagementName,
            filters: {
                ...normalizedFilters,
                test__engagement__product: group.route.projectId || group.route.projectName || '',
                test__engagement: group.route.engagementId || group.route.engagementName || '',
                syncHistorySplitChild: true,
                syncHistoryParentId: parentSyncHistory.id
            },
            severityBreakdown,
            triggeredBy: user?.username || '',
            triggeredRole: user?.role || ''
        });
        childRows.push(await database.finishSyncHistory(childHistory.id, {
            status,
            findingsPulled: group.findings.length,
            ticketsPulled: group.ticketRefs.length,
            findingsUpdated: findingsUpdatedByGroup.get(group.key) || 0,
            ticketsUpdated: (redmineChangedByGroup.get(group.key) || 0)
                + group.priorityUpdatedTicketKeys.size
                + group.createdOrUpdatedTicketKeys.size
                + group.recheckRecords.filter(record => record.result === 'reopened').length,
            findingsMitigated: group.recheckRecords.filter(record => record.result === 'manual_review').length,
            findingsStillActive: group.recheckRecords.filter(record => record.result === 'reopened').length,
            severityBreakdown,
            warnings,
            errors
        }));
    }
    await database.markSyncHistorySplitParent(parentSyncHistory.id);
    return childRows;
};

const fetchConfirmedRedmineIssueStatus = async ({baseUrl, apiKey, issueId, statusIds = {}}) => {
    const resolvedStatusMap = buildRedmineStatusMapFromResolvedStatuses(statusIds);
    const statusMap = resolvedStatusMap.size > 0
        ? resolvedStatusMap
        : await fetchRedmineIssueStatusMap({
            baseUrl,
            apiKey
        });

    return fetchRedmineIssueStatus({
        baseUrl,
        apiKey,
        issueId,
        statusMap,
        statusIds,
        config
    });
};
const fetchRedmineIssueAllowedStatuses = async ({baseUrl, apiKey, issueId}) => {
    try {
        const response = await axios.get(`${baseUrl}/issues/${issueId}.json?include=allowed_statuses`, {
            headers: getRedmineHeaders(apiKey)
        });
        return asArray(response.data?.issue?.allowed_statuses);
    } catch (error) {
        console.warn(`[REDMINE] Could not fetch allowed statuses for issue ${issueId}: ${error.message}`);
        return [];
    }
};
const updateRedmineIssueStatusAndConfirm = async ({baseUrl, apiKey, issueId, statusId, notes, statusIds = {}, expectedStatusLabel = 'target status', matchesExpectedStatus}) => {
    const targetStatusId = cleanRouteValue(statusId);
    const allowedStatuses = await fetchRedmineIssueAllowedStatuses({
        baseUrl,
        apiKey,
        issueId
    });
    if (allowedStatuses.length > 0) {
        console.log(`[REDMINE_STATUS_UPDATE] Issue #${issueId}: allowed statuses are ${allowedStatuses.map(status => `${status.name || 'Status'} (${status.id})`).join(', ')}`);
    } else {
        console.log(`[REDMINE_STATUS_UPDATE] Issue #${issueId}: Redmine did not return allowed statuses; attempting update anyway.`);
    }
    if (allowedStatuses.length > 0 && !allowedStatuses.some(status => cleanRouteValue(status.id) === targetStatusId)) {
        const allowedLabels = allowedStatuses.map(status => `${status.name || 'Status'} (${status.id})`).join(', ');
        const error = new Error(`Redmine workflow does not allow ${expectedStatusLabel} (${targetStatusId}) from the current status. Allowed: ${allowedLabels || 'none'}.`);
        error.status = 409;
        error.allowedStatuses = allowedStatuses;
        console.warn(`[REDMINE_STATUS_UPDATE] Issue #${issueId}: blocked before PUT. ${error.message}`);
        throw error;
    }
    console.log(`[REDMINE_STATUS_UPDATE] Issue #${issueId}: sending PUT status_id=${targetStatusId} (${expectedStatusLabel}).`);
    await updateRedmineIssue({
        baseUrl,
        apiKey,
        issueId,
        issue: {
            status_id: Number.parseInt(targetStatusId, 10) || targetStatusId,
            notes
        }
    });

    const issueStatus = await fetchConfirmedRedmineIssueStatus({
        baseUrl,
        apiKey,
        issueId,
        statusIds
    });
    console.log(`[REDMINE_STATUS_UPDATE] Issue #${issueId}: Redmine returned status "${issueStatus.status || ''}" (${issueStatus.statusId || ''}) after PUT.`);

    if (matchesExpectedStatus && !matchesExpectedStatus(issueStatus)) {
        const currentStatus = issueStatus.status || issueStatus.statusId || 'unknown';
        const error = new Error(`Redmine did not report issue ${issueId} as ${expectedStatusLabel} after update. Current status is ${currentStatus}.`);
        error.status = 409;
        error.issueStatus = issueStatus;
        throw error;
    }

    return issueStatus;
};
const updateClosedRedmineSyncRecordsForIssue = async ({issueId, ticketKey = '', statusId = '', statusName = 'Closed', issueUrl = ''} = {}) => {
    const targetIssueId = cleanRouteValue(issueId);
    const targetTicketKey = cleanRouteValue(ticketKey);
    if (!targetIssueId && !targetTicketKey) return 0;
    let updated = 0;
    const entries = Object.entries(redmineSyncStore.byTicket || ({}));
    for (const [recordKey, record] of entries) {
        const matchesIssue = targetIssueId && cleanRouteValue(record.issueId) === targetIssueId;
        const matchesTicket = targetTicketKey && recordKey === targetTicketKey;
        if (!matchesIssue && !matchesTicket) continue;
        await writeStoredRedmineSyncRecord(recordKey, {
            ...record,
            action: 'existing_closed',
            issueId: record.issueId || targetIssueId,
            issueUrl: record.issueUrl || issueUrl,
            status: statusName,
            statusId,
            isClosed: true,
            lastCheckError: '',
            updatedAt: new Date().toISOString()
        }, {
            notify: false,
            save: false
        });
        updated += 1;
    }
    if (updated > 0) {
        await saveRedmineSyncStore();
        broadcastDashboardSync('redmine-status-updated');
    }
    return updated;
};
const checkRedmineTicketRefsForDashboard = async ({baseUrl, apiKey, configuredProjectId, trackerId, ticketRefs, logPrefix = 'REDMINE', persist = true, statusIds = {}, pruneScope = {}}) => {
    const statusMap = await fetchRedmineIssueStatusMap({
        baseUrl,
        apiKey
    });
    const projectCache = new Map();
    const resultsByTicketKey = new Map();
    const ticketsNeedingSearch = [];
    let redmineIssueRequests = 0;
    let redmineProjectIssueRequests = 0;
    let redmineNotFoundCount = 0;
    let redmineErrorCount = 0;
    console.log(`[${logPrefix}] Checking ${ticketRefs.length} compacted tickets (concurrency ${REDMINE_CHECK_CONCURRENCY})`);
    await runWithConcurrency(ticketRefs, REDMINE_CHECK_CONCURRENCY, async ticket => {
        const knownIssueId = getKnownRedmineIssueId(ticket, redmineSyncStore);
        if (!knownIssueId) {
            ticketsNeedingSearch.push(ticket);
            return;
        }
        try {
            redmineIssueRequests += 1;
            const issueStatus = await fetchRedmineIssueStatus({
                baseUrl,
                apiKey,
                issueId: knownIssueId,
                statusMap,
                statusIds,
                config
            });
            resultsByTicketKey.set(ticket.ticketKey, buildTicketStatusFromIssue({
                ticket,
                issueStatus,
                baseUrl
            }));
        } catch (error) {
            if (isRedmineNotFoundError(error)) redmineNotFoundCount += 1;
            const missingMessage = isRedmineNotFoundError(error) ? 'known issue was not found; the issue or its Redmine project may have been deleted' : error.message;
            console.warn(`[${logPrefix}] Known issue ${knownIssueId} for ${ticket.ticketKey} could not be checked; falling back to grouped search: ${missingMessage}`);
            ticketsNeedingSearch.push(ticket);
        }
    }, {
        onProgress: createProgressLogger('Known Redmine issue IDs checked', ticketRefs.length, logPrefix)
    });
    const ticketsByProject = new Map();
    if (ticketsNeedingSearch.length > 0) {
        console.log(`[${logPrefix}] Resolving projects for ${ticketsNeedingSearch.length} tickets needing search`);
    }
    await runWithConcurrency(ticketsNeedingSearch, REDMINE_CHECK_CONCURRENCY, async ticket => {
        try {
            const resolvedProject = await resolveRedmineProjectCached({
                cache: projectCache,
                baseUrl,
                apiKey,
                configuredProjectId,
                route: ticket.route,
                allowCreate: false
            });
            if (!resolvedProject) {
                resultsByTicketKey.set(ticket.ticketKey, buildRedmineProjectMissingStatus({
                    ticket,
                    configuredProjectId,
                    route: ticket.route,
                    status: 'Project not found'
                }));
                return;
            }
            const projectKey = resolvedProject.id;
            if (!ticketsByProject.has(projectKey)) {
                ticketsByProject.set(projectKey, {
                    resolvedProject,
                    tickets: []
                });
            }
            ticketsByProject.get(projectKey).tickets.push(ticket);
        } catch (error) {
            redmineErrorCount += 1;
            resultsByTicketKey.set(ticket.ticketKey, {
                ticketKey: ticket.ticketKey,
                action: 'check_failed',
                error: error.response?.data || error.message
            });
        }
    }, {
        onProgress: createProgressLogger('Redmine projects resolved', ticketsNeedingSearch.length, logPrefix)
    });
    const projectGroups = Array.from(ticketsByProject.values());
    if (projectGroups.length > 0) {
        console.log(`[${logPrefix}] Grouped Redmine search: ${projectGroups.length} project groups for ${projectGroups.reduce((sum, group) => sum + group.tickets.length, 0)} tickets`);
    }
    await runWithConcurrency(projectGroups, REDMINE_CHECK_CONCURRENCY, async ({resolvedProject, tickets}) => {
        try {
            redmineProjectIssueRequests += 2;
            const [openIssues, closedIssues] = await Promise.all([fetchRedmineIssuesForProjectStatus({
                baseUrl,
                apiKey,
                projectId: resolvedProject.id,
                trackerId,
                statusId: 'open'
            }), fetchRedmineIssuesForProjectStatus({
                baseUrl,
                apiKey,
                projectId: resolvedProject.id,
                trackerId,
                statusId: 'closed'
            })]);
            tickets.forEach(ticket => {
                const openIssue = findIssueInList(openIssues, ticket);
                if (openIssue) {
                    resultsByTicketKey.set(ticket.ticketKey, buildTicketStatusFromIssue({
                        ticket,
                        issueStatus: {
                            issue: openIssue,
                            issueId: openIssue.id,
                            issueUrl: getRedmineIssueUrl(baseUrl, openIssue),
                            isClosed: false,
                            status: openIssue.status?.name || 'open'
                        },
                        baseUrl,
                        resolvedProject
                    }));
                    return;
                }
                const closedIssue = findIssueInList(closedIssues, ticket);
                if (closedIssue) {
                    resultsByTicketKey.set(ticket.ticketKey, buildTicketStatusFromIssue({
                        ticket,
                        issueStatus: {
                            issue: closedIssue,
                            issueId: closedIssue.id,
                            issueUrl: getRedmineIssueUrl(baseUrl, closedIssue),
                            isClosed: true,
                            status: closedIssue.status?.name || 'closed'
                        },
                        baseUrl,
                        resolvedProject
                    }));
                    return;
                }
                resultsByTicketKey.set(ticket.ticketKey, {
                    ticketKey: ticket.ticketKey,
                    action: 'not_found',
                    status: 'Not found',
                    resolvedProject
                });
            });
        } catch (error) {
            redmineErrorCount += tickets.length;
            tickets.forEach(ticket => {
                if (isRedmineNotFoundError(error)) {
                    redmineNotFoundCount += 1;
                    resultsByTicketKey.set(ticket.ticketKey, buildRedmineProjectMissingStatus({
                        ticket,
                        configuredProjectId,
                        route: resolvedProject.route || ticket.route,
                        fallback: resolvedProject.name,
                        status: 'Project not found'
                    }));
                    return;
                }
                resultsByTicketKey.set(ticket.ticketKey, {
                    ticketKey: ticket.ticketKey,
                    action: 'check_failed',
                    error: error.response?.data || error.message
                });
            });
        }
    }, {
        onProgress: createProgressLogger('Redmine project issue groups searched', projectGroups.length, logPrefix)
    });
    const results = ticketRefs.map(ticket => resultsByTicketKey.get(ticket.ticketKey) || ({
        ticketKey: ticket.ticketKey,
        action: 'check_failed',
        error: 'Ticket was not checked'
    }));
    let changedCount = 0;
    let prunedCount = 0;
    if (persist) {
        const currentSyncKeys = new Set(ticketRefs.map(ticket => ticket.syncKey || ticket.ticketKey).filter(Boolean));
        for (const ticketStatus of results) {
            if (ticketStatus.action === 'check_failed') continue;
            const ticket = ticketRefs.find(item => item.ticketKey === ticketStatus.ticketKey);
            if (!ticket) continue;
            const storeKey = ticket.syncKey || ticket.ticketKey;
            const nextRecord = buildStoredRedmineSyncRecord({
                action: ticketStatus.action,
                issue: ticketStatus.issue,
                issueId: ticketStatus.issueId,
                issueUrl: ticketStatus.issueUrl,
                isClosed: Boolean(ticketStatus.isClosed) || ticketStatus.action === 'existing_closed',
                status: ticketStatus.status,
                statusId: ticketStatus.statusId,
                resolvedProject: ticketStatus.resolvedProject,
                projectMissing: ticketStatus.projectMissing,
                findingIds: ticket.findingIds,
                legacySyncKeys: ticket.legacySyncKeys || [],
                route: ticket.route || ({}),
                subject: ticket.subject || '',
                cveId: ticket.cveId || ''
            });
            const currentRecord = redmineSyncStore.byTicket[storeKey];
            if (comparableStoredSync(currentRecord) !== comparableStoredSync(nextRecord)) {
                if (logPrefix === 'REDMINE_AUTO') {
                    console.log(`[REDMINE_AUTO] Status changed for ${storeKey}: ` + `issue ${currentRecord?.issueId || '-'} ${currentRecord?.action || '-'} "${currentRecord?.status || '-'}" -> ` + `issue ${nextRecord.issueId || '-'} ${nextRecord.action || '-'} "${nextRecord.status || '-'}"`);
                }
                await writeStoredRedmineSyncRecord(storeKey, nextRecord, {
                    notify: false,
                    save: false
                });
                changedCount += 1;
            }
        }
        prunedCount = pruneStaleRedmineSyncRecords(currentSyncKeys, pruneScope);
        if (prunedCount > 0 && logPrefix === 'REDMINE_AUTO') {
            console.log(`[REDMINE_AUTO] Pruned ${prunedCount} stale Redmine sync records that no longer match current compacted tickets`);
        }
        if (changedCount > 0 || prunedCount > 0 || database.isEnabled()) {
            await saveRedmineSyncStore();
        }
        if (changedCount > 0 || prunedCount > 0) {
            broadcastDashboardSync('redmine-status-updated');
        }
    }
    return {
        results,
        stats: {
            checkedCount: ticketRefs.length,
            changedCount,
            redmineMetadataRequests: 1,
            redmineIssueRequests,
            redmineProjectIssueRequests,
            redmineNotFoundCount,
            redmineErrorCount,
            prunedCount,
            ticketsNeedingSearch: ticketsNeedingSearch.length,
            projectGroups: projectGroups.length
        }
    };
};

const calculateRedmineCheckStats = (results = []) => ({
    checkedCount: results.length,
    changedCount: 0,
    errorCount: results.filter(result => result.error || result.action === 'check_failed').length,
    notFoundCount: results.filter(result => result.action === 'not_found').length,
    existingOpenCount: results.filter(result => result.action === 'existing_open').length,
    existingClosedCount: results.filter(result => result.action === 'existing_closed').length
});

const persistRedmineCheckResults = async (results = [], store = redmineSyncStore, ticketRefs = []) => {
    const ticketByKey = new Map(ticketRefs.map(ticket => [ticket.ticketKey, ticket]));
    let changedCount = 0;

    for (const ticketStatus of results) {
        if (!ticketStatus?.ticketKey || ticketStatus.error || ticketStatus.action === 'check_failed') continue;
        const ticket = ticketByKey.get(ticketStatus.ticketKey) || {};
        const storeKey = ticket.syncKey || ticketStatus.ticketKey;
        const nextRecord = buildStoredRedmineSyncRecord({
            action: ticketStatus.action,
            issue: ticketStatus.issue,
            issueId: ticketStatus.issueId,
            issueUrl: ticketStatus.issueUrl,
            isClosed: Boolean(ticketStatus.isClosed) || ticketStatus.action === 'existing_closed',
            status: ticketStatus.status,
            statusId: ticketStatus.statusId,
            resolvedProject: ticketStatus.resolvedProject,
            projectMissing: ticketStatus.projectMissing,
            findingIds: ticket.findingIds || [],
            legacySyncKeys: ticket.legacySyncKeys || [],
            route: ticket.route || ({}),
            subject: ticket.subject || ticketStatus.subject || '',
            cveId: ticket.cveId || ticketStatus.cveId || ''
        });
        if (comparableStoredSync(store.byTicket?.[storeKey]) === comparableStoredSync(nextRecord)) continue;
        await writeStoredRedmineSyncRecord(storeKey, nextRecord, {
            notify: false,
            save: false
        });
        changedCount += 1;
    }

    if (changedCount > 0) {
        await saveRedmineSyncStore();
        broadcastDashboardSync('redmine-status-updated');
    }

    return { changedCount };
};

const getRedmineSyncStatusPayload = () => ({
    ...redmineSyncScheduler,
    syncRecords: Object.keys(redmineSyncStore.byTicket || ({})).length
});

const rebuildRedmineStatusFromCurrentFindings = async ({logPrefix = 'REDMINE_REBUILD'} = {}) => {
    const redmineUrl = String(config.redmineUrl || '').trim();
    const apiKey = String(config.redmineApiKey || '').trim();
    if (!redmineUrl || !apiKey) {
        const error = new Error('Redmine URL and API key are required before rebuilding status.');
        error.status = 400;
        throw error;
    }

    if (redmineSyncPollRunning) {
        const error = new Error('Redmine status sync is already running. Wait for it to finish before rebuilding.');
        error.status = 409;
        throw error;
    }

    const ticketRefs = await loadBackendRedmineCheckTicketRefs();
    const baseUrl = redmineUrl.replace(/\/$/, '');
    redmineSyncPollRunning = true;
    redmineSyncScheduler = {
        ...redmineSyncScheduler,
        running: true,
        lastStartedAt: new Date().toISOString(),
        lastError: '',
        checkedCount: ticketRefs.length,
        changedCount: 0,
        redmineMetadataRequests: 0,
        redmineIssueRequests: 0,
        redmineProjectIssueRequests: 0,
        redmineNotFoundCount: 0,
        redmineErrorCount: 0
    };

    try {
        console.log(`[${logPrefix}] Rebuilding Redmine status for ${ticketRefs.length} current compacted ticket${ticketRefs.length === 1 ? '' : 's'}`);
        if (ticketRefs.length === 0) {
            await resetRedmineSyncStore();
            redmineSyncScheduler = {
                ...redmineSyncScheduler,
                checkedCount: 0,
                changedCount: 0,
                lastError: ''
            };
            broadcastDashboardSync('redmine-status-rebuild-empty');
            return {
                checkedCount: 0,
                changedCount: 0,
                redmineMetadataRequests: 0,
                redmineIssueRequests: 0,
                redmineProjectIssueRequests: 0,
                redmineNotFoundCount: 0,
                redmineErrorCount: 0,
                prunedCount: 0
            };
        }

        const statusIds = await resolveRedmineStatusIds({
            baseUrl,
            apiKey,
            config
        });
        const {stats} = await checkRedmineTicketRefsForDashboard({
            baseUrl,
            apiKey,
            configuredProjectId: cleanRouteValue(config.redmineProjectId),
            trackerId: cleanRouteValue(config.redmineTrackerId),
            ticketRefs,
            logPrefix,
            persist: true,
            statusIds,
            pruneScope: {}
        });
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            checkedCount: stats.checkedCount,
            changedCount: stats.changedCount,
            redmineMetadataRequests: stats.redmineMetadataRequests,
            redmineIssueRequests: stats.redmineIssueRequests,
            redmineProjectIssueRequests: stats.redmineProjectIssueRequests,
            redmineNotFoundCount: stats.redmineNotFoundCount,
            redmineErrorCount: stats.redmineErrorCount,
            lastError: ''
        };
        broadcastDashboardSync('redmine-status-rebuilt');
        console.log(`[${logPrefix}] Rebuild complete: checked=${stats.checkedCount}, changed=${stats.changedCount}, pruned=${stats.prunedCount || 0}`);
        return stats;
    } catch (error) {
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            lastError: error.message || 'Redmine status rebuild failed'
        };
        throw error;
    } finally {
        redmineSyncPollRunning = false;
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            running: false,
            lastFinishedAt: new Date().toISOString()
        };
    }
};

const refreshStoredRedmineSyncStatuses = async () => {
    if (redmineSyncPollRunning) {
        console.log('[REDMINE_AUTO] Previous status sync is still running; skipping this tick');
        return {
            skipped: true,
            checkedCount: 0,
            changedCount: 0
        };
    }
    const redmineUrl = String(config.redmineUrl || '').trim();
    const apiKey = String(config.redmineApiKey || '').trim();
    if (!redmineUrl || !apiKey) {
        console.log('[REDMINE_AUTO] Redmine URL/API key not configured; status sync skipped');
        return {
            skipped: true,
            checkedCount: 0,
            changedCount: 0
        };
    }
    const storedSyncRecordCount = Object.keys(redmineSyncStore.byTicket || ({})).length;
    const ticketRefs = mergeStoredRedmineSyncTicketRefs(await loadBackendRedmineCheckTicketRefs());
    const discoveryMode = storedSyncRecordCount === 0 && ticketRefs.length > 0;
    redmineSyncPollRunning = true;
    redmineSyncScheduler = {
        ...redmineSyncScheduler,
        running: true,
        discoveryMode,
        lastStartedAt: new Date().toISOString(),
        lastError: '',
        checkedCount: ticketRefs.length,
        changedCount: 0,
        redmineMetadataRequests: 0,
        redmineIssueRequests: 0,
        redmineProjectIssueRequests: 0,
        redmineNotFoundCount: 0,
        redmineErrorCount: 0
    };
    try {
        console.log(`[REDMINE_AUTO] Status sync started: ${ticketRefs.length} backend-compacted tickets to check${discoveryMode ? ' (discovery mode)' : ''}`);
        if (ticketRefs.length === 0) {
            redmineSyncScheduler = {
                ...redmineSyncScheduler,
                discoveryMode: false,
                checkedCount: 0,
                changedCount: 0,
                redmineMetadataRequests: 0,
                redmineIssueRequests: 0,
                redmineProjectIssueRequests: 0,
                redmineNotFoundCount: 0,
                redmineErrorCount: 0,
                mitigationReviewLastCheckedAt: new Date().toISOString(),
                mitigationReviewChecked: 0,
                mitigationReviewQueued: 0,
                mitigationReviewSkippedActive: 0,
                mitigationReviewWarnings: 0,
                lastError: ''
            };
            console.log('[REDMINE_AUTO] Status sync finished: no backend-compacted tickets to check');
            return {
                checkedCount: 0,
                changedCount: 0
            };
        }
        const baseUrl = redmineUrl.replace(/\/$/, '');
        const statusIds = await resolveRedmineStatusIds({
            baseUrl,
            apiKey,
            config
        });
        const {results, stats} = await checkRedmineTicketRefsForDashboard({
            baseUrl,
            apiKey,
            configuredProjectId: cleanRouteValue(config.redmineProjectId),
            trackerId: cleanRouteValue(config.redmineTrackerId),
            ticketRefs,
            logPrefix: 'REDMINE_AUTO',
            persist: true,
            statusIds
        });
        const mitigationRecheck = await runBackgroundMitigationReviewCheck({
            baseUrl,
            apiKey,
            statusIds,
            ticketRefs,
            checkResults: results
        }).catch(error => ({
            error: error.message || 'Background mitigation review check failed',
            checked: 0,
            reviewQueued: 0,
            warnings: [error.message || 'Background mitigation review check failed']
        }));
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            checkedCount: stats.checkedCount,
            changedCount: stats.changedCount,
            redmineMetadataRequests: stats.redmineMetadataRequests,
            redmineIssueRequests: stats.redmineIssueRequests,
            redmineProjectIssueRequests: stats.redmineProjectIssueRequests,
            redmineNotFoundCount: stats.redmineNotFoundCount,
            redmineErrorCount: stats.redmineErrorCount,
            lastError: ''
        };
        console.log(`[REDMINE_AUTO] Redmine API queried: metadata=${stats.redmineMetadataRequests}, issueStatus=${stats.redmineIssueRequests}, projectIssueLists=${stats.redmineProjectIssueRequests}, notFound=${stats.redmineNotFoundCount}, errors=${stats.redmineErrorCount}`);
        console.log(`[REDMINE_AUTO] Status sync finished: checked=${stats.checkedCount}, changed=${stats.changedCount}`);
        return {
            checkedCount: stats.checkedCount,
            changedCount: stats.changedCount,
            discoveryMode,
            mitigationRecheck,
            redmineMetadataRequests: stats.redmineMetadataRequests,
            redmineIssueRequests: stats.redmineIssueRequests,
            redmineProjectIssueRequests: stats.redmineProjectIssueRequests,
            redmineNotFoundCount: stats.redmineNotFoundCount,
            redmineErrorCount: stats.redmineErrorCount
        };
    } catch (error) {
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            discoveryMode: false,
            lastError: error.message || 'Redmine status sync failed'
        };
        console.warn(`[REDMINE_AUTO] Status sync failed: ${redmineSyncScheduler.lastError}`);
        throw error;
    } finally {
        redmineSyncPollRunning = false;
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            running: false,
            discoveryMode: false,
            lastFinishedAt: new Date().toISOString()
        };
    }
};
const scheduleNextRedmineSyncPoll = intervalMs => {
    if (redmineSyncPollTimer) {
        clearTimeout(redmineSyncPollTimer);
        redmineSyncPollTimer = null;
    }
    redmineSyncScheduler = {
        ...redmineSyncScheduler,
        nextRunAt: new Date(Date.now() + intervalMs).toISOString()
    };
    console.log(`[REDMINE_AUTO] Next status sync scheduled at ${redmineSyncScheduler.nextRunAt}`);
    redmineSyncPollTimer = setTimeout(() => {
        runScheduledRedmineSyncPoll(intervalMs);
    }, intervalMs);
};
const runScheduledRedmineSyncPoll = intervalMs => {
    refreshStoredRedmineSyncStatuses().catch(error => {
        console.warn(`Redmine dashboard sync failed: ${error.message}`);
    }).finally(() => {
        const configured = Boolean(config.redmineUrl && config.redmineApiKey);
        if (redmineSyncScheduler.enabled && configured) {
            scheduleNextRedmineSyncPoll(intervalMs);
        }
    });
};
function startRedmineSyncPoller() {
    if (redmineSyncPollTimer) {
        clearTimeout(redmineSyncPollTimer);
        redmineSyncPollTimer = null;
    }
    const pollIntervalSeconds = Number.parseInt(config.redmineStatusPollIntervalSeconds, 10);
    const normalizedIntervalSeconds = Number.isInteger(pollIntervalSeconds) && pollIntervalSeconds > 0 ? Math.max(60, pollIntervalSeconds) : 0;
    const pollIntervalMs = normalizedIntervalSeconds * 1000;
    const configured = Boolean(config.redmineUrl && config.redmineApiKey);
    const mitigationReviewConfigured = Boolean(database.isEnabled() && config.defectDojoUrl && config.defectDojoApiKey);
    redmineSyncScheduler = {
        ...redmineSyncScheduler,
        enabled: configured && pollIntervalMs > 0,
        configured,
        mitigationReviewConfigured,
        intervalSeconds: normalizedIntervalSeconds,
        nextRunAt: null,
        lastError: configured ? redmineSyncScheduler.lastError : '',
        running: redmineSyncPollRunning
    };
    if (!redmineSyncScheduler.enabled) {
        const reason = configured ? 'interval is disabled' : 'Redmine URL/API key not configured';
        console.log(`[REDMINE_AUTO] Background status sync disabled: ${reason}`);
        return;
    }
    console.log(`[REDMINE_AUTO] Background status sync enabled: every ${normalizedIntervalSeconds} seconds`);
    runScheduledRedmineSyncPoll(pollIntervalMs);
}
const runDefectDojoPull = async ({
    url,
    apiKey,
    filters,
    user = null,
    createHistory = false,
    syncHistoryId = null,
    finishHistory = createHistory,
    broadcastEvent = true,
    includeFindings = false
} = {}) => {
    let syncHistory = null;
    const syncWarnings = [];
    let historyId = syncHistoryId || null;
    try {
        let baseUrl = url.trim();
        baseUrl = baseUrl.replace(/\/$/, '').replace(/\/api\/v2$/, '');
        const normalizedFilters = normalizePullFilters(filters);
        const requestedProductId = getEntityId(normalizedFilters.test__engagement__product);
        const requestedEngagementId = getEntityId(normalizedFilters.test__engagement);
        if (createHistory && database.isEnabled()) {
            syncHistory = await database.createSyncHistory({
                syncType: 'DefectDojo Pull',
                productId: requestedProductId,
                engagementId: requestedEngagementId,
                filters: normalizedFilters,
                triggeredBy: user?.username || '',
                triggeredRole: user?.role || ''
            });
            historyId = syncHistory.id;
        }
        const selectedSeverities = normalizedFilters.severity;
        const shouldFilterBySeverity = selectedSeverities.length > 0 && selectedSeverities.length < SEVERITY_VALUES.length;
        const severitiesToPull = shouldFilterBySeverity ? selectedSeverities : [''];
        const findingMap = new Map();
        let rawFindingCount = 0;
        const productIdsToPull = splitDelimitedFilterValue(normalizedFilters.test__engagement__product);
        if (productIdsToPull.length === 0) {
            productIdsToPull.push('');
        }
        console.log(`[PULL] Starting DefectDojo pull from ${baseUrl}/api/v2/findings/`);
        const endpointFallbackLimitLabel = DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT > 0 ? DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT : 'unlimited';
        console.log(`[PULL] Finding page limit=${DEFECTDOJO_PULL_PAGE_LIMIT}; context concurrency=${DEFECTDOJO_CONTEXT_CONCURRENCY}; endpoint chunk concurrency=${DEFECTDOJO_ENDPOINT_CHUNK_CONCURRENCY}; individual endpoint fallback cap=${endpointFallbackLimitLabel}`);
        console.log(`[PULL] Filters: severities=${shouldFilterBySeverity ? selectedSeverities.join(', ') : 'all'}, products=${productIdsToPull.join(', ') || 'all'}`);
        for (const productId of productIdsToPull) {
            const currentFilters = {
                ...normalizedFilters
            };
            if (productId) {
                currentFilters.test__engagement__product = productId;
            } else {
                delete currentFilters.test__engagement__product;
            }
            for (const severity of severitiesToPull) {
                const filterQuery = buildFindingFilterQuery(currentFilters, severity);
                const scopeLabel = `${productId ? `product ${productId}` : 'all products'} / ${severity || 'all severities'}`;
                console.log(`[PULL] Fetching findings for ${scopeLabel}; query=${filterQuery || 'none'}`);
                let nextUrl = `${baseUrl}/api/v2/findings/?limit=${DEFECTDOJO_PULL_PAGE_LIMIT}${filterQuery}`;
                let pageNumber = 0;
                while (nextUrl) {
                    pageNumber += 1;
                    console.log(`[DEBUG] Requesting DefectDojo: ${nextUrl}`);
                    const response = await axios.get(nextUrl, {
                        headers: {
                            'Authorization': `Token ${apiKey}`,
                            'Accept': 'application/json'
                        }
                    });
                    if (response.data.results) {
                        const pageResults = response.data.results;
                        const queryTotal = Number.parseInt(response.data.count, 10);
                        const totalPages = Number.isInteger(queryTotal) && queryTotal > 0 ? Math.ceil(queryTotal / DEFECTDOJO_PULL_PAGE_LIMIT) : null;
                        rawFindingCount += pageResults.length;
                        pageResults.forEach(finding => {
                            const scopedFinding = withPullProductContext(finding, productId);
                            const key = getFindingKey(scopedFinding);
                            const existingFinding = findingMap.get(key);
                            if (!existingFinding) {
                                findingMap.set(key, scopedFinding);
                            } else if (productId) {
                                findingMap.set(key, withPullProductContext(existingFinding, productId));
                            }
                        });
                        console.log(`[PULL] Findings page ${pageNumber}${totalPages ? `/${totalPages}` : ''} for ${scopeLabel}: received ${pageResults.length}, unique so far ${findingMap.size}`);
                    }
                    nextUrl = response.data.next;
                }
            }
        }
        const allFindings = Array.from(findingMap.values());
        console.log(`[PULL] Finding fetch complete: ${rawFindingCount} records received, ${allFindings.length} unique findings`);
        if (rawFindingCount !== allFindings.length) {
            console.log(`[PULL] Removed ${rawFindingCount - allFindings.length} duplicate finding records before endpoint resolution`);
        }
        const severityBreakdown = buildSeverityBreakdown(allFindings);
        await enrichFindingsWithDefectDojoContext({
            baseUrl,
            apiKey,
            findings: allFindings,
            filters: normalizedFilters
        });
        console.log('[PULL] DefectDojo context enrichment complete');
        const endpointIds = new Set();
        allFindings.forEach(f => {
            if (Array.isArray(f.endpoints)) {
                f.endpoints.forEach(item => {
                    if (typeof item === 'number' || typeof item === 'string' && !isNaN(item)) {
                        endpointIds.add(item);
                    }
                });
            }
        });
        if (endpointIds.size > 0) {
            console.log(`[PULL] Resolving ${endpointIds.size} unique endpoints`);
            const idList = Array.from(endpointIds);
            const endpointMap = {};
            const chunkSize = 50;
            const endpointChunks = [];
            for (let i = 0; i < idList.length; i += chunkSize) {
                endpointChunks.push(idList.slice(i, i + chunkSize));
            }
            console.log(`[PULL] Endpoint bulk lookup: ${endpointChunks.length} chunks of up to ${chunkSize} IDs (concurrency ${DEFECTDOJO_ENDPOINT_CHUNK_CONCURRENCY})`);
            await runWithConcurrency(endpointChunks, DEFECTDOJO_ENDPOINT_CHUNK_CONCURRENCY, async (chunk, index) => {
                const epUrl = `${baseUrl}/api/v2/endpoints/?id__in=${chunk.join(',')}&limit=100`;
                console.log(`[DEBUG] Requesting endpoint chunk ${index + 1}/${endpointChunks.length}: ${epUrl}`);
                try {
                    const epResponse = await axios.get(epUrl, {
                        headers: {
                            'Authorization': `Token ${apiKey}`,
                            'Accept': 'application/json'
                        }
                    });
                    if (epResponse.data.results) {
                        console.log(`[PULL] Endpoint chunk ${index + 1}/${endpointChunks.length}: resolved ${epResponse.data.results.length}/${chunk.length}`);
                        epResponse.data.results.forEach(ep => {
                            endpointMap[ep.id.toString()] = ep;
                        });
                    }
                } catch (epError) {
                    console.error(`[ERROR] Failed to resolve endpoint chunk ${index + 1}/${endpointChunks.length}: ${epError.message}`);
                }
            }, {
                onProgress: createProgressLogger('Endpoint chunks processed', endpointChunks.length)
            });
            const missingEndpointIds = idList.filter(id => !endpointMap[id.toString()]);
            if (missingEndpointIds.length > 0) {
                const fallbackIds = DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT > 0 ? missingEndpointIds.slice(0, DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT) : missingEndpointIds;
                const skippedFallbackCount = missingEndpointIds.length - fallbackIds.length;
                console.log(`[PULL] Endpoint individual fallback: ${fallbackIds.length}/${missingEndpointIds.length} unresolved IDs will be requested${skippedFallbackCount > 0 ? `, ${skippedFallbackCount} skipped by cap` : ''}`);
                await runWithConcurrency(fallbackIds, DEFECTDOJO_ENDPOINT_CHUNK_CONCURRENCY, async id => {
                    try {
                        const singleEpUrl = `${baseUrl}/api/v2/endpoints/${id}/`;
                        const singleEpResponse = await axios.get(singleEpUrl, {
                            headers: {
                                'Authorization': `Token ${apiKey}`,
                                'Accept': 'application/json'
                            }
                        });
                        if (singleEpResponse.data) {
                            endpointMap[id.toString()] = singleEpResponse.data;
                        }
                    } catch (singleErr) {
                        console.warn(`[WARN] Could not resolve endpoint ${id} with individual fallback: ${singleErr.message}`);
                    }
                }, {
                    onProgress: createProgressLogger('Endpoint fallback requests processed', fallbackIds.length)
                });
            }
            console.log(`[PULL] Endpoint resolution lookup complete: resolved ${Object.keys(endpointMap).length}/${idList.length}`);
            let descriptionFallbackCount = 0;
            let unresolvedEndpointFindingCount = 0;
            allFindings.forEach(f => {
                if (Array.isArray(f.endpoints)) {
                    const resolvedEndpoints = f.endpoints.map(item => {
                        if (typeof item === 'number' || typeof item === 'string' && !isNaN(item)) {
                            return endpointMap[item.toString()] || item;
                        }
                        return item;
                    });
                    if (resolvedEndpoints.some(e => typeof e !== 'object')) {
                        let host = null;
                        let port = null;
                        let protocol = null;
                        const urlMatch = f.description?.match(/([a-z0-9]+):\/\/([^\/\s?#]+)/i);
                        if (urlMatch) {
                            protocol = urlMatch[1];
                            const hostPort = urlMatch[2].replace(/\/$/, '');
                            const parts = hostPort.split(':');
                            host = parts[0];
                            port = parts[1] || (protocol === 'https' ? '443' : protocol === 'http' ? '80' : null);
                        } else {
                            const ipMatch = f.description?.match(/(?:URL|Host|IP)\s*[:=]\s*([0-9a-z.-]+)/i);
                            if (ipMatch && ipMatch[1]) {
                                host = ipMatch[1].trim();
                            } else {
                                const rawIpMatch = f.description?.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
                                if (rawIpMatch) host = rawIpMatch[0];
                            }
                        }
                        if (host) {
                            descriptionFallbackCount += 1;
                            f.endpoints = resolvedEndpoints.map(item => {
                                if (typeof item !== 'object') {
                                    return {
                                        id: item,
                                        host: host,
                                        port: port,
                                        protocol: protocol,
                                        is_fallback: true
                                    };
                                }
                                return item;
                            });
                        } else {
                            unresolvedEndpointFindingCount += 1;
                            f.endpoints = resolvedEndpoints;
                        }
                    } else {
                        f.endpoints = resolvedEndpoints;
                    }
                }
            });
            console.log(`[PULL] Endpoint description fallback complete: applied to ${descriptionFallbackCount} findings; ${unresolvedEndpointFindingCount} findings still have unresolved endpoint IDs`);
        } else {
            console.log('[PULL] No endpoint IDs require resolution');
        }
        console.log(`[PULL] Saving ${allFindings.length} findings to ${database.isEnabled() ? 'PostgreSQL' : 'JSON storage'}`);
        const storageResult = await saveFindingsToStore(allFindings, {
            syncHistoryId: historyId
        });
        let staleActiveResult = {
            updated: 0
        };
        if (database.isEnabled() && historyId && shouldMarkUnseenActiveFindingsInactive(normalizedFilters)) {
            staleActiveResult = await database.markUnseenActiveFindingsInactiveForSync({
                syncHistoryId: historyId,
                productId: requestedProductId,
                engagementId: requestedEngagementId,
                severities: normalizedFilters.severity
            });
            if (staleActiveResult.updated > 0) {
                syncWarnings.push(`Marked ${staleActiveResult.updated} previously active findings inactive because they were not returned by the latest active DefectDojo pull.`);
                console.log(`[PULL] Marked ${staleActiveResult.updated} stale active findings inactive after latest DefectDojo pull`);
            }
        }
        emptyFindingsCache();
        if (broadcastEvent) {
            broadcastDashboardSync('defectdojo-pull-complete');
        }
        console.log(`[PULL] Pull complete: saved ${allFindings.length} findings`);
        if (finishHistory && syncHistory && database.isEnabled()) {
            syncHistory = await database.finishSyncHistory(syncHistory.id, {
                status: syncWarnings.length > 0 ? 'partial' : 'success',
                findingsPulled: allFindings.length,
                findingsUpdated: storageResult.updated || 0,
                findingsMitigated: allFindings.filter(finding => finding.is_mitigated === true || finding.mitigated === true || Boolean(finding.mitigated_at || finding.mitigation_confirmed || finding.mitigation_confirmed_at)).length,
                findingsStillActive: allFindings.filter(finding => finding.active !== false && finding.is_mitigated !== true && finding.mitigated !== true && !finding.mitigated_at && !finding.mitigation_confirmed && !finding.mitigation_confirmed_at).length,
                severityBreakdown,
                warnings: syncWarnings
            });
        }
        return {
            message: `Successfully pulled ${allFindings.length} findings`,
            ...storageResult,
            staleActiveUpdated: staleActiveResult.updated || 0,
            severityBreakdown,
            syncHistory,
            count: allFindings.length,
            findings: includeFindings ? allFindings : undefined
        };
    } catch (error) {
        if (finishHistory && syncHistory && database.isEnabled()) {
            try {
                syncHistory = await database.finishSyncHistory(syncHistory.id, {
                    status: 'failed',
                    errors: [error.response?.data || error.message]
                });
            } catch (historyError) {
                console.warn(`Could not finish failed sync history: ${historyError.message}`);
            }
        }
        error.syncHistory = syncHistory;
        throw error;
    }
};

registerApiRoutes(app, {
    getUsers: () => users,
    setUsers: (u) => { users = (Array.isArray(u) ? u : []).map(normalizeUserRecord).filter(user => user.username); },
    sessions,
    verifyPassword,
    hashPassword,
    normalizeUserStatus,
    normalizeUserRecord,
    buildPublicUser,
    signJwt,
    saveUsers,
    requireAuth,
    requireAdmin,
    crypto,
    getConfig: () => config,
    setConfig: (c) => { config = c; },
    listConfigBackups,
    isSafeConfigBackupFileName,
    readConfigBackup,
    createConfigBackupExport,
    getBackupLabelFromFileName,
    writeConfigBackup,
    getBackupTimestamp,
    extractConfigFromBackupPayload,
    normalizeConfigObject,
    saveConfigToDisk,
    afterConfigChanged,
    getLogs,
    clearLogs,
    dashboardSyncClients,
    writeDashboardSyncEvent,
    getDashboardSyncState: () => dashboardSyncState,
    DASHBOARD_SYNC_HEARTBEAT_MS,
    database,
    getAllowedProductsForUser,
    enrichMitigationReviewItem,
    cleanRouteValue,
    resolveRedmineStatusIds,
    asArray,
    isClosedStatus,
    updateRedmineIssueStatusAndConfirm,
    updateClosedRedmineSyncRecordsForIssue,
    broadcastDashboardSync,
    getRedmineIssueUrl,
    getRedmineSyncStatusPayload,
    rebuildRedmineStatusFromCurrentFindings,
    getRedmineSyncStore: () => redmineSyncStore,
    fetchRedmineIssueStatusMap,
    REDMINE_CHECK_CONCURRENCY,
    runWithConcurrency,
    fetchRedmineIssueStatus,
    isRedmineNotFoundError,
    createProgressLogger,
    normalizeFindingIds,
    getKnownRedmineIssueId,
    buildTicketStatusFromIssue,
    resolveRedmineProjectCached,
    redmineProjectResolveCache,
    isSyncAllRunning: () => syncAllRunning,
    setSyncAllRunning: (value) => { syncAllRunning = Boolean(value); },
    buildRedmineProjectMissingStatus,
    isRedmineProjectReferenceError,
    extractMissingRedmineProjectNameFromError,
    findMatchingRedmineIssue,
    calculateRedmineCheckStats,
    persistRedmineCheckResults,
    getRedminePriorityIdForSeverity,
    appendSyncMetadata,
    updateOpenRedmineIssuePriorityIfNeeded,
    writeStoredRedmineSyncRecord,
    buildStoredRedmineSyncRecord,
    getIssueResolvedProject,
    updateRedmineIssue,
    axios,
    getRedmineHeaders,
    getRedmineProjectCacheKey,
    buildMissingRedmineProject,
    normalizePullFilters,
    getEntityId,
    createSyncAllProgressBroadcaster,
    PORT,
    runDefectDojoPull,
    loadBackendRedmineCheckTicketRefs,
    mergeStoredRedmineSyncTicketRefs,
    checkRedmineTicketRefsForDashboard,
    getRedmineIssuePriorityId,
    buildAutoSuperTicketMarkdown,
    runMitigationRecheck,
    createSyncAllSplitHistoryRows,
    loadFindingsForUser,
    getAutoDefectDojoRoute,
    routeValueMatches,
    getRouteEntityKey,
    isStoredFindingActive,
    isStoredFindingMitigated,
    normalizeTicketStatus,
    isInProgressStatus,
    isResolveStatus,
    buildBackendCompactedRedmineTicketRefs,
    clearLocalFindingsStore,
    resetRedmineSyncStore,
    emptyFindingsCache
});
const configureStaticClient = () => {
    const indexPath = path.join(CLIENT_DIST_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) {
        console.warn(`Frontend dist not found at ${CLIENT_DIST_DIR}; API-only mode enabled`);
        return;
    }
    app.use(express.static(CLIENT_DIST_DIR));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
        res.sendFile(indexPath);
    });
};
const startServer = async () => {
    try {
        if (await database.init()) {
            console.log('Connected to PostgreSQL database');
        } else {
            console.log('PostgreSQL is not configured; using local JSON storage');
        }
        await loadUsers();
        await loadConfig();
        await importLocalConfigBackupsToPostgresIfEmpty();
        await loadRedmineSyncStore();
        await importFileFindingsToPostgresIfEmpty();
        configureStaticClient();
        // Global error handler for Express 5
        app.use((err, req, res, next) => {
            console.error('[EXPRESS ERROR]', req.method, req.path, err.message, err.stack);
            if (res.headersSent) return next(err);
            res.status(500).json({ error: err.message });
        });
        app.listen(PORT, () => {
            console.log(`Backend server running at http://localhost:${PORT}`);
            console.log(`Storage mode: ${database.isEnabled() ? 'postgresql' : 'json'}`);
            startRedmineSyncPoller();
        });
    } catch (error) {
        console.error('Failed to start backend server:', error);
        database.close().finally(() => process.exit(1));
    }
};
process.on('SIGINT', () => {
    database.close().finally(() => {
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    database.close().finally(() => {
        process.exit(0);
    });
});
startServer();
