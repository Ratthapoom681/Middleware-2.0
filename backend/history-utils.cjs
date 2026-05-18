const normalizeStatus = (value = '') => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');

const isResolveStatus = (statusName = '', statusId = '', statusIds = {}) => {
    const normalized = normalizeStatus(statusName);
    const configuredResolveId = String(statusIds.resolve || '').trim();
    return (configuredResolveId && String(statusId || '').trim() === configuredResolveId)
        || normalized === 'resolve'
        || normalized === 'resolved';
};

const isInProgressStatus = (statusName = '', statusId = '', statusIds = {}) => {
    const normalized = normalizeStatus(statusName);
    const configuredId = String(statusIds.inProgress || '').trim();
    return (configuredId && String(statusId || '').trim() === configuredId)
        || normalized === 'in progress';
};

const isClosedStatus = (statusName = '', statusId = '', statusIds = {}) => {
    if (isResolveStatus(statusName, statusId, statusIds)) return false;
    const normalized = normalizeStatus(statusName);
    const configuredId = String(statusIds.closed || '').trim();
    return (configuredId && String(statusId || '').trim() === configuredId)
        || normalized === 'closed'
        || normalized === 'done'
        || normalized === 'rejected';
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const UPGRADE_TARGET_RE = /upgrade\s+to\s+(.+?)\s+(?:version\s+)?([0-9][0-9a-z.-]*)\s*(?:or\s+later)?\.?/i;
const TITLE_VERSION_RE = /^(.+?)\s+.*?(?:<|version)\s+([0-9][0-9a-z.-]*)/i;

const cleanSoftwareName = (value = '') => String(value || '').trim().replace(/[.:;,-]+$/g, '').trim();

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

const sortStrings = (values = []) => asArray(values)
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const sortFindingIds = (ids = []) => sortStrings(asFindingIdArray(ids))
    .map(id => (/^\d+$/.test(id) ? Number.parseInt(id, 10) : id));

const stableHash = (value = '') => {
    const text = String(value || '');
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let index = 0; index < text.length; index += 1) {
        const ch = text.charCodeAt(index);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const buildCompactedSyncKey = ({ groupKey, productIds = [], engagementIds = [] }) => {
    const source = [
        `group:${groupKey}`,
        `products:${sortStrings(productIds).join(',')}`,
        `engagements:${sortStrings(engagementIds).join(',')}`
    ].join('|');

    return `dd-compact-${stableHash(source)}`;
};

const buildLegacyCompactedSyncKey = ({ groupKey, findingIds = [], productIds = [], engagementIds = [] }) => {
    const source = [
        `group:${groupKey}`,
        `findings:${sortStrings(asFindingIdArray(findingIds)).join(',')}`,
        `products:${sortStrings(productIds).join(',')}`,
        `engagements:${sortStrings(engagementIds).join(',')}`
    ].join('|');

    return `dd-compact-${stableHash(source)}`;
};

const tokenizeVersion = (value = '') => String(value || '0')
    .split(/[._+-]/)
    .map(part => {
        const numeric = Number.parseInt(part, 10);
        return Number.isNaN(numeric) ? part.toLowerCase() : numeric;
    });

const compareVersions = (a, b) => {
    const left = tokenizeVersion(a);
    const right = tokenizeVersion(b);
    const maxLength = Math.max(left.length, right.length);

    for (let index = 0; index < maxLength; index += 1) {
        const leftPart = left[index] ?? 0;
        const rightPart = right[index] ?? 0;
        if (typeof leftPart === 'number' && typeof rightPart === 'number') {
            if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
            continue;
        }
        const comparison = String(leftPart).localeCompare(String(rightPart), undefined, { numeric: true });
        if (comparison !== 0) return comparison;
    }

    return 0;
};

const getTitleVersion = (title = '') => {
    const match = String(title || '').match(TITLE_VERSION_RE);
    return match ? match[2].replace(/\.$/, '') : null;
};

const endpointLabel = (endpoint) => {
    if (endpoint && typeof endpoint === 'object') {
        const protocol = endpoint.protocol ? `${endpoint.protocol}://` : '';
        const host = endpoint.host || endpoint.hostname || endpoint.ip || endpoint.address || '';
        const port = endpoint.port ? `:${endpoint.port}` : '';
        if (host) return `${protocol}${host}${port}`;
        return endpoint.label || endpoint.url || endpoint.id || 'Unknown endpoint';
    }
    return String(endpoint || 'Unknown endpoint');
};

const endpointHost = (endpoint) => {
    if (endpoint && typeof endpoint === 'object') {
        return String(endpoint.host || endpoint.hostname || endpoint.ip || endpoint.address || endpointLabel(endpoint) || 'Unknown host');
    }
    return String(endpoint || 'Unknown host');
};

const HISTORY_SOURCE_EVIDENCE_RE = /\b(?:URL|URI)\s*:\s*https?:\/\/\S+(?:\s+\([^)]*\))?(?:\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:\s*\S+)*|\bVersion source\s*:\s*\S+(?:\s+(?!(?:Installed|Detected|Current|Fixed|Affected) version\s*:)\S+)*(?:\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:\s*\S+)*/gi;

const cleanHistoryTextSourceBody = (value = '') => String(value || '').trim()
    .replace(HISTORY_SOURCE_EVIDENCE_RE, '')
    .replace(/\busing the following request\s*:\s*https?:\/\/\S+/i, 'using a request to the affected endpoint')
    .replace(/\s*This produced the following truncated output[\s\S]*$/i, '\n\nEvidence output omitted. See DefectDojo finding for raw truncated output.')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const extractHistoryTextSourceEvidenceLines = (value = '') => {
    const evidenceLines = new Set();
    String(value || '').trim().replace(HISTORY_SOURCE_EVIDENCE_RE, match => {
        const cleaned = String(match || '').replace(/\s+/g, ' ').trim();
        if (cleaned) evidenceLines.add(cleaned);
        return match;
    });
    return Array.from(evidenceLines);
};

const normalizeHistoryTextSourceKey = (value = '') => {
    const bodyText = cleanHistoryTextSourceBody(value);
    const evidenceLines = extractHistoryTextSourceEvidenceLines(value);
    return [
        bodyText
            .replace(/\busing the following request\s*:\s*https?:\/\/\S+/i, 'using a request to the affected endpoint')
            .replace(/\s*This produced the following truncated output[\s\S]*$/i, ' Evidence output omitted. See DefectDojo finding for raw truncated output.')
            .replace(/\bURL\s*:\s*https?:\/\/\S+/gi, 'URL: <endpoint>')
            .replace(/\bhttps?:\/\/[^\s)]+/gi, '<url>')
            .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<host>')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase(),
        evidenceLines
            .map(line => line
                .replace(/\bURL\s*:\s*https?:\/\/\S+/gi, 'URL: <endpoint>')
                .replace(/\bhttps?:\/\/[^\s)]+/gi, '<url>')
                .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<host>')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase())
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .join('|')
    ].filter(Boolean).join('|evidence|').toLowerCase();
};

