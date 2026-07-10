// Shared pure utility functions used across all backend modules.

const cleanRouteValue = (value) => String(value || '').trim();

const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value instanceof Set) return Array.from(value);
    if (value === undefined || value === null || value === '') return [];
    return [value];
};

const asFindingIdArray = (value) => {
    if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
    return asArray(value);
};

const normalizeFindingIds = (findingIds = []) => (
    Array.from(new Set(asFindingIdArray(findingIds)
        .map(id => Number.parseInt(id, 10))
        .filter(id => Number.isInteger(id) && id > 0)))
);

const isPlainObject = (value) => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

module.exports = {
    cleanRouteValue,
    asArray,
    asFindingIdArray,
    normalizeFindingIds,
    isPlainObject
};
