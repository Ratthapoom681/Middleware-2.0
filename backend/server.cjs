const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const database = require('./database.cjs');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..');
const CLIENT_DIST_DIR = process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : path.resolve(__dirname, '..', 'dist');
const SEVERITY_VALUES = ['Critical', 'High', 'Medium', 'Low', 'Info'];
const DASHBOARD_SYNC_HEARTBEAT_MS = 25000;
const REDMINE_SYNC_STORE_VERSION = 1;
const DEFECTDOJO_PULL_PAGE_LIMIT = 500;
const DEFECTDOJO_CONTEXT_CONCURRENCY = 5;
const DEFECTDOJO_ENDPOINT_CHUNK_CONCURRENCY = 5;
const DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT = Number.parseInt(process.env.DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT || '0', 10);
const REDMINE_CHECK_CONCURRENCY = 5;
const REDMINE_ISSUE_SEARCH_LIMIT = 100;
const REDMINE_ISSUE_SEARCH_MAX_PAGES = 5;
const CONFIG_BACKUP_KIND = 'defectdojo-viewer-config-backup';
const CONFIG_BACKUP_VERSION = 1;

app.use(cors());
app.use(express.json());

// --- AUTHENTICATION & USER MANAGEMENT ---
const usersPath = path.join(DATA_DIR, 'users.json');
let users = [];
const sessions = new Map(); // token -> user object

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
};

const verifyPassword = (password, hash, salt) => {
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
};

const readUsersFromDisk = () => {
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

    await fs.writeJson(usersPath, users, { spaces: 2 });
};

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);

    if (!user || !verifyPassword(password, user.hash, user.salt)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username: user.username, role: user.role, products: user.products });

    res.json({ token, user: { username: user.username, role: user.role, products: user.products } });
});

app.post('/api/logout', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    sessions.delete(token);
    res.json({ message: 'Logged out' });
});

app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        storage: database.isEnabled() ? 'postgresql' : 'json'
    });
});

const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = sessions.get(token);
    next();
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admins only' });
    }
    next();
};

// Protect all API routes below this
app.use('/api', requireAuth);

// User Management Routes (Admin only)
app.get('/api/users', requireAdmin, (req, res) => {
    res.json(users.map(u => ({ username: u.username, role: u.role, products: u.products })));
});

app.post('/api/users', requireAdmin, async (req, res) => {
    const { username, password, role, products } = req.body;

    if (!username || !role) {
        return res.status(400).json({ error: 'Username and role are required' });
    }

    const existingIndex = users.findIndex(u => u.username === username);

    if (existingIndex >= 0) {
        // Update user
        users[existingIndex].role = role;
        users[existingIndex].products = Array.isArray(products) ? products : [];
        if (password) {
            const { salt, hash } = hashPassword(password);
            users[existingIndex].salt = salt;
            users[existingIndex].hash = hash;
        }
    } else {
        // Create user
        if (!password) return res.status(400).json({ error: 'Password is required for new users' });
        const { salt, hash } = hashPassword(password);
        users.push({
            username,
            salt,
            hash,
            role,
            products: Array.isArray(products) ? products : []
        });
    }

    await saveUsers();

    // Update active sessions for this user
    for (const [token, session] of sessions.entries()) {
        if (session.username === username) {
            sessions.set(token, { username, role, products: Array.isArray(products) ? products : [] });
        }
    }

    res.json({ message: 'User saved successfully' });
});

app.delete('/api/users/:username', requireAdmin, async (req, res) => {
    const { username } = req.params;
    if (username === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin user' });
    }
    if (req.user.username === username) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    users = users.filter(u => u.username !== username);
    await saveUsers();

    // Invalidate sessions
    for (const [token, session] of sessions.entries()) {
        if (session.username === username) sessions.delete(token);
    }

    res.json({ message: 'User deleted' });
});

// --- LIVE LOG CAPTURE ---
let globalLogs = [];
const MAX_LOGS = 500;
const addLog = (level, msg) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    globalLogs.push({ id: Date.now() + Math.random(), time: timestamp, level, text: msg });
    if (globalLogs.length > MAX_LOGS) globalLogs.shift();
};

const originalLog = console.log;
console.log = (...args) => {
    addLog('info', args.join(' '));
    originalLog(...args);
};
const originalWarn = console.warn;
console.warn = (...args) => {
    addLog('warn', args.join(' '));
    originalWarn(...args);
};
const originalError = console.error;
console.error = (...args) => {
    addLog('error', args.join(' '));
    originalError(...args);
};

// --- DASHBOARD LIVE SYNC ---
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

const normalizeSeverityFilter = (severity) => {
    const values = Array.isArray(severity)
        ? severity
        : String(severity || '').split(',');

    return Array.from(new Set(values
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .map(item => SEVERITY_VALUES.find(sev => sev.toLowerCase() === item.toLowerCase()))
        .filter(Boolean)));
};

const normalizePullFilters = (filters = {}) => ({
    ...filters,
    severity: normalizeSeverityFilter(filters.severity)
});

const splitDelimitedFilterValue = (value) => {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(/[,\r\n;]+/);

    return Array.from(new Set(values
        .map(item => String(item || '').trim())
        .filter(Boolean)));
};

const runWithConcurrency = async (items, concurrency, mapper, { onProgress } = {}) => {
    const list = Array.from(items || []);
    if (list.length === 0) return [];

    const workerCount = Math.max(1, Math.min(Number.parseInt(concurrency, 10) || 1, list.length));
    const results = new Array(list.length);
    let nextIndex = 0;
    let completed = 0;

    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < list.length) {
            const index = nextIndex;
            nextIndex += 1;

            try {
                results[index] = await mapper(list[index], index);
            } finally {
                completed += 1;
                if (onProgress) {
                    onProgress({ completed, total: list.length, item: list[index], index });
                }
            }
        }
    });

    await Promise.all(workers);
    return results;
};

const createProgressLogger = (label, total, prefix = 'PULL') => {
    const totalCount = Number.parseInt(total, 10) || 0;
    const interval = Math.max(1, Math.ceil(totalCount / 10));

    return ({ completed }) => {
        if (totalCount === 0) return;
        if (completed === 1 || completed === totalCount || completed % interval === 0) {
            console.log(`[${prefix}] ${label}: ${completed}/${totalCount}`);
        }
    };
};

const CONFIG_FIELDS = [
    'scanPath',
    'defectDojoUrl',
    'defectDojoApiKey',
    'redmineUrl',
    'redmineApiKey',
    'redmineProjectId',
    'redmineTrackerId',
    'redminePriorityId',
    'redminePriorityCriticalId',
    'redminePriorityHighId',
    'redminePriorityMediumId',
    'redminePriorityLowId',
    'redminePriorityInfoId',
    'redmineStatusPollIntervalSeconds',
    'pullFilters'
];

const buildFindingFilterQuery = (filters = {}, severity = '') => {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
        if (key === 'severity') return;

        if (Array.isArray(value)) {
            value
                .filter(item => item !== undefined && item !== '')
                .forEach(item => params.append(key, item));
            return;
        }

        if (value !== undefined && value !== '') {
            params.append(key, value);
        }
    });

    if (severity) params.append('severity', severity);

    const query = params.toString();
    return query ? `&${query}` : '';
};

const getFindingKey = (finding) => {
    if (finding.id !== undefined && finding.id !== null) return `id:${finding.id}`;
    if (finding.unique_id_from_tool) return `tool:${finding.unique_id_from_tool}`;
    return `fallback:${finding.title || ''}|${finding.severity || ''}|${finding.date || ''}`;
};

const getEntityId = (value) => {
    if (value && typeof value === 'object') {
        return cleanRouteValue(value.id || value.pk || value.value);
    }

    const cleaned = cleanRouteValue(value);
    const urlIdMatch = cleaned.match(/\/(\d+)\/?$/);
    if (urlIdMatch) return urlIdMatch[1];
    return cleaned && /^\d+$/.test(cleaned) ? cleaned : '';
};

const withPullProductContext = (finding, productId) => {
    const scopedProductId = cleanRouteValue(productId);
    if (!scopedProductId || !finding || typeof finding !== 'object') return finding;

    const existingProductId = getEntityId(finding.product_id || finding.product || finding.test__engagement__product);
    if (existingProductId) return finding;

    return {
        ...finding,
        product_id: scopedProductId,
        test__engagement__product: scopedProductId
    };
};

const getEntityName = (value) => {
    if (value && typeof value === 'object') {
        return cleanRouteValue(value.name || value.title);
    }

    const cleaned = cleanRouteValue(value);
    return cleaned && !/^\d+$/.test(cleaned) ? cleaned : '';
};

const fetchDefectDojoEntity = async ({ baseUrl, apiKey, resource, id }) => {
    const entityId = cleanRouteValue(id);
    if (!entityId) return null;

    try {
        const response = await axios.get(`${baseUrl}/api/v2/${resource}/${encodeURIComponent(entityId)}/`, {
            headers: {
                'Authorization': `Token ${apiKey}`,
                'Accept': 'application/json'
            }
        });
        return response.data || null;
    } catch (error) {
        console.warn(`[WARN] Could not resolve DefectDojo ${resource.slice(0, -1)} ${entityId}: ${error.message}`);
        return null;
    }
};