const getHistoryCompactionDetailKey = (finding = {}) => ([
    'detail',
    normalizeHistoryTextSourceKey(finding.description || ''),
    normalizeHistoryTextSourceKey(finding.impact || '')
].join('|'));

const addTextSource = (sourceMap, text, findingId) => {
    const cleanedText = String(text || '').trim();
    if (!cleanedText) return;
    const bodyText = cleanHistoryTextSourceBody(cleanedText);
    const evidenceLines = new Set(extractHistoryTextSourceEvidenceLines(cleanedText));
    const sourceKey = normalizeHistoryTextSourceKey(cleanedText);
    if (!sourceMap.has(sourceKey)) sourceMap.set(sourceKey, { text: bodyText, findingIds: new Set(), evidenceLines: new Set() });
    evidenceLines.forEach(line => sourceMap.get(sourceKey).evidenceLines.add(line));
    if (findingId !== undefined && findingId !== null) sourceMap.get(sourceKey).findingIds.add(String(findingId));
};

const sortTextSources = (sourceMap) => Array.from(sourceMap.values())
    .map(source => ({
        text: source.text,
        findingIds: sortFindingIds(source.findingIds),
        evidenceLines: sortStrings(source.evidenceLines || [])
    }))
    .filter(source => source.text || source.evidenceLines.length > 0)
    .sort((a, b) => (a.text || a.evidenceLines.join(' ')).localeCompare(b.text || b.evidenceLines.join(' '), undefined, { numeric: true }));

const finalizeEndpointDetails = (endpointDetailsMap) => Array.from(endpointDetailsMap.values())
    .map(detail => ({
        label: detail.label,
        host: detail.host,
        severity: detail.severity,
        cves: sortStrings(detail.cves),
        mitigations: sortStrings(detail.mitigations),
        findingIds: sortFindingIds(detail.findingIds)
    }))
    .sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }) || a.label.localeCompare(b.label, undefined, { numeric: true }));

const sourceStatus = (activeCount, mitigatedCount) => (
    activeCount > 0 && mitigatedCount > 0
        ? 'mixed'
        : activeCount > 0
            ? 'active'
            : 'mitigated'
);

