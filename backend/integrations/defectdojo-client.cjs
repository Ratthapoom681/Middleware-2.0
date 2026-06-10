// DefectDojo API client — entity resolution, finding enrichment, and filter query building.

const axios = require('axios');
const { cleanRouteValue } = require('../lib/utils.cjs');
const { splitDelimitedFilterValue, runWithConcurrency, createProgressLogger } = require('../domain/sync-utils.cjs');

const DEFECTDOJO_CONTEXT_CONCURRENCY = 5;

const CONFIG_FIELDS = [
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
    'redmineStatusNewId',
    'redmineStatusFeedbackId',
    'redmineStatusInProgressId',
    'redmineStatusResolveId',
    'redmineStatusClosedId',
    'redmineStatusPollIntervalSeconds',
    'pullFilters',
    'notifyIpMappings'
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

const getEntityName = (value) => {
    if (value && typeof value === 'object') {
        return cleanRouteValue(value.name || value.title);
    }

    const cleaned = cleanRouteValue(value);
    return cleaned && !/^\d+$/.test(cleaned) ? cleaned : '';
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

const enrichFindingsWithDefectDojoContext = async ({ baseUrl, apiKey, findings, filters = {}, concurrency = DEFECTDOJO_CONTEXT_CONCURRENCY }) => {
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
        console.log(`[PULL] Resolving DefectDojo context: ${testIdList.length} tests (concurrency ${concurrency})`);
    }

    await runWithConcurrency(testIdList, concurrency, async (testId) => {
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
        console.log(`[PULL] Resolving DefectDojo context: ${engagementIdList.length} engagements (concurrency ${concurrency})`);
    }

    await runWithConcurrency(engagementIdList, concurrency, async (engagementId) => {
        const engagement = await fetchDefectDojoEntity({ baseUrl, apiKey, resource: 'engagements', id: engagementId });
        if (!engagement) return;
        engagements.set(engagementId, engagement);

        const productId = getEntityId(engagement.product || engagement.product_id);
        if (productId) productIds.add(productId);
    }, { onProgress: createProgressLogger('Engagements resolved', engagementIdList.length) });

    const productIdList = Array.from(productIds);
    if (productIdList.length > 0) {
        console.log(`[PULL] Resolving DefectDojo context: ${productIdList.length} products (concurrency ${concurrency})`);
    }

    await runWithConcurrency(productIdList, concurrency, async (productId) => {
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

module.exports = {
    CONFIG_FIELDS,
    DEFECTDOJO_CONTEXT_CONCURRENCY,
    buildFindingFilterQuery,
    getFindingKey,
    getEntityId,
    getEntityName,
    withPullProductContext,
    fetchDefectDojoEntity,
    enrichFindingsWithDefectDojoContext
};