const enrichFindingsWithDefectDojoContext = async ({ baseUrl, apiKey, findings, filters = {} }) => {
    const testIds = new Set();
    const engagementIds = new Set();
    const productIds = new Set();

    const filterEngagementId = getEntityId(filters.test__engagement);
    const filterProductIds = splitDelimitedFilterValue(filters.test__engagement__product)
        .map(getEntityId)
        .filter(Boolean);
    const fallbackFilterProductId = filterProductIds.length === 1 ? filterProductIds[0] : '';
    if (filterEngagementId) engagementIds.add(filterEngagementId);
    filterProductIds.forEach(productId => productIds.add(productId));

    findings.forEach(finding => {
        const testId = getEntityId(finding.test || finding.test_id);
        const engagementId = getEntityId(finding.engagement || finding.engagement_id || finding.test__engagement);
        const productId = getEntityId(finding.product || finding.product_id || finding.test__engagement__product);

        if (testId) testIds.add(testId);
        if (engagementId) engagementIds.add(engagementId);
        if (productId) productIds.add(productId);
    });

    const tests = new Map();
    const engagements = new Map();
    const products = new Map();

    const testIdList = Array.from(testIds);
    if (testIdList.length > 0) {
        console.log(`[PULL] Resolving DefectDojo context: ${testIdList.length} tests (concurrency ${DEFECTDOJO_CONTEXT_CONCURRENCY})`);
    }

    await runWithConcurrency(testIdList, DEFECTDOJO_CONTEXT_CONCURRENCY, async (testId) => {
        const test = await fetchDefectDojoEntity({ baseUrl, apiKey, resource: 'tests', id: testId });
        if (!test) return;
        tests.set(testId, test);

        const engagementId = getEntityId(test.engagement || test.engagement_id);
        const productId = getEntityId(test.product || test.product_id);
        if (engagementId) engagementIds.add(engagementId);
        if (productId) productIds.add(productId);
    }, { onProgress: createProgressLogger('Tests resolved', testIdList.length) });

    const engagementIdList = Array.from(engagementIds);
    if (engagementIdList.length > 0) {
        console.log(`[PULL] Resolving DefectDojo context: ${engagementIdList.length} engagements (concurrency ${DEFECTDOJO_CONTEXT_CONCURRENCY})`);
    }

    await runWithConcurrency(engagementIdList, DEFECTDOJO_CONTEXT_CONCURRENCY, async (engagementId) => {
        const engagement = await fetchDefectDojoEntity({ baseUrl, apiKey, resource: 'engagements', id: engagementId });
        if (!engagement) return;
        engagements.set(engagementId, engagement);

        const productId = getEntityId(engagement.product || engagement.product_id);
        if (productId) productIds.add(productId);
    }, { onProgress: createProgressLogger('Engagements resolved', engagementIdList.length) });

    const productIdList = Array.from(productIds);
    if (productIdList.length > 0) {
        console.log(`[PULL] Resolving DefectDojo context: ${productIdList.length} products (concurrency ${DEFECTDOJO_CONTEXT_CONCURRENCY})`);
    }

    await runWithConcurrency(productIdList, DEFECTDOJO_CONTEXT_CONCURRENCY, async (productId) => {
        const product = await fetchDefectDojoEntity({ baseUrl, apiKey, resource: 'products', id: productId });
        if (product) products.set(productId, product);
    }, { onProgress: createProgressLogger('Products resolved', productIdList.length) });

    findings.forEach(finding => {
        const testId = getEntityId(finding.test || finding.test_id);
        const test = tests.get(testId) || (finding.test && typeof finding.test === 'object' ? finding.test : {});
        const engagementId = getEntityId(finding.engagement || finding.engagement_id || test.engagement || test.engagement_id) || filterEngagementId;
        const engagement = engagements.get(engagementId) || (finding.engagement && typeof finding.engagement === 'object' ? finding.engagement : {});
        const productId = getEntityId(finding.product || finding.product_id || engagement.product || engagement.product_id || test.product || test.product_id) || fallbackFilterProductId;
        const product = products.get(productId) || (finding.product && typeof finding.product === 'object' ? finding.product : {});
        const engagementName = getEntityName(finding.engagement_name || engagement.name || test.engagement);
        const productName = getEntityName(finding.product_name || product.name || engagement.product || test.product);

        if (testId) finding.defectdojo_test_id = testId;
        if (engagementId) finding.engagement_id = engagementId;
        if (engagementName) finding.engagement_name = engagementName;
        if (productId) finding.product_id = productId;
        if (productName) finding.product_name = productName;

        finding.defectdojo_route = {
            projectId: productId || '',
            projectName: productName || '',
            engagementId: engagementId || '',
            engagementName: engagementName || ''
        };
    });
};

const getRedmineHeaders = (apiKey) => ({
    'X-Redmine-API-Key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
});

const getRedmineIssueUrl = (baseUrl, issue) => (
    issue?.id ? `${baseUrl}/issues/${issue.id}` : baseUrl
);

const appendSyncMetadata = (description, syncKey, findingIds = []) => {
    const metadata = [];
    if (syncKey) metadata.push(`DefectDojo Sync Key: ${syncKey}`);
    if (findingIds.length > 0) metadata.push(`DefectDojo Finding IDs: ${findingIds.join(', ')}`);
    if (metadata.length === 0) return description;
    return `${description}\n\n---\n${metadata.join('\n')}`;
};

const cleanRouteValue = (value) => String(value || '').trim();

const REDMINE_PRIORITY_FIELD_BY_SEVERITY = {
    Critical: 'redminePriorityCriticalId',
    High: 'redminePriorityHighId',
    Medium: 'redminePriorityMediumId',
    Low: 'redminePriorityLowId',
    Info: 'redminePriorityInfoId',
    Informational: 'redminePriorityInfoId',
    None: 'redminePriorityInfoId'
};

const getRedminePriorityIdForSeverity = (severity) => {
    const severityText = cleanRouteValue(severity);
    const field = REDMINE_PRIORITY_FIELD_BY_SEVERITY[severityText];
    if (field && config[field]) return cleanRouteValue(config[field]);

    return severityText ? '' : cleanRouteValue(config.redminePriorityId);
};

const normalizeProjectToken = (value) => (
    cleanRouteValue(value)
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
);

const redmineProjectMatches = (project, candidate) => {
    const rawCandidate = cleanRouteValue(candidate);
    const normalizedCandidate = normalizeProjectToken(candidate);
    if (!rawCandidate) return false;

    const values = [
        project?.identifier,
        project?.name
    ].map(value => cleanRouteValue(value)).filter(Boolean);

    return values.some(value => (
        value === rawCandidate
        || value.toLowerCase() === rawCandidate.toLowerCase()
        || normalizeProjectToken(value) === normalizedCandidate
    ));
};

const getProjectIssueValue = (project) => cleanRouteValue(project?.identifier);

const isRedmineNotFoundError = (error) => error.response?.status === 404;

const isRedmineProjectReferenceError = (error) => {
    const status = error.response?.status;
    const details = error.response?.data || error.message || '';
    const detailText = typeof details === 'string'
        ? details
        : JSON.stringify(details);

    return isRedmineNotFoundError(error)
        || ([400, 422].includes(status) && /project/i.test(detailText));
};

const getMissingRedmineProjectLabel = ({ configuredProjectId = '', route = {}, fallback = '' } = {}) => (
    cleanRouteValue(configuredProjectId)
    || cleanRouteValue(route.projectName)
    || cleanRouteValue(route.projectIdentifier)
    || cleanRouteValue(route.projectId)
    || cleanRouteValue(fallback)
);

const buildMissingRedmineProject = ({ configuredProjectId = '', route = {}, fallback = '' } = {}) => {
    const label = getMissingRedmineProjectLabel({ configuredProjectId, route, fallback });
    return {
        id: '',
        identifier: cleanRouteValue(configuredProjectId),
        name: label,
        source: 'missing_project',
        project: {
            identifier: cleanRouteValue(configuredProjectId),
            name: label
        },
        route
    };
};

const buildRedmineProjectMissingStatus = ({ ticket = {}, configuredProjectId = '', route = ticket.route || {}, fallback = '', status = 'Project not found' } = {}) => ({
    ticketKey: ticket.ticketKey,
    action: 'not_found',
    status,
    projectMissing: true,
    resolvedProject: buildMissingRedmineProject({ configuredProjectId, route, fallback })
});

const makeRedmineProjectIdentifier = (value) => {
    const source = cleanRouteValue(value);
    const identifier = source
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 100);

    if (identifier) return identifier;

    const hash = crypto
        .createHash('sha1')
        .update(source || 'defectdojo-project')
        .digest('hex')
        .slice(0, 12);
    return `defectdojo-${hash}`;
};

const getRouteCandidates = (route = {}) => {
    const projectId = cleanRouteValue(route.projectId);
    const nonNumericProjectId = /^\d+$/.test(projectId) ? '' : projectId;
    const identifierSource = cleanRouteValue(route.projectIdentifier)
        || cleanRouteValue(route.projectName)
        || nonNumericProjectId;
    return Array.from(new Set([
        cleanRouteValue(route.projectIdentifier),
        cleanRouteValue(route.projectName),
        nonNumericProjectId,
        identifierSource ? makeRedmineProjectIdentifier(identifierSource) : '',
    ].filter(Boolean)));
};

const getRouteProjectName = (route = {}, candidates = []) => {
    const projectName = cleanRouteValue(route.projectName);
    if (projectName) return projectName;

    const namedCandidate = candidates.find(candidate => candidate && !/^\d+$/.test(candidate));
    if (namedCandidate) return namedCandidate;

    const productId = cleanRouteValue(route.projectId);
    if (productId) return `DefectDojo Project ${productId}`;

    return 'DefectDojo Project';
};

const isRedmineProjectDuplicateError = (error) => {
    const status = error.response?.status;
    const details = error.response?.data || error.message || '';
    const detailText = typeof details === 'string'
        ? details
        : JSON.stringify(details);

    return status === 409
        || (status === 422 && /(already|duplicate|exist|taken|identifier|name)/i.test(detailText));
};

const createRedmineProject = async ({ baseUrl, apiKey, route, identifierOverride = '', candidates = [] }) => {
    const projectName = getRouteProjectName(route, candidates);
    const identifierSource = cleanRouteValue(identifierOverride)
        || cleanRouteValue(route.projectIdentifier)
        || cleanRouteValue(route.projectName)
        || cleanRouteValue(route.projectId)
        || projectName;
    const identifier = makeRedmineProjectIdentifier(identifierSource);
    const projectPayload = {
        name: projectName,
        identifier,
        description: 'Created automatically from middleware.'
    };

    console.log(`[ROUTE] Creating Redmine project "${projectName}" (${identifier})`);
    let response;
    try {
        response = await axios.post(`${baseUrl}/projects.json`, { project: projectPayload }, {
            headers: getRedmineHeaders(apiKey)
        });
    } catch (error) {
        if (isRedmineProjectDuplicateError(error)) {
            const retryCandidates = Array.from(new Set([
                identifier,
                projectName,
                ...candidates
            ].filter(Boolean)));
            console.warn(`[ROUTE] Redmine project create reported a duplicate; re-checking candidates: ${retryCandidates.join(', ')}`);
            const existingProject = await findRedmineProjectByCandidates({ baseUrl, apiKey, candidates: retryCandidates });
            if (existingProject) return existingProject;
        }

        throw error;
    }

    return response.data.project || {
        name: projectName,
        identifier
    };
};

const fetchRedmineProjectDirect = async ({ baseUrl, apiKey, candidate }) => {
    if (/^\d+$/.test(candidate)) return null;

    try {
        const response = await axios.get(`${baseUrl}/projects/${encodeURIComponent(candidate)}.json`, {
            headers: getRedmineHeaders(apiKey)
        });
        return response.data.project || null;
    } catch (error) {
        if (isRedmineNotFoundError(error)) return null;
        throw error;
    }
};