const finalizeSourceGroups = (sourceGroupsMap) => Array.from(sourceGroupsMap.values())
    .map(sourceGroup => ({
        title: sourceGroup.title,
        findingIds: sortFindingIds(sourceGroup.findingIds),
        severity: sourceGroup.severity || 'Info',
        cveIds: sortStrings(sourceGroup.cveIds),
        endpointDetails: finalizeEndpointDetails(sourceGroup.endpointDetailsMap),
        descriptionSources: sortTextSources(sourceGroup.descriptionsMap),
        impactSources: sortTextSources(sourceGroup.impactsMap),
        mitigations: sortStrings(sourceGroup.mitigations),
        activeCount: sourceGroup.activeCount,
        mitigatedCount: sourceGroup.mitigatedCount,
        currentStatus: sourceStatus(sourceGroup.activeCount, sourceGroup.mitigatedCount)
    }))
    .sort((a, b) => {
        const versionA = getTitleVersion(a.title);
        const versionB = getTitleVersion(b.title);
        if (versionA && versionB) return compareVersions(versionB, versionA);
        if (versionA) return -1;
        if (versionB) return 1;
        return a.title.localeCompare(b.title, undefined, { numeric: true });
    });

const collectCveIds = (finding = {}) => {
    const ids = new Set();
    const push = (value) => {
        if (value && typeof value === 'object') {
            push(value.vulnerability_id || value.name || value.id);
            return;
        }
        const cleaned = String(value || '').trim();
        if (cleaned && !['none', 'n/a'].includes(cleaned.toLowerCase())) ids.add(cleaned);
    };
    normalizeArray(finding.cve_ids).forEach(push);
    normalizeArray(finding.cves).forEach(push);
    normalizeArray(finding.vulnerability_ids).forEach(push);
    push(finding.cve || finding.CVE);
    return Array.from(ids).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const isFindingMitigated = (finding = {}) => (
    finding.mitigated === true
    || finding.is_mitigated === true
    || String(finding.mitigated || '').toLowerCase() === 'true'
    || String(finding.is_mitigated || '').toLowerCase() === 'true'
    || Boolean(finding.mitigated_at || finding.mitigation_confirmed_at || finding.mitigation_confirmed)
);

const isFindingActive = (finding = {}) => {
    if (finding.active === false || String(finding.active || '').toLowerCase() === 'false') return false;
    return !isFindingMitigated(finding);
};

const normalizeCompactText = (value = '') => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const normalizeCompactFamilyText = (value = '') => (
    normalizeCompactText(value)
        .replace(UPGRADE_TARGET_RE, (_match, software) => `upgrade to ${cleanSoftwareName(software).toLowerCase()} version <version> or later`)
        .replace(/\bversion\s+[0-9][0-9a-z.-]*/gi, 'version <version>')
);

const getMitigationText = (finding = {}) => String(finding.mitigation || finding.solution || finding.remediation || '').trim();

const getStrictFamilyKey = (finding = {}) => ([
    'strict',
    normalizeCompactFamilyText(finding.title || finding.name || 'Untitled finding'),
    normalizeCompactFamilyText(getMitigationText(finding)),
    normalizeCompactFamilyText(finding.description || ''),
    normalizeCompactFamilyText(finding.impact || '')
].join('|'));

const getKnownNoCveFamily = (finding = {}) => {
    const title = normalizeCompactFamilyText(finding.title || finding.name);
    const hasSslOrTls = /\b(?:ssl|tls)\b/i.test(title);
    const hasCertificate = /\bcert(?:ificate)?s?\b/i.test(title);
    const hasTrustSignal = /cannot be trusted|not trusted|untrusted|self[-\s]?signed|invalid chain|certificate chain|expired|hostname|common[-\s]?name|name mismatch|unknown ca|unrecognized ca/i.test(title);
    const isProtocolOrCipher = /\b(?:protocol|cipher|sslv2|sslv3|tlsv1|sweet32|beast|poodle)\b/i.test(title);

    if (hasSslOrTls && hasCertificate && hasTrustSignal && !isProtocolOrCipher) {
        return {
            key: 'ssl-certificate-trust',
            title: 'SSL Certificate Trust Issues'
        };
    }

    return null;
};

const parseUpgradeText = (value = '') => {
    const match = String(value || '').trim().match(UPGRADE_TARGET_RE);
    if (!match) return null;
    return {
        software: cleanSoftwareName(match[1]),
        version: match[2].replace(/\.$/, '')
    };
};

const parseUpgradeTarget = (finding = {}) => {
    const sources = [getMitigationText(finding), finding.title, finding.name].filter(Boolean);
    for (const source of sources) {
        const target = parseUpgradeText(source);
        if (target) return target;
    }

    const titleMatch = String(finding.title || finding.name || '').trim().match(TITLE_VERSION_RE);
    if (!titleMatch) return null;

    return {
        software: cleanSoftwareName(titleMatch[1]),
        version: titleMatch[2].replace(/\.$/, '')
    };
};

const resolveCompactionFamily = (finding = {}) => {
    const cveIds = collectCveIds(finding);
    const cveSignature = cveIds.join(',');
    const target = parseUpgradeTarget(finding);

    if (target) {
        return {
            cveIds,
            cveSignature,
            familyKey: `upgrade|${normalizeCompactFamilyText(target.software)}`,
            familyTitle: getSoftwareFamilyTitle(target.software, [finding.title || finding.name || '']) || `${target.software} Vulnerabilities`,
            softwareFamily: target.software,
            reason: 'upgrade-family',
            isSoftwareFamily: true
        };
    }

    const knownFamily = cveIds.length === 0 ? getKnownNoCveFamily(finding) : null;
    if (knownFamily) {
        return {
            cveIds,
            cveSignature,
            familyKey: `known|${knownFamily.key}`,
            familyTitle: knownFamily.title,
            softwareFamily: '',
            reason: 'known-no-cve-family',
            isSoftwareFamily: false
        };
    }

    if (cveIds.length > 0) {
        return {
            cveIds,
            cveSignature,
            familyKey: `cve|${cveSignature}`,
            familyTitle: '',
            softwareFamily: '',
            reason: 'same-cve',
            isSoftwareFamily: false
        };
    }

    return {
        cveIds,
        cveSignature,
        familyKey: getStrictFamilyKey(finding),
        familyTitle: '',
        softwareFamily: '',
        reason: 'strict-fingerprint',
        isSoftwareFamily: false
    };
};

const getSoftwareFamilyTitle = (softwareFamily = '', titles = []) => {
    const software = String(softwareFamily || '').trim();
    if (!software) return '';
    const hasMultipleVulnerabilities = normalizeArray(titles)
        .some(title => /multiple vulnerabilities/i.test(String(title || '')));
    return `${software} ${hasMultipleVulnerabilities ? 'Multiple Vulnerabilities' : 'Vulnerabilities'}`;
};

const buildFindingFingerprint = (finding = {}) => {
    const family = resolveCompactionFamily(finding);
    const detailKey = getHistoryCompactionDetailKey(finding);

    return {
        cveIds: family.cveIds,
        cveSignature: family.cveSignature,
        compactFamilyKey: family.familyKey,
        compactFamilyTitle: family.familyTitle,
        compactReason: family.reason,
        softwareFamily: family.softwareFamily,
        isSoftwareFamily: family.isSoftwareFamily,
        groupKey: [
            family.familyKey,
            detailKey,
            'route',
            normalizeCompactFamilyText(finding.product_id || finding.product_name || ''),
            normalizeCompactFamilyText(finding.engagement_id || finding.engagement_name || '')
        ].join('|')
    };
};

const groupFindingsByFingerprint = (findings = []) => {
    const groups = new Map();
    findings.forEach(finding => {
        const fingerprint = buildFindingFingerprint(finding);
        if (!groups.has(fingerprint.groupKey)) {
            groups.set(fingerprint.groupKey, {
                groupKey: fingerprint.groupKey,
                softwareFamilies: new Set(),
                titles: new Set(),
                descriptions: new Set(),
                impacts: new Set(),
                mitigations: new Set(),
                endpoints: new Set(),
                cveIds: new Set(),
                compactFamilyKeys: new Set(),
                compactFamilyTitles: new Set(),
                compactReasons: new Set(),
                sourceGroupsMap: new Map(),
                findingIds: [],
                activeCount: 0,
                mitigatedCount: 0
            });
        }
        const group = groups.get(fingerprint.groupKey);
        const findingId = String(finding.id || finding.finding_id || '');
        const title = String(finding.title || finding.name || 'Untitled finding').trim();
        const mitigation = getMitigationText(finding);
        const endpoints = normalizeArray(finding.endpoints).length > 0
            ? normalizeArray(finding.endpoints)
            : [{ host: 'Unknown host' }];
        if (fingerprint.softwareFamily) group.softwareFamilies.add(fingerprint.softwareFamily);
        if (fingerprint.compactFamilyKey) group.compactFamilyKeys.add(fingerprint.compactFamilyKey);
        if (fingerprint.compactFamilyTitle) group.compactFamilyTitles.add(fingerprint.compactFamilyTitle);
        if (fingerprint.compactReason) group.compactReasons.add(fingerprint.compactReason);
        if (title) group.titles.add(title);
        if (finding.description) group.descriptions.add(String(finding.description));
        if (finding.impact) group.impacts.add(String(finding.impact));
        if (mitigation) group.mitigations.add(mitigation);
        endpoints.forEach(endpoint => group.endpoints.add(endpointLabel(endpoint)));
        group.findingIds.push(findingId);
        fingerprint.cveIds.forEach(cveId => group.cveIds.add(cveId));

        if (!group.sourceGroupsMap.has(title)) {
            group.sourceGroupsMap.set(title, {
                title,
                findingIds: [],
                severity: finding.severity || 'Info',
                cveIds: new Set(),
                endpointDetailsMap: new Map(),
                descriptionsMap: new Map(),
                impactsMap: new Map(),
                mitigations: new Set(),
                activeCount: 0,
                mitigatedCount: 0
            });
        }

        const sourceGroup = group.sourceGroupsMap.get(title);
        sourceGroup.findingIds.push(findingId);
        fingerprint.cveIds.forEach(cveId => sourceGroup.cveIds.add(cveId));
        if (finding.description) addTextSource(sourceGroup.descriptionsMap, finding.description, findingId);
        if (finding.impact) addTextSource(sourceGroup.impactsMap, finding.impact, findingId);
        if (mitigation) sourceGroup.mitigations.add(mitigation);
        endpoints.forEach(endpoint => {
            const label = endpointLabel(endpoint);
            if (!sourceGroup.endpointDetailsMap.has(label)) {
                sourceGroup.endpointDetailsMap.set(label, {
                    label,
                    host: endpointHost(endpoint),
                    severity: finding.severity || 'Info',
                    cves: new Set(),
                    mitigations: new Set(),
                    findingIds: []
                });
            }
            const detail = sourceGroup.endpointDetailsMap.get(label);
            detail.findingIds.push(findingId);
            fingerprint.cveIds.forEach(cveId => detail.cves.add(cveId));
            if (mitigation) detail.mitigations.add(mitigation);
        });

        if (isFindingMitigated(finding)) {
            group.mitigatedCount += 1;
            sourceGroup.mitigatedCount += 1;
        } else if (isFindingActive(finding)) {
            group.activeCount += 1;
            sourceGroup.activeCount += 1;
        }
    });

    return Array.from(groups.values()).map(group => {
        const cveIds = Array.from(group.cveIds).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const allTitles = Array.from(group.titles).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const compactFamilyTitle = sortStrings(group.compactFamilyTitles)[0] || '';
        const sourceGroups = finalizeSourceGroups(group.sourceGroupsMap);
        return {
            ...group,
            title: sourceGroups[0]?.title || allTitles[0] || compactFamilyTitle || 'Untitled finding',
            compactFamilyKey: sortStrings(group.compactFamilyKeys)[0] || group.groupKey,
            compactFamilyTitle,
            compactReason: sortStrings(group.compactReasons)[0] || 'strict-fingerprint',
            allTitles,
            allDescriptions: Array.from(group.descriptions),
            allImpacts: Array.from(group.impacts),
            allMitigations: Array.from(group.mitigations),
            endpointDetails: Array.from(group.endpoints).filter(Boolean),
            sourceGroups,
            cveIds,
            cveId: cveIds.join(','),
            findingCount: group.findingIds.length,
            currentStatus: sourceStatus(group.activeCount, group.mitigatedCount)
        };
    });
};

const groupFindingsByCve = groupFindingsByFingerprint;

const evaluateResolveRecheck = ({ ticket = {}, findings = [], statusIds = {} } = {}) => {
    if (!isResolveStatus(ticket.status, ticket.statusId, statusIds)) return [];
    const findingsById = new Map(findings.map(finding => [String(finding.id || finding.finding_id), finding]));
    return normalizeArray(ticket.findingIds).map(findingId => {
        const finding = findingsById.get(String(findingId));
        if (!finding) return { findingId: String(findingId), result: 'not_found' };
        if (isFindingActive(finding)) return { findingId: String(findingId), result: 'reopen' };
        if (isFindingMitigated(finding)) return { findingId: String(findingId), result: 'manual_review' };
        return { findingId: String(findingId), result: 'checked' };
    });
};

const formatCanonicalTextBlock = (title, sources = [], endpointDetails = []) => {
    const escapeText = (text = '') => (
        String(text || '').trim()
            .replace(/\busing the following request\s*:\s*https?:\/\/\S+/i, 'using a request to the affected endpoint')
            .replace(/\s*This produced the following truncated output[\s\S]*$/i, '\n\nEvidence output omitted. See DefectDojo finding for raw truncated output.')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    );
    const formatEvidenceLine = (value = '') => {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';

        const lines = [];
        const urlMatch = text.match(/\b(URL|URI)\s*:\s*(https?:\/\/\S+)(\s+\([^)]*\))?/i);
        if (urlMatch) {
            lines.push(`${urlMatch[1].toUpperCase()}: ${urlMatch[2]}${urlMatch[3] || ''}`);
        }
        const versionSourceMatch = text.match(/\bVersion source\s*:\s*(.*?)(?=\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:|$)/i);
        if (versionSourceMatch) {
            lines.push(`Version source : ${String(versionSourceMatch[1] || '').replace(/\s+/g, ' ').trim()}`);
        }

        const versionRe = /\b(Installed|Detected|Current|Fixed|Affected) version\s*:\s*([^\s]+)/gi;
        let versionMatch = versionRe.exec(text);
        while (versionMatch) {
            const label = `${versionMatch[1][0].toUpperCase()}${versionMatch[1].slice(1).toLowerCase()} version`;
            lines.push(`${label.padEnd(18, ' ')}: ${versionMatch[2]}`);
            versionMatch = versionRe.exec(text);
        }

        return lines.length > 0 ? lines.join('\n') : text;
    };
    const items = normalizeArray(sources)
        .map(source => (typeof source === 'string' ? { text: source, findingIds: [] } : source))
        .map(source => ({
            ...source,
            text: escapeText(source?.text || ''),
            evidenceLines: sortStrings(source?.evidenceLines || []).map(line => escapeText(formatEvidenceLine(line)))
        }))
        .filter(source => source?.text || source.evidenceLines.length > 0);
    const formatSourceAssets = (source = {}, endpointDetails = []) => {
        const sourceFindingIds = new Set(sortFindingIds(source.findingIds || []).map(id => String(id)));
        if (sourceFindingIds.size === 0) return '';
        const scopedDetails = normalizeArray(endpointDetails).filter(detail => (
            normalizeArray(detail.findingIds).some(findingId => sourceFindingIds.has(String(findingId)))
        ));
        if (scopedDetails.length === 0) return '';
        return `Affected IP:\n${formatCanonicalAssets(scopedDetails)}`;
    };
    const formatItem = (item) => [
        items.length > 1 ? formatSourceAssets(item, endpointDetails) : '',
        item.text,
        item.evidenceLines.length > 0 ? item.evidenceLines.join('\n') : ''
    ].filter(Boolean).join('\n');
    if (items.length === 0) return '';
    if (items.length === 1) return `\n\n**${title}:**\n${formatItem(items[0])}`;
    return `\n\n**${title}:**\n${items.map((source, index) => {
        const findingIds = sortFindingIds(source.findingIds || []);
        const label = findingIds.length > 0
            ? `Source ${index + 1} (DefectDojo Finding IDs: ${findingIds.join(', ')})`
            : `Source ${index + 1}`;
        return `${label}:\n${formatItem(source)}`;
    }).join('\n\n')}`;
};

