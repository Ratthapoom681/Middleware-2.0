const test = require('node:test');
const assert = require('node:assert/strict');
const {
    groupFindingsByFingerprint,
    buildCanonicalMarkdown,
    buildCompactedSyncKey,
    buildLegacyCompactedSyncKey,
    buildFindingFingerprint,
    evaluateResolveRecheck,
    isClosedStatus,
    isResolveStatus
} = require('../backend/domain/history-utils.cjs');
const {
    findTicketForGroup
} = require('../backend/data/database.cjs').__test;
const {
    buildBackendCompactedRedmineTicketRefs,
    collectAutoCweIds
} = require('../backend/domain/compaction.cjs');
const redmineClient = require('../backend/integrations/redmine-client.cjs');
const {
    createSyncHistorySplitGroups
} = require('../backend/domain/sync-history-utils.cjs');

test('groups compacted findings into upgrade-family super tickets without splitting per CVE', () => {
    const groups = groupFindingsByFingerprint([
        { id: 1, title: 'Apache 2.4.x < 2.4.58 Multiple Vulnerabilities', vulnerability_ids: [{ vulnerability_id: 'CVE-2023-43622' }], impact: 'Shared Apache advisory', description: 'Multiple vulnerabilities', mitigation: 'Upgrade to Apache version 2.4.58 or later.', active: true, is_mitigated: false },
        { id: 2, title: 'Apache 2.4.x < 2.4.60 Multiple Vulnerabilities', vulnerability_ids: [{ vulnerability_id: 'CVE-2024-38472' }, { vulnerability_id: 'CVE-2024-38473' }], impact: 'Shared Apache advisory', description: 'Multiple vulnerabilities', mitigation: 'Upgrade to Apache version 2.4.60 or later.', active: false, is_mitigated: true },
        { id: 3, title: 'OpenSSL issue', cve_ids: ['CVE-2026-0001'], impact: 'Remote access', description: 'Old package', active: true, is_mitigated: false },
        { id: 4, title: 'No CVE item', impact: 'Local', description: 'Config', active: true },
        { id: 5, title: 'No CVE item', impact: 'Local', description: 'Config', active: true }
    ]);

    const apacheGroup = groups.find(group => group.groupKey.startsWith('upgrade|apache|'));
    assert.equal(apacheGroup.currentStatus, 'mixed');
    assert.equal(apacheGroup.title, 'Apache 2.4.x < 2.4.60 Multiple Vulnerabilities');
    assert.deepEqual(apacheGroup.cveIds, ['CVE-2023-43622', 'CVE-2024-38472', 'CVE-2024-38473']);
    assert.deepEqual(apacheGroup.findingIds, ['1', '2']);
    assert.equal(groups.some(group => group.cveId === 'CVE-2024-38472'), false);

    const singleCveGroup = groups.find(group => group.cveId === 'CVE-2026-0001');
    assert.deepEqual(singleCveGroup.findingIds, ['3']);

    const rawGroup = groups.find(group => group.cveId === '');
    assert.equal(rawGroup.currentStatus, 'active');
    assert.deepEqual(rawGroup.findingIds, ['4', '5']);
    assert.equal(groups.length, 3);
});