const findRedmineProjectByCandidates = async ({ baseUrl, apiKey, candidates }) => {
    console.log(`[ROUTE] Searching Redmine for project matching candidates: ${candidates.join(', ')}`);

    // Step 1: Try direct identifier lookup
    for (const candidate of candidates) {
        const directProject = await fetchRedmineProjectDirect({ baseUrl, apiKey, candidate });
        if (directProject) {
            console.log(`[ROUTE] Found Redmine project by identifier: "${directProject.name}" (${directProject.identifier})`);
            return directProject;
        }
    }

    // Step 2: Search by name using Redmine's search query
    for (const candidate of candidates) {
        try {
            const searchParams = new URLSearchParams({ limit: '100' });
            const searchUrl = `${baseUrl}/projects.json?${searchParams.toString()}`;
            console.log(`[ROUTE] Searching Redmine projects list for name match: "${candidate}"`);
            const response = await axios.get(searchUrl, {
                headers: getRedmineHeaders(apiKey)
            });

            const projects = response.data.projects || [];
            const exactMatch = projects.find(project => redmineProjectMatches(project, candidate));
            if (exactMatch) {
                console.log(`[ROUTE] Found Redmine project by name search: "${exactMatch.name}" (${exactMatch.identifier})`);
                return exactMatch;
            }
        } catch (searchError) {
            console.warn(`[ROUTE] Name search failed for "${candidate}": ${searchError.message}`);
        }
    }

    // Step 3: Brute-force pagination (fallback for large Redmine instances)
    console.log(`[ROUTE] Direct and search lookup failed; falling back to paginated project scan`);
    const limit = 100;
    const maxPages = 10;

    for (let page = 0; page < maxPages; page += 1) {
        const params = new URLSearchParams({
            limit: String(limit),
            offset: String(page * limit)
        });

        const response = await axios.get(`${baseUrl}/projects.json?${params.toString()}`, {
            headers: getRedmineHeaders(apiKey)
        });

        const projects = response.data.projects || [];
        const match = projects.find(project => candidates.some(candidate => redmineProjectMatches(project, candidate)));
        if (match) {
            console.log(`[ROUTE] Found Redmine project by pagination scan: "${match.name}" (${match.identifier})`);
            return match;
        }
        if (projects.length < limit) break;
    }

    console.warn(`[ROUTE] No Redmine project matched any candidate: ${candidates.join(', ')}`);
    return null;
};

const resolveRedmineProject = async ({ baseUrl, apiKey, configuredProjectId, route, allowCreate = true }) => {
    const override = cleanRouteValue(configuredProjectId);
    if (override) {
        if (/^\d+$/.test(override)) {
            const error = new Error('Use the Redmine project identifier, not the numeric Redmine project id.');
            error.status = 400;
            throw error;
        }

        const existingProject = await fetchRedmineProjectDirect({ baseUrl, apiKey, candidate: override });
        if (existingProject) {
            console.log(`[ROUTE] Using configured Redmine project override: "${override}"`);
            return {
                id: getProjectIssueValue(existingProject),
                identifier: getProjectIssueValue(existingProject),
                name: existingProject.name,
                source: 'configured_override',
                project: existingProject,
                route
            };
        }

        if (!allowCreate) {
            console.log(`[ROUTE] Configured Redmine project override "${override}" does not exist`);
            return null;
        }

        console.log(`[ROUTE] Configured Redmine project override "${override}" does not exist; creating it`);
        const createdProject = await createRedmineProject({
            baseUrl,
            apiKey,
            route,
            identifierOverride: override,
            candidates: [override]
        });

        return {
            id: getProjectIssueValue(createdProject) || override,
            identifier: getProjectIssueValue(createdProject) || override,
            name: createdProject.name,
            source: 'created_from_override',
            project: createdProject,
            route
        };
    }

    const candidates = getRouteCandidates(route);
    console.log(`[ROUTE] Auto-routing: No Redmine project override configured. DefectDojo route candidates: ${candidates.length > 0 ? candidates.join(', ') : '(none)'}`);

    if (candidates.length === 0) {
        if (!allowCreate) return null;

        const error = new Error('Redmine Project Identifier override is empty and the compacted ticket has no DefectDojo product name to auto-route.');
        error.status = 400;
        throw error;
    }

    const project = await findRedmineProjectByCandidates({ baseUrl, apiKey, candidates });
    if (!project) {
        if (!allowCreate) return null;

        console.log(`[ROUTE] No Redmine project matched; creating project for DefectDojo route`);
        const createdProject = await createRedmineProject({
            baseUrl,
            apiKey,
            route,
            candidates
        });
        const createdIdentifier = getProjectIssueValue(createdProject);
        if (!createdIdentifier) {
            const error = new Error(`Created Redmine project "${createdProject.name || candidates[0]}", but it has no project identifier.`);
            error.status = 400;
            throw error;
        }

        return {
            id: createdIdentifier,
            identifier: createdIdentifier,
            name: createdProject.name,
            source: 'created_from_defectdojo_product',
            project: createdProject,
            route
        };
    }

    const identifier = getProjectIssueValue(project);
    if (!identifier) {
        const error = new Error(`Matched Redmine project "${project.name || project.id}", but it has no project identifier.`);
        error.status = 400;
        throw error;
    }

    console.log(`[ROUTE] Auto-routed to Redmine project: "${project.name}" (identifier: ${identifier})`);
    return {
        id: identifier,
        identifier,
        name: project.name,
        source: 'defectdojo_product',
        project,
        route
    };
};

const getRedmineProjectCacheKey = ({ baseUrl, configuredProjectId, route = {} }) => {
    const baseKey = cleanRouteValue(baseUrl).replace(/\/+$/, '').toLowerCase();
    const override = cleanRouteValue(configuredProjectId);
    if (override) return `${baseKey}|override:${override.toLowerCase()}`;

    const candidates = getRouteCandidates(route)
        .map(candidate => normalizeProjectToken(candidate))
        .filter(Boolean)
        .sort();

    return `${baseKey}|route:${candidates.join('|')}`;
};

const resolveRedmineProjectCached = async ({
    cache,
    baseUrl,
    apiKey,
    configuredProjectId,
    route,
    allowCreate = true,
    retain = true
}) => {
    const cacheKey = getRedmineProjectCacheKey({ baseUrl, configuredProjectId, route });
    if (!cache.has(cacheKey)) {
        const projectPromise = resolveRedmineProject({
            baseUrl,
            apiKey,
            configuredProjectId,
            route,
            allowCreate
        }).catch(error => {
            cache.delete(cacheKey);
            throw error;
        }).finally(() => {
            if (!retain) cache.delete(cacheKey);
        });

        cache.set(cacheKey, projectPromise);
    }

    return cache.get(cacheKey);
};

const normalizeFindingIds = (findingIds = []) => (
    Array.from(new Set(findingIds
        .map(id => Number.parseInt(id, 10))
        .filter(id => Number.isInteger(id) && id > 0)))
);

const extractRedmineIssueFindingIds = (issue = {}) => {
    const description = String(issue.description || '');
    const match = description.match(/DefectDojo Finding IDs:\s*([^\r\n]+)/i);
    if (!match) return [];

    return normalizeFindingIds(match[1].split(/[\s,]+/));
};

const extractRedmineIssueSyncKey = (issue = {}) => {
    const description = String(issue.description || '');
    const match = description.match(/DefectDojo Sync Key:\s*([^\r\n]+)/i);
    return match ? cleanRouteValue(match[1]) : '';
};

const redmineIssueMatchesSyncKey = (issue = {}, syncKey = '') => {
    const expectedSyncKey = cleanRouteValue(syncKey);
    if (!expectedSyncKey) return false;

    return extractRedmineIssueSyncKey(issue) === expectedSyncKey;
};

const compareFindingIdsWithRedmineIssue = (currentFindingIds = [], issue = {}) => {
    const currentIds = normalizeFindingIds(currentFindingIds);
    const issueIds = extractRedmineIssueFindingIds(issue);
    const issueIdSet = new Set(issueIds);
    const newFindingIds = currentIds.filter(id => !issueIdSet.has(id));

    return {
        currentIds,
        issueIds,
        newFindingIds,
        hasNewFindingIds: currentIds.length > 0 && (issueIds.length === 0 || newFindingIds.length > 0)
    };
};

const findIssueInList = (issues = [], { subject, syncKey }) => {
    const syncKeyMatch = issues.find(issue => redmineIssueMatchesSyncKey(issue, syncKey));
    if (syncKeyMatch) return syncKeyMatch;

    return issues.find(issue => issue.subject === subject) || null;
};

const fetchRedmineIssuesForProjectStatus = async ({ baseUrl, apiKey, projectId, trackerId, statusId }) => {
    const allIssues = [];

    for (let page = 0; page < REDMINE_ISSUE_SEARCH_MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
            project_id: projectId,
            status_id: statusId,
            limit: String(REDMINE_ISSUE_SEARCH_LIMIT),
            offset: String(page * REDMINE_ISSUE_SEARCH_LIMIT),
            sort: 'updated_on:desc'
        });

        if (trackerId) params.append('tracker_id', trackerId);

        const response = await axios.get(`${baseUrl}/issues.json?${params.toString()}`, {
            headers: getRedmineHeaders(apiKey)
        });

        const issues = response.data.issues || [];
        allIssues.push(...issues);

        if (issues.length < REDMINE_ISSUE_SEARCH_LIMIT) break;
    }

    return allIssues;
};

const findMatchingRedmineIssue = async ({ baseUrl, apiKey, projectId, trackerId, subject, syncKey, statusId }) => {
    const issues = await fetchRedmineIssuesForProjectStatus({ baseUrl, apiKey, projectId, trackerId, statusId });
    return findIssueInList(issues, { subject, syncKey });
};

const updateRedmineIssue = async ({ baseUrl, apiKey, issueId, issue }) => {
    await axios.put(`${baseUrl}/issues/${issueId}.json`, { issue }, {
        headers: getRedmineHeaders(apiKey)
    });
};

const getStatusNameIsClosed = (statusName = '') => (
    /^(closed|resolved|done|rejected)$/i.test(cleanRouteValue(statusName))
);