const formatCanonicalAssets = (endpointDetails = []) => {
    const byHost = new Map();
    normalizeArray(endpointDetails).forEach(detail => {
        const host = detail.host || 'Unknown host';
        if (!byHost.has(host)) byHost.set(host, []);
        byHost.get(host).push(detail);
    });
    if (byHost.size === 0) return 'None';
    return Array.from(byHost.entries())
        .sort(([hostA], [hostB]) => hostA.localeCompare(hostB, undefined, { numeric: true }))
        .map(([host, details]) => {
            const lines = details
                .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true }))
                .map(detail => `  - ${detail.label} (Severity: ${detail.severity || 'Info'})`)
                .join('\n');
            return `**Host:** ${host}\n${lines}`;
        })
        .join('\n\n');
};

const formatCanonicalRouteValue = (name, id) => {
    if (name && id) return `${name} (ID: ${id})`;
    return name || id || 'N/A';
};

const formatCanonicalDefectDojoContext = (ticket = {}) => {
    const project = formatCanonicalRouteValue(ticket.defectDojoProjectName || ticket.productName, ticket.defectDojoProjectId || ticket.productId);
    const engagement = formatCanonicalRouteValue(ticket.defectDojoEngagementName || ticket.engagementName, ticket.defectDojoEngagementId || ticket.engagementId);
    if (project === 'N/A' && engagement === 'N/A') return '';
    return `\n\n**DefectDojo Context:**\n- Project: ${project}\n- Engagement: ${engagement}`;
};