test('backend compaction carries CWE metadata without using CWE as ticket identity', () => {
    assert.deepEqual(collectAutoCweIds({ cwe: 79 }), ['CWE-79']);
    assert.deepEqual(collectAutoCweIds({ cwes: [{ id: 'CWE-89: SQL Injection' }, { cwe_id: 79 }] }), ['CWE-79', 'CWE-89']);

    const groups = buildBackendCompactedRedmineTicketRefs([
        {
            id: 7001,
            title: 'Reflected XSS in login form',
            severity: 'Medium',
            cwe: 79,
            description: 'Login parameter is reflected.',
            impact: 'Browser script execution.',
            endpoints: [{ protocol: 'https', host: 'app.example.test', port: 443 }],
            active: true
        },
        {
            id: 7002,
            title: 'Stored XSS in profile page',
            severity: 'Medium',
            cwe: 'CWE-79',
            description: 'Profile name is stored unsafely.',
            impact: 'Browser script execution from stored content.',
            endpoints: [{ protocol: 'https', host: 'app.example.test', port: 443 }],
            active: true
        },
        {
            id: 7003,
            title: 'OpenSSL issue with CWE and CVE',
            severity: 'High',
            cve_ids: ['CVE-2026-7003'],
            cwe_id: 'CWE-20',
            description: 'Input validation issue.',
            impact: 'Service impact.',
            endpoints: [{ protocol: 'tcp', host: '10.0.0.7', port: 443 }],
            active: true
        }
    ]);

    const xssGroups = groups.filter(group => group.cweIds.includes('CWE-79'));
    assert.equal(xssGroups.length, 2);
    assert.ok(xssGroups.every(group => group.cveIds.length === 0));
    assert.ok(xssGroups.every(group => group.allCWEs.some(cwe => cwe.weakness_id === 'CWE-79')));

    const cveGroup = groups.find(group => group.cveId === 'CVE-2026-7003');
    assert.deepEqual(cveGroup.cweIds, ['CWE-20']);
    assert.match(cveGroup.superTicketMarkdown, /\*\*Associated CVEs:\*\* CVE-2026-7003/);
    assert.match(cveGroup.superTicketMarkdown, /\*\*Associated CWEs:\*\* CWE-20/);
});

test('groups php multiple-vulnerability titles across versions into one software-family ticket', () => {
    const endpoint80 = { protocol: 'tcp', host: '10.149.20.45', port: 80 };
    const endpoint443 = { protocol: 'tcp', host: '10.149.20.48', port: 443 };
    const groups = groupFindingsByFingerprint([
        { id: 10, title: 'PHP 8.2.x < 8.2.18 Multiple Vulnerabilities', severity: 'High', vulnerability_ids: [{ vulnerability_id: 'CVE-2024-0001' }], description: 'PHP shared description', impact: 'PHP shared impact', mitigation: 'Upgrade to PHP version 8.2.18 or later.', endpoints: [endpoint80], active: true, is_mitigated: false },
        { id: 11, title: 'PHP 8.2.x < 8.2.20 Multiple Vulnerabilities', severity: 'High', vulnerability_ids: [{ vulnerability_id: 'CVE-2024-0002' }], description: 'PHP shared description', impact: 'PHP shared impact', mitigation: 'Upgrade to PHP version 8.2.20 or later.', endpoints: [endpoint443], active: true, is_mitigated: false },
        { id: 12, title: 'PHP 8.2.x < 8.2.24 Multiple Vulnerabilities', severity: 'Critical', vulnerability_ids: [{ vulnerability_id: 'CVE-2024-0003' }], description: 'PHP shared description', impact: 'PHP shared impact', mitigation: 'Upgrade to PHP version 8.2.24 or later.', endpoints: [endpoint80], active: true, is_mitigated: false },
        { id: 13, title: 'PHP 8.2.x < 8.2.26 Multiple Vulnerabilities', severity: 'Critical', vulnerability_ids: [{ vulnerability_id: 'CVE-2024-0004' }], description: 'PHP shared description', impact: 'PHP shared impact', mitigation: 'Upgrade to PHP version 8.2.26 or later.', endpoints: [endpoint443], active: false, is_mitigated: true },
        { id: 14, title: 'PHP 8.2.x < 8.2.28 Multiple Vulnerabilities', severity: 'Critical', vulnerability_ids: [{ vulnerability_id: 'CVE-2024-0005' }, { vulnerability_id: 'CVE-2024-0006' }], description: 'PHP shared description', impact: 'PHP shared impact', mitigation: 'Upgrade to PHP version 8.2.28 or later.', endpoints: [endpoint80, endpoint443], active: true, is_mitigated: false }
    ]);

    assert.equal(groups.length, 1);
    const phpGroup = groups[0];
    assert.equal(phpGroup.title, 'PHP 8.2.x < 8.2.28 Multiple Vulnerabilities');
    assert.equal(phpGroup.findingCount, 5);
    assert.deepEqual(phpGroup.findingIds, ['10', '11', '12', '13', '14']);
    assert.deepEqual(phpGroup.cveIds, ['CVE-2024-0001', 'CVE-2024-0002', 'CVE-2024-0003', 'CVE-2024-0004', 'CVE-2024-0005', 'CVE-2024-0006']);
    assert.equal(phpGroup.currentStatus, 'mixed');
    assert.equal(phpGroup.sourceGroups.length, 5);
    assert.equal(phpGroup.sourceGroups[0].title, 'PHP 8.2.x < 8.2.28 Multiple Vulnerabilities');
    assert.deepEqual(phpGroup.sourceGroups[0].findingIds, [14]);
    assert.deepEqual(phpGroup.sourceGroups[0].cveIds, ['CVE-2024-0005', 'CVE-2024-0006']);
    assert.deepEqual(phpGroup.sourceGroups[0].descriptionSources, [{ text: 'PHP shared description', findingIds: [14], evidenceLines: [] }]);
    assert.deepEqual(phpGroup.sourceGroups[0].impactSources, [{ text: 'PHP shared impact', findingIds: [14], evidenceLines: [] }]);
    assert.equal(phpGroup.sourceGroups[0].endpointDetails.length, 2);

    const markdown = buildCanonicalMarkdown({
        ...phpGroup,
        defectDojoProjectName: 'A',
        defectDojoProjectId: '8',
        defectDojoEngagementName: 'A1',
        defectDojoEngagementId: '74'
    });
    assert.match(markdown, /Vulnerability Overview:\nThe endpoints listed below are running outdated software and require patching\./);
    assert.match(markdown, /\*\*DefectDojo Context:\*\*\n- Project: A \(ID: 8\)\n- Engagement: A1 \(ID: 74\)/);
    assert.match(markdown, /\*\*Target Mitigation:\*\*\nUpgrade to PHP version 8\.2\.28 or later\./);
    assert.match(markdown, /\*\*Affected Assets & Ports:\*\*\n\n\*\*Host:\*\* 10\.149\.20\.45\n\n\*\*Affected Ports:\*\* 80/);
    assert.match(markdown, /\*\*Host:\*\* 10\.149\.20\.48\n\n\*\*Affected Ports:\*\* 443/);
    assert.match(markdown, /\*\*Appendix:\*\* Vulnerability Details\n\*\*Associated CVEs:\*\* CVE-2024-0001, CVE-2024-0002, CVE-2024-0003, CVE-2024-0004, CVE-2024-0005, CVE-2024-0006/);
    assert.match(markdown, /\*\*DefectDojo Description:\*\*\n> PHP shared description/);
    assert.match(markdown, /\*\*Impact:\*\*\n> PHP shared impact/);
});