const fetchRedmineIssueStatusMap = async ({ baseUrl, apiKey }) => {
    try {
        const response = await axios.get(`${baseUrl}/issue_statuses.json`, {
            headers: getRedmineHeaders(apiKey)
        });

        return new Map((response.data.issue_statuses || []).map(status => [
            String(status.id),
            Boolean(status.is_closed)
        ]));
    } catch (error) {
        console.warn(`[WARN] Could not fetch Redmine issue status metadata: ${error.message}`);
        return new Map();
    }
};

const fetchRedmineIssueStatus = async ({ baseUrl, apiKey, issueId, statusMap }) => {
    const response = await axios.get(`${baseUrl}/issues/${issueId}.json`, {
        headers: getRedmineHeaders(apiKey)
    });
    const issue = response.data.issue;
    const statusId = issue?.status?.id !== undefined ? String(issue.status.id) : '';
    const statusName = issue?.status?.name || '';
    const isClosed = statusMap.has(statusId)
        ? statusMap.get(statusId)
        : getStatusNameIsClosed(statusName);

    return {
        action: isClosed ? 'existing_closed' : 'existing_open',
        issue,
        issueId: issue?.id || issueId,
        issueUrl: getRedmineIssueUrl(baseUrl, issue),
        isClosed,
        status: statusName,
        statusId
    };
};

const getKnownRedmineIssueId = (ticket = {}) => {
    const explicitIssueId = Number.parseInt(ticket.issueId, 10);
    if (Number.isInteger(explicitIssueId) && explicitIssueId > 0) return explicitIssueId;

    const ticketKeys = [
        ticket.syncKey,
        ticket.ticketKey
    ].map(key => cleanRouteValue(key)).filter(Boolean);

    for (const ticketKey of ticketKeys) {
        const storedIssueId = Number.parseInt(redmineSyncStore.byTicket[ticketKey]?.issueId, 10);
        if (Number.isInteger(storedIssueId) && storedIssueId > 0) return storedIssueId;
    }

    return null;
};

const getIssueResolvedProject = (issue = {}, fallbackProject = null) => {
    if (fallbackProject) return fallbackProject;
    const issueProject = issue.project || {};
    const projectValue = getProjectIssueValue(issueProject) || issueProject.identifier || issueProject.id || '';

    return {
        id: projectValue,
        identifier: projectValue,
        name: issueProject.name || '',
        source: 'issue_project',
        project: issueProject
    };
};

const buildTicketStatusFromIssue = ({ ticket, issueStatus, baseUrl, resolvedProject }) => {
    const issue = issueStatus.issue || issueStatus;
    const action = issueStatus.isClosed ? 'existing_closed' : 'existing_open';
    const baseResult = {
        ticketKey: ticket.ticketKey,
        action,
        issue,
        issueId: issueStatus.issueId || issue?.id,
        status: issueStatus.status || issue?.status?.name || (issueStatus.isClosed ? 'closed' : 'open'),
        issueUrl: issueStatus.issueUrl || getRedmineIssueUrl(baseUrl, issue),
        resolvedProject: getIssueResolvedProject(issue, resolvedProject),
        isClosed: Boolean(issueStatus.isClosed)
    };

    if (issueStatus.isClosed) {
        return {
            ...baseResult,
            action: 'existing_closed'
        };
    }

    return baseResult;
};

// Default configuration
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

// Load config from disk if exists
const configPath = path.join(DATA_DIR, 'config.json');
const configBackupDir = path.join(DATA_DIR, 'config-backups');
const redmineSyncStorePath = path.join(DATA_DIR, 'sync-state.json');

let redmineSyncStore = {
    version: REDMINE_SYNC_STORE_VERSION,
    byTicket: {},
    byFindingId: {}
};
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

const getStoredSyncProjectName = (record = {}) => (
    record.resolvedProject?.project?.name
    || record.resolvedProject?.name
    || record.resolvedProject?.identifier
    || record.resolvedProject?.id
    || record.projectName
    || ''
);