const parseCanonicalTitleUpgradeTarget = (value = '') => {
    const titleMatch = String(value || '').trim().match(TITLE_VERSION_RE);
    if (!titleMatch) return null;
    return {
        software: cleanSoftwareName(titleMatch[1]),
        version: titleMatch[2].replace(/\.$/, '')
    };
};

const getCanonicalTicketUpgradeTarget = (ticket = {}) => {
    const candidates = [
        ticket.title,
        ticket.subject,
        ...normalizeArray(ticket.allTitles),
        ...normalizeArray(ticket.allMitigations),
        ...normalizeArray(ticket.sourceGroups).flatMap(sourceGroup => [
            sourceGroup.title,
            ...normalizeArray(sourceGroup.mitigations)
        ])
    ];
    return candidates
        .map(candidate => parseUpgradeText(candidate) || parseCanonicalTitleUpgradeTarget(candidate))
        .filter(target => target?.software && target?.version)
        .sort((left, right) => compareVersions(right.version, left.version))[0] || null;
};

const getCanonicalEndpointPort = (detail = {}) => {
    const label = String(detail.label || '').trim();
    const match = label.match(/:(\d+)(?:\/|\s|$)?/);
    return match ? match[1] : '';
};

const formatCanonicalAssetsAndPorts = (endpointDetails = []) => {
    const hosts = new Map();
    normalizeArray(endpointDetails).forEach(detail => {
        const host = String(detail.host || 'Unknown host').trim();
        if (!hosts.has(host)) hosts.set(host, { ports: new Set(), labels: new Set() });
        const port = getCanonicalEndpointPort(detail);
        if (port) hosts.get(host).ports.add(port);
        if (detail.label) hosts.get(host).labels.add(String(detail.label));
    });
    if (hosts.size === 0) return 'None';
    return Array.from(hosts.entries())
        .sort(([hostA], [hostB]) => hostA.localeCompare(hostB, undefined, { numeric: true }))
        .map(([host, detail]) => {
            const ports = sortStrings(detail.ports);
            if (ports.length > 0) return `**Host:** ${host}\n\n**Affected Ports:** ${ports.join(', ')}`;
            return `**Host:** ${host}\n\n**Affected Endpoints:** ${sortStrings(detail.labels).join(', ') || 'N/A'}`;
        })
        .join('\n\n');
};

