const { cleanRouteValue } = require('../lib/utils.cjs');

const getSyncHistoryGroupKey = (route = {}) => ([
    cleanRouteValue(route.projectId) || cleanRouteValue(route.projectName),
    cleanRouteValue(route.engagementId) || cleanRouteValue(route.engagementName)
].join('|'));

const getSyncHistoryGroupRoute = (route = {}) => ({
    projectId: cleanRouteValue(route.projectId),
    projectName: cleanRouteValue(route.projectName),
    engagementId: cleanRouteValue(route.engagementId),
    engagementName: cleanRouteValue(route.engagementName)
});

const hasCompleteSyncHistoryRoute = (route = {}) => {
    const normalized = getSyncHistoryGroupRoute(route);
    return Boolean(
        (normalized.projectId || normalized.projectName)
        && (normalized.engagementId || normalized.engagementName)
    );
};

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

const createSkippedTracker = () => ({
    findings: 0,
    tickets: 0,
    checkResults: 0,
    priorityUpdates: 0,
    ticketCreates: 0,
    mitigationRechecks: 0
});

const getSkippedTotal = (skipped = {}) => Object.values(skipped)
    .reduce((sum, count) => sum + (Number.parseInt(count, 10) || 0), 0);

const buildSkippedWarning = (skipped = {}) => {
    const total = getSkippedTotal(skipped);
    if (total === 0) return '';
    const details = [
        ['findings', skipped.findings],
        ['tickets', skipped.tickets],
        ['checks', skipped.checkResults],
        ['priority updates', skipped.priorityUpdates],
        ['ticket creates', skipped.ticketCreates],
        ['mitigation rechecks', skipped.mitigationRechecks]
    ]
        .filter(([, count]) => count > 0)
        .map(([label, count]) => `${label}: ${count}`)
        .join(', ');

    return `Skipped ${total} Sync History item${total === 1 ? '' : 's'} without resolved company and scope${details ? ` (${details})` : ''}.`;
};

const createSyncHistorySplitGroups = ({
    findings = [],
    ticketRefs = [],
    checkResults = [],
    priorityUpdatedTicketKeys = new Set(),
    createdOrUpdatedTicketKeys = new Set(),
    recheckRecords = [],
    getFindingRoute = finding => finding?.defectdojo_route || {}
} = {}) => {
    const groupsByKey = new Map();
    const skipped = createSkippedTracker();

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

    const addToCompleteRoute = (routeInput, skippedKey, addItem) => {
        if (!hasCompleteSyncHistoryRoute(routeInput)) {
            skipped[skippedKey] += 1;
            return;
        }
        addItem(ensureGroup(routeInput));
    };

    findings.forEach(finding => {
        const route = getFindingRoute(finding);
        addToCompleteRoute(route, 'findings', group => group.findings.push(finding));
    });

    ticketRefs.forEach(ticket => {
        addToCompleteRoute(ticket.route || {}, 'tickets', group => group.ticketRefs.push(ticket));
    });

    const ticketRefByKey = new Map(ticketRefs.map(ticket => [ticket.ticketKey, ticket]));

    checkResults.forEach(result => {
        const ticket = ticketRefByKey.get(result.ticketKey);
        if (!ticket) return;
        addToCompleteRoute(ticket.route || {}, 'checkResults', group => group.checkResults.push(result));
    });

    priorityUpdatedTicketKeys.forEach(ticketKey => {
        const ticket = ticketRefByKey.get(ticketKey);
        if (!ticket) return;
        addToCompleteRoute(ticket.route || {}, 'priorityUpdates', group => group.priorityUpdatedTicketKeys.add(ticketKey));
    });

    createdOrUpdatedTicketKeys.forEach(ticketKey => {
        const ticket = ticketRefByKey.get(ticketKey);
        if (!ticket) return;
        addToCompleteRoute(ticket.route || {}, 'ticketCreates', group => group.createdOrUpdatedTicketKeys.add(ticketKey));
    });

    recheckRecords.forEach(record => {
        const route = {
            projectId: record.productId,
            projectName: record.productName,
            engagementId: record.engagementId,
            engagementName: record.engagementName
        };
        addToCompleteRoute(route, 'mitigationRechecks', group => group.recheckRecords.push(record));
    });

    const groups = Array.from(groupsByKey.values()).filter(group => (
        group.findings.length > 0
        || group.ticketRefs.length > 0
        || group.recheckRecords.length > 0
    ));

    return {
        groups,
        skipped,
        warning: buildSkippedWarning(skipped)
    };
};

module.exports = {
    allocateCountByWeight,
    buildSkippedWarning,
    createSyncHistorySplitGroups,
    getSkippedTotal,
    getSyncHistoryGroupKey,
    getSyncHistoryGroupRoute,
    hasCompleteSyncHistoryRoute
};
