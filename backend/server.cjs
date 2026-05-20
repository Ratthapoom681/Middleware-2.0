const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const database = require('./database.cjs');

const utils = require('./utils.cjs');
const auth = require('./auth.cjs');
const logger = require('./logger.cjs');
const syncUtils = require('./sync-utils.cjs');
const defectdojoClient = require('./defectdojo-client.cjs');
const redmineClient = require('./redmine-client.cjs');
const compaction = require('./compaction.cjs');

// Expose these into the global or module scope
const { cleanRouteValue, asArray, asFindingIdArray, normalizeFindingIds, isPlainObject } = utils;
const { createLogCapture } = logger;
const { SEVERITY_VALUES, normalizeSeverityFilter, normalizePullFilters, shouldMarkUnseenActiveFindingsInactive, splitDelimitedFilterValue, runWithConcurrency, createProgressLogger, createDashboardSync } = syncUtils;
const { CONFIG_FIELDS, DEFECTDOJO_CONTEXT_CONCURRENCY, buildFindingFilterQuery, getFindingKey, getEntityId, getEntityName, withPullProductContext, fetchDefectDojoEntity, enrichFindingsWithDefectDojoContext } = defectdojoClient;
const { REDMINE_ISSUE_SEARCH_LIMIT, REDMINE_ISSUE_SEARCH_MAX_PAGES, getRedmineHeaders, getRedmineIssueUrl, appendSyncMetadata, REDMINE_PRIORITY_FIELD_BY_SEVERITY, getRedminePriorityIdForSeverity, normalizeProjectToken, redmineProjectMatches, getProjectIssueValue, isRedmineNotFoundError, isRedmineProjectReferenceError, getMissingRedmineProjectLabel, buildMissingRedmineProject, buildRedmineProjectMissingStatus, makeRedmineProjectIdentifier, getRouteCandidates, getRouteProjectName, isRedmineProjectDuplicateError, createRedmineProject, fetchRedmineProjectDirect, findRedmineProjectByCandidates, resolveRedmineProject, getRedmineProjectCacheKey, resolveRedmineProjectCached, extractRedmineIssueFindingIds, extractRedmineIssueSyncKey, redmineIssueMatchesSyncKey, compareFindingIdsWithRedmineIssue, redmineIssueFindingIdsAreSubsetOfCurrent, findIssueInList, fetchRedmineIssuesForProjectStatus, findMatchingRedmineIssue, updateRedmineIssue, getRedmineIssuePriorityId, updateOpenRedmineIssuePriorityIfNeeded, normalizeTicketStatus, isResolveStatus, isInProgressStatus, isClosedStatus, getStatusNameIsClosed, fetchRedmineIssueStatuses, resolveRedmineStatusIds, fetchRedmineIssueStatusMap, fetchRedmineIssueStatus, getKnownRedmineIssueId, getIssueResolvedProject, buildTicketStatusFromIssue } = redmineClient;
const { AUTO_UPGRADE_TARGET_RE, AUTO_TITLE_VERSION_RE, AUTO_LESS_THAN_VERSION_RE, AUTO_SEVERITY_RANK, normalizeAutoText, normalizeAutoGroupText, highestSeverity, isStoredFindingMitigated, isStoredFindingActive, cleanAutoBlockText, compactAutoDefectDojoText, getAutoDescriptionText, getAutoImpactText, getAutoMitigationText, getAutoStrictFindingKey, parseAutoUpgradeText, parseAutoUpgradeTarget, getAutoLegacyCompactGroupKey, getAutoKnownNoCveFamily, tokenizeAutoVersion, compareAutoVersions, firstAutoRouteValue, firstAutoRouteName, getAutoDefectDojoRoute, stableAutoHash, sortAutoStrings, sortAutoFindingIds, collectAutoCveIds, resolveAutoCompactionFamily, extractAutoTextSourceEvidenceLines, normalizeAutoTextSourceKey, getAutoCompactionDetailKey, buildAutoFindingFingerprint, buildAutoLegacyFindingGroupKey, buildAutoCompactedSyncKey, buildAutoCompactedLegacySyncKey, extractAutoTitleVersion, chooseAutoDisplayTitle, getAutoSoftwareFamilyTitle, parseAutoTitleUpgradeTarget, collectAutoTicketUpgradeTargets, getAutoTicketUpgradeTarget, buildAutoActionRequiredSubject, addAutoTextSource, getAutoEndpointParts, getAutoEndpointLabel, getAutoEndpointHost, groupAutoEndpointDetailsByCves, sortAutoSourceGroupsByTitleVersion, finalizeAutoEndpointDetails, sortAutoTextSources, finalizeAutoSourceGroups, formatAutoTextSourceLabel, formatAutoEvidenceLine, formatAutoSourceGroupAssets, formatAutoSourceFindingAssets, getAutoEndpointPort, formatAutoAffectedAssetsAndPorts, formatAutoTicketTextSection, formatAutoRouteValue, formatAutoDefectDojoContext, buildAutoSourceTitlesBlock, buildAutoCveBlock, formatAutoSourceGroupTextBlock, normalizeAutoTextSource, collectAutoAppendixSources, formatAutoQuoteBlock, formatAutoAppendixTextBlock, buildAutoSourceGroupSection, buildAutoSourceGroupsBlock, buildAutoActionRequiredMarkdown, buildAutoSuperTicketMarkdown, buildBackendCompactedRedmineTicketRefs } = compaction;