const normalizeCanonicalTextSource = (source = {}) => ({
    text: source.text || '',
    findingIds: sortFindingIds(source.findingIds || []),
    evidenceLines: sortStrings(source.evidenceLines || []),
    endpointDetails: normalizeArray(source.endpointDetails)
});

const collectCanonicalAppendixSources = (sourceGroups = [], sourceKey = 'descriptionSources') => {
    const sourcesByKey = new Map();
    normalizeArray(sourceGroups).forEach(sourceGroup => {
        normalizeArray(sourceGroup[sourceKey]).forEach(source => {
            const sourceItem = normalizeCanonicalTextSource({
                ...source,
                endpointDetails: sourceGroup.endpointDetails || []
            });
            if (!sourceItem.text && sourceItem.evidenceLines.length === 0) return;
            const key = [
                sourceItem.text,
                ...sourceItem.evidenceLines.map(line => line
                    .replace(/\bURL\s*:\s*https?:\/\/\S+/gi, 'URL: <endpoint>')
                    .replace(/\bhttps?:\/\/[^\s)]+/gi, '<url>')
                    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<host>')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase())
            ].join('|');
            if (!sourcesByKey.has(key)) {
                sourcesByKey.set(key, {
                    text: sourceItem.text,
                    findingIds: new Set(),
                    evidenceLines: new Set(),
                    endpointDetails: []
                });
            }
            const target = sourcesByKey.get(key);
            sourceItem.findingIds.forEach(findingId => target.findingIds.add(String(findingId)));
            sourceItem.evidenceLines.forEach(line => target.evidenceLines.add(line));
            target.endpointDetails.push(...sourceItem.endpointDetails);
        });
    });
    return Array.from(sourcesByKey.values()).map(source => normalizeCanonicalTextSource(source));
};