const buildStoredRedmineSyncRecord = ({
    action,
    issue = {},
    issueId,
    issueUrl,
    isClosed,
    status,
    resolvedProject,
    projectMissing = false,
    findingIds = [],
    lastCheckError = ''
}) => ({
    action: action || 'unknown',
    issueId: issueId || issue?.id,
    status: status || issue?.status?.name || '',
    issueUrl: issueUrl || '',
    isClosed: action === 'existing_closed' || Boolean(isClosed),
    projectName: getStoredSyncProjectName({ resolvedProject }),
    projectMissing: Boolean(projectMissing),
    findingIds: normalizeFindingIds(findingIds),
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
        const ticketRecords = Object.entries(diskStore.byTicket || {})
            .map(([syncKey, record]) => ({
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

const saveRedmineSyncStore = async () => {
    if (database.isEnabled()) {
        await database.saveRedmineSyncRecords(Object.values(redmineSyncStore.byTicket || {}));
        return;
    }

    await fs.writeJson(redmineSyncStorePath, redmineSyncStore, { spaces: 2 });
};

const comparableStoredSync = (record = {}) => JSON.stringify({
    action: record.action || '',
    issueId: record.issueId || '',
    status: record.status || '',
    issueUrl: record.issueUrl || '',
    isClosed: Boolean(record.isClosed),
    projectName: record.projectName || '',
    projectMissing: Boolean(record.projectMissing),
    lastCheckError: record.lastCheckError || ''
});

const rebuildRedmineSyncFindingIndex = () => {
    const byFindingId = {};
    Object.values(redmineSyncStore.byTicket || {}).forEach(record => {
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
    Object.entries(redmineSyncStore.byTicket || {}).forEach(([otherKey, otherRecord]) => {
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

const pruneStaleRedmineSyncRecords = (currentSyncKeys = new Set()) => {
    let prunedCount = 0;
    Object.keys(redmineSyncStore.byTicket || {}).forEach(ticketKey => {
        if (currentSyncKeys.has(ticketKey)) return;
        delete redmineSyncStore.byTicket[ticketKey];
        prunedCount += 1;
    });

    if (prunedCount > 0) rebuildRedmineSyncFindingIndex();
    return prunedCount;
};

const writeStoredRedmineSyncRecord = async (syncKey, record, { notify = true, save = true } = {}) => {
    const ticketKey = String(syncKey || '').trim();
    const findingIds = normalizeFindingIds(record.findingIds || []);
    const previousRecord = ticketKey ? redmineSyncStore.byTicket[ticketKey] : null;
    const storedRecord = {
        ...record,
        syncKey: ticketKey,
        findingIds
    };

    if (previousRecord?.findingIds) {
        normalizeFindingIds(previousRecord.findingIds)
            .filter(id => !findingIds.includes(id))
            .forEach(id => {
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

const scheduleScanPathBroadcast = (reason) => {
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
    if (!config.scanPath || !(await fs.pathExists(config.scanPath))) return;

    try {
        scanPathWatcher = fs.watch(config.scanPath, { persistent: false }, (_eventType, fileName) => {
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

const getBackupTimestamp = () => (
    new Date().toISOString().replace(/[:.]/g, '-')
);

const isPlainObject = (value) => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isSafeConfigBackupFileName = (value) => {
    const fileName = String(value || '');
    return Boolean(
        fileName
        && fileName.endsWith('.json')
        && path.basename(fileName) === fileName
        && !/["\r\n]/.test(fileName)
        && !fileName.includes('/')
        && !fileName.includes('\\')
    );
};

const extractConfigFromBackupPayload = (payload) => {
    if (!isPlainObject(payload)) return null;
    return isPlainObject(payload.config) ? payload.config : payload;
};

const createConfigBackupExport = ({ fileName, label = 'manual', sourceConfig = config, createdAt } = {}) => ({
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

const getBackupLabelFromFileName = (fileName) => {
    const match = String(fileName || '').match(/^config-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(.+)\.json$/i);
    return match?.[1] || 'imported';
};

const readLocalConfigBackupEntries = async () => {
    if (!(await fs.pathExists(configBackupDir))) return [];

    const files = await fs.readdir(configBackupDir);
    const entries = [];

    for (const fileName of files.filter(isSafeConfigBackupFileName)) {
        const filePath = path.join(configBackupDir, fileName);
        const stats = await fs.stat(filePath);
        entries.push({ fileName, filePath, stats });
    }

    return entries;
};

const normalizeConfigObject = (data = {}) => {
    const nextConfig = { ...config };

    CONFIG_FIELDS.forEach(field => {
        if (data[field] !== undefined) nextConfig[field] = data[field];
    });

    nextConfig.pullFilters = normalizePullFilters({
        ...config.pullFilters,
        ...(nextConfig.pullFilters || {})
    });

    if (nextConfig.scanPath && !path.isAbsolute(nextConfig.scanPath)) {
        nextConfig.scanPath = path.resolve(nextConfig.scanPath);
    }

    const pollInterval = Number.parseInt(nextConfig.redmineStatusPollIntervalSeconds, 10);
    nextConfig.redmineStatusPollIntervalSeconds = Number.isInteger(pollInterval) && pollInterval > 0
        ? Math.max(60, pollInterval)
        : pollInterval === 0 ? 0 : 60;

    return nextConfig;
};

const saveConfigToDisk = async () => {
    if (database.isEnabled()) {
        await database.saveConfig(config);
        return;
    }

    await fs.writeJson(configPath, config, { spaces: 2 });
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
    await fs.writeJson(filePath, sourceConfig, { spaces: 2 });
    return { fileName, filePath };
};

const listConfigBackups = async () => {
    if (database.isEnabled()) return database.listConfigBackups();

    const entries = await readLocalConfigBackupEntries();
    return entries
        .map(({ fileName, stats }) => ({
            fileName,
            size: stats.size,
            createdAt: stats.mtime.toISOString(),
            storage: 'json'
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

const readConfigBackup = async (fileName) => {
    if (!isSafeConfigBackupFileName(fileName)) return null;
    if (database.isEnabled()) return database.getConfigBackup(fileName);

    const backupPath = path.join(configBackupDir, fileName);
    if (!(await fs.pathExists(backupPath))) return null;
    return extractConfigFromBackupPayload(await fs.readJson(backupPath));
};

const importLocalConfigBackupsToPostgresIfEmpty = async () => {
    if (!database.isEnabled()) return;
    if ((await database.listConfigBackups()).length > 0) return;

    const entries = await readLocalConfigBackupEntries();
    if (entries.length === 0) return;

    let importedCount = 0;
    for (const { fileName, filePath, stats } of entries) {
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
    if (!(await fs.pathExists(config.scanPath))) {
        const error = new Error('Scan path does not exist');
        error.status = 404;
        throw error;
    }

    const files = await fs.readdir(config.scanPath);
    const jsonFiles = files
        .filter(file => file.toLowerCase().endsWith('.json'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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

    if (
        findingsCache.scanPath === config.scanPath
        && findingsCache.signature === snapshot.signature
    ) {
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

    const uniqueFindings = Array.from(new Map(
        allFindings.map(finding => [getFindingKey(finding), finding])
    ).values());

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

const mapFindingsForDatabase = (findings = []) => findings.map((finding, index) => ({
    findingKey: getFindingKey(finding),
    findingId: finding.id === undefined || finding.id === null ? null : String(finding.id),
    productName: finding.product_name || null,
    defectDojoProjectName: finding.defectDojoProjectName || null,
    sortIndex: index,
    data: finding
}));

const saveFindingsToStore = async (findings = []) => {
    if (database.isEnabled()) {
        await database.replaceFindings(mapFindingsForDatabase(findings));
        return { storage: 'postgresql' };
    }

    const fileName = 'defectdojo_api_data.json';
    const filePath = path.join(config.scanPath, fileName);

    await fs.ensureDir(config.scanPath);
    await fs.writeJson(filePath, { findings }, { spaces: 2 });
    return { storage: 'json', file: fileName };
};

const importFileFindingsToPostgresIfEmpty = async () => {
    if (!database.isEnabled()) return;
    if ((await database.countFindings()) > 0) return;

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
    return storedSync ? { ...finding, redmineSync: storedSync } : finding;
});

const getAllowedProductsForUser = (user = {}) => (
    Array.isArray(user.products)
        ? user.products.map(product => String(product || '').trim()).filter(Boolean)
        : []
);

const filterFindingsForUser = (findings, user) => {
    let filteredFindings = findings;

    if (user.role !== 'admin') {
        const allowedProducts = getAllowedProductsForUser(user);
        filteredFindings = findings.filter(finding =>
            allowedProducts.includes(finding.defectDojoProjectName || finding.product_name)
        );
    }

    return appendRedmineSyncToFindings(filteredFindings);
};

const loadFindingsForUser = async (user) => {
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

const AUTO_UPGRADE_TARGET_RE = /upgrade\s+to\s+(.+?)\s+(?:version\s+)?([0-9][0-9a-z.-]*)\s*(?:or\s+later)?\.?/i;
const AUTO_TITLE_VERSION_RE = /^(.+?)\s+.*?(?:<|version)\s+([0-9][0-9a-z.-]*)/i;
const AUTO_LESS_THAN_VERSION_RE = /<\s*([0-9][0-9a-z.-]*)/i;

const normalizeAutoText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeAutoGroupText = (value) => (
    normalizeAutoText(value)
        .toLowerCase()
        .replace(AUTO_UPGRADE_TARGET_RE, (_match, software) => `upgrade to ${normalizeAutoText(software).replace(/[.:;,-]+$/g, '').toLowerCase()} version <version> or later`)
        .replace(/\bversion\s+[0-9][0-9a-z.-]*/gi, 'version <version>')
);

const tokenizeAutoVersion = (value) => (
    String(value || '0')
        .split(/[._+-]/)
        .map(part => {
            const numeric = Number.parseInt(part, 10);
            return Number.isNaN(numeric) ? part.toLowerCase() : numeric;
        })
);

const compareAutoVersions = (a, b) => {
    const left = tokenizeAutoVersion(a);
    const right = tokenizeAutoVersion(b);
    const maxLength = Math.max(left.length, right.length);

    for (let i = 0; i < maxLength; i += 1) {
        const leftPart = left[i] ?? 0;
        const rightPart = right[i] ?? 0;
        if (typeof leftPart === 'number' && typeof rightPart === 'number') {
            if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
            continue;
        }

        const comparison = String(leftPart).localeCompare(String(rightPart), undefined, { numeric: true });
        if (comparison !== 0) return comparison;
    }

    return 0;
};

const parseAutoUpgradeText = (value) => {
    const match = normalizeAutoText(value).match(AUTO_UPGRADE_TARGET_RE);
    if (!match) return null;

    return {
        software: normalizeAutoText(match[1]).replace(/[.:;,-]+$/g, '').trim(),
        version: match[2].replace(/\.$/, '')
    };
};

const getAutoMitigationText = (finding) => normalizeAutoText(finding.mitigation || finding.solution || finding.remediation || '');

const parseAutoUpgradeTarget = (finding) => {
    const sources = [getAutoMitigationText(finding), finding.title, finding.name].filter(Boolean);
    for (const source of sources) {
        const target = parseAutoUpgradeText(source);
        if (target) return target;
    }

    const titleMatch = normalizeAutoText(finding.title || finding.name).match(AUTO_TITLE_VERSION_RE);
    if (!titleMatch) return null;

    return {
        software: normalizeAutoText(titleMatch[1]).replace(/[.:;,-]+$/g, '').trim(),
        version: titleMatch[2].replace(/\.$/, '')
    };
};

const getAutoCompactGroupKey = (finding) => {
    const target = parseAutoUpgradeTarget(finding);
    const mitigationText = getAutoMitigationText(finding);
    if (target) {
        const mitigationFamily = normalizeAutoGroupText(mitigationText || `Upgrade to ${target.software} version ${target.version} or later.`);
        return `upgrade|${target.software.toLowerCase()}|${mitigationFamily}`;
    }

    return `finding|${normalizeAutoGroupText(finding.title || finding.name)}|${normalizeAutoGroupText(mitigationText)}`;
};

const firstAutoRouteValue = (...values) => {
    for (const value of values) {
        if (value && typeof value === 'object') continue;
        const cleaned = normalizeAutoText(value);
        const urlIdMatch = cleaned.match(/\/(\d+)\/?$/);
        if (urlIdMatch) return urlIdMatch[1];
        if (cleaned) return cleaned;
    }
    return '';
};

const firstAutoRouteName = (...values) => {
    for (const value of values) {
        if (value && typeof value === 'object') continue;
        const cleaned = normalizeAutoText(value);
        if (cleaned && !/^\d+$/.test(cleaned)) return cleaned;
    }
    return '';
};

const getAutoDefectDojoRoute = (finding) => {
    const explicitRoute = finding.defectdojo_route && typeof finding.defectdojo_route === 'object' ? finding.defectdojo_route : {};
    const test = finding.test && typeof finding.test === 'object' ? finding.test : {};
    const engagement = finding.engagement && typeof finding.engagement === 'object'
        ? finding.engagement
        : (test.engagement && typeof test.engagement === 'object' ? test.engagement : {});
    const product = finding.product && typeof finding.product === 'object'
        ? finding.product
        : (engagement.product && typeof engagement.product === 'object' ? engagement.product : {});

    return {
        projectId: firstAutoRouteValue(finding.product_id, explicitRoute.projectId, finding.product, product.id, finding.test__engagement__product, engagement.product_id, test.product_id),
        projectName: firstAutoRouteName(finding.product_name, explicitRoute.projectName, product.name, finding.product, engagement.product_name, test.product_name),
        engagementId: firstAutoRouteValue(finding.engagement_id, explicitRoute.engagementId, finding.engagement, engagement.id, finding.test__engagement, test.engagement_id),
        engagementName: firstAutoRouteName(finding.engagement_name, explicitRoute.engagementName, engagement.name, finding.engagement, test.engagement_name)
    };
};

const stableAutoHash = (value) => {
    const text = String(value || '');
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const sortAutoStrings = (values) => Array.from(values).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

const sortAutoFindingIds = (ids = []) => (
    sortAutoStrings(new Set(ids.map(id => normalizeAutoText(id)).filter(Boolean)))
        .map(id => (/^\d+$/.test(id) ? Number.parseInt(id, 10) : id))
);

const buildAutoCompactedSyncKey = ({ groupKey, findingIds = [], productIds = [], engagementIds = [] }) => {
    const source = [
        `group:${groupKey}`,
        `findings:${sortAutoStrings(findingIds.map(id => normalizeAutoText(id)).filter(Boolean)).join(',')}`,
        `products:${sortAutoStrings(productIds.map(id => normalizeAutoText(id)).filter(Boolean)).join(',')}`,
        `engagements:${sortAutoStrings(engagementIds.map(id => normalizeAutoText(id)).filter(Boolean)).join(',')}`
    ].join('|');

    return `dd-compact-${stableAutoHash(source)}`;
};

const extractAutoTitleVersion = (title) => {
    const text = normalizeAutoText(title);
    const lessThanMatch = text.match(AUTO_LESS_THAN_VERSION_RE);
    if (lessThanMatch) return lessThanMatch[1].replace(/\.$/, '');

    const target = parseAutoUpgradeText(text);
    if (target) return target.version;

    const versionMatch = text.match(/\bversion\s+([0-9][0-9a-z.-]*)/i);
    return versionMatch ? versionMatch[1].replace(/\.$/, '') : null;
};

const chooseAutoDisplayTitle = (titles, fallbackTitle) => {
    const cleanedTitles = sortAutoStrings(titles).map(title => normalizeAutoText(title)).filter(Boolean);
    if (cleanedTitles.length === 0) return normalizeAutoText(fallbackTitle || 'Untitled finding');

    return cleanedTitles.reduce((best, candidate) => {
        const bestVersion = extractAutoTitleVersion(best);
        const candidateVersion = extractAutoTitleVersion(candidate);
        if (candidateVersion && (!bestVersion || compareAutoVersions(candidateVersion, bestVersion) > 0)) return candidate;
        if (!candidateVersion && !bestVersion && candidate.length > best.length) return candidate;
        return best;
    }, cleanedTitles[0]);
};

const buildBackendCompactedRedmineTicketRefs = (findings = []) => {
    const groups = new Map();

    findings.forEach(finding => {
        const route = getAutoDefectDojoRoute(finding);
        const routeProjectKey = route.projectId || route.projectName || config.pullFilters?.test__engagement__product || '';
        const routeEngagementKey = route.engagementId || route.engagementName || config.pullFilters?.test__engagement || '';
        const groupKey = `${getAutoCompactGroupKey(finding)}|route|${normalizeAutoGroupText(routeProjectKey)}|${normalizeAutoGroupText(routeEngagementKey)}`;

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                groupKey,
                originalIds: [],
                titles: new Set(),
                productIds: new Set(),
                productNames: new Set(),
                engagementIds: new Set(),
                engagementNames: new Set()
            });
        }

        const group = groups.get(groupKey);
        group.originalIds.push(finding.id);
        group.titles.add(normalizeAutoText(finding.title || finding.name || 'Untitled finding'));
        if (route.projectId) group.productIds.add(route.projectId);
        if (route.projectName) group.productNames.add(route.projectName);
        if (route.engagementId) group.engagementIds.add(route.engagementId);
        if (route.engagementName) group.engagementNames.add(route.engagementName);
    });

    return Array.from(groups.values()).map(group => {
        const findingIds = sortAutoFindingIds(group.originalIds);
        const productIds = sortAutoStrings(group.productIds);
        const productNames = sortAutoStrings(group.productNames);
        const engagementIds = sortAutoStrings(group.engagementIds);
        const engagementNames = sortAutoStrings(group.engagementNames);
        const pullProjectId = normalizeAutoText(config.pullFilters?.test__engagement__product || '');
        const pullEngagementId = normalizeAutoText(config.pullFilters?.test__engagement || '');

        if (productIds.length === 0 && pullProjectId) productIds.push(pullProjectId);
        if (engagementIds.length === 0 && pullEngagementId) engagementIds.push(pullEngagementId);

        const syncKey = buildAutoCompactedSyncKey({
            groupKey: group.groupKey,
            findingIds,
            productIds,
            engagementIds
        });

        return {
            ticketKey: syncKey,
            subject: chooseAutoDisplayTitle(group.titles, 'Untitled finding'),
            syncKey,
            issueId: getKnownRedmineIssueId({ ticketKey: syncKey, syncKey }),
            findingIds,
            route: {
                projectId: productIds[0] || '',
                projectName: productNames[0] || '',
                engagementId: engagementIds[0] || '',
                engagementName: engagementNames[0] || ''
            }
        };
    });
};

const loadBackendRedmineCheckTicketRefs = async () => {
    const findings = database.isEnabled()
        ? await database.loadFindings()
        : await loadFindingsFromFileStore();
    return buildBackendCompactedRedmineTicketRefs(findings);
};

const checkRedmineTicketRefsForDashboard = async ({
    baseUrl,
    apiKey,
    configuredProjectId,
    trackerId,
    ticketRefs,
    logPrefix = 'REDMINE',
    persist = true
}) => {
    const statusMap = await fetchRedmineIssueStatusMap({ baseUrl, apiKey });
    const projectCache = new Map();
    const resultsByTicketKey = new Map();
    const ticketsNeedingSearch = [];
    let redmineIssueRequests = 0;
    let redmineProjectIssueRequests = 0;
    let redmineNotFoundCount = 0;
    let redmineErrorCount = 0;

    console.log(`[${logPrefix}] Checking ${ticketRefs.length} compacted tickets (concurrency ${REDMINE_CHECK_CONCURRENCY})`);

    await runWithConcurrency(ticketRefs, REDMINE_CHECK_CONCURRENCY, async (ticket) => {
        const knownIssueId = getKnownRedmineIssueId(ticket);
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
                statusMap
            });
            resultsByTicketKey.set(ticket.ticketKey, buildTicketStatusFromIssue({
                ticket,
                issueStatus,
                baseUrl
            }));
        } catch (error) {
            if (isRedmineNotFoundError(error)) redmineNotFoundCount += 1;
            const missingMessage = isRedmineNotFoundError(error)
                ? 'known issue was not found; the issue or its Redmine project may have been deleted'
                : error.message;
            console.warn(`[${logPrefix}] Known issue ${knownIssueId} for ${ticket.ticketKey} could not be checked; falling back to grouped search: ${missingMessage}`);
            ticketsNeedingSearch.push(ticket);
        }
    }, { onProgress: createProgressLogger('Known Redmine issue IDs checked', ticketRefs.length, logPrefix) });

    const ticketsByProject = new Map();
    if (ticketsNeedingSearch.length > 0) {
        console.log(`[${logPrefix}] Resolving projects for ${ticketsNeedingSearch.length} tickets needing search`);
    }

    await runWithConcurrency(ticketsNeedingSearch, REDMINE_CHECK_CONCURRENCY, async (ticket) => {
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
    }, { onProgress: createProgressLogger('Redmine projects resolved', ticketsNeedingSearch.length, logPrefix) });

    const projectGroups = Array.from(ticketsByProject.values());
    if (projectGroups.length > 0) {
        console.log(`[${logPrefix}] Grouped Redmine search: ${projectGroups.length} project groups for ${projectGroups.reduce((sum, group) => sum + group.tickets.length, 0)} tickets`);
    }

    await runWithConcurrency(projectGroups, REDMINE_CHECK_CONCURRENCY, async ({ resolvedProject, tickets }) => {
        try {
            redmineProjectIssueRequests += 2;
            const [openIssues, closedIssues] = await Promise.all([
                fetchRedmineIssuesForProjectStatus({
                    baseUrl,
                    apiKey,
                    projectId: resolvedProject.id,
                    trackerId,
                    statusId: 'open'
                }),
                fetchRedmineIssuesForProjectStatus({
                    baseUrl,
                    apiKey,
                    projectId: resolvedProject.id,
                    trackerId,
                    statusId: 'closed'
                })
            ]);

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
    }, { onProgress: createProgressLogger('Redmine project issue groups searched', projectGroups.length, logPrefix) });

    const results = ticketRefs.map(ticket => (
        resultsByTicketKey.get(ticket.ticketKey) || {
            ticketKey: ticket.ticketKey,
            action: 'check_failed',
            error: 'Ticket was not checked'
        }
    ));

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
                resolvedProject: ticketStatus.resolvedProject,
                projectMissing: ticketStatus.projectMissing,
                findingIds: ticket.findingIds
            });
            const currentRecord = redmineSyncStore.byTicket[storeKey];

            if (comparableStoredSync(currentRecord) !== comparableStoredSync(nextRecord)) {
                if (logPrefix === 'REDMINE_AUTO') {
                    console.log(
                        `[REDMINE_AUTO] Status changed for ${storeKey}: `
                        + `issue ${currentRecord?.issueId || '-'} ${currentRecord?.action || '-'} "${currentRecord?.status || '-'}" -> `
                        + `issue ${nextRecord.issueId || '-'} ${nextRecord.action || '-'} "${nextRecord.status || '-'}"`
                    );
                }
                await writeStoredRedmineSyncRecord(storeKey, nextRecord, { notify: false, save: false });
                changedCount += 1;
            }
        }

        prunedCount = pruneStaleRedmineSyncRecords(currentSyncKeys);
        if (prunedCount > 0 && logPrefix === 'REDMINE_AUTO') {
            console.log(`[REDMINE_AUTO] Pruned ${prunedCount} stale Redmine sync records that no longer match current compacted tickets`);
        }

        if (changedCount > 0 || prunedCount > 0) {
            await saveRedmineSyncStore();
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
    syncRecords: Object.keys(redmineSyncStore.byTicket || {}).length
});

const refreshStoredRedmineSyncStatuses = async () => {
    if (redmineSyncPollRunning) {
        console.log('[REDMINE_AUTO] Previous status sync is still running; skipping this tick');
        return { skipped: true, checkedCount: 0, changedCount: 0 };
    }

    const redmineUrl = String(config.redmineUrl || '').trim();
    const apiKey = String(config.redmineApiKey || '').trim();
    if (!redmineUrl || !apiKey) {
        console.log('[REDMINE_AUTO] Redmine URL/API key not configured; status sync skipped');
        return { skipped: true, checkedCount: 0, changedCount: 0 };
    }

    const ticketRefs = await loadBackendRedmineCheckTicketRefs();

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
            return { checkedCount: 0, changedCount: 0 };
        }

        const baseUrl = redmineUrl.replace(/\/$/, '');
        const { stats } = await checkRedmineTicketRefsForDashboard({
            baseUrl,
            apiKey,
            configuredProjectId: cleanRouteValue(config.redmineProjectId),
            trackerId: cleanRouteValue(config.redmineTrackerId),
            ticketRefs,
            logPrefix: 'REDMINE_AUTO',
            persist: true
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

const scheduleNextRedmineSyncPoll = (intervalMs) => {
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

const runScheduledRedmineSyncPoll = (intervalMs) => {
    refreshStoredRedmineSyncStatuses()
        .catch(error => {
            console.warn(`Redmine dashboard sync failed: ${error.message}`);
        })
        .finally(() => {
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
    const normalizedIntervalSeconds = Number.isInteger(pollIntervalSeconds) && pollIntervalSeconds > 0
        ? Math.max(60, pollIntervalSeconds)
        : 0;
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
        const reason = configured
            ? 'interval is disabled'
            : 'Redmine URL/API key not configured';
        console.log(`[REDMINE_AUTO] Background status sync disabled: ${reason}`);
        return;
    }

    console.log(`[REDMINE_AUTO] Background status sync enabled: every ${normalizedIntervalSeconds} seconds`);
    runScheduledRedmineSyncPoll(pollIntervalMs);
}

// Endpoint to get configuration
app.get('/api/config', requireAdmin, (req, res) => {
    res.json(config);
});

app.get('/api/config/backups', requireAdmin, async (req, res) => {
    try {
        res.json(await listConfigBackups());
    } catch (error) {
        console.error('Error listing config backups:', error);
        res.status(500).json({ error: 'Failed to list config backups', details: error.message });
    }
});

app.get('/api/config/backups/:fileName/export', requireAdmin, async (req, res) => {
    try {
        const { fileName } = req.params;
        if (!isSafeConfigBackupFileName(fileName)) {
            return res.status(400).json({ error: 'Backup fileName is required' });
        }

        const backupConfig = await readConfigBackup(fileName);
        if (!backupConfig) {
            return res.status(404).json({ error: 'Backup file not found' });
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
        res.status(500).json({ error: 'Failed to export config backup', details: error.message });
    }
});

app.post('/api/config/backup', requireAdmin, async (req, res) => {
    try {
        const backup = await writeConfigBackup(config, 'manual');
        res.json({ message: 'Configuration backup created', backup });
    } catch (error) {
        console.error('Error backing up config:', error);
        res.status(500).json({ error: 'Failed to backup config', details: error.message });
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
            return res.status(400).json({ error: 'Config JSON body is required' });
        }

        const previousScanPath = config.scanPath;
        const backup = await writeConfigBackup(config, 'pre-import');
        config = normalizeConfigObject(importedConfig);
        await saveConfigToDisk();
        await afterConfigChanged(previousScanPath, 'config-imported');
        res.json({ message: 'Configuration imported', config, backup });
    } catch (error) {
        console.error('Error importing config:', error);
        res.status(500).json({ error: 'Failed to import config', details: error.message });
    }
});

app.post('/api/config/restore', requireAdmin, async (req, res) => {
    try {
        const fileName = String(req.body?.fileName || '');
        if (!isSafeConfigBackupFileName(fileName)) {
            return res.status(400).json({ error: 'Backup fileName is required' });
        }

        const restoredConfig = await readConfigBackup(fileName);
        if (!restoredConfig) {
            return res.status(404).json({ error: 'Backup file not found' });
        }

        const currentBackup = await writeConfigBackup(config, 'pre-restore');
        const previousScanPath = config.scanPath;
        config = normalizeConfigObject(restoredConfig);
        await saveConfigToDisk();
        await afterConfigChanged(previousScanPath, 'config-restored');
        res.json({ message: 'Configuration restored', config, backup: currentBackup });
    } catch (error) {
        console.error('Error restoring config:', error);
        res.status(500).json({ error: 'Failed to restore config', details: error.message });
    }
});

// Endpoint to update configuration
app.post('/api/config', requireAdmin, async (req, res) => {
    try {
        const previousScanPath = config.scanPath;
        const backup = await writeConfigBackup(config, 'pre-save');
        config = normalizeConfigObject(req.body || {});
        await saveConfigToDisk();
        await afterConfigChanged(previousScanPath, 'config-saved');
        res.json({ message: 'Configuration updated', config, backup });
    } catch (error) {
        console.error('Error updating config:', error);
        res.status(500).json({ error: 'Failed to update config', details: error.message });
    }
});

// Endpoint to pull findings from DefectDojo API
app.get('/api/logs', (req, res) => {
    res.json(globalLogs);
});

app.delete('/api/logs', (req, res) => {
    globalLogs = [];
    res.json({ message: 'Logs cleared' });
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
        writeDashboardSyncEvent(res, 'heartbeat', { at: new Date().toISOString() });
    }, DASHBOARD_SYNC_HEARTBEAT_MS);

    req.on('close', () => {
        clearInterval(heartbeat);
        dashboardSyncClients.delete(client);
    });
});

app.get('/api/redmine/sync/status', (req, res) => {
    res.json(getRedmineSyncStatusPayload());
});

app.post('/api/redmine/issues/status', requireAdmin, async (req, res) => {
    const { redmine = {}, issues = [] } = req.body;
    const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
    const apiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();

    if (!redmineUrl || !apiKey) {
        return res.status(400).json({ error: 'Redmine URL and API Key are required' });
    }

    const issueRefs = Array.isArray(issues)
        ? issues
            .map(item => ({
                ticketKey: String(item.ticketKey || ''),
                issueId: Number.parseInt(item.issueId, 10)
            }))
            .filter(item => item.ticketKey && Number.isInteger(item.issueId) && item.issueId > 0)
        : [];

    if (issueRefs.length === 0) {
        return res.json({ issues: [] });
    }

    try {
        const baseUrl = redmineUrl.replace(/\/$/, '');
        const statusMap = await fetchRedmineIssueStatusMap({ baseUrl, apiKey });
        console.log(`[REDMINE] Refreshing ${issueRefs.length} known issue statuses (concurrency ${REDMINE_CHECK_CONCURRENCY})`);

        const results = await runWithConcurrency(issueRefs, REDMINE_CHECK_CONCURRENCY, async (ref) => {
            try {
                const status = await fetchRedmineIssueStatus({
                    baseUrl,
                    apiKey,
                    issueId: ref.issueId,
                    statusMap
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
        }, { onProgress: createProgressLogger('Redmine issue statuses checked', issueRefs.length) });

        res.json({ issues: results });
    } catch (error) {
        console.error('Error refreshing Redmine issue statuses:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to refresh Redmine issue statuses',
            details: error.response?.data || error.message
        });
    }
});

app.post('/api/redmine/issues/check', requireAdmin, async (req, res) => {
    const { redmine = {}, tickets = [] } = req.body;
    const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
    const apiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();
    const configuredProjectId = String(redmine.projectId || config.redmineProjectId || '').trim();
    const trackerId = String(redmine.trackerId || config.redmineTrackerId || '').trim();

    if (!redmineUrl || !apiKey) {
        return res.status(400).json({ error: 'Redmine URL and API Key are required' });
    }

    const ticketRefs = Array.isArray(tickets)
        ? tickets
            .map(ticket => ({
                ticketKey: String(ticket.ticketKey || ''),
                subject: String(ticket.subject || '').trim(),
                syncKey: String(ticket.syncKey || '').trim(),
                issueId: Number.parseInt(ticket.issueId, 10),
                findingIds: normalizeFindingIds(ticket.findingIds || []),
                route: ticket.route || {}
            }))
            .filter(ticket => ticket.ticketKey && ticket.subject)
        : [];

    if (ticketRefs.length === 0) {
        return res.json({ tickets: [] });
    }

    try {
        const baseUrl = redmineUrl.replace(/\/$/, '');
        const statusMap = await fetchRedmineIssueStatusMap({ baseUrl, apiKey });
        const projectCache = new Map();
        const resultsByTicketKey = new Map();
        const ticketsNeedingSearch = [];

        console.log(`[REDMINE] Checking ${ticketRefs.length} compacted tickets (concurrency ${REDMINE_CHECK_CONCURRENCY})`);

        await runWithConcurrency(ticketRefs, REDMINE_CHECK_CONCURRENCY, async (ticket) => {
            const knownIssueId = getKnownRedmineIssueId(ticket);
            if (!knownIssueId) {
                ticketsNeedingSearch.push(ticket);
                return;
            }

            try {
                const issueStatus = await fetchRedmineIssueStatus({
                    baseUrl,
                    apiKey,
                    issueId: knownIssueId,
                    statusMap
                });
                resultsByTicketKey.set(ticket.ticketKey, buildTicketStatusFromIssue({
                    ticket,
                    issueStatus,
                    baseUrl
                }));
            } catch (error) {
                const missingMessage = isRedmineNotFoundError(error)
                    ? 'known issue was not found; the issue or its Redmine project may have been deleted'
                    : error.message;
                console.warn(`[REDMINE] Known issue ${knownIssueId} for ${ticket.ticketKey} could not be checked; falling back to grouped search: ${missingMessage}`);
                ticketsNeedingSearch.push(ticket);
            }
        }, { onProgress: createProgressLogger('Known Redmine issue IDs checked', ticketRefs.length) });

        const ticketsByProject = new Map();
        if (ticketsNeedingSearch.length > 0) {
            console.log(`[REDMINE] Resolving projects for ${ticketsNeedingSearch.length} tickets needing search`);
        }

        await runWithConcurrency(ticketsNeedingSearch, REDMINE_CHECK_CONCURRENCY, async (ticket) => {
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
        }, { onProgress: createProgressLogger('Redmine projects resolved', ticketsNeedingSearch.length) });

        const projectGroups = Array.from(ticketsByProject.values());
        if (projectGroups.length > 0) {
            console.log(`[REDMINE] Grouped Redmine search: ${projectGroups.length} project groups for ${projectGroups.reduce((sum, group) => sum + group.tickets.length, 0)} tickets`);
        }

        await runWithConcurrency(projectGroups, REDMINE_CHECK_CONCURRENCY, async ({ resolvedProject, tickets }) => {
            try {
                const [openIssues, closedIssues] = await Promise.all([
                    fetchRedmineIssuesForProjectStatus({
                        baseUrl,
                        apiKey,
                        projectId: resolvedProject.id,
                        trackerId,
                        statusId: 'open'
                    }),
                    fetchRedmineIssuesForProjectStatus({
                        baseUrl,
                        apiKey,
                        projectId: resolvedProject.id,
                        trackerId,
                        statusId: 'closed'
                    })
                ]);

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
        }, { onProgress: createProgressLogger('Redmine project issue groups searched', projectGroups.length) });

        const results = ticketRefs.map(ticket => (
            resultsByTicketKey.get(ticket.ticketKey) || {
                ticketKey: ticket.ticketKey,
                action: 'check_failed',
                error: 'Ticket was not checked'
            }
        ));

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
                resolvedProject: ticketStatus.resolvedProject,
                projectMissing: ticketStatus.projectMissing,
                findingIds: ticket.findingIds
            });
            const currentRecord = redmineSyncStore.byTicket[storeKey];

            if (comparableStoredSync(currentRecord) !== comparableStoredSync(nextRecord)) {
                await writeStoredRedmineSyncRecord(storeKey, nextRecord, { notify: false, save: false });
                storedSyncChanged = true;
            }
        }

        if (storedSyncChanged) {
            await saveRedmineSyncStore();
            broadcastDashboardSync('redmine-status-updated');
        }

        res.json({ tickets: results });
    } catch (error) {
        console.error('Error checking Redmine tickets:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to check Redmine tickets',
            details: error.response?.data || error.message
        });
    }
});

app.post('/api/redmine/issues', requireAdmin, async (req, res) => {
    const { redmine = {}, issue = {} } = req.body;
    const redmineUrl = String(redmine.url || config.redmineUrl || '').trim();
    const apiKey = String(redmine.apiKey || config.redmineApiKey || '').trim();
    const configuredProjectId = String(redmine.projectId || config.redmineProjectId || '').trim();
    const trackerId = String(redmine.trackerId || config.redmineTrackerId || '').trim();
    const subject = String(issue.subject || '').trim();
    const description = String(issue.description || '').trim();
    const severity = String(issue.severity || '').trim();
    const priorityId = String(redmine.priorityId || getRedminePriorityIdForSeverity(severity) || '').trim();
    const syncKey = String(issue.syncKey || '').trim();
    const findingIds = normalizeFindingIds(issue.findingIds || []);
    const route = issue.route || {};

    if (!redmineUrl || !apiKey) {
        return res.status(400).json({ error: 'Redmine URL and API Key are required' });
    }

    if (!subject || !description) {
        return res.status(400).json({ error: 'Issue subject and description are required' });
    }

    try {
        const baseUrl = redmineUrl.replace(/\/$/, '');
        const descriptionWithSync = appendSyncMetadata(description, syncKey, findingIds);
        const knownIssueId = getKnownRedmineIssueId({
            ticketKey: syncKey,
            syncKey,
            issueId: issue.issueId,
            findingIds
        });

        if (knownIssueId) {
            try {
                const statusMap = await fetchRedmineIssueStatusMap({ baseUrl, apiKey });
                const issueStatus = await fetchRedmineIssueStatus({
                    baseUrl,
                    apiKey,
                    issueId: knownIssueId,
                    statusMap
                });
                const issueUrl = issueStatus.issueUrl;

                if (!issueStatus.isClosed) {
                    const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
                        action: 'existing_open',
                        issue: issueStatus.issue,
                        issueUrl,
                        resolvedProject: getIssueResolvedProject(issueStatus.issue),
                        findingIds
                    }));
                    console.log(`Found known open Redmine issue ${knownIssueId}; not searching`);
                    return res.json({
                        action: 'existing_open',
                        message: 'Known open Redmine issue found; no duplicate created',
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
                    resolvedProject: getIssueResolvedProject(issueStatus.issue),
                    findingIds
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
                const missingMessage = isRedmineNotFoundError(knownError)
                    ? 'known issue was not found; the issue or its Redmine project may have been deleted'
                    : knownError.message;
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
            syncKey
        };

        const openIssue = await findMatchingRedmineIssue({ ...searchArgs, statusId: 'open' });
        if (openIssue) {
            const issueUrl = getRedmineIssueUrl(baseUrl, openIssue);
            const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
                action: 'existing_open',
                issue: openIssue,
                issueUrl,
                resolvedProject,
                findingIds
            }));
            console.log(`Found existing open Redmine issue ${openIssue.id}; not creating duplicate`);
            return res.json({
                action: 'existing_open',
                message: 'Existing open Redmine issue found; no duplicate created',
                issue: openIssue,
                issueUrl,
                resolvedProject,
                serverSync
            });
        }

        const closedIssue = await findMatchingRedmineIssue({ ...searchArgs, statusId: 'closed' });
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
                findingIds
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
            response = await axios.post(`${baseUrl}/issues.json`, { issue: redmineIssue }, {
                headers: getRedmineHeaders(apiKey)
            });
        } catch (createError) {
            if (isRedmineProjectReferenceError(createError)) {
                redmineProjectResolveCache.delete(getRedmineProjectCacheKey({ baseUrl, configuredProjectId, route }));
                const serverSync = await writeStoredRedmineSyncRecord(syncKey, buildStoredRedmineSyncRecord({
                    action: 'not_found',
                    status: 'Project not found',
                    resolvedProject: buildMissingRedmineProject({
                        configuredProjectId,
                        route,
                        fallback: resolvedProject.name
                    }),
                    projectMissing: true,
                    findingIds
                }));

                return res.status(409).json({
                    error: 'Redmine project was not found',
                    details: 'The Redmine project for this ticket may have been deleted. Re-run the action to resolve or recreate the project, or update the Redmine Project Identifier override in Settings.',
                    action: 'not_found',
                    projectMissing: true,
                    resolvedProject: serverSync.projectName ? { name: serverSync.projectName } : undefined,
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
            findingIds
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

app.post('/api/pull', requireAdmin, async (req, res) => {
    const { url, apiKey, filters } = req.body;

    if (!url || !apiKey) {
        return res.status(400).json({ error: 'URL and API Key are required' });
    }

    try {
        let baseUrl = url.trim();
        baseUrl = baseUrl.replace(/\/$/, '').replace(/\/api\/v2$/, '');

        const normalizedFilters = normalizePullFilters(filters);
        const selectedSeverities = normalizedFilters.severity;
        const shouldFilterBySeverity = selectedSeverities.length > 0 && selectedSeverities.length < SEVERITY_VALUES.length;
        const severitiesToPull = shouldFilterBySeverity ? selectedSeverities : [''];
        const findingMap = new Map();
        let rawFindingCount = 0;

        const productIdsToPull = splitDelimitedFilterValue(normalizedFilters.test__engagement__product);
        if (productIdsToPull.length === 0) {
            productIdsToPull.push(''); // Empty string signifies pulling all products
        }

        console.log(`[PULL] Starting DefectDojo pull from ${baseUrl}/api/v2/findings/`);
        const endpointFallbackLimitLabel = DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT > 0
            ? DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT
            : 'unlimited';
        console.log(`[PULL] Finding page limit=${DEFECTDOJO_PULL_PAGE_LIMIT}; context concurrency=${DEFECTDOJO_CONTEXT_CONCURRENCY}; endpoint chunk concurrency=${DEFECTDOJO_ENDPOINT_CHUNK_CONCURRENCY}; individual endpoint fallback cap=${endpointFallbackLimitLabel}`);
        console.log(`[PULL] Filters: severities=${shouldFilterBySeverity ? selectedSeverities.join(', ') : 'all'}, products=${productIdsToPull.join(', ') || 'all'}`);

        for (const productId of productIdsToPull) {
            const currentFilters = { ...normalizedFilters };
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
                        const totalPages = Number.isInteger(queryTotal) && queryTotal > 0
                            ? Math.ceil(queryTotal / DEFECTDOJO_PULL_PAGE_LIMIT)
                            : null;
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

        await enrichFindingsWithDefectDojoContext({
            baseUrl,
            apiKey,
            findings: allFindings,
            filters: normalizedFilters
        });
        console.log('[PULL] DefectDojo context enrichment complete');

        // --- Endpoint Resolution ---
        const endpointIds = new Set();
        allFindings.forEach(f => {
            if (Array.isArray(f.endpoints)) {
                f.endpoints.forEach(item => {
                    if (typeof item === 'number' || (typeof item === 'string' && !isNaN(item))) {
                        endpointIds.add(item);
                    }
                });
            }
        });

        if (endpointIds.size > 0) {
            console.log(`[PULL] Resolving ${endpointIds.size} unique endpoints`);
            const idList = Array.from(endpointIds);
            const endpointMap = {};

            // DefectDojo allows filtering by id__in, but we should chunk large requests
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
            }, { onProgress: createProgressLogger('Endpoint chunks processed', endpointChunks.length) });

            const missingEndpointIds = idList.filter(id => !endpointMap[id.toString()]);
            if (missingEndpointIds.length > 0) {
                const fallbackIds = DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT > 0
                    ? missingEndpointIds.slice(0, DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT)
                    : missingEndpointIds;
                const skippedFallbackCount = missingEndpointIds.length - fallbackIds.length;
                console.log(`[PULL] Endpoint individual fallback: ${fallbackIds.length}/${missingEndpointIds.length} unresolved IDs will be requested${skippedFallbackCount > 0 ? `, ${skippedFallbackCount} skipped by cap` : ''}`);

                await runWithConcurrency(fallbackIds, DEFECTDOJO_ENDPOINT_CHUNK_CONCURRENCY, async (id) => {
                    try {
                        const singleEpUrl = `${baseUrl}/api/v2/endpoints/${id}/`;
                        const singleEpResponse = await axios.get(singleEpUrl, {
                            headers: { 'Authorization': `Token ${apiKey}`, 'Accept': 'application/json' }
                        });
                        if (singleEpResponse.data) {
                            endpointMap[id.toString()] = singleEpResponse.data;
                        }
                    } catch (singleErr) {
                        console.warn(`[WARN] Could not resolve endpoint ${id} with individual fallback: ${singleErr.message}`);
                    }
                }, { onProgress: createProgressLogger('Endpoint fallback requests processed', fallbackIds.length) });
            }

            console.log(`[PULL] Endpoint resolution lookup complete: resolved ${Object.keys(endpointMap).length}/${idList.length}`);

            // Replace IDs with objects
            let descriptionFallbackCount = 0;
            let unresolvedEndpointFindingCount = 0;
            allFindings.forEach(f => {
                if (Array.isArray(f.endpoints)) {
                    const resolvedEndpoints = f.endpoints.map(item => {
                        if (typeof item === 'number' || (typeof item === 'string' && !isNaN(item))) {
                            return endpointMap[item.toString()] || item;
                        }
                        return item;
                    });

                    // Fallback: If we still have numeric IDs, try to extract host from description
                    if (resolvedEndpoints.some(e => typeof e !== 'object')) {
                        // Try 1: Look for URL-like patterns (e.g., tcp://10.149.20.51:80)
                        let host = null;
                        let port = null;
                        let protocol = null;

                        const urlMatch = f.description?.match(/([a-z0-9]+):\/\/([^\/\s?#]+)/i);
                        if (urlMatch) {
                            protocol = urlMatch[1];
                            const hostPort = urlMatch[2].replace(/\/$/, '');
                            const parts = hostPort.split(':');
                            host = parts[0];
                            port = parts[1] || (protocol === 'https' ? '443' : (protocol === 'http' ? '80' : null));
                        } else {
                            // Try 2: Look for IP pattern near "URL" or "Host"
                            const ipMatch = f.description?.match(/(?:URL|Host|IP)\s*[:=]\s*([0-9a-z.-]+)/i);
                            if (ipMatch && ipMatch[1]) {
                                host = ipMatch[1].trim();
                            } else {
                                // Try 3: Any IP address as a last resort
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
        // ---------------------------

        console.log(`[PULL] Saving ${allFindings.length} findings to ${database.isEnabled() ? 'PostgreSQL' : 'JSON storage'}`);
        const storageResult = await saveFindingsToStore(allFindings);
        emptyFindingsCache();
        await restartScanPathWatcher();
        broadcastDashboardSync('defectdojo-pull-complete');
        console.log(`[PULL] Pull complete: saved ${allFindings.length} findings`);

        res.json({
            message: `Successfully pulled ${allFindings.length} findings`,
            ...storageResult,
            count: allFindings.length
        });
    } catch (error) {
        console.error('Error pulling from DefectDojo:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
        res.status(500).json({
            error: 'Failed to pull from DefectDojo',
            details: error.response?.data || error.message
        });
    }
});

// Endpoint to get findings from the active storage backend
app.get('/api/findings', async (req, res) => {
    try {
        const findings = await loadFindingsForUser(req.user);
        res.json(findings);
    } catch (error) {
        console.error('Error reading findings:', error);
        res.status(error.status || 500).json({ error: error.message || 'Failed to read findings' });
    }
});

// Endpoint to clear local findings
app.post('/api/clear', requireAdmin, async (req, res) => {
    try {
        if (database.isEnabled()) {
            await database.clearFindings();
            emptyFindingsCache();
            broadcastDashboardSync('scan-store-cleared');
            return res.json({ message: 'Database findings cleared' });
        }

        const files = await fs.readdir(config.scanPath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        for (const file of jsonFiles) {
            await fs.remove(path.join(config.scanPath, file));
        }
        emptyFindingsCache();
        broadcastDashboardSync('scan-store-cleared');
        res.json({ message: 'Local findings cleared' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear findings' });
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