// Special cases for auth
const { hashPassword, verifyPassword, readUsersFromDisk, createDefaultAdminUser, createRequireAuth, requireAdmin } = auth;


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
let users = [];
const sessions = new Map();
const requireAuth = createRequireAuth(sessions);
const loadUsers = async () => {
    let shouldPersistUsers = false;
    if (database.isEnabled()) {
        users = await database.loadUsers();
        if (users.length === 0) {
            users = readUsersFromDisk();
            if (users.length > 0) {
                console.log(`Imported ${users.length} users from users.json into PostgreSQL`);
                shouldPersistUsers = true;
            }
        }
    } else {
        users = readUsersFromDisk();
    }
    if (users.length === 0) {
        users.push(createDefaultAdminUser());
        console.log('Created default admin user (password: admin)');
        shouldPersistUsers = true;
    }
    if (shouldPersistUsers) await saveUsers();
};
const saveUsers = async () => {
    if (database.isEnabled()) {
        await database.saveUsers(users);
        return;
    }
    await fs.writeJson(usersPath, users, {
        spaces: 2
    });
};
app.post('/api/login', (req, res) => {
    const {username, password} = req.body;
    const user = users.find(u => u.username === username);
    if (!user || !verifyPassword(password, user.hash, user.salt)) {
        return res.status(401).json({
            error: 'Invalid credentials'
        });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
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
app.post('/api/logout', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    sessions.delete(token);
    res.json({
        message: 'Logged out'
    });
});
app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        storage: database.isEnabled() ? 'postgresql' : 'json'
    });
});
app.use('/api', requireAuth);
app.get('/api/users', requireAdmin, (req, res) => {
    res.json(users.map(u => ({
        username: u.username,
        role: u.role,
        products: u.products
    })));
});
app.post('/api/users', requireAdmin, async (req, res) => {
    const {username, password, role, products} = req.body;
    if (!username || !role) {
        return res.status(400).json({
            error: 'Username and role are required'
        });
    }
    const existingIndex = users.findIndex(u => u.username === username);
    if (existingIndex >= 0) {
        users[existingIndex].role = role;
        users[existingIndex].products = Array.isArray(products) ? products : [];
        if (password) {
            const {salt, hash} = hashPassword(password);
            users[existingIndex].salt = salt;
            users[existingIndex].hash = hash;
        }
    } else {
        if (!password) return res.status(400).json({
            error: 'Password is required for new users'
        });
        const {salt, hash} = hashPassword(password);
        users.push({
            username,
            salt,
            hash,
            role,
            products: Array.isArray(products) ? products : []
        });
    }
    await saveUsers();
    for (const [token, session] of sessions.entries()) {
        if (session.username === username) {
            sessions.set(token, {
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
app.delete('/api/users/:username', requireAdmin, async (req, res) => {
    const {username} = req.params;
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
    await saveUsers();
    for (const [token, session] of sessions.entries()) {
        if (session.username === username) sessions.delete(token);
    }
    res.json({
        message: 'User deleted'
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
let config = {
    scanPath: 'C:\\Users\\ifilm\\เดสก์ท็อป\\Scan CSV File\\TestApiJson',
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
    }
};
const configPath = path.join(DATA_DIR, 'config.json');
const configBackupDir = path.join(DATA_DIR, 'config-backups');
const redmineSyncStorePath = path.join(DATA_DIR, 'sync-state.json');
let redmineSyncStore = {
    version: REDMINE_SYNC_STORE_VERSION,
    byTicket: {},
    byFindingId: {}
};
let redmineSyncStoreSaveQueue = Promise.resolve();
let findingsCache = {
    scanPath: '',
    signature: '',
    findings: []
};
let scanPathWatcher = null;
let scanPathWatchDebounce = null;
let redmineSyncPollTimer = null;
let redmineSyncPollRunning = false;
let redmineSyncScheduler = {
    enabled: false,
    configured: false,
    intervalSeconds: 60,
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    nextRunAt: null,
    lastError: '',
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
        scanPath: '',
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
const clearLocalScanFiles = async () => {
    if (!config.scanPath || !await fs.pathExists(config.scanPath)) return 0;
    const files = await fs.readdir(config.scanPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    for (const file of jsonFiles) {
        await fs.remove(path.join(config.scanPath, file));
    }
    return jsonFiles.length;
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
const scheduleScanPathBroadcast = reason => {
    if (scanPathWatchDebounce) clearTimeout(scanPathWatchDebounce);
    scanPathWatchDebounce = setTimeout(() => {
        emptyFindingsCache();
        broadcastDashboardSync(reason);
    }, 250);
};
const closeScanPathWatcher = () => {
    if (scanPathWatcher) {
        scanPathWatcher.close();
        scanPathWatcher = null;
    }
    if (scanPathWatchDebounce) {
        clearTimeout(scanPathWatchDebounce);
        scanPathWatchDebounce = null;
    }
};
const restartScanPathWatcher = async () => {
    closeScanPathWatcher();
    if (database.isEnabled()) return;
    if (!config.scanPath || !await fs.pathExists(config.scanPath)) return;
    try {
        scanPathWatcher = fs.watch(config.scanPath, {
            persistent: false
        }, (_eventType, fileName) => {
            if (fileName && !String(fileName).toLowerCase().endsWith('.json')) return;
            scheduleScanPathBroadcast('scan-store-changed');
        });
        console.log(`Watching scan store for dashboard updates: ${config.scanPath}`);
    } catch (error) {
        console.warn(`Unable to watch scan store ${config.scanPath}: ${error.message}`);
    }
};
const afterConfigChanged = async (previousScanPath, reason = 'config-updated') => {
    startRedmineSyncPoller();
    if (previousScanPath !== config.scanPath) {
        emptyFindingsCache();
        await restartScanPathWatcher();
        broadcastDashboardSync(reason);
    }
};
const getBackupTimestamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const isSafeConfigBackupFileName = value => {
    const fileName = String(value || '');
    return Boolean(fileName && fileName.endsWith('.json') && path.basename(fileName) === fileName && !(/["\r\n]/).test(fileName) && !fileName.includes('/') && !fileName.includes('\\'));
};
const extractConfigFromBackupPayload = payload => {
    if (!isPlainObject(payload)) return null;
    return isPlainObject(payload.config) ? payload.config : payload;
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
    if (nextConfig.scanPath && !path.isAbsolute(nextConfig.scanPath)) {
        nextConfig.scanPath = path.resolve(nextConfig.scanPath);
    }
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
    config = normalizeConfigObject(storedConfig || config);
    if (!path.isAbsolute(config.scanPath)) {
        config.scanPath = path.resolve(config.scanPath);
    }
    if (database.isEnabled() && shouldPersistConfig) await saveConfigToDisk();
};
const getScanStoreSnapshot = async () => {
    if (!await fs.pathExists(config.scanPath)) {
        const error = new Error('Scan path does not exist');
        error.status = 404;
        throw error;
    }
    const files = await fs.readdir(config.scanPath);
    const jsonFiles = files.filter(file => file.toLowerCase().endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, {
        numeric: true
    }));
    const signatureParts = [];
    for (const file of jsonFiles) {
        const filePath = path.join(config.scanPath, file);
        const stats = await fs.stat(filePath);
        signatureParts.push(`${file}:${stats.size}:${stats.mtimeMs}`);
    }
    return {
        jsonFiles,
        signature: `${config.scanPath}|${signatureParts.join('|')}`
    };
};
const loadFindingsFromFileStore = async () => {
    const snapshot = await getScanStoreSnapshot();
    if (findingsCache.scanPath === config.scanPath && findingsCache.signature === snapshot.signature) {
        return findingsCache.findings;
    }
    let allFindings = [];
    for (const file of snapshot.jsonFiles) {
        const filePath = path.join(config.scanPath, file);
        const content = await fs.readJson(filePath);
        if (content.findings && Array.isArray(content.findings)) {
            allFindings = [...allFindings, ...content.findings];
        } else if (Array.isArray(content)) {
            allFindings = [...allFindings, ...content];
        }
    }
    const uniqueFindings = Array.from(new Map(allFindings.map(finding => [getFindingKey(finding), finding])).values());
    if (uniqueFindings.length !== allFindings.length) {
        console.log(`[DEBUG] Removed ${allFindings.length - uniqueFindings.length} duplicate local finding records`);
    }
    findingsCache = {
        scanPath: config.scanPath,
        signature: snapshot.signature,
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
    const fileName = 'defectdojo_api_data.json';
    const filePath = path.join(config.scanPath, fileName);
    await fs.ensureDir(config.scanPath);
    let existingFindings = [];
    try {
        existingFindings = await loadFindingsFromFileStore();
    } catch {
        existingFindings = [];
    }
    const merged = new Map(existingFindings.map(finding => [getFindingKey(finding), finding]));
    findings.forEach(finding => merged.set(getFindingKey(finding), finding));
    const mergedFindings = Array.from(merged.values());
    await fs.writeJson(filePath, {
        findings: mergedFindings
    }, {
        spaces: 2
    });
    return {
        storage: 'json',
        file: fileName,
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
const runMitigationRecheck = async ({baseUrl, apiKey, syncHistoryId = null, statusIds = {}, defectDojoBaseUrl = '', defectDojoApiKey = '', filters = {}, recheckSourceRecords = []} = {}) => {
    const findings = database.isEnabled() ? await database.loadFindings() : await loadFindingsFromFileStore();
    const findingsById = new Map(findings.map(finding => [String(finding.id || finding.findingId || ''), finding]).filter(([id]) => id));
    const recheckRecords = [];
    const reviewItems = [];
    const reopened = [];
    const warnings = [];
    const skippedNoLinkedFindings = [];
    const skippedNoActiveLinkedFindings = [];
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
    console.log(`[SYNC_ALL_RECHECK] Resolve compacted records selected=${resolveRecords.length}; Feedback status ID=${feedbackStatusId || '(missing)'}`);
    const refreshResult = await refreshRecheckFindingsFromDefectDojo({
        baseUrl: defectDojoBaseUrl,
        apiKey: defectDojoApiKey,
        records: resolveRecords,
        findingsById,
        filters,
        syncHistoryId
    });
    console.log(`[SYNC_ALL_RECHECK] DefectDojo findings refreshed=${refreshResult.refreshed || 0}; warnings=${refreshResult.warnings.length}`);
    warnings.push(...refreshResult.warnings);
    for (const record of resolveRecords) {
        const linkedFindings = normalizeFindingIds(record.findingIds || []).map(findingId => ({
            findingId,
            finding: findingsById.get(String(findingId))
        })).filter(item => item.finding);
        console.log(`[SYNC_ALL_RECHECK] Issue #${record.issueId} (${record.syncKey || record.ticketKey || 'unknown-key'}) status="${record.status || ''}" statusId="${record.statusId || ''}" linkedFindingIds=${normalizeFindingIds(record.findingIds || []).join(',') || '(none)'} linkedFound=${linkedFindings.length}`);
        if (linkedFindings.length === 0) {
            skippedNoLinkedFindings.push(record.issueId);
            console.warn(`[SYNC_ALL_RECHECK] Issue #${record.issueId} skipped: no linked DefectDojo findings found in local store after pull.`);
            continue;
        }
        const activeLinkedFindings = linkedFindings.filter(item => isStoredFindingActive(item.finding));
        const mitigatedLinkedFindings = linkedFindings.filter(item => isStoredFindingMitigated(item.finding));
        console.log(`[SYNC_ALL_RECHECK] Issue #${record.issueId} linked active/not-mitigated=${activeLinkedFindings.map(item => item.findingId).join(',') || '(none)'} mitigated=${mitigatedLinkedFindings.map(item => item.findingId).join(',') || '(none)'}`);
        if (activeLinkedFindings.length > 0) {
            const activeFindingIds = normalizeFindingIds(activeLinkedFindings.map(item => item.findingId));
            const reason = activeFindingIds.length === 1
                ? `DefectDojo finding ${activeFindingIds[0]} is still active after the latest scan; reopening Redmine issue ${record.issueId}.`
                : `DefectDojo findings ${activeFindingIds.join(', ')} are still active after the latest scan; reopening Redmine issue ${record.issueId}.`;
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
                console.warn(`[SYNC_ALL_RECHECK] Issue #${record.issueId} cannot change to Feedback: Feedback status ID is missing.`);
                addReopenFailureRecords(reason, {
                    missingStatus: 'feedback'
                });
                continue;
            }
            let issueStatus;
            try {
                attemptedFeedback.push(record.issueId);
                console.log(`[SYNC_ALL_RECHECK] Issue #${record.issueId}: attempting Redmine status change Resolved -> Feedback (${feedbackStatusId}).`);
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
                console.warn(`[SYNC_ALL_RECHECK] Issue #${record.issueId}: Feedback update failed. currentStatus="${currentStatus || 'unknown'}" detail=${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
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
            console.log(`[SYNC_ALL_RECHECK] Issue #${record.issueId}: middleware and Redmine status updated to "${nextStatusName}" (${nextStatusId}).`);
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
                        sourceFindingTitle: finding.title || finding.name || ''
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
            console.log(`[SYNC_ALL_RECHECK] Issue #${record.issueId} skipped: linked findings exist but none are active/not mitigated.`);
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
        warnings,
        records: recheckRecords
    };
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

const getSyncHistoryGroupKey = (route = {}) => ([
    cleanRouteValue(route.projectId) || cleanRouteValue(route.projectName) || 'unknown-product',
    cleanRouteValue(route.engagementId) || cleanRouteValue(route.engagementName) || 'unknown-engagement'
].join('|'));

const getSyncHistoryGroupRoute = (route = {}) => ({
    projectId: cleanRouteValue(route.projectId),
    projectName: cleanRouteValue(route.projectName),
    engagementId: cleanRouteValue(route.engagementId),
    engagementName: cleanRouteValue(route.engagementName)
});

const allocateCountByWeight = (total, groups, getWeight) => {
    const safeTotal = Math.max(0, Number.parseInt(total, 10) || 0);
    if (safeTotal === 0 || groups.length === 0) return new Map(groups.map(group => [group.key, 0]));
    const weights = groups.map(group => Math.max(0, getWeight(group) || 0));
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    if (weightTotal === 0) return new Map(groups.map(group => [group.key, 0]));
    const allocations = groups.map((group, index) => {
        const exact = safeTotal * weights[index] / weightTotal;
        const value = Math.floor(exact);
        return {
            key: group.key,
            value,
            remainder: exact - value
        };
    });
    let remaining = safeTotal - allocations.reduce((sum, item) => sum + item.value, 0);
    allocations.sort((left, right) => right.remainder - left.remainder);
    for (let index = 0; index < allocations.length && remaining > 0; index += 1) {
        allocations[index].value += 1;
        remaining -= 1;
    }
    return new Map(allocations.map(item => [item.key, item.value]));
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
    if (!database.isEnabled() || !parentSyncHistory?.id || findings.length === 0) return [];
    const groupsByKey = new Map();
    const ensureGroup = (routeInput = {}) => {
        const route = getSyncHistoryGroupRoute(routeInput);
        const key = getSyncHistoryGroupKey(route);
        if (!groupsByKey.has(key)) {
            groupsByKey.set(key, {
                key,
                route,
                findings: [],
                ticketRefs: [],
                checkResults: [],
                priorityUpdatedTicketKeys: new Set(),
                createdOrUpdatedTicketKeys: new Set(),
                recheckRecords: []
            });
        }
        return groupsByKey.get(key);
    };

    findings.forEach(finding => ensureGroup(getAutoDefectDojoRoute(finding)).findings.push(finding));
    ticketRefs.forEach(ticket => ensureGroup(ticket.route || {}).ticketRefs.push(ticket));
    const ticketRefByKey = new Map(ticketRefs.map(ticket => [ticket.ticketKey, ticket]));
    checkResults.forEach(result => {
        const ticket = ticketRefByKey.get(result.ticketKey);
        if (ticket) ensureGroup(ticket.route || {}).checkResults.push(result);
    });
    priorityUpdatedTicketKeys.forEach(ticketKey => {
        const ticket = ticketRefByKey.get(ticketKey);
        if (ticket) ensureGroup(ticket.route || {}).priorityUpdatedTicketKeys.add(ticketKey);
    });
    createdOrUpdatedTicketKeys.forEach(ticketKey => {
        const ticket = ticketRefByKey.get(ticketKey);
        if (ticket) ensureGroup(ticket.route || {}).createdOrUpdatedTicketKeys.add(ticketKey);
    });
    recheckRecords.forEach(record => ensureGroup({
        projectId: record.productId,
        projectName: record.productName,
        engagementId: record.engagementId,
        engagementName: record.engagementName
    }).recheckRecords.push(record));

    const groups = Array.from(groupsByKey.values()).filter(group => (
        group.findings.length > 0
        || group.ticketRefs.length > 0
        || group.recheckRecords.length > 0
    ));
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
const getRedmineSyncStatusPayload = () => ({
    ...redmineSyncScheduler,
    syncRecords: Object.keys(redmineSyncStore.byTicket || ({})).length
});
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
    const ticketRefs = mergeStoredRedmineSyncTicketRefs(await loadBackendRedmineCheckTicketRefs());
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
        console.log(`[REDMINE_AUTO] Status sync started: ${ticketRefs.length} backend-compacted tickets to check`);
        if (ticketRefs.length === 0) {
            redmineSyncScheduler = {
                ...redmineSyncScheduler,
                checkedCount: 0,
                changedCount: 0,
                redmineMetadataRequests: 0,
                redmineIssueRequests: 0,
                redmineProjectIssueRequests: 0,
                redmineNotFoundCount: 0,
                redmineErrorCount: 0,
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
        const {stats} = await checkRedmineTicketRefsForDashboard({
            baseUrl,
            apiKey,
            configuredProjectId: cleanRouteValue(config.redmineProjectId),
            trackerId: cleanRouteValue(config.redmineTrackerId),
            ticketRefs,
            logPrefix: 'REDMINE_AUTO',
            persist: true,
            statusIds
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
        console.log(`[REDMINE_AUTO] Redmine API queried: metadata=${stats.redmineMetadataRequests}, issueStatus=${stats.redmineIssueRequests}, projectIssueLists=${stats.redmineProjectIssueRequests}, notFound=${stats.redmineNotFoundCount}, errors=${stats.redmineErrorCount}`);
        console.log(`[REDMINE_AUTO] Status sync finished: checked=${stats.checkedCount}, changed=${stats.changedCount}`);
        return {
            checkedCount: stats.checkedCount,
            changedCount: stats.changedCount,
            redmineMetadataRequests: stats.redmineMetadataRequests,
            redmineIssueRequests: stats.redmineIssueRequests,
            redmineProjectIssueRequests: stats.redmineProjectIssueRequests,
            redmineNotFoundCount: stats.redmineNotFoundCount,
            redmineErrorCount: stats.redmineErrorCount
        };
    } catch (error) {
        redmineSyncScheduler = {
            ...redmineSyncScheduler,
            lastError: error.message || 'Redmine status sync failed'
        };
        console.warn(`[REDMINE_AUTO] Status sync failed: ${redmineSyncScheduler.lastError}`);
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
    redmineSyncScheduler = {
        ...redmineSyncScheduler,
        enabled: configured && pollIntervalMs > 0,
        configured,
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
app.get('/api/config', requireAdmin, (req, res) => {
    res.json(config);
});
app.get('/api/config/backups', requireAdmin, async (req, res) => {
    try {
        res.json(await listConfigBackups());
    } catch (error) {
        console.error('Error listing config backups:', error);
        res.status(500).json({
            error: 'Failed to list config backups',
            details: error.message
        });
    }
});
app.get('/api/config/backups/:fileName/export', requireAdmin, async (req, res) => {
    try {
        const {fileName} = req.params;
        if (!isSafeConfigBackupFileName(fileName)) {
            return res.status(400).json({
                error: 'Backup fileName is required'
            });
        }
        const backupConfig = await readConfigBackup(fileName);
        if (!backupConfig) {
            return res.status(404).json({
                error: 'Backup file not found'
            });
        }
        const backup = (await listConfigBackups()).find(item => item.fileName === fileName);
        const exportPayload = createConfigBackupExport({
            fileName,
            label: getBackupLabelFromFileName(fileName),
            sourceConfig: backupConfig,
            createdAt: backup?.createdAt
        });
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(JSON.stringify(exportPayload, null, 2));
    } catch (error) {
        console.error('Error exporting config backup:', error);
        res.status(500).json({
            error: 'Failed to export config backup',
            details: error.message
        });
    }
});
app.post('/api/config/backup', requireAdmin, async (req, res) => {
    try {
        const backup = await writeConfigBackup(config, 'manual');
        res.json({
            message: 'Configuration backup created',
            backup
        });
    } catch (error) {
        console.error('Error backing up config:', error);
        res.status(500).json({
            error: 'Failed to backup config',
            details: error.message
        });
    }
});
app.get('/api/config/export', requireAdmin, (req, res) => {
    const fileName = `defectdojo-viewer-config-${getBackupTimestamp()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(config, null, 2));
});
app.post('/api/config/import', requireAdmin, async (req, res) => {
    try {
        const importedConfig = extractConfigFromBackupPayload(req.body);
        if (!importedConfig) {
            return res.status(400).json({
                error: 'Config JSON body is required'
            });
        }
        const previousScanPath = config.scanPath;
        const backup = await writeConfigBackup(config, 'pre-import');
        config = normalizeConfigObject(importedConfig);
        await saveConfigToDisk();
        await afterConfigChanged(previousScanPath, 'config-imported');
        res.json({
            message: 'Configuration imported',
            config,
            backup
        });
    } catch (error) {
        console.error('Error importing config:', error);
        res.status(500).json({
            error: 'Failed to import config',
            details: error.message
        });
    }
});
app.post('/api/config/restore', requireAdmin, async (req, res) => {
    try {
        const fileName = String(req.body?.fileName || '');
        if (!isSafeConfigBackupFileName(fileName)) {
            return res.status(400).json({
                error: 'Backup fileName is required'
            });
        }
        const restoredConfig = await readConfigBackup(fileName);
        if (!restoredConfig) {
            return res.status(404).json({
                error: 'Backup file not found'
            });
        }
        const currentBackup = await writeConfigBackup(config, 'pre-restore');
        const previousScanPath = config.scanPath;
        config = normalizeConfigObject(restoredConfig);
        await saveConfigToDisk();
        await afterConfigChanged(previousScanPath, 'config-restored');
        res.json({
            message: 'Configuration restored',
            config,
            backup: currentBackup
        });
    } catch (error) {
        console.error('Error restoring config:', error);
        res.status(500).json({
            error: 'Failed to restore config',
            details: error.message
        });
    }
});
app.post('/api/config', requireAdmin, async (req, res) => {
    try {
        const previousScanPath = config.scanPath;
        const backup = await writeConfigBackup(config, 'pre-save');
        config = normalizeConfigObject(req.body || ({}));
        await saveConfigToDisk();
        await afterConfigChanged(previousScanPath, 'config-saved');
        res.json({
            message: 'Configuration updated',
            config,
            backup
        });
    } catch (error) {
        console.error('Error updating config:', error);
        res.status(500).json({
            error: 'Failed to update config',
            details: error.message
        });
    }
});
app.get('/api/logs', (req, res) => {
    res.json(getLogs());
});
app.delete('/api/logs', (req, res) => {
    clearLogs();
    res.json({
        message: 'Logs cleared'
    });
});
app.get('/api/sync/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    const client = {
        id: crypto.randomUUID(),
        res
    };
    dashboardSyncClients.add(client);
    writeDashboardSyncEvent(res, 'dashboard-sync', dashboardSyncState);
    const heartbeat = setInterval(() => {
        writeDashboardSyncEvent(res, 'heartbeat', {
            at: new Date().toISOString()
        });
    }, DASHBOARD_SYNC_HEARTBEAT_MS);
    req.on('close', () => {
        clearInterval(heartbeat);
        dashboardSyncClients.delete(client);
    });
});
app.get('/api/redmine/sync/status', (req, res) => {
    res.json(getRedmineSyncStatusPayload());
});
app.get('/api/dashboard/summary', async (req, res) => {
    try {
        const productId = cleanRouteValue(req.query.productId);
        const engagementId = cleanRouteValue(req.query.engagementId);
        const isAdmin = req.user.role === 'admin';
        const allowedProducts = isAdmin ? undefined : getAllowedProductsForUser(req.user);
        if (database.isEnabled()) {
            return res.json(await database.getDashboardSummary({
                allowedProducts,
                requireAllowedProducts: !isAdmin,
                productId,
                engagementId,
                includeMitigationReview: isAdmin
            }));
        }
        const findings = await loadFindingsForUser(req.user);
        const scopedFindings = findings.filter(finding => {
            const route = getAutoDefectDojoRoute(finding);
            if (productId && !routeValueMatches(productId, route.projectId, route.projectName, getRouteEntityKey('product', route.projectId, route.projectName))) return false;
            if (engagementId && !routeValueMatches(engagementId, route.engagementId, route.engagementName, getRouteEntityKey('engagement', route.engagementId, route.engagementName))) return false;
            return true;
        });
        const products = new Map();
        const engagements = new Map();
        findings.forEach(finding => {
            const route = getAutoDefectDojoRoute(finding);
            const productKey = getRouteEntityKey('product', route.projectId, route.projectName);
            const engagementKey = getRouteEntityKey('engagement', route.engagementId, route.engagementName);
            if (route.projectId || route.projectName) {
                products.set(route.projectId || productKey || route.projectName, {
                    id: route.projectId || '',
                    key: productKey,
                    name: route.projectName || route.projectId || 'Unknown product'
                });
            }
            if ((!productId || routeValueMatches(productId, route.projectId, route.projectName, productKey)) && (route.engagementId || route.engagementName)) {
                engagements.set(route.engagementId || engagementKey || route.engagementName, {
                    id: route.engagementId || '',
                    key: engagementKey,
                    name: route.engagementName || route.engagementId || 'Unknown engagement',
                    productId: route.projectId || '',
                    productKey
                });
            }
        });
        const ticketValues = Object.values(redmineSyncStore.byTicket || ({})).filter(ticket => {
            const route = ticket.route || {};
            const productKey = getRouteEntityKey('product', route.projectId, route.projectName);
            const engagementKey = getRouteEntityKey('engagement', route.engagementId, route.engagementName);
            if (!isAdmin && !allowedProducts.some(product => routeValueMatches(product, route.projectId, route.projectName, productKey))) return false;
            if (productId && !routeValueMatches(productId, route.projectId, route.projectName, productKey)) return false;
            if (engagementId && !routeValueMatches(engagementId, route.engagementId, route.engagementName, engagementKey)) return false;
            return true;
        });
        const ticketCount = predicate => ticketValues.filter(predicate).length;
        const summary = {
            defectDojo: {
                activeFindings: scopedFindings.filter(finding => isStoredFindingActive(finding) && !isStoredFindingMitigated(finding)).length,
                mitigatedFindings: scopedFindings.filter(isStoredFindingMitigated).length
            },
            redmine: {
                ticketNew: ticketCount(ticket => normalizeTicketStatus(ticket.status) === 'new'),
                ticketInProgress: ticketCount(ticket => isInProgressStatus(ticket.status, ticket.statusId, {}, config)),
                ticketFeedback: ticketCount(ticket => normalizeTicketStatus(ticket.status) === 'feedback'),
                ticketResolve: ticketCount(ticket => isResolveStatus(ticket.status, ticket.statusId, {}, config)),
                ticketClosed: ticketCount(ticket => Boolean(ticket.isClosed) || isClosedStatus(ticket.status, ticket.statusId, {}, config))
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
app.get('/api/sync-history', requireAdmin, async (req, res) => {
    try {
        if (!database.isEnabled()) return res.json([]);
        res.json(await database.listSyncHistory(req.query));
    } catch (error) {
        console.error('Error listing sync history:', error);
        res.status(500).json({
            error: 'Failed to list sync history',
            details: error.message
        });
    }
});
app.get('/api/sync-history/:id', requireAdmin, async (req, res) => {
    try {
        if (!database.isEnabled()) return res.status(404).json({
            error: 'Sync history is database-backed and PostgreSQL is not enabled'
        });
        const item = await database.getSyncHistory(req.params.id);
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
app.get('/api/compacted-cves', async (req, res) => {
    try {
        const productId = cleanRouteValue(req.query.productId);
        const engagementId = cleanRouteValue(req.query.engagementId);
        const severity = cleanRouteValue(req.query.severity);
        const isAdmin = req.user.role === 'admin';
        const allowedProducts = isAdmin ? undefined : getAllowedProductsForUser(req.user);
        if (database.isEnabled()) {
            return res.json(await database.listCompactedCveFindings({
                allowedProducts,
                requireAllowedProducts: !isAdmin,
                productId,
                engagementId,
                severity
            }));
        }
        const findings = await loadFindingsForUser(req.user);
        const groups = buildBackendCompactedRedmineTicketRefs(findings).filter(group => {
            const route = group.route || {};
            const productKey = getRouteEntityKey('product', route.projectId, route.projectName);
            const engagementKey = getRouteEntityKey('engagement', route.engagementId, route.engagementName);
            if (productId && !routeValueMatches(productId, route.projectId, route.projectName, productKey)) return false;
            if (engagementId && !routeValueMatches(engagementId, route.engagementId, route.engagementName, engagementKey)) return false;
            return true;
        }).map(group => {
            const storedSync = redmineSyncStore.byTicket[group.ticketKey] || ({});
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
app.get('/api/mitigation-rechecks', async (req, res) => {
    try {
        if (!database.isEnabled()) return res.json([]);
        const isAdmin = req.user.role === 'admin';
        res.json(await database.listMitigationRechecks({
            ...req.query,
            allowedProducts: isAdmin ? undefined : getAllowedProductsForUser(req.user),
            requireAllowedProducts: !isAdmin
        }));
    } catch (error) {
        console.error('Error listing mitigation rechecks:', error);
        res.status(500).json({
            error: 'Failed to list mitigation rechecks',
            details: error.message
        });
    }
});
app.get('/api/admin/mitigation-queue', requireAdmin, async (req, res) => {
    try {
        if (!database.isEnabled()) return res.json([]);
        const queue = await database.listMitigationReviewQueue(req.query);
        res.json(queue.map(enrichMitigationReviewItem));
    } catch (error) {
        console.error('Error listing mitigation review queue:', error);
        res.status(500).json({
            error: 'Failed to list mitigation review queue',
            details: error.message
        });
    }
});
app.get('/api/admin/mitigation-actions', requireAdmin, async (req, res) => {
    try {
        if (!database.isEnabled()) return res.json([]);
        res.json(await database.listAdminActionHistory(req.query));
    } catch (error) {
        console.error('Error listing mitigation review action history:', error);
        res.status(500).json({
            error: 'Failed to list mitigation review action history',
            details: error.message
        });
    }
});
app.post('/api/admin/mitigation-queue/:reviewKey/actions', requireAdmin, async (req, res) => {
    try {
        if (!database.isEnabled()) {
            return res.status(400).json({
                error: 'Mitigation review actions require PostgreSQL storage'
            });
        }
        const action = cleanRouteValue(req.body?.action);
        const reason = String(req.body?.reason || '');
        const queue = (await database.listMitigationReviewQueue({})).map(enrichMitigationReviewItem);
        const item = queue.find(review => review.reviewKey === req.params.reviewKey || Array.isArray(review.reviewKeys) && review.reviewKeys.includes(req.params.reviewKey));
        if (!item) return res.status(404).json({
            error: 'Review item not found'
        });
        const reviewKeys = Array.isArray(item.reviewKeys) && item.reviewKeys.length > 0 ? item.reviewKeys : [item.reviewKey];
        const actor = req.user?.username || '';
        const actorRole = req.user?.role || '';
        let redmineCloseNote = '';
        if (action === 'close_redmine') {
            const redmineUrl = String(config.redmineUrl || '').trim();
            const apiKey = String(config.redmineApiKey || '').trim();
            const baseUrl = redmineUrl.replace(/\/$/, '');
            const statusIds = redmineUrl && apiKey ? await resolveRedmineStatusIds({
                baseUrl,
                apiKey,
                config
            }) : {};
            const closedStatusId = cleanRouteValue(statusIds.closed || config.redmineStatusClosedId);
            if (!redmineUrl || !apiKey || !closedStatusId) {
                return res.status(400).json({
                    error: 'Redmine URL, API key, and Closed status ID are required to close an issue'
                });
            }
            if (!item.issueId) {
                return res.status(400).json({
                    error: 'This mitigation review item has no Redmine issue ID to close'
                });
            }
            const closedStatus = asArray(statusIds.statuses).find(status => cleanRouteValue(status.id) === closedStatusId);
            if (closedStatus && closedStatus.is_closed === false && !isClosedStatus(closedStatus.name, closedStatus.id, {}, {})) {
                return res.status(400).json({
                    error: `Configured Closed status ID ${closedStatusId} is "${closedStatus.name || 'unknown'}", but Redmine does not mark that status as closed. Update Settings > Redmine > Status IDs to use a real closed status.`
                });
            }
            const closedAt = new Date().toISOString();
            redmineCloseNote = [
                `Reviewed and closed by ${actor || 'unknown user'}${actorRole ? ` (${actorRole})` : ''} in DefectDojo Viewer.`,
                `Closed at: ${closedAt}`,
                reason ? `Reviewer note: ${reason}` : '',
            ].filter(Boolean).join('\n');
            const issueStatus = await updateRedmineIssueStatusAndConfirm({
                baseUrl,
                apiKey,
                issueId: item.issueId,
                statusId: closedStatusId,
                notes: redmineCloseNote,
                statusIds,
                expectedStatusLabel: `closed status ${closedStatus?.name || closedStatusId}`,
                matchesExpectedStatus: status => (
                    cleanRouteValue(status.statusId) === closedStatusId
                    && Boolean(status.isClosed)
                    && isClosedStatus(status.status, status.statusId, statusIds, config)
                )
            });
            await updateClosedRedmineSyncRecordsForIssue({
                issueId: item.issueId,
                ticketKey: item.ticketKey,
                statusId: closedStatusId,
                statusName: closedStatus?.name || issueStatus.status || 'Closed',
                issueUrl: issueStatus.issueUrl || item.issueUrl || getRedmineIssueUrl(baseUrl, {
                    id: item.issueId
                })
            });
        }
        const results = [];
        for (const reviewKey of reviewKeys) {
            results.push(await database.applyMitigationReviewAction(reviewKey, {
                action,
                actor,
                actorRole,
                reason,
                raw: {
                    request: req.body || ({}),
                    redmineCloseNote,
                    groupedReviewKey: item.reviewKey,
                    groupedReviewKeys: reviewKeys
                }
            }));
        }
        broadcastDashboardSync('mitigation-review-updated');
        res.json({
            reviewKey: item.reviewKey,
            reviewKeys,
            action,
            state: results[0]?.state || '',
            updated: results.length
        });
    } catch (error) {
        console.error('Error applying mitigation review action:', error);
        res.status(error.status || 500).json({
            error: error.message || 'Failed to apply mitigation review action'
        });
    }
});
app.post('/api/redmine/issues/status', requireAdmin, async (req, res) => {
    const {redmine = {}, issues = []} = req.body;
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
        const statusIds = await resolveRedmineStatusIds({
            baseUrl,
            apiKey,
            config
        });
        const statusMap = await fetchRedmineIssueStatusMap({
            baseUrl,
            apiKey
        });
        console.log(`[REDMINE] Refreshing ${issueRefs.length} known issue statuses (concurrency ${REDMINE_CHECK_CONCURRENCY})`);
        const results = await runWithConcurrency(issueRefs, REDMINE_CHECK_CONCURRENCY, async ref => {
            try {
                const status = await fetchRedmineIssueStatus({
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
                if (isRedmineNotFoundError(error)) {
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
            onProgress: createProgressLogger('Redmine issue statuses checked', issueRefs.length)
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
app.post('/api/redmine/issues/check', requireAdmin, async (req, res) => {
    const {redmine = {}, tickets = []} = req.body;
    let syncHistory = null;
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
        findingIds: normalizeFindingIds(ticket.findingIds || []),
        legacySyncKeys: asArray(ticket.legacySyncKeys || ticket.legacyTicketKeys).map(cleanRouteValue).filter(Boolean),
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
        const statusIds = await resolveRedmineStatusIds({
            baseUrl,
            apiKey,
            config
        });
        if (database.isEnabled()) {
            syncHistory = await database.createSyncHistory({
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
        const statusMap = await fetchRedmineIssueStatusMap({
            baseUrl,
            apiKey
        });
        const projectCache = new Map();
        const resultsByTicketKey = new Map();
        const ticketsNeedingSearch = [];
        console.log(`[REDMINE] Checking ${ticketRefs.length} compacted tickets (concurrency ${REDMINE_CHECK_CONCURRENCY})`);
        await runWithConcurrency(ticketRefs, REDMINE_CHECK_CONCURRENCY, async ticket => {
            const knownIssueId = getKnownRedmineIssueId(ticket, redmineSyncStore);
            if (!knownIssueId) {
                ticketsNeedingSearch.push(ticket);
                return;
            }
            try {
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
                const missingMessage = isRedmineNotFoundError(error) ? 'known issue was not found; the issue or its Redmine project may have been deleted' : error.message;
                console.warn(`[REDMINE] Known issue ${knownIssueId} for ${ticket.ticketKey} could not be checked; falling back to grouped search: ${missingMessage}`);
                ticketsNeedingSearch.push(ticket);
            }
        }, {
            onProgress: createProgressLogger('Known Redmine issue IDs checked', ticketRefs.length)
        });
        const ticketsByProject = new Map();
        if (ticketsNeedingSearch.length > 0) {
            console.log(`[REDMINE] Resolving projects for ${ticketsNeedingSearch.length} tickets needing search`);
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
                resultsByTicketKey.set(ticket.ticketKey, {
                    ticketKey: ticket.ticketKey,
                    action: 'check_failed',
                    error: error.response?.data || error.message
                });
            }
        }, {
            onProgress: createProgressLogger('Redmine projects resolved', ticketsNeedingSearch.length)
        });
        const projectGroups = Array.from(ticketsByProject.values());
        if (projectGroups.length > 0) {
            console.log(`[REDMINE] Grouped Redmine search: ${projectGroups.length} project groups for ${projectGroups.reduce((sum, group) => sum + group.tickets.length, 0)} tickets`);
        }
        await runWithConcurrency(projectGroups, REDMINE_CHECK_CONCURRENCY, async ({resolvedProject, tickets}) => {
            try {
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
                tickets.forEach(ticket => {
                    if (isRedmineNotFoundError(error)) {
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
            onProgress: createProgressLogger('Redmine project issue groups searched', projectGroups.length)
        });
        const results = ticketRefs.map(ticket => resultsByTicketKey.get(ticket.ticketKey) || ({
            ticketKey: ticket.ticketKey,
            action: 'check_failed',
            error: 'Ticket was not checked'
        }));
        let storedSyncChanged = false;
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
                isClosed: ticketStatus.action === 'existing_closed',
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
                await writeStoredRedmineSyncRecord(storeKey, nextRecord, {
                    notify: false,
                    save: false
                });
                storedSyncChanged = true;
            }
        }
        if (storedSyncChanged) {
            await saveRedmineSyncStore();
            broadcastDashboardSync('redmine-status-updated');
        }
        if (syncHistory && database.isEnabled()) {
            syncHistory = await database.finishSyncHistory(syncHistory.id, {
                status: results.some(result => result.action === 'check_failed') ? 'partial' : 'success',
                ticketsPulled: results.length,
                ticketsUpdated: storedSyncChanged ? results.length : 0,
                errors: results.filter(result => result.action === 'check_failed').map(result => result.error || 'Check failed')
            });
        }
        res.json({
            tickets: results,
            syncHistory
        });
    } catch (error) {
        console.error('Error checking Redmine tickets:', error.message);
        if (syncHistory && database.isEnabled()) {
            try {
                syncHistory = await database.finishSyncHistory(syncHistory.id, {
                    status: 'failed',
                    errors: [error.response?.data || error.message]
                });
            } catch (historyError) {
                console.warn(`Could not finish failed Redmine sync history: ${historyError.message}`);
            }
        }
        res.status(error.response?.status || 500).json({
            error: 'Failed to check Redmine tickets',
            details: error.response?.data || error.message,
            syncHistory
        });
    }
});
app.post('/api/redmine/issues', requireAdmin, async (req, res) => {
    const {redmine = {}, issue = {}} = req.body;
    const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
    const apiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();
    const configuredProjectId = String(redmine.projectId || config.redmineProjectId || '').trim();
    const trackerId = String(redmine.trackerId || config.redmineTrackerId || '').trim();
    const subject = String(issue.subject || '').trim();
    const description = String(issue.description || '').trim();
    const severity = String(issue.severity || '').trim();
    const priorityId = String(redmine.priorityId || getRedminePriorityIdForSeverity(severity, config) || '').trim();
    const syncKey = String(issue.syncKey || '').trim();
    const findingIds = normalizeFindingIds(issue.findingIds || []);
    const legacySyncKeys = asArray(issue.legacySyncKeys || issue.legacyTicketKeys).map(cleanRouteValue).filter(Boolean);
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
        const descriptionWithSync = appendSyncMetadata(description, syncKey, findingIds);
        const knownIssueId = getKnownRedmineIssueId({
            ticketKey: syncKey,
            syncKey,
            issueId: issue.issueId,
            legacySyncKeys,
            findingIds
        }, redmineSyncStore);
        if (knownIssueId) {
            try {
                const statusMap = await fetchRedmineIssueStatusMap({
                    baseUrl,
                    apiKey
                });
                const issueStatus = await fetchRedmineIssueStatus({
                    baseUrl,
                    apiKey,
                    issueId: knownIssueId,
                    statusMap,
                    config
                });
                const issueUrl = issueStatus.issueUrl;
                if (!issueStatus.isClosed) {
                    const priorityUpdated = await updateOpenRedmineIssuePriorityIfNeeded({
                        baseUrl,
                        apiKey,
                        issue: issueStatus.issue,
                        issueId: knownIssueId,
                        priorityId,
                        severity
                    });
                    const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
                        action: 'existing_open',
                        issue: issueStatus.issue,
                        issueUrl,
                        statusId: issueStatus.statusId,
                        resolvedProject: getIssueResolvedProject(issueStatus.issue),
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
                        resolvedProject: getIssueResolvedProject(issueStatus.issue),
                        serverSync
                    });
                }
                const updatedIssuePayload = {
                    subject: subject.slice(0, 255),
                    description: descriptionWithSync,
                    notes: 'Synchronized latest compacted ticket metadata. Existing Redmine issue is already closed.'
                };
                console.log(`Found known closed Redmine issue ${knownIssueId}; updating compacted body`);
                await updateRedmineIssue({
                    baseUrl,
                    apiKey,
                    issueId: knownIssueId,
                    issue: updatedIssuePayload
                });
                const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
                    action: 'existing_closed',
                    issue: issueStatus.issue,
                    issueUrl,
                    isClosed: true,
                    statusId: issueStatus.statusId,
                    resolvedProject: getIssueResolvedProject(issueStatus.issue),
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
                    resolvedProject: getIssueResolvedProject(issueStatus.issue),
                    serverSync
                });
            } catch (knownError) {
                const missingMessage = isRedmineNotFoundError(knownError) ? 'known issue was not found; the issue or its Redmine project may have been deleted' : knownError.message;
                console.warn(`Known Redmine issue ${knownIssueId} could not be checked; falling back to project search: ${missingMessage}`);
            }
        }
        const resolvedProject = await resolveRedmineProjectCached({
            cache: redmineProjectResolveCache,
            baseUrl,
            apiKey,
            configuredProjectId,
            route,
            retain: false
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
        const openIssue = await findMatchingRedmineIssue({
            ...searchArgs,
            statusId: 'open'
        });
        if (openIssue) {
            const issueUrl = getRedmineIssueUrl(baseUrl, openIssue);
            const priorityUpdated = await updateOpenRedmineIssuePriorityIfNeeded({
                baseUrl,
                apiKey,
                issue: openIssue,
                issueId: openIssue.id,
                priorityId,
                severity
            });
            const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
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
        const closedIssue = await findMatchingRedmineIssue({
            ...searchArgs,
            statusId: 'closed'
        });
        if (closedIssue) {
            const issueUrl = getRedmineIssueUrl(baseUrl, closedIssue);
            const updatedIssuePayload = {
                subject: subject.slice(0, 255),
                description: descriptionWithSync,
                notes: 'Synchronized latest compacted ticket metadata. Existing Redmine issue is already closed.'
            };
            console.log(`Found existing closed Redmine issue ${closedIssue.id}; updating compacted body`);
            await updateRedmineIssue({
                baseUrl,
                apiKey,
                issueId: closedIssue.id,
                issue: updatedIssuePayload
            });
            const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
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
            response = await axios.post(`${baseUrl}/issues.json`, {
                issue: redmineIssue
            }, {
                headers: getRedmineHeaders(apiKey)
            });
        } catch (createError) {
            if (isRedmineProjectReferenceError(createError)) {
                redmineProjectResolveCache.delete(getRedmineProjectCacheKey({
                    baseUrl,
                    configuredProjectId,
                    route
                }));
                const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
                    action: 'not_found',
                    status: 'Project not found',
                    resolvedProject: buildMissingRedmineProject({
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
        const issueUrl = getRedmineIssueUrl(baseUrl, createdIssue);
        const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
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
        await restartScanPathWatcher();
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

app.post('/api/sync-all', requireAdmin, async (req, res) => {
    const {url, apiKey, filters, redmine = {}} = req.body;
    const defectDojoUrl = String(url || config.defectDojoUrl || '').trim();
    const defectDojoApiKey = String(apiKey || config.defectDojoApiKey || '').trim();
    const normalizedFilters = normalizePullFilters(filters || config.pullFilters || ({}));
    const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
    const redmineApiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();
    const configuredProjectId = cleanRouteValue(redmine.projectId || config.redmineProjectId);
    const trackerId = cleanRouteValue(redmine.trackerId || config.redmineTrackerId);
    const requestedProductId = getEntityId(normalizedFilters.test__engagement__product);
    const requestedEngagementId = getEntityId(normalizedFilters.test__engagement);
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
    try {
        if (database.isEnabled()) {
            syncHistory = await database.createSyncHistory({
                syncType: 'Sync All',
                productId: requestedProductId,
                engagementId: requestedEngagementId,
                filters: normalizedFilters,
                triggeredBy: req.user?.username || '',
                triggeredRole: req.user?.role || ''
            });
        }
        const localBaseUrl = `http://127.0.0.1:${PORT}`;
        const pullData = await runDefectDojoPull({
            url: defectDojoUrl,
            apiKey: defectDojoApiKey,
            filters: normalizedFilters,
            user: req.user,
            syncHistoryId: syncHistory?.id || null,
            finishHistory: false,
            broadcastEvent: false,
            includeFindings: shouldSplitSyncHistory
        });
        const baseUrl = redmineUrl.replace(/\/$/, '');
        const statusIds = await resolveRedmineStatusIds({
            baseUrl,
            apiKey: redmineApiKey,
            config
        });
        let ticketRefs = await loadBackendRedmineCheckTicketRefs();
        ticketRefs = mergeStoredRedmineSyncTicketRefs(ticketRefs, {
            productId: requestedProductId,
            engagementId: requestedEngagementId
        });
        ticketRefs = ticketRefs.filter(ticket => {
            if (requestedProductId && ticket.route?.projectId !== requestedProductId) return false;
            if (requestedEngagementId && ticket.route?.engagementId !== requestedEngagementId) return false;
            return true;
        });
        const ticketRefByKey = new Map(ticketRefs.map(ticket => [ticket.ticketKey, ticket]));
        const {results, stats} = await checkRedmineTicketRefsForDashboard({
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
        let createdOrUpdated = 0;
        let priorityUpdated = 0;
        const createdOrUpdatedTicketKeys = new Set();
        const priorityUpdatedTicketKeys = new Set();
        const statusByTicketKey = new Map(results.map(result => [result.ticketKey, result]));
        const ticketsToUpdatePriority = ticketRefs.filter(ticket => {
            const status = statusByTicketKey.get(ticket.ticketKey);
            const priorityId = getRedminePriorityIdForSeverity(ticket.severity || '', config);
            return status?.action === 'existing_open' && status.issueId && priorityId && getRedmineIssuePriorityId(status.issue) !== priorityId;
        });
        const ticketsToCreate = ticketRefs.filter(ticket => statusByTicketKey.get(ticket.ticketKey)?.action === 'not_found');
        await runWithConcurrency(ticketsToUpdatePriority, REDMINE_CHECK_CONCURRENCY, async ticket => {
            const status = statusByTicketKey.get(ticket.ticketKey);
            const priorityId = getRedminePriorityIdForSeverity(ticket.severity || '', config);
            try {
                const changed = await updateOpenRedmineIssuePriorityIfNeeded({
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
            onProgress: createProgressLogger('Sync All Redmine ticket priorities updated', ticketsToUpdatePriority.length, 'SYNC_ALL')
        });
        await runWithConcurrency(ticketsToCreate, REDMINE_CHECK_CONCURRENCY, async ticket => {
            const detailedTicket = ticketRefByKey.get(ticket.ticketKey) || ticket;
            const description = detailedTicket.superTicketMarkdown || buildAutoSuperTicketMarkdown({
                ...detailedTicket,
                defectDojoProjectId: detailedTicket.defectDojoProjectId || detailedTicket.route?.projectId || '',
                defectDojoProjectName: detailedTicket.defectDojoProjectName || detailedTicket.route?.projectName || '',
                defectDojoEngagementId: detailedTicket.defectDojoEngagementId || detailedTicket.route?.engagementId || '',
                defectDojoEngagementName: detailedTicket.defectDojoEngagementName || detailedTicket.route?.engagementName || ''
            });
            try {
                const severity = detailedTicket.severity || ticket.severity || '';
                await axios.post(`${localBaseUrl}/api/redmine/issues`, {
                    redmine: {
                        url: redmineUrl,
                        apiKey: redmineApiKey,
                        projectId: configuredProjectId,
                        trackerId,
                        priorityId: getRedminePriorityIdForSeverity(severity, config)
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
            onProgress: createProgressLogger('Sync All Redmine tickets created', ticketsToCreate.length, 'SYNC_ALL')
        });
        const recheckSourceRecords = ticketRefs.map(ticket => {
            const status = statusByTicketKey.get(ticket.ticketKey);
            if (!status?.issueId) return null;
            return {
                ...(redmineSyncStore.byTicket?.[ticket.syncKey || ticket.ticketKey] || {}),
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
        const recheck = await runMitigationRecheck({
            baseUrl,
            apiKey: redmineApiKey,
            syncHistoryId: syncHistory?.id || null,
            statusIds,
            defectDojoBaseUrl: defectDojoUrl,
            defectDojoApiKey,
            filters: normalizedFilters,
            recheckSourceRecords
        });
        warnings.push(...recheck.warnings);
        const finalStatus = errors.length > 0 ? 'partial' : 'success';
        let splitSyncHistories = [];
        if (syncHistory && database.isEnabled()) {
            syncHistory = await database.finishSyncHistory(syncHistory.id, {
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
                splitSyncHistories = await createSyncAllSplitHistoryRows({
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
        broadcastDashboardSync('sync-all-complete');
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
        if (syncHistory && database.isEnabled()) {
            try {
                syncHistory = await database.finishSyncHistory(syncHistory.id, {
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
app.post('/api/pull', requireAdmin, async (req, res) => {
    const {url, apiKey, filters} = req.body;
    if (!url || !apiKey) {
        return res.status(400).json({
            error: 'URL and API Key are required'
        });
    }
    try {
        const pullData = await runDefectDojoPull({
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
app.get('/api/findings', async (req, res) => {
    try {
        const findings = await loadFindingsForUser(req.user);
        res.json(findings);
    } catch (error) {
        console.error('Error reading findings:', error);
        res.status(error.status || 500).json({
            error: error.message || 'Failed to read findings'
        });
    }
});
app.post('/api/clear', requireAdmin, async (req, res) => {
    try {
        if (database.isEnabled()) {
            await database.clearAllData();
            await clearLocalScanFiles();
            await resetRedmineSyncStore();
            emptyFindingsCache();
            broadcastDashboardSync('scan-store-cleared');
            return res.json({
                message: 'Database scan, sync, ticket, and review data cleared'
            });
        }
        await clearLocalScanFiles();
        await resetRedmineSyncStore();
        emptyFindingsCache();
        broadcastDashboardSync('scan-store-cleared');
        res.json({
            message: 'Local scan and sync data cleared'
        });
    } catch (error) {
        console.error('Failed to clear local data:', error);
        res.status(500).json({
            error: 'Failed to clear local data'
        });
    }
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
            restartScanPathWatcher().catch(error => {
                console.warn(`Initial scan store watcher failed: ${error.message}`);
            });
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