const formatCanonicalQuoteBlock = (value = '') => (
    String(value || '').trim().split('\n').map(line => `> ${line}`).join('\n')
);

const formatCanonicalAppendixTextBlock = (title, sources = []) => {
    const items = normalizeArray(sources)
        .map(source => normalizeCanonicalTextSource(source))
        .filter(source => source.text || source.evidenceLines.length > 0);
    if (items.length === 0) return '';

    const escapeText = (text = '') => (
        String(text || '').trim()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    );
    const formatEvidenceLine = (value = '') => {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        const lines = [];
        const urlMatch = text.match(/\b(URL|URI)\s*:\s*(https?:\/\/\S+)(\s+\([^)]*\))?/i);
        if (urlMatch) lines.push(`${urlMatch[1].toUpperCase()}: ${urlMatch[2]}${urlMatch[3] || ''}`);
        const versionSourceMatch = text.match(/\bVersion source\s*:\s*(.*?)(?=\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:|$)/i);
        if (versionSourceMatch) lines.push(`Version source : ${String(versionSourceMatch[1] || '').replace(/\s+/g, ' ').trim()}`);
        const versionRe = /\b(Installed|Detected|Current|Fixed|Affected) version\s*:\s*([^\s]+)/gi;
        let versionMatch = versionRe.exec(text);
        while (versionMatch) {
            const label = `${versionMatch[1][0].toUpperCase()}${versionMatch[1].slice(1).toLowerCase()} version`;
            lines.push(`${label.padEnd(18, ' ')}: ${versionMatch[2]}`);
            versionMatch = versionRe.exec(text);
        }
        return lines.length > 0 ? lines.join('\n') : text;
    };
    const formatSourceAssets = (source = {}) => {
        const sourceFindingIds = new Set(sortFindingIds(source.findingIds || []).map(id => String(id)));
        const scopedDetails = normalizeArray(source.endpointDetails).filter(detail => (
            normalizeArray(detail.findingIds).some(findingId => sourceFindingIds.has(String(findingId)))
        ));
        return scopedDetails.length > 0 ? `Affected IP:\n${formatCanonicalAssets(scopedDetails)}` : '';
    };
    const formatItem = (item, includeAssets) => [
        includeAssets ? formatSourceAssets(item) : '',
        escapeText(item.text || ''),
        ...item.evidenceLines.map(line => escapeText(formatEvidenceLine(line)))
    ].filter(Boolean).join('\n');

    if (items.length === 1) return `\n\n**${title}:**\n${formatCanonicalQuoteBlock(formatItem(items[0], false))}`;

    return `\n\n**${title}:**\n${items.map((item, index) => {
        const findingIds = sortFindingIds(item.findingIds || []);
        const label = findingIds.length > 0
            ? `Source ${index + 1} (DefectDojo Finding IDs: ${findingIds.join(', ')})`
            : `Source ${index + 1}`;
        return `${label}:\n${formatItem(item, true)}`;
    }).join('\n\n')}`;
};