test('groups SSL certificate trust findings without CVEs into one readable family ticket', () => {
    const groups = groupFindingsByFingerprint([
        { id: 200, title: 'SSL Certificate Cannot Be Trusted', severity: 'Medium', description: 'The certificate chain is not trusted.', endpoints: [{ host: '10.0.0.1', port: 443 }] },
        { id: 201, title: 'SSL Self-Signed Certificate', severity: 'Medium', description: 'The certificate chain is not trusted.', endpoints: [{ host: '10.0.0.2', port: 443 }] }
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, 'SSL Certificate Cannot Be Trusted');
    assert.equal(groups[0].compactFamilyKey, 'known|ssl-certificate-trust');
    assert.equal(groups[0].compactReason, 'known-no-cve-family');
    assert.equal(groups[0].findingCount, 2);
    assert.deepEqual(groups[0].findingIds, ['200', '201']);
});

test('does not merge SSL certificate trust findings with TLS protocol or cipher findings', () => {
    const groups = groupFindingsByFingerprint([
        { id: 210, title: 'SSL Certificate Cannot Be Trusted', severity: 'Medium', description: 'The certificate chain is not trusted.' },
        { id: 211, title: 'TLS Version 1.0 Protocol Detection', severity: 'Medium', description: 'The remote service accepts TLS 1.0.' },
        { id: 212, title: 'SSL Weak Cipher Suites Supported', severity: 'Medium', description: 'The remote service supports weak ciphers.' }
    ]);

    assert.equal(groups.length, 3);
    assert.equal(groups.some(group => group.compactFamilyTitle === 'SSL Certificate Trust Issues'), true);
});

test('groups non-family findings by the same CVE before strict text fallback', () => {
    const groups = groupFindingsByFingerprint([
        { id: 220, title: 'Library Foo Memory Disclosure', severity: 'High', cve_ids: ['CVE-2025-9999'], description: 'Same scanner wording.', impact: 'Same impact.' },
        { id: 221, title: 'Different Scanner Name For Foo Issue', severity: 'High', cve_ids: ['CVE-2025-9999'], description: 'Same scanner wording.', impact: 'Same impact.' }
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].compactReason, 'same-cve');
    assert.deepEqual(groups[0].findingIds, ['220', '221']);
});

test('splits same-family findings when DefectDojo description or impact differs', () => {
    const groups = groupFindingsByFingerprint([
        { id: 240, title: 'PHP 8.2.x < 8.2.28 Multiple Vulnerabilities', severity: 'High', cve_ids: ['CVE-2025-0001'], description: 'PHP advisory for host set A.', impact: 'Impact text A.', mitigation: 'Upgrade to PHP version 8.2.28 or later.' },
        { id: 241, title: 'PHP 8.2.x < 8.2.28 Multiple Vulnerabilities', severity: 'High', cve_ids: ['CVE-2025-0001'], description: 'PHP advisory for host set B.', impact: 'Impact text B.', mitigation: 'Upgrade to PHP version 8.2.28 or later.' }
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups.every(group => group.compactReason === 'upgrade-family'), true);
    assert.deepEqual(groups.map(group => group.findingIds), [['240'], ['241']]);
});

test('keeps unknown no-CVE findings on strict fallback groups', () => {
    const groups = groupFindingsByFingerprint([
        { id: 230, title: 'Local Security Policy Warning', severity: 'Low', description: 'Password age is long.' },
        { id: 231, title: 'Banner Disclosure', severity: 'Low', description: 'A service banner is visible.' }
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups.every(group => group.compactReason === 'strict-fingerprint'), true);
});

test('stable compacted sync key ignores finding IDs while legacy key preserves old matching shape', () => {
    const fingerprint = buildFindingFingerprint({
        title: 'SSL Certificate Cannot Be Trusted',
        product_id: '5',
        engagement_id: '9'
    });
    const firstKey = buildCompactedSyncKey({
        groupKey: fingerprint.groupKey,
        findingIds: [300],
        productIds: ['5'],
        engagementIds: ['9']
    });
    const secondKey = buildCompactedSyncKey({
        groupKey: fingerprint.groupKey,
        findingIds: [301, 302],
        productIds: ['5'],
        engagementIds: ['9']
    });
    const legacyFirstKey = buildLegacyCompactedSyncKey({
        groupKey: fingerprint.groupKey,
        findingIds: [300],
        productIds: ['5'],
        engagementIds: ['9']
    });
    const legacySecondKey = buildLegacyCompactedSyncKey({
        groupKey: fingerprint.groupKey,
        findingIds: [301, 302],
        productIds: ['5'],
        engagementIds: ['9']
    });

    assert.equal(firstKey, secondKey);
    assert.notEqual(legacyFirstKey, legacySecondKey);
    assert.notEqual(firstKey, legacyFirstKey);
});

test('legacy compacted sync key still matches an existing stored Redmine ticket', () => {
    const currentSyncKey = 'dd-compact-current';
    const legacySyncKey = 'dd-compact-legacy-old-finding-set';
    const tickets = [
        {
            ticket_key: legacySyncKey,
            sync_key: legacySyncKey,
            issue_id: 32634,
            finding_ids: ['29072']
        }
    ];

    const ticket = findTicketForGroup(tickets, currentSyncKey, ['29260', '29261'], '', [legacySyncKey]);

    assert.equal(ticket.issue_id, 32634);
});

test('split compacted groups do not reuse a different keyed Redmine ticket by CVE or partial finding overlap', () => {
    const oldBroadTicket = {
        ticket_key: 'dd-compact-old-broad',
        sync_key: 'dd-compact-old-broad',
        issue_id: 32634,
        finding_ids: ['30304', '30337', '30344'],
        cve_id: 'CVE-2025-32728'
    };

    assert.equal(
        findTicketForGroup([oldBroadTicket], 'dd-compact-current-a', ['30304', '30337'], 'CVE-2025-32728', []),
        null
    );
    assert.equal(
        findTicketForGroup([oldBroadTicket], 'dd-compact-current-b', ['30344'], 'CVE-2025-32728', []),
        null
    );
});

test('unkeyed legacy Redmine tickets can still match when their finding IDs are fully inside the current group', () => {
    const unkeyedTicket = {
        issue_id: 32635,
        finding_ids: ['30304'],
        cve_id: 'CVE-2025-32728'
    };

    const ticket = findTicketForGroup([unkeyedTicket], 'dd-compact-current-a', ['30304', '30337'], 'CVE-2025-32728', []);

    assert.equal(ticket.issue_id, 32635);
});

test('keyed legacy Redmine tickets can migrate when their finding IDs are fully inside the current group', () => {
    const oldTicket = {
        ticket_key: 'dd-compact-old-single-source',
        sync_key: 'dd-compact-old-single-source',
        issue_id: 32636,
        finding_ids: ['30304'],
        cve_id: 'CVE-2025-32728'
    };

    const ticket = findTicketForGroup([oldTicket], 'dd-compact-current-a', ['30304', '30337'], 'CVE-2025-32728', []);

    assert.equal(ticket.issue_id, 32636);
});

test('deduplicates repeated source descriptions that only differ by endpoint URL', () => {
    const duplicateDescriptionA = 'The remote web server is affected by an out-of-bounds read vulnerability. URL : https://10.149.20.45/ Installed version : 2.4.56 Fixed version : 2.4.58';
    const duplicateDescriptionB = 'The remote web server is affected by an out-of-bounds read vulnerability. URL : https://10.149.20.48/ Installed version : 2.4.56 Fixed version : 2.4.58';
    const groups = groupFindingsByFingerprint([
        { id: 100, title: 'Apache 2.4.x < 2.4.58 Out-of-Bounds Read', severity: 'Critical', vulnerability_ids: [{ vulnerability_id: 'CVE-2023-31122' }], description: duplicateDescriptionA, impact: '<html>Index of /</html>', mitigation: 'Upgrade to Apache version 2.4.58 or later.', endpoints: [{ protocol: 'tcp', host: '10.149.20.45', port: 443 }], active: true, is_mitigated: false },
        { id: 101, title: 'Apache 2.4.x < 2.4.58 Out-of-Bounds Read', severity: 'Critical', vulnerability_ids: [{ vulnerability_id: 'CVE-2023-31122' }], description: duplicateDescriptionB, impact: '<html>Index of /</html>', mitigation: 'Upgrade to Apache version 2.4.58 or later.', endpoints: [{ protocol: 'tcp', host: '10.149.20.48', port: 443 }], active: true, is_mitigated: false }
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].sourceGroups.length, 1);
    assert.equal(groups[0].sourceGroups[0].descriptionSources.length, 1);
    assert.deepEqual(groups[0].sourceGroups[0].descriptionSources[0].findingIds, [100, 101]);
    assert.equal(groups[0].sourceGroups[0].descriptionSources[0].text, 'The remote web server is affected by an out-of-bounds read vulnerability.');
    assert.deepEqual(groups[0].sourceGroups[0].descriptionSources[0].evidenceLines, [
        'URL : https://10.149.20.45/ Installed version : 2.4.56 Fixed version : 2.4.58',
        'URL : https://10.149.20.48/ Installed version : 2.4.56 Fixed version : 2.4.58'
    ]);

    const markdown = buildCanonicalMarkdown(groups[0]);
    assert.equal((markdown.match(/out-of-bounds read vulnerability/g) || []).length, 1);
    assert.match(markdown, /\*\*Target Mitigation:\*\*\nUpgrade to Apache version 2\.4\.58 or later\./);
    assert.match(markdown, /\*\*Host:\*\* 10\.149\.20\.45\n\n\*\*Affected Ports:\*\* 443/);
    assert.match(markdown, /> URL: https:\/\/10\.149\.20\.45\/\n> Installed version : 2\.4\.56\n> Fixed version     : 2\.4\.58/);
    assert.match(markdown, /> URL: https:\/\/10\.149\.20\.48\/\n> Installed version : 2\.4\.56\n> Fixed version     : 2\.4\.58/);
    assert.match(markdown, /\*\*Impact:\*\*\n> &lt;html&gt;Index of \/&lt;\/html&gt;/);
});

test('renders one common PHP description with unique URL and version evidence lines', () => {
    const commonText = 'The version PHP running on the remote web server is affected by multiple vulnerabilities.';
    const groups = groupFindingsByFingerprint([
        { id: 120, title: 'PHP 8.2.x < 8.2.28 Multiple Vulnerabilities', severity: 'Critical', description: `${commonText} URL : https://10.149.20.50/ (8.2.12 under X-Powered-By: PHP/8.2.12) Installed version : 8.2.12 Fixed version : 8.2.28`, mitigation: 'Upgrade to PHP version 8.2.28 or later.', endpoints: [{ protocol: 'tcp', host: '10.149.20.50', port: 443 }], active: true, is_mitigated: false },
        { id: 121, title: 'PHP 8.2.x < 8.2.28 Multiple Vulnerabilities', severity: 'Critical', description: `${commonText} URL : https://10.149.20.53/ (8.2.12 under X-Powered-By: PHP/8.2.12) Installed version : 8.2.12 Fixed version : 8.2.28`, mitigation: 'Upgrade to PHP version 8.2.28 or later.', endpoints: [{ protocol: 'tcp', host: '10.149.20.53', port: 443 }], active: true, is_mitigated: false },
        { id: 122, title: 'PHP 8.2.x < 8.2.28 Multiple Vulnerabilities', severity: 'Critical', description: `${commonText} URL : https://10.149.20.49/ (8.2.12 under X-Powered-By: PHP/8.2.12) Installed version : 8.2.12 Fixed version : 8.2.28`, mitigation: 'Upgrade to PHP version 8.2.28 or later.', endpoints: [{ protocol: 'tcp', host: '10.149.20.49', port: 443 }], active: true, is_mitigated: false }
    ]);

    const descriptionSource = groups[0].sourceGroups[0].descriptionSources[0];
    assert.equal(descriptionSource.text, commonText);
    assert.deepEqual(descriptionSource.findingIds, [120, 121, 122]);
    assert.deepEqual(descriptionSource.evidenceLines, [
        'URL : https://10.149.20.49/ (8.2.12 under X-Powered-By: PHP/8.2.12) Installed version : 8.2.12 Fixed version : 8.2.28',
        'URL : https://10.149.20.50/ (8.2.12 under X-Powered-By: PHP/8.2.12) Installed version : 8.2.12 Fixed version : 8.2.28',
        'URL : https://10.149.20.53/ (8.2.12 under X-Powered-By: PHP/8.2.12) Installed version : 8.2.12 Fixed version : 8.2.28'
    ]);

    const markdown = buildCanonicalMarkdown(groups[0]);
    assert.equal((markdown.match(/The version PHP running on the remote web server/g) || []).length, 1);
    assert.match(markdown, /> URL: https:\/\/10\.149\.20\.50\/ \(8\.2\.12 under X-Powered-By: PHP\/8\.2\.12\)\n> Installed version : 8\.2\.12\n> Fixed version     : 8\.2\.28/);
    assert.match(markdown, /> URL: https:\/\/10\.149\.20\.53\/ \(8\.2\.12 under X-Powered-By: PHP\/8\.2\.12\)\n> Installed version : 8\.2\.12\n> Fixed version     : 8\.2\.28/);
    assert.match(markdown, /> URL: https:\/\/10\.149\.20\.49\/ \(8\.2\.12 under X-Powered-By: PHP\/8\.2\.12\)\n> Installed version : 8\.2\.12\n> Fixed version     : 8\.2\.28/);
});

test('splits multiple description sources into separate compacted findings when evidence differs', () => {
    const descriptionText = 'The SSH server running on the remote host is affected by a vulnerability.';
    const groups = groupFindingsByFingerprint([
        { id: 30304, title: 'OpenSSH < 10.0 DisableForwarding', severity: 'Low', cve_ids: ['CVE-2025-32728'], description: `${descriptionText} Version source : SSH-1.99-OpenSSH_5.0 NetBSD_Secure_Shell-20080403+-hpn13v1 Installed version : 5.0 Fixed version : 10.0`, endpoints: [{ protocol: 'tcp', host: '10.146.10.51', port: 22 }], active: true },
        { id: 30337, title: 'OpenSSH < 10.0 DisableForwarding', severity: 'Low', cve_ids: ['CVE-2025-32728'], description: `${descriptionText} Version source : SSH-1.99-OpenSSH_5.0 NetBSD_Secure_Shell-20080403+-hpn13v1 Installed version : 5.0 Fixed version : 10.0`, endpoints: [{ protocol: 'tcp', host: '10.146.10.56', port: 22 }], active: true },
        { id: 30344, title: 'OpenSSH < 10.0 DisableForwarding', severity: 'Low', cve_ids: ['CVE-2025-32728'], description: `${descriptionText} Version source : SSH-2.0-OpenSSH_7.8 Installed version : 7.8 Fixed version : 10.0`, endpoints: [{ protocol: 'tcp', host: '10.146.10.99', port: 22 }], active: true }
    ]);

    assert.equal(groups.length, 2);
    const firstGroup = groups.find(group => group.findingIds.includes('30304'));
    const secondGroup = groups.find(group => group.findingIds.includes('30344'));
    assert.deepEqual(firstGroup.findingIds, ['30304', '30337']);
    assert.deepEqual(secondGroup.findingIds, ['30344']);

    const markdown = buildCanonicalMarkdown(firstGroup);
    assert.match(markdown, /\*\*Target Mitigation:\*\*\nUpgrade to OpenSSH version 10\.0 or later\./);
    assert.match(markdown, /\*\*Affected Assets & Ports:\*\*\n\n\*\*Host:\*\* 10\.146\.10\.51\n\n\*\*Affected Ports:\*\* 22/);
    assert.match(markdown, /\*\*Associated CVEs:\*\* CVE-2025-32728/);
    assert.match(markdown, /\*\*DefectDojo Description:\*\*\n> The SSH server running on the remote host is affected by a vulnerability\./);
    assert.match(markdown, /> Version source : SSH-1\.99-OpenSSH_5\.0 NetBSD_Secure_Shell-20080403\+-hpn13v1\n> Installed version : 5\.0\n> Fixed version     : 10\.0/);
    const secondMarkdown = buildCanonicalMarkdown(secondGroup);
    assert.match(secondMarkdown, /\*\*Host:\*\* 10\.146\.10\.99\n\n\*\*Affected Ports:\*\* 22/);
    assert.match(secondMarkdown, /> Version source : SSH-2\.0-OpenSSH_7\.8\n> Installed version : 7\.8\n> Fixed version     : 10\.0/);
});

test('summarizes Nessus truncated evidence blocks in markdown descriptions', () => {
    const noisyDescription = 'The remote web server is affected by an information disclosure vulnerability. Nessus was able to exploit the issue using the following request : http://10.149.20.46/?M=A This produced the following truncated output (limited to 10 lines) : ------------------------------ snip ------------------------------ <!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN"> <html> <head> <title>Index of /</title> </head> <body> <h1>Index of /</h1> <table> [...] ------------------------------ snip ------------------------------';
    const groups = groupFindingsByFingerprint([
        { id: 110, title: 'Apache Directory Listing Information Disclosure', severity: 'Medium', description: noisyDescription, mitigation: 'Disable directory listing.', endpoints: [{ protocol: 'tcp', host: '10.149.20.46', port: 80 }], active: true, is_mitigated: false }
    ]);

    const markdown = buildCanonicalMarkdown(groups[0]);
    assert.match(markdown, /using a request to the affected endpoint/);
    assert.match(markdown, /Evidence output omitted\. See DefectDojo finding for raw truncated output\./);
    assert.doesNotMatch(markdown, /DOCTYPE HTML/);
    assert.doesNotMatch(markdown, /<html>/);
});

test('Resolve is distinct from Closed for manual closure workflow', () => {
    assert.equal(isResolveStatus('Resolve'), true);
    assert.equal(isClosedStatus('Resolve'), false);
    assert.equal(isClosedStatus('Closed'), true);
});

test('Redmine status helpers tolerate missing config objects', () => {
    assert.equal(redmineClient.isResolveStatus('Resolve'), true);
    assert.equal(redmineClient.isInProgressStatus('In Progress'), true);
    assert.equal(redmineClient.isClosedStatus('Closed'), true);
    assert.equal(redmineClient.getStatusNameIsClosed('Resolve'), false);
    assert.equal(redmineClient.getRedminePriorityIdForSeverity('High'), '');
});

test('sync history split creates concrete child groups per company and scope', () => {
    const split = createSyncHistorySplitGroups({
        findings: [
            {
                id: 1,
                defectdojo_route: {
                    projectId: '8',
                    projectName: 'Acme',
                    engagementId: '74',
                    engagementName: 'External'
                }
            },
            {
                id: 2,
                defectdojo_route: {
                    projectId: '9',
                    projectName: 'Beta',
                    engagementId: '75',
                    engagementName: 'Internal'
                }
            }
        ],
        ticketRefs: [
            {
                ticketKey: 'ticket-1',
                route: {
                    projectId: '8',
                    projectName: 'Acme',
                    engagementId: '74',
                    engagementName: 'External'
                }
            }
        ],
        checkResults: [{ ticketKey: 'ticket-1', status: 'New' }]
    });

    assert.equal(split.warning, '');
    assert.equal(split.groups.length, 2);
    assert.deepEqual(
        split.groups.map(group => [group.route.projectName, group.route.engagementName, group.findings.length, group.ticketRefs.length]),
        [
            ['Acme', 'External', 1, 1],
            ['Beta', 'Internal', 1, 0]
        ]
    );
});

test('sync history split skips incomplete company or scope routes', () => {
    const split = createSyncHistorySplitGroups({
        findings: [
            {
                id: 1,
                defectdojo_route: {
                    projectId: '8',
                    projectName: 'Acme',
                    engagementId: '74',
                    engagementName: 'External'
                }
            },
            {
                id: 2,
                defectdojo_route: {
                    projectId: '9',
                    projectName: 'Beta'
                }
            }
        ],
        ticketRefs: [
            {
                ticketKey: 'ticket-1',
                route: {
                    projectId: '10',
                    projectName: 'Gamma'
                }
            }
        ],
        checkResults: [{ ticketKey: 'ticket-1', status: 'Not checked' }]
    });

    assert.equal(split.groups.length, 1);
    assert.equal(split.groups[0].route.projectName, 'Acme');
    assert.equal(split.groups[0].route.engagementName, 'External');
    assert.equal(split.skipped.findings, 1);
    assert.equal(split.skipped.tickets, 1);
    assert.equal(split.skipped.checkResults, 1);
    assert.match(split.warning, /Skipped 3 Sync History items without resolved company and scope/);
});

test('active linked finding reopens a Resolve ticket', () => {
    const results = evaluateResolveRecheck({
        ticket: { status: 'Resolve', findingIds: ['10'] },
        findings: [{ id: 10, active: true, is_mitigated: false }]
    });

    assert.deepEqual(results, [{ findingId: '10', result: 'reopen' }]);
});

test('mitigated linked finding enters manual review and is not auto-closed', () => {
    const results = evaluateResolveRecheck({
        ticket: { status: 'Resolve', findingIds: ['11'] },
        findings: [{ id: 11, active: false, is_mitigated: true }]
    });

    assert.deepEqual(results, [{ findingId: '11', result: 'manual_review' }]);
});