const buildCanonicalMarkdown = (ticket = {}) => {
    const sourceGroups = normalizeArray(ticket.sourceGroups);
    const target = getCanonicalTicketUpgradeTarget(ticket);
    const targetMitigation = target
        ? `Upgrade to ${target.software} version ${target.version} or later.`
        : sortStrings(ticket.allMitigations || [])[0] || 'Review the affected finding and apply the recommended remediation.';
    const cveIds = sortStrings([
        ...normalizeArray(ticket.cveIds),
        ...normalizeArray(ticket.allCVEs).map(cve => cve?.vulnerability_id || cve?.name || cve?.id || cve)
    ]);
    const descriptionSources = collectCanonicalAppendixSources(sourceGroups, 'descriptionSources');
    const impactSources = collectCanonicalAppendixSources(sourceGroups, 'impactSources');
    const endpointDetails = sourceGroups.flatMap(sourceGroup => normalizeArray(sourceGroup.endpointDetails));
    const cveBlock = cveIds.length > 0 ? cveIds.join(', ') : 'None';

    return `Vulnerability Overview:\nThe endpoints listed below are running outdated software and require patching.${formatCanonicalDefectDojoContext(ticket)}\n\n**Target Mitigation:**\n${targetMitigation}\n\n**Affected Assets & Ports:**\n\n${formatCanonicalAssetsAndPorts(endpointDetails)}\n\n**Appendix:** Vulnerability Details\n**Associated CVEs:** ${cveBlock}${formatCanonicalAppendixTextBlock('DefectDojo Description', descriptionSources)}${formatCanonicalAppendixTextBlock('Impact', impactSources)}`;
};

module.exports = {
    normalizeStatus,
    isResolveStatus,
    isInProgressStatus,
    isClosedStatus,
    collectCveIds,
    resolveCompactionFamily,
    buildFindingFingerprint,
    buildCompactedSyncKey,
    buildLegacyCompactedSyncKey,
    groupFindingsByFingerprint,
    groupFindingsByCve,
    evaluateResolveRecheck,
    buildCanonicalMarkdown
};
