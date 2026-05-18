import { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  RefreshCw, 
  AlertTriangle, 
  Info,
  Filter,
  Database,
  ExternalLink,
  LogOut,
  X,
  History,
  ShieldCheck
} from 'lucide-react';
import { AUTH_EXPIRED_EVENT, apiFetch, getCurrentUser, openDashboardSyncStream, removeAuthToken, removeCurrentUser } from '../services/api';
import Login from '../features/auth/Login';
import SettingsView from '../features/settings/Settings';
import SummaryCards from '../features/dashboard/SummaryCards';
import SyncHistory from '../features/sync-history/SyncHistory';
import MitigationReview from '../features/admin/MitigationReview';

const PULL_SEVERITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low', 'Info'];
const DEFAULT_REDMINE_STATUS_POLL_SECONDS = 60;
const SYNC_ALL_REDMINE_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_REDMINE_SYNC_STATUS = {
  enabled: false,
  configured: false,
  intervalSeconds: DEFAULT_REDMINE_STATUS_POLL_SECONDS,
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
  redmineErrorCount: 0,
  syncRecords: 0,
};

const setHashRoute = (hash) => {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
};

const DEFAULT_PULL_FILTERS = {
  severity: [],
  active: '',
  verified: '',
  is_mitigated: '',
  test__engagement__product: '',
  test__engagement: '',
};

const createDefaultConfig = () => ({
  scanPath: '',
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
  redmineStatusPollIntervalSeconds: DEFAULT_REDMINE_STATUS_POLL_SECONDS,
  pullFilters: { ...DEFAULT_PULL_FILTERS },
});

const normalizeSeverityFilterValue = (severity) => {
  const values = Array.isArray(severity)
    ? severity
    : String(severity || '').split(',');

  return Array.from(new Set(values
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => PULL_SEVERITY_OPTIONS.find(sev => sev.toLowerCase() === item.toLowerCase()))
    .filter(Boolean)));
};

const normalizeConfig = (data = {}) => {
  const pullFilters = {
    ...DEFAULT_PULL_FILTERS,
    ...(data.pullFilters || {}),
  };

  const pollInterval = Number.parseInt(data.redmineStatusPollIntervalSeconds, 10);

  return {
    ...createDefaultConfig(),
    ...data,
    redmineStatusPollIntervalSeconds: Number.isInteger(pollInterval) && pollInterval > 0
      ? Math.max(DEFAULT_REDMINE_STATUS_POLL_SECONDS, pollInterval)
      : pollInterval === 0 ? 0 : DEFAULT_REDMINE_STATUS_POLL_SECONDS,
    pullFilters: {
      ...pullFilters,
      severity: normalizeSeverityFilterValue(pullFilters.severity),
    },
  };
};

const createPullFiltersDraft = (filters = {}) => ({
  ...DEFAULT_PULL_FILTERS,
  ...filters,
  severity: normalizeSeverityFilterValue(filters.severity),
});

const formatSyncTimestamp = (value) => (
  value ? new Date(value).toLocaleString() : 'Not yet'
);

const formatTimeoutSeconds = (timeoutMs) => Math.round(timeoutMs / 1000);

const runWithTimeout = async (task, timeoutMs, timeoutMessage) => {
  if (!timeoutMs || timeoutMs <= 0) return task();

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await task(controller.signal);
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(timeoutMessage || `Request timed out after ${formatTimeoutSeconds(timeoutMs)} seconds`, { cause: err });
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const normalizeFetchedFindings = (data) => {
  if (!Array.isArray(data)) return null;

  return data.map(finding => {
    const fixedFinding = { ...finding };

    if (Array.isArray(fixedFinding.endpoints) && fixedFinding.endpoints.some(ep => typeof ep !== 'object')) {
      const combinedText = `${fixedFinding.title || ''} ${fixedFinding.description || ''} ${fixedFinding.impact || ''} ${fixedFinding.mitigation || ''}`;
      const urlMatches = combinedText.match(/([a-z0-9]+):\/\/([^/\s?#]+)/gi) || [];

      if (urlMatches.length > 0) {
        const fullUrl = urlMatches[0];
        const protocolMatch = fullUrl.match(/^([a-z0-9]+):\/\//i);
        const protocol = protocolMatch ? protocolMatch[1].toLowerCase() : null;
        const hostPort = fullUrl.replace(/^[a-z0-9]+:\/\//i, '').replace(/\/$/, '');
        const [host, port] = hostPort.split(':');
        const finalPort = port || (protocol === 'https' ? '443' : (protocol === 'http' ? '80' : null));

        fixedFinding.endpoints = fixedFinding.endpoints.map(endpoint => {
          if (typeof endpoint !== 'object') {
            return {
              id: endpoint,
              host: host.trim(),
              port: finalPort,
              protocol,
              is_fallback: true
            };
          }
          return endpoint;
        });
      } else {
        const ipMatches = combinedText.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
        if (ipMatches.length > 0) {
          fixedFinding.endpoints = fixedFinding.endpoints.map(endpoint => {
            if (typeof endpoint !== 'object') {
              return { id: endpoint, host: ipMatches[0], is_fallback: true };
            }
            return endpoint;
          });
        }
      }
    }

    return fixedFinding;
  });
};

const getRedmineSyncLabel = (sync) => {
  if (!sync) return '';
  const projectSuffix = sync.projectName ? ` → ${sync.projectName}` : '';
  if (sync.action === 'created') return sync.issueId ? `Redmine #${sync.issueId}${projectSuffix}` : `Redmine created${projectSuffix}`;
  if (sync.action === 'existing_open') return sync.status ? `Redmine ${sync.status}${projectSuffix}` : `Redmine open${projectSuffix}`;
  if (sync.action === 'existing_closed') return `Redmine closed${projectSuffix}`;
  if (sync.action === 'closed_with_new_findings') return `Redmine closed${projectSuffix}`;
  if (sync.action === 'not_found') return sync.projectMissing ? `Redmine project missing${projectSuffix}` : `Redmine not found${projectSuffix}`;
  if (sync.action === 'check_failed') return `Redmine check failed${projectSuffix}`;
  return `Redmine synced${projectSuffix}`;
};

const normalizeRedmineStatus = (status) => (
  cleanText(status)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
);

const getRedmineStatusBadgeClass = (sync = {}) => {
  const normalizedStatus = normalizeRedmineStatus(sync.status);
  if (sync.action === 'existing_closed' || ['closed', 'done'].includes(normalizedStatus)) return 'status-closed';
  if (normalizedStatus === 'new') return 'status-new';
  if (normalizedStatus === 'feedback') return 'status-feedback';
  if (normalizedStatus === 'in progress') return 'status-in-progress';
  if (['resolve', 'resolved'].includes(normalizedStatus)) return 'status-resolve';
  if (sync.action === 'not_found') return 'status-not-found';
  if (sync.action === 'check_failed') return 'status-error';
  return 'status-synced';
};

const getRedmineSyncBadgeClass = (sync = {}) => (
  ['redmine-sync-badge', sync.action, getRedmineStatusBadgeClass(sync)].filter(Boolean).join(' ')
);

const REDMINE_SYNC_PRIORITY = {
  created: 5,
  existing_open: 4,
  closed_with_new_findings: 2,
  existing_closed: 2,
  not_found: 1,
  check_failed: 0,
};

const chooseRedmineSync = (current, next) => {
  if (!next) return current || null;
  if (!current) return next;

  const currentPriority = REDMINE_SYNC_PRIORITY[current.action] ?? -1;
  const nextPriority = REDMINE_SYNC_PRIORITY[next.action] ?? -1;
  if (nextPriority !== currentPriority) return nextPriority > currentPriority ? next : current;

  const currentUpdatedAt = Date.parse(current.updatedAt || current.checkedAt || '') || 0;
  const nextUpdatedAt = Date.parse(next.updatedAt || next.checkedAt || '') || 0;
  return nextUpdatedAt >= currentUpdatedAt ? next : current;
};

const REDMINE_PRIORITY_FIELD_BY_SEVERITY = {
  Critical: 'redminePriorityCriticalId',
  High: 'redminePriorityHighId',
  Medium: 'redminePriorityMediumId',
  Low: 'redminePriorityLowId',
  Info: 'redminePriorityInfoId',
  Informational: 'redminePriorityInfoId',
  None: 'redminePriorityInfoId',
};

const getRedminePriorityIdForSeverity = (severity, config) => {
  const severityText = cleanText(severity);
  const normalizedSeverity = Object.keys(REDMINE_PRIORITY_FIELD_BY_SEVERITY)
    .find(item => item.toLowerCase() === severityText.toLowerCase()) || '';
  const field = REDMINE_PRIORITY_FIELD_BY_SEVERITY[normalizedSeverity];
  if (field && config[field]) return cleanText(config[field]);

  return severityText ? '' : cleanText(config.redminePriorityId);
};

const SEVERITY_RANK = {
  None: 0,
  Info: 0,
  Informational: 0,
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

const UPGRADE_TARGET_RE = /upgrade\s+to\s+(.+?)\s+(?:version\s+)?([0-9][0-9a-z.-]*)\s*(?:or\s+later)?\.?/i;
const TITLE_VERSION_RE = /^(.+?)\s+.*?(?:<|version)\s+([0-9][0-9a-z.-]*)/i;
const LESS_THAN_VERSION_RE = /<\s*([0-9][0-9a-z.-]*)/i;

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const cleanBlockText = (value) => (
  String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
);

const DEFECTDOJO_EVIDENCE_LINE_RE = /^(?:URL|URI|Endpoint|Host|Hostname|Port|Protocol|Path|Service|Installed version|Detected version|Current version|Fixed version|Affected version)\s*:/i;

const compactDefectDojoText = (value) => {
  const text = cleanBlockText(value);
  if (!text) return '';

  return cleanBlockText(
    text
      .split('\n')
      .filter(line => !DEFECTDOJO_EVIDENCE_LINE_RE.test(line.trim()))
      .join('\n')
      .replace(/\busing the following request\s*:\s*https?:\/\/\S+/i, 'using a request to the affected endpoint')
      .replace(/\s*This produced the following truncated output[\s\S]*$/i, '\n\nEvidence output omitted. See DefectDojo finding for raw truncated output.')
  );
};

const cleanSoftwareName = (value) => (
  cleanText(value)
    .replace(/[.:;,-]+$/g, '')
    .trim()
);

const parseUpgradeText = (value) => {
  const upgradeMatch = cleanText(value).match(UPGRADE_TARGET_RE);
  if (!upgradeMatch) return null;

  const software = cleanSoftwareName(upgradeMatch[1]);
  const parsedVersion = upgradeMatch[2].replace(/\.$/, '');
  return {
    software,
    version: parsedVersion,
    title: `Upgrade to ${software} version ${parsedVersion} or later.`,
  };
};

const normalizeForGrouping = (value) => (
  cleanText(value)
    .toLowerCase()
    .replace(UPGRADE_TARGET_RE, (_match, software) => `upgrade to ${cleanSoftwareName(software).toLowerCase()} version <version> or later`)
    .replace(/\bversion\s+[0-9][0-9a-z.-]*/gi, 'version <version>')
);

const tokenizeVersion = (value) => (
  String(value || '0')
    .split(/[._+-]/)
    .map(part => {
      const numeric = Number.parseInt(part, 10);
      return Number.isNaN(numeric) ? part.toLowerCase() : numeric;
    })
);

const compareVersions = (a, b) => {
  const left = tokenizeVersion(a);
  const right = tokenizeVersion(b);
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

const getSeverityRank = (severity) => SEVERITY_RANK[severity] ?? 0;

const highestSeverity = (current, next) => (
  getSeverityRank(next) > getSeverityRank(current) ? next : current
);

const getMitigationText = (finding) => cleanText(
  finding.mitigation
  || finding.solution
  || finding.remediation
  || ''
);

const getDescriptionText = (finding) => compactDefectDojoText(finding.description || '');

const getImpactText = (finding) => compactDefectDojoText(finding.impact || '');

const getStrictCompactFamilyKey = (finding) => ([
  'strict',
  normalizeForGrouping(finding.title || finding.name),
  normalizeForGrouping(getMitigationText(finding)),
  normalizeForGrouping(getDescriptionText(finding)),
  normalizeForGrouping(getImpactText(finding)),
].join('|'));

const getLegacyCompactGroupKey = (finding) => {
  const target = parseUpgradeTarget(finding);
  const mitigationText = getMitigationText(finding);

  if (target) return `upgrade|${normalizeForGrouping(target.software)}`;

  return [
    'finding',
    normalizeForGrouping(finding.title || finding.name),
    normalizeForGrouping(mitigationText),
    normalizeForGrouping(getDescriptionText(finding)),
    normalizeForGrouping(getImpactText(finding)),
  ].join('|');
};

const getKnownNoCveFamily = (finding) => {
  const title = normalizeForGrouping(finding.title || finding.name);
  const hasSslOrTls = /\b(?:ssl|tls)\b/i.test(title);
  const hasCertificate = /\bcert(?:ificate)?s?\b/i.test(title);
  const hasTrustSignal = /cannot be trusted|not trusted|untrusted|self[-\s]?signed|invalid chain|certificate chain|expired|hostname|common[-\s]?name|name mismatch|unknown ca|unrecognized ca/i.test(title);
  const isProtocolOrCipher = /\b(?:protocol|cipher|sslv2|sslv3|tlsv1|sweet32|beast|poodle)\b/i.test(title);

  if (hasSslOrTls && hasCertificate && hasTrustSignal && !isProtocolOrCipher) {
    return {
      key: 'ssl-certificate-trust',
      title: 'SSL Certificate Trust Issues',
    };
  }

  return null;
};

const firstPresent = (...values) => {
  for (const value of values) {
    if (value && typeof value === 'object') continue;
    const cleaned = cleanText(value);
    const urlIdMatch = cleaned.match(/\/(\d+)\/?$/);
    if (urlIdMatch) return urlIdMatch[1];
    if (cleaned) return cleaned;
  }
  return '';
};

const firstNamePresent = (...values) => {
  for (const value of values) {
    if (value && typeof value === 'object') continue;
    const cleaned = cleanText(value);
    if (cleaned && !/^\d+$/.test(cleaned)) return cleaned;
  }
  return '';
};

const getDefectDojoRoute = (finding) => {
  const explicitRoute = finding.defectdojo_route && typeof finding.defectdojo_route === 'object'
    ? finding.defectdojo_route
    : {};
  const test = finding.test && typeof finding.test === 'object' ? finding.test : {};
  const engagement = finding.engagement && typeof finding.engagement === 'object'
    ? finding.engagement
    : (test.engagement && typeof test.engagement === 'object' ? test.engagement : {});
  const product = finding.product && typeof finding.product === 'object'
    ? finding.product
    : (engagement.product && typeof engagement.product === 'object' ? engagement.product : {});

  return {
    projectId: firstPresent(
      finding.product_id,
      explicitRoute.projectId,
      finding.product,
      product.id,
      finding.test__engagement__product,
      engagement.product_id,
      test.product_id
    ),
    projectName: firstNamePresent(
      finding.product_name,
      explicitRoute.projectName,
      product.name,
      finding.product,
      engagement.product_name,
      test.product_name
    ),
    engagementId: firstPresent(
      finding.engagement_id,
      explicitRoute.engagementId,
      finding.engagement,
      engagement.id,
      finding.test__engagement,
      test.engagement_id
    ),
    engagementName: firstNamePresent(
      finding.engagement_name,
      explicitRoute.engagementName,
      engagement.name,
      finding.engagement,
      test.engagement_name
    ),
    productKey: firstPresent(
      finding.productKey,
      finding.product_key,
      explicitRoute.productKey
    ),
    engagementKey: firstPresent(
      finding.engagementKey,
      finding.engagement_key,
      explicitRoute.engagementKey
    ),
  };
};

const getEntityRouteKey = (prefix, id, name) => {
  const cleanedId = cleanText(id);
  if (cleanedId) return `${prefix}:id:${cleanedId}`;
  const cleanedName = cleanText(name);
  return cleanedName ? `${prefix}:name:${cleanedName.toLowerCase()}` : '';
};

const routeValueMatches = (selectedValue, ...candidates) => {
  const selected = cleanText(selectedValue).toLowerCase();
  if (!selected) return true;
  return candidates.some(candidate => cleanText(candidate).toLowerCase() === selected);
};

const parseUpgradeTarget = (finding) => {
  const sources = [
    getMitigationText(finding),
    finding.title,
    finding.name,
  ].filter(Boolean);

  for (const source of sources) {
    const upgradeTarget = parseUpgradeText(source);
    if (upgradeTarget) return upgradeTarget;
  }

  const titleMatch = cleanText(finding.title || finding.name).match(TITLE_VERSION_RE);
  if (titleMatch) {
    const software = cleanSoftwareName(titleMatch[1]);
    const parsedVersion = titleMatch[2].replace(/\.$/, '');
    return {
      software,
      version: parsedVersion,
      title: `Upgrade to ${software} version ${parsedVersion} or later.`,
    };
  }

  return null;
};

const collectVulnerabilityIds = (finding) => {
  const ids = new Set();

  const pushId = (value) => {
    if (value && typeof value === 'object') {
      pushId(value.vulnerability_id || value.name || value.id);
      return;
    }
    const cleaned = cleanText(value);
    if (cleaned && cleaned.toLowerCase() !== 'none' && cleaned.toLowerCase() !== 'n/a') {
      ids.add(cleaned);
    }
  };

  if (Array.isArray(finding.vulnerability_ids)) finding.vulnerability_ids.forEach(pushId);
  if (Array.isArray(finding.cves)) finding.cves.forEach(pushId);
  if (Array.isArray(finding.cve_ids)) finding.cve_ids.forEach(pushId);
  pushId(finding.cve || finding.CVE);

  return sortStrings(ids);
};

const resolveCompactFamily = (finding) => {
  const cves = collectVulnerabilityIds(finding);
  const target = parseUpgradeTarget(finding);

  if (target) {
    return {
      cves,
      familyKey: `upgrade|${normalizeForGrouping(target.software)}`,
      familyTitle: getSoftwareFamilyTitle(target.software, [finding.title || finding.name || '']) || `${target.software} Vulnerabilities`,
      softwareFamily: target.software,
      reason: 'upgrade-family',
      isSoftwareFamily: true,
    };
  }

  const knownFamily = cves.length === 0 ? getKnownNoCveFamily(finding) : null;
  if (knownFamily) {
    return {
      cves,
      familyKey: `known|${knownFamily.key}`,
      familyTitle: knownFamily.title,
      softwareFamily: '',
      reason: 'known-no-cve-family',
      isSoftwareFamily: false,
    };
  }

  if (cves.length > 0) {
    return {
      cves,
      familyKey: `cve|${cves.join(',')}`,
      familyTitle: '',
      softwareFamily: '',
      reason: 'same-cve',
      isSoftwareFamily: false,
    };
  }

  return {
    cves,
    familyKey: getStrictCompactFamilyKey(finding),
    familyTitle: '',
    softwareFamily: '',
    reason: 'strict-fingerprint',
    isSoftwareFamily: false,
  };
};

const getCompactFingerprint = (finding, route = getDefectDojoRoute(finding), config = {}) => {
  const family = resolveCompactFamily(finding);
  const cves = family.cves;
  const cveSignature = cves.join(',');
  const detailKey = getCompactionDetailKey(finding);
  const productKey = route.projectId
    || route.projectName
    || config.pullFilters?.test__engagement__product
    || '';
  const engagementKey = route.engagementId
    || route.engagementName
    || config.pullFilters?.test__engagement
    || '';

  return {
    cves,
    cveSignature,
    compactFamilyKey: family.familyKey,
    compactFamilyTitle: family.familyTitle,
    compactReason: family.reason,
    softwareFamily: family.softwareFamily,
    isSoftwareFamily: family.isSoftwareFamily,
    groupKey: [
      family.familyKey,
      detailKey,
      'route',
      normalizeForGrouping(productKey),
      normalizeForGrouping(engagementKey),
    ].join('|'),
  };
};

const getLegacyFindingGroupKey = (finding, route = getDefectDojoRoute(finding), config = {}) => {
  const productKey = route.projectId
    || route.projectName
    || config.pullFilters?.test__engagement__product
    || '';
  const engagementKey = route.engagementId
    || route.engagementName
    || config.pullFilters?.test__engagement
    || '';

  return [
    getLegacyCompactGroupKey(finding),
    'route',
    normalizeForGrouping(productKey),
    normalizeForGrouping(engagementKey),
  ].join('|');
};

const getSoftwareFamilyTitle = (softwareFamily, titles = []) => {
  const software = cleanText(softwareFamily);
  if (!software) return '';
  const hasMultipleVulnerabilities = sortStrings(titles).some(title => /multiple vulnerabilities/i.test(cleanText(title)));
  return `${software} ${hasMultipleVulnerabilities ? 'Multiple Vulnerabilities' : 'Vulnerabilities'}`;
};

const parseTitleUpgradeTarget = (value = '') => {
  const titleMatch = cleanText(value).match(TITLE_VERSION_RE);
  if (!titleMatch) return null;
  return {
    software: cleanSoftwareName(titleMatch[1]),
    version: titleMatch[2].replace(/\.$/, ''),
  };
};

const collectTicketUpgradeTargets = (ticket = {}) => {
  const candidates = [
    ticket.title,
    ticket.subject,
    ...(asArray(ticket.allTitles)),
    ...(asArray(ticket.allMitigations)),
    ...(asArray(ticket.sourceGroups).flatMap(sourceGroup => [
      sourceGroup.title,
      ...(asArray(sourceGroup.mitigations)),
    ])),
  ];

  return candidates
    .map(candidate => parseUpgradeText(candidate) || parseTitleUpgradeTarget(candidate))
    .filter(target => target?.software && target?.version)
    .sort((left, right) => compareVersions(right.version, left.version));
};

const getTicketUpgradeTarget = (ticket = {}) => collectTicketUpgradeTargets(ticket)[0] || null;

const buildActionRequiredSubject = (ticket = {}) => {
  return cleanText(ticket.title || chooseDisplayTitle(ticket.allTitles || [], ticket.subject || 'Untitled finding'));
};

const firstCleanText = (...values) => {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned && cleaned.toLowerCase() !== 'n/a') return cleaned;
  }
  return '';
};

const splitEndpointHostPort = (value) => {
  const cleaned = cleanText(value).replace(/^[^@]+@/, '');
  if (!cleaned) return {};

  if (cleaned.startsWith('[')) {
    const closeIndex = cleaned.indexOf(']');
    if (closeIndex > 0) {
      const host = cleaned.slice(1, closeIndex);
      const portMatch = cleaned.slice(closeIndex + 1).match(/^:(\d+)/);
      return { host, port: portMatch?.[1] || '' };
    }
  }

  const portMatch = cleaned.match(/^(.+):(\d+)$/);
  if (portMatch && !portMatch[1].includes(':')) {
    return { host: portMatch[1], port: portMatch[2] };
  }

  return { host: cleaned, port: '' };
};

const parseEndpointText = (value) => {
  const text = cleanText(value);
  if (!text || text.toLowerCase() === 'n/a') return {};

  const labelledMatch = text.match(/^(?:URL|URI|Endpoint|Host|Hostname)\s*[:=]\s*(.+)$/i);
  if (labelledMatch) return parseEndpointText(labelledMatch[1]);

  const urlMatch = text.match(/\b([a-z][a-z0-9+.-]*):\/\/([^/\s?#]+)/i);
  if (urlMatch) {
    return {
      protocol: urlMatch[1].toLowerCase(),
      ...splitEndpointHostPort(urlMatch[2]),
    };
  }

  const hostCandidate = text.split(/[/?#]/)[0];
  const looksLikeHost = /^[^\s]+$/.test(hostCandidate)
    && (
      hostCandidate.includes('.')
      || hostCandidate.includes(':')
      || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostCandidate)
      || hostCandidate.toLowerCase() === 'localhost'
    );

  return looksLikeHost ? splitEndpointHostPort(hostCandidate) : {};
};

const getEndpointParts = (endpoint) => {
  if (endpoint && typeof endpoint === 'object') {
    const candidates = [
      endpoint.url,
      endpoint.uri,
      endpoint.endpoint,
      endpoint.display_name,
      endpoint.name,
      endpoint.target,
      endpoint.address,
      endpoint.netloc,
      endpoint.host,
      endpoint.hostname,
      endpoint.fqdn,
      endpoint.dns_name,
      endpoint.ip_address,
      endpoint.ip,
    ];
    const parsed = candidates.map(parseEndpointText).find(parts => parts.host) || {};
    const explicitHost = firstCleanText(
      endpoint.host,
      endpoint.hostname,
      endpoint.fqdn,
      endpoint.dns_name,
      endpoint.ip_address,
      endpoint.ip
    );
    const parsedExplicitHost = parseEndpointText(explicitHost);

    return {
      protocol: firstCleanText(endpoint.protocol, parsed.protocol),
      host: parsedExplicitHost.host || explicitHost || parsed.host || '',
      port: firstCleanText(endpoint.port, parsedExplicitHost.port, parsed.port),
    };
  }

  return parseEndpointText(endpoint);
};

const endpointLabel = (endpoint) => {
  const parts = getEndpointParts(endpoint);
  if (parts.host) {
    return `${parts.protocol ? `${parts.protocol}://` : ''}${parts.host}${parts.port ? `:${parts.port}` : ''}`;
  }

  if (endpoint && typeof endpoint === 'object') {
    if (endpoint.id !== undefined) return `ID: ${endpoint.id}`;
  }

  return endpoint !== undefined && endpoint !== null ? `ID: ${endpoint}` : 'N/A';
};

const endpointHost = (endpoint) => {
  const parts = getEndpointParts(endpoint);
  if (parts.host) return parts.host;
  if (endpoint && typeof endpoint === 'object' && endpoint.id !== undefined) {
    const idText = cleanText(endpoint.id);
    return idText && idText.toLowerCase() !== 'n/a' ? `Endpoint ID ${idText}` : 'N/A';
  }
  if (endpoint !== undefined && endpoint !== null) {
    const idText = cleanText(endpoint);
    return idText && idText.toLowerCase() !== 'n/a' ? `Endpoint ID ${idText}` : 'N/A';
  }
  return 'Unknown host';
};

const endpointKey = (endpoint) => {
  const parts = getEndpointParts(endpoint);
  if (endpoint && typeof endpoint === 'object') {
    const values = [
      parts.protocol,
      parts.host,
      parts.port,
      endpoint.id !== undefined ? String(endpoint.id) : '',
    ].filter(Boolean);
    return values.length > 0 ? values.join('|') : endpointLabel(endpoint);
  }

  return parts.host ? endpointLabel(endpoint) : String(endpoint ?? 'N/A');
};

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

const sortStrings = (values) => asArray(values)
  .map(value => cleanText(value))
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const sortFindingIds = (ids = []) => (
  sortStrings(new Set(asFindingIdArray(ids).map(id => cleanText(id)).filter(Boolean)))
    .map(id => (/^\d+$/.test(id) ? Number.parseInt(id, 10) : id))
);

const addCompactedFindingIds = (target, value) => {
  asFindingIdArray(value).forEach(id => {
    const cleaned = cleanText(id);
    if (cleaned) target.add(cleaned);
  });
};

const getCompactedFindingIds = (finding = {}) => {
  const ids = new Set();

  addCompactedFindingIds(ids, finding.originalIds);
  addCompactedFindingIds(ids, finding.findingIds);
  addCompactedFindingIds(ids, finding.defectdojoFindingIds);
  addCompactedFindingIds(ids, finding.serverRedmineSync?.findingIds);

  asArray(finding.findingStates).forEach(state => {
    addCompactedFindingIds(ids, state?.findingId || state?.finding_id || state?.id);
  });

  asArray(finding.endpointDetails).forEach(detail => {
    addCompactedFindingIds(ids, detail?.findingIds);
  });

  asArray(finding.allDescriptionSources).forEach(source => {
    addCompactedFindingIds(ids, source?.findingIds);
  });
  asArray(finding.allImpactSources).forEach(source => {
    addCompactedFindingIds(ids, source?.findingIds);
  });

  asArray(finding.sourceGroups).forEach(sourceGroup => {
    addCompactedFindingIds(ids, sourceGroup?.findingIds);
    asArray(sourceGroup?.endpointDetails).forEach(detail => {
      addCompactedFindingIds(ids, detail?.findingIds);
    });
    asArray(sourceGroup?.descriptionSources).forEach(source => {
      addCompactedFindingIds(ids, source?.findingIds);
    });
    asArray(sourceGroup?.impactSources).forEach(source => {
      addCompactedFindingIds(ids, source?.findingIds);
    });
  });

  return sortFindingIds(Array.from(ids));
};

const getCompactedFindingCount = (finding = {}) => {
  const ids = getCompactedFindingIds(finding);
  if (ids.length > 0) return ids.length;

  const fallback = [finding.findingCount, finding.sourceFindingCount, finding.count]
    .map(value => Number.parseInt(value, 10))
    .find(value => Number.isFinite(value) && value > 0);

  return fallback || 1;
};

const SOURCE_EVIDENCE_RE = /\b(?:URL|URI)\s*:\s*https?:\/\/\S+(?:\s+\([^)]*\))?(?:\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:\s*\S+)*|\bVersion source\s*:\s*\S+(?:\s+(?!(?:Installed|Detected|Current|Fixed|Affected) version\s*:)\S+)*(?:\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:\s*\S+)*/gi;

const cleanTextSourceBody = (text = '') => (
  cleanBlockText(text)
    .replace(SOURCE_EVIDENCE_RE, '')
    .replace(/\busing the following request\s*:\s*https?:\/\/\S+/i, 'using a request to the affected endpoint')
    .replace(/\s*This produced the following truncated output[\s\S]*$/i, '\n\nEvidence output omitted. See DefectDojo finding for raw truncated output.')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
);

const extractTextSourceEvidenceLines = (text = '') => {
  const evidenceLines = new Set();
  cleanBlockText(text).replace(SOURCE_EVIDENCE_RE, (match) => {
    const cleaned = cleanText(match);
    if (cleaned) evidenceLines.add(cleaned);
    return match;
  });
  return Array.from(evidenceLines);
};

const normalizeTextSourceKey = (text = '') => (
  [
    cleanTextSourceBody(text),
    extractTextSourceEvidenceLines(text)
      .map(line => line
        .replace(/\bURL\s*:\s*https?:\/\/\S+/gi, 'URL: <endpoint>')
        .replace(/\bhttps?:\/\/[^\s)]+/gi, '<url>')
        .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<host>')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase())
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .join('|'),
  ]
    .filter(Boolean)
    .join('|evidence|')
    .toLowerCase()
);

const getCompactionDetailKey = (finding = {}) => ([
  'detail',
  normalizeTextSourceKey(finding.description || ''),
  normalizeTextSourceKey(finding.impact || ''),
].join('|'));

const addTextSource = (sourceMap, text, findingId) => {
  const cleanedText = cleanBlockText(text);
  if (!cleanedText) return;
  const bodyText = cleanTextSourceBody(cleanedText);
  const evidenceLines = extractTextSourceEvidenceLines(cleanedText);
  const sourceKey = normalizeTextSourceKey(cleanedText);

  if (!sourceMap.has(sourceKey)) {
    sourceMap.set(sourceKey, {
      text: bodyText,
      findingIds: new Set(),
      evidenceLines: new Set(),
    });
  }

  evidenceLines.forEach(line => sourceMap.get(sourceKey).evidenceLines.add(line));
  const cleanedFindingId = cleanText(findingId);
  if (cleanedFindingId) sourceMap.get(sourceKey).findingIds.add(cleanedFindingId);
};

const sortTextSources = (sourceMap) => (
  Array.from(sourceMap.values())
    .map(source => ({
      text: source.text,
      findingIds: sortFindingIds(Array.from(source.findingIds)),
      evidenceLines: sortStrings(source.evidenceLines || []),
    }))
    .filter(source => source.text || source.evidenceLines.length > 0)
    .sort((a, b) => cleanText(a.text || a.evidenceLines.join(' ')).localeCompare(cleanText(b.text || b.evidenceLines.join(' ')), undefined, { numeric: true }))
);

const stableHash = (value) => {
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

const buildCompactedSyncKey = ({
  groupKey,
  productIds = [],
  engagementIds = [],
}) => {
  const source = [
    `group:${groupKey}`,
    `products:${sortStrings(asArray(productIds).map(id => cleanText(id)).filter(Boolean)).join(',')}`,
    `engagements:${sortStrings(asArray(engagementIds).map(id => cleanText(id)).filter(Boolean)).join(',')}`,
  ].join('|');

  return `dd-compact-${stableHash(source)}`;
};

const buildLegacyCompactedSyncKey = ({
  groupKey,
  findingIds = [],
  productIds = [],
  engagementIds = [],
}) => {
  const source = [
    `group:${groupKey}`,
    `findings:${sortStrings(asFindingIdArray(findingIds).map(id => cleanText(id)).filter(Boolean)).join(',')}`,
    `products:${sortStrings(asArray(productIds).map(id => cleanText(id)).filter(Boolean)).join(',')}`,
    `engagements:${sortStrings(asArray(engagementIds).map(id => cleanText(id)).filter(Boolean)).join(',')}`,
  ].join('|');

  return `dd-compact-${stableHash(source)}`;
};

const extractTitleVersion = (title) => {
  const text = cleanText(title);
  const lessThanMatch = text.match(LESS_THAN_VERSION_RE);
  if (lessThanMatch) return lessThanMatch[1].replace(/\.$/, '');

  const target = parseUpgradeText(text);
  if (target) return target.version;

  const versionMatch = text.match(/\bversion\s+([0-9][0-9a-z.-]*)/i);
  return versionMatch ? versionMatch[1].replace(/\.$/, '') : null;
};

const chooseDisplayTitle = (titles, fallbackTitle) => {
  const cleanedTitles = sortStrings(titles)
    .map(title => cleanText(title))
    .filter(Boolean);

  if (cleanedTitles.length === 0) return cleanText(fallbackTitle || 'Untitled finding');

  return cleanedTitles.reduce((best, candidate) => {
    const bestVersion = extractTitleVersion(best);
    const candidateVersion = extractTitleVersion(candidate);

    if (candidateVersion && (!bestVersion || compareVersions(candidateVersion, bestVersion) > 0)) {
      return candidate;
    }

    if (!candidateVersion && !bestVersion && candidate.length > best.length) {
      return candidate;
    }

    return best;
  }, cleanedTitles[0]);
};

const groupEndpointDetailsByCves = (details) => {
  const groups = new Map();

  details.forEach(detail => {
    const signature = detail.cves.length > 0 ? detail.cves.join('|') : 'None';
    if (!groups.has(signature)) {
      groups.set(signature, {
        cves: detail.cves,
        endpoints: [],
      });
    }

    groups.get(signature).endpoints.push(detail);
  });

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      endpoints: group.endpoints.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    }))
    .sort((a, b) => {
      const firstA = a.endpoints[0]?.label || '';
      const firstB = b.endpoints[0]?.label || '';
      return firstA.localeCompare(firstB, undefined, { numeric: true });
    });
};

const sortSourceGroupsByTitleVersion = (groups = []) => (
  groups.sort((a, b) => {
    const versionA = extractTitleVersion(a.title);
    const versionB = extractTitleVersion(b.title);
    if (versionA && versionB) return compareVersions(versionB, versionA);
    if (versionA) return -1;
    if (versionB) return 1;
    return cleanText(a.title).localeCompare(cleanText(b.title), undefined, { numeric: true });
  })
);

const finalizeEndpointDetails = (endpointDetailMap) => (
  Array.from(endpointDetailMap.values())
    .map(detail => ({
      endpoint: detail.endpoint,
      label: detail.label,
      host: detail.host,
      severity: detail.severity,
      cves: sortStrings(detail.cves),
      mitigations: sortStrings(detail.mitigations),
      findingIds: sortFindingIds(detail.findingIds),
    }))
    .sort((a, b) => (
      a.host.localeCompare(b.host, undefined, { numeric: true })
      || a.label.localeCompare(b.label, undefined, { numeric: true })
    ))
);

const finalizeSourceGroups = (sourceGroupsMap) => (
  sortSourceGroupsByTitleVersion(Array.from(sourceGroupsMap.values()).map(sourceGroup => {
    const activeCount = sourceGroup.activeCount || 0;
    const mitigatedCount = sourceGroup.mitigatedCount || 0;
    return {
      title: sourceGroup.title,
      findingIds: sortFindingIds(sourceGroup.findingIds),
      severity: sourceGroup.severity || 'Info',
      cveIds: sortStrings(sourceGroup.cveIds),
      endpointDetails: finalizeEndpointDetails(sourceGroup.endpointDetailMap),
      descriptionSources: sortTextSources(sourceGroup.descriptionsMap),
      impactSources: sortTextSources(sourceGroup.impactsMap),
      mitigations: sortStrings(sourceGroup.mitigations),
      activeCount,
      mitigatedCount,
      currentStatus: activeCount > 0 && mitigatedCount > 0
        ? 'mixed'
        : activeCount > 0
          ? 'active'
          : 'mitigated',
    };
  }))
);

const formatTextSourceLabel = (source, index) => {
  const findingIds = source.findingIds || [];
  const idLabel = findingIds.length === 0
    ? ''
    : ` (DefectDojo Finding IDs: ${findingIds.join(', ')})`;

  return `Source ${index + 1}${idLabel}`;
};

const formatEvidenceLine = (value = '') => {
  const text = cleanText(value);
  if (!text) return '';

  const lines = [];
  const urlMatch = text.match(/\b(URL|URI)\s*:\s*(https?:\/\/\S+)(\s+\([^)]*\))?/i);
  if (urlMatch) {
    lines.push(`${urlMatch[1].toUpperCase()}: ${urlMatch[2]}${urlMatch[3] || ''}`);
  }
  const versionSourceMatch = text.match(/\bVersion source\s*:\s*(.*?)(?=\s+(?:Installed|Detected|Current|Fixed|Affected) version\s*:|$)/i);
  if (versionSourceMatch) {
    lines.push(`Version source : ${cleanText(versionSourceMatch[1])}`);
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

const formatSourceFindingAssets = (source = {}, endpointDetails = []) => {
  const sourceFindingIds = new Set(sortFindingIds(source.findingIds || []).map(id => String(id)));
  if (sourceFindingIds.size === 0) return '';

  const scopedDetails = asArray(endpointDetails).filter(detail => (
    asArray(detail.findingIds).some(findingId => sourceFindingIds.has(String(findingId)))
  ));
  if (scopedDetails.length === 0) return '';

  return `Affected IP:\n${formatSourceGroupAssets(scopedDetails)}`;
};

const getEndpointPort = (detail = {}) => {
  const parts = getEndpointParts(detail.endpoint);
  if (parts.port) return parts.port;
  const label = cleanText(detail.label || '');
  const match = label.match(/:(\d+)(?:\/|\s|$)?/);
  return match ? match[1] : '';
};

const formatAffectedAssetsAndPorts = (endpointDetails = []) => {
  const hosts = new Map();
  asArray(endpointDetails).forEach(detail => {
    const host = cleanText(detail.host || endpointHost(detail.endpoint) || 'Unknown host');
    if (!hosts.has(host)) hosts.set(host, { ports: new Set(), labels: new Set() });
    const port = getEndpointPort(detail);
    if (port) hosts.get(host).ports.add(port);
    const label = cleanText(detail.label || endpointLabel(detail.endpoint));
    if (label) hosts.get(host).labels.add(label);
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

const formatTicketTextSection = (title, values) => {
  const items = values
    .map(value => (typeof value === 'string' ? { text: value, findingIds: [] } : value))
    .map(value => ({
      text: cleanBlockText(value?.text || ''),
      findingIds: sortFindingIds(value?.findingIds || []),
    }))
    .filter(value => value.text);

  if (items.length === 0) return '';
  if (items.length === 1) return `\n\n**${title}:**\n${items[0].text}`;

  return `\n\n**${title}s:**\n${items.map((item, idx) => `${formatTextSourceLabel(item, idx)}:\n${item.text}`).join('\n\n')}`;
};

const formatRouteValue = (name, id) => {
  if (name && id) return `${name} (ID: ${id})`;
  return name || id || 'N/A';
};

const formatDefectDojoContext = (ticket) => {
  const project = formatRouteValue(ticket.defectDojoProjectName, ticket.defectDojoProjectId);
  const engagement = formatRouteValue(ticket.defectDojoEngagementName, ticket.defectDojoEngagementId);

  if (project === 'N/A' && engagement === 'N/A') return '';

  return `\n\n**DefectDojo Context:**\n- Project: ${project}\n- Engagement: ${engagement}`;
};

const formatSourceGroupTextBlock = (title, values = [], endpointDetails = []) => {
  const escapeText = (text = '') => (
    cleanBlockText(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  );
  const items = values
    .map(value => (typeof value === 'string' ? { text: value, findingIds: [] } : value))
    .map(value => ({
      text: escapeText(value?.text || ''),
      findingIds: sortFindingIds(value?.findingIds || []),
      evidenceLines: sortStrings(value?.evidenceLines || []).map(line => escapeText(formatEvidenceLine(line))),
    }))
    .filter(value => value.text || value.evidenceLines.length > 0);

  const formatItem = (item) => [
    items.length > 1 ? formatSourceFindingAssets(item, endpointDetails) : '',
    item.text,
    item.evidenceLines.length > 0 ? item.evidenceLines.join('\n') : '',
  ].filter(Boolean).join('\n');
  if (items.length === 0) return '';
  if (items.length === 1) return `\n\n**${title}:**\n${formatItem(items[0])}`;

  return `\n\n**${title}:**\n${items.map((item, idx) => `${formatTextSourceLabel(item, idx)}:\n${formatItem(item)}`).join('\n\n')}`;
};

const formatSourceGroupAssets = (endpointDetails = []) => {
  const details = Array.isArray(endpointDetails) ? endpointDetails : [];
  if (details.length === 0) return 'None';

  const endpointsByHost = new Map();
  details.forEach(detail => {
    const host = detail.host || endpointHost(detail.endpoint) || 'Unknown host';
    if (!endpointsByHost.has(host)) endpointsByHost.set(host, []);
    endpointsByHost.get(host).push(detail);
  });

  return Array.from(endpointsByHost.entries())
    .sort(([hostA], [hostB]) => hostA.localeCompare(hostB, undefined, { numeric: true }))
    .map(([host, hostDetails]) => {
      const endpointLines = hostDetails
        .sort((a, b) => cleanText(a.label).localeCompare(cleanText(b.label), undefined, { numeric: true }))
        .map(detail => `  - ${detail.label || endpointLabel(detail.endpoint)} (Severity: ${detail.severity || 'Info'})`)
        .join('\n');

      return `**Host:** ${host}\n${endpointLines}`;
    })
    .join('\n\n');
};

const normalizeTextSource = (source = {}) => ({
  text: source.text || '',
  findingIds: sortFindingIds(source.findingIds || []),
  evidenceLines: sortStrings(source.evidenceLines || []),
  endpointDetails: asArray(source.endpointDetails),
});

const collectAppendixSources = (sourceGroups = [], sourceKey = 'descriptionSources') => {
  const sourcesByKey = new Map();

  asArray(sourceGroups).forEach(sourceGroup => {
    asArray(sourceGroup[sourceKey]).forEach(source => {
      const sourceItem = normalizeTextSource({
        ...source,
        endpointDetails: sourceGroup.endpointDetails || [],
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
          .toLowerCase()),
      ].join('|');
      if (!sourcesByKey.has(key)) {
        sourcesByKey.set(key, {
          text: sourceItem.text,
          findingIds: new Set(),
          evidenceLines: new Set(),
          endpointDetails: [],
        });
      }
      const target = sourcesByKey.get(key);
      sourceItem.findingIds.forEach(findingId => target.findingIds.add(String(findingId)));
      sourceItem.evidenceLines.forEach(line => target.evidenceLines.add(line));
      target.endpointDetails.push(...sourceItem.endpointDetails);
    });
  });

  return Array.from(sourcesByKey.values()).map(source => normalizeTextSource(source));
};

const formatQuoteBlock = (value = '') => (
  cleanBlockText(value)
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
);

const formatAppendixTextBlock = (title, sources = []) => {
  const items = asArray(sources)
    .map(source => normalizeTextSource(source))
    .filter(source => source.text || source.evidenceLines.length > 0);
  if (items.length === 0) return '';

  const escapeText = (text = '') => (
    cleanBlockText(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  );
  const formatItem = (item, includeAssets) => [
    includeAssets ? formatSourceFindingAssets(item, item.endpointDetails) : '',
    escapeText(item.text || ''),
    ...item.evidenceLines.map(line => escapeText(formatEvidenceLine(line))),
  ].filter(Boolean).join('\n');

  if (items.length === 1) {
    return `\n\n**${title}:**\n${formatQuoteBlock(formatItem(items[0], false))}`;
  }

  return `\n\n**${title}:**\n${items.map((item, idx) => `${formatTextSourceLabel(item, idx)}:\n${formatItem(item, true)}`).join('\n\n')}`;
};

const buildSourceGroupSection = (sourceGroup = {}) => {
  const title = cleanText(sourceGroup.title || 'Untitled finding');
  const findingIds = sortFindingIds(sourceGroup.findingIds || []);
  const idLabel = findingIds.length > 0
    ? ` (DefectDojo Finding IDs: ${findingIds.join(', ')})`
    : '';
  const cveIds = sortStrings(asArray(sourceGroup.cveIds).map(cve => cve?.vulnerability_id || cve).filter(Boolean));
  const mitigations = sortStrings(asArray(sourceGroup.mitigations));
  const mitigationBlock = mitigations.length > 0
    ? `\n\nMitigation:\n${mitigations.map(item => `- ${item}`).join('\n')}`
    : '';
  const descriptionSources = asArray(sourceGroup.descriptionSources).filter(source => source?.text || source?.evidenceLines?.length > 0);
  const impactSources = asArray(sourceGroup.impactSources).filter(source => source?.text || source?.evidenceLines?.length > 0);
  const hasScopedTextSources = descriptionSources.length > 1 || impactSources.length > 1;
  const assetsBlock = hasScopedTextSources
    ? ''
    : `Affected Assets:\n${formatSourceGroupAssets(sourceGroup.endpointDetails)}\n\n`;

  return `${title}${idLabel}:\n${assetsBlock}CVEs: ${cveIds.length > 0 ? cveIds.join(', ') : 'None'}${formatSourceGroupTextBlock('Description', descriptionSources, sourceGroup.endpointDetails)}${formatSourceGroupTextBlock('Impact', impactSources, sourceGroup.endpointDetails)}${mitigationBlock}`;
};

const buildSourceGroupsBlock = (ticket) => {
  const sourceGroups = Array.isArray(ticket.sourceGroups)
    ? ticket.sourceGroups.filter(sourceGroup => sourceGroup && sourceGroup.title)
    : [];
  if (sourceGroups.length === 0) return '';

  const listTitle = cleanText(ticket.title || 'Compacted Vulnerabilities');
  return `\n\nList of ${listTitle}:\n\n${sourceGroups.map(buildSourceGroupSection).join('\n\n')}`;
};

const buildActionRequiredMarkdown = (ticket) => {
  const target = getTicketUpgradeTarget(ticket);
  const targetMitigation = target
    ? `Upgrade to ${target.software} version ${target.version} or later.`
    : sortStrings(ticket.allMitigations || [])[0] || 'Review the affected finding and apply the recommended remediation.';
  const sourceGroups = asArray(ticket.sourceGroups).filter(sourceGroup => sourceGroup && sourceGroup.title);
  const cveIds = sortStrings([
    ...(asArray(ticket.cveIds)),
    ...(asArray(ticket.allCVEs).map(cve => cve?.vulnerability_id || cve?.name || cve?.id || cve)),
  ]);
  const descriptionSources = collectAppendixSources(sourceGroups, 'descriptionSources');
  const impactSources = collectAppendixSources(sourceGroups, 'impactSources');
  const cveBlock = cveIds.length > 0 ? cveIds.join(', ') : 'None';
  const defectDojoContextBlock = formatDefectDojoContext(ticket);

  return `Vulnerability Overview:\nThe endpoints listed below are running outdated software and require patching.${defectDojoContextBlock}\n\n**Target Mitigation:**\n${targetMitigation}\n\n**Affected Assets & Ports:**\n\n${formatAffectedAssetsAndPorts(ticket.endpointDetails || [])}\n\n**Appendix:** Vulnerability Details\n**Associated CVEs:** ${cveBlock}${formatAppendixTextBlock('DefectDojo Description', descriptionSources)}${formatAppendixTextBlock('Impact', impactSources)}`;
};

const buildSuperTicketMarkdown = (ticket) => {
  if (asArray(ticket.sourceGroups).length > 0 || getTicketUpgradeTarget(ticket)) {
    return buildActionRequiredMarkdown(ticket);
  }

  const defectDojoContextBlock = formatDefectDojoContext(ticket);
  const sourceGroupsBlock = buildSourceGroupsBlock(ticket);
  if (sourceGroupsBlock) {
    return `**Vulnerability Overview:**\nThe targeted software is out of date and affected by one or more vulnerabilities. Please apply the mitigation to the endpoints listed below.${defectDojoContextBlock}${sourceGroupsBlock}`;
  }

  const endpointsByHost = new Map();

  (ticket.endpointDetails || []).forEach(detail => {
    if (!endpointsByHost.has(detail.host)) endpointsByHost.set(detail.host, []);
    endpointsByHost.get(detail.host).push(detail);
  });

  const hostBlocks = Array.from(endpointsByHost.entries())
    .sort(([hostA], [hostB]) => hostA.localeCompare(hostB, undefined, { numeric: true }))
    .map(([host, details]) => {
      const endpointLines = groupEndpointDetailsByCves(details)
        .map(group => {
          const endpoints = group.endpoints
            .map(detail => `  - ${detail.label} (Severity: ${detail.severity})`)
            .join('\n');
          const cves = group.cves.length > 0 ? group.cves.join(', ') : 'None';
          return `${endpoints}\n    CVEs: ${cves}`;
        })
        .join('\n');

      return `**Host:** ${host}\n${endpointLines}`;
    })
    .join('\n\n');

  const sourceTitles = Array.isArray(ticket.allTitles) ? ticket.allTitles.filter(Boolean) : [];
  const sourceTitlesBlock = sourceTitles.length > 0
    ? `\n\n**Source Titles:**\n${sourceTitles.map(title => `- ${title}`).join('\n')}`
    : '';
  const allCveIds = Array.isArray(ticket.allCVEs)
    ? ticket.allCVEs.map(item => item?.vulnerability_id || item?.name || item?.id || item).filter(Boolean)
    : [];
  const cveBlock = allCveIds.length > 0
    ? `\n\n**CVEs:**\n${allCveIds.join(', ')}`
    : '';
  const mitigationBlock = ticket.allMitigations.length > 0
    ? `\n\n**${ticket.allMitigations.length === 1 ? 'Mitigation' : 'Mitigations'}:**\n${ticket.allMitigations.map(item => `- ${item}`).join('\n')}`
    : '';

  const descriptionBlock = formatTicketTextSection('Description', ticket.allDescriptionSources || ticket.allDescriptions || []);
  const impactBlock = formatTicketTextSection('Impact', ticket.allImpactSources || ticket.allImpacts || []);

  return `**Vulnerability Overview:**\nThe targeted software is out of date and affected by one or more vulnerabilities. Please apply the mitigation to the endpoints listed below.${defectDojoContextBlock}${sourceTitlesBlock}${cveBlock}${descriptionBlock}${impactBlock}${mitigationBlock}\n\n**Affected Assets & Details:**\n\n${hostBlocks}`;
};

const normalizeBackendCveGroupForDisplay = (group) => {
  const backendCves = Array.isArray(group.allCVEs)
    ? group.allCVEs.map(item => item?.vulnerability_id || item?.name || item?.id || item).filter(Boolean)
    : [];
  const cveIds = backendCves.length > 0
    ? backendCves
    : (Array.isArray(group.cveIds) ? group.cveIds.filter(Boolean) : []);
  const cveLabel = cveIds.length > 0 ? cveIds.join(', ') : (group.cveId || 'No CVE');
  const findingStates = Array.isArray(group.findingStates) ? group.findingStates : [];
  const endpointDetails = Array.isArray(group.endpointDetails) && group.endpointDetails.length > 0
    ? group.endpointDetails
    : findingStates.map(state => ({
      endpoint: state.endpoint || 'Unknown endpoint',
      label: state.endpoint || 'Unknown endpoint',
      host: state.endpoint || 'Unknown endpoint',
      severity: state.severity || group.severity || 'Info',
      cves: state.cveIds?.length > 0 ? state.cveIds : (cveIds.length > 0 ? cveIds : (group.cveId ? [group.cveId] : [])),
      mitigations: state.mitigated ? ['Mitigated in DefectDojo'] : [],
      findingIds: [state.findingId],
      mitigated: Boolean(state.mitigated),
    }));
  const originalIds = getCompactedFindingIds({
    ...group,
    findingStates,
    endpointDetails,
  });
  const sourceFindingCount = getCompactedFindingCount({ ...group, originalIds, findingStates, endpointDetails });
  const route = {
    projectId: group.productId || '',
    projectName: group.productName || '',
    engagementId: group.engagementId || '',
    engagementName: group.engagementName || '',
  };
  const compactedSyncKey = group.compactedSyncKey || group.redmineTicketKey || group.groupKey;
  const displayTicket = {
    title: group.title || (group.cveId ? `${cveLabel} - ${group.currentStatus || 'active'}` : findingStates[0]?.title || cveLabel),
    allTitles: Array.isArray(group.allTitles) ? group.allTitles : findingStates.map(state => state.title).filter(Boolean),
    allCVEs: cveIds.length > 0
      ? cveIds.map(vulnerability_id => ({ vulnerability_id }))
      : (group.cveId ? [{ vulnerability_id: group.cveId }] : []),
    allMitigations: Array.isArray(group.allMitigations) ? group.allMitigations : findingStates.filter(state => state.mitigated).map(state => `Finding ${state.findingId} mitigated`),
    allDescriptionSources: group.allDescriptionSources,
    allImpactSources: group.allImpactSources,
    allDescriptions: Array.isArray(group.allDescriptions) ? group.allDescriptions : [],
    allImpacts: Array.isArray(group.allImpacts) ? group.allImpacts : [],
    endpointDetails,
    sourceGroups: Array.isArray(group.sourceGroups) ? group.sourceGroups : [],
    defectDojoProjectId: route.projectId,
    defectDojoProjectName: route.projectName,
    defectDojoEngagementId: route.engagementId,
    defectDojoEngagementName: route.engagementName,
  };
  const redmineSubject = buildActionRequiredSubject(displayTicket) || group.redmineSubject || group.subject;

  return {
    id: compactedSyncKey,
    compactedSyncKey,
    compactGroupId: compactedSyncKey,
    compactSourceKey: group.compactSourceKey,
    compactFamilyKey: group.compactFamilyKey,
    compactFamilyTitle: group.compactFamilyTitle,
    compactReason: group.compactReason,
    legacySyncKeys: Array.isArray(group.legacySyncKeys) ? group.legacySyncKeys : [],
    redmineSubject,
    subject: redmineSubject,
    title: displayTicket.title,
    severity: group.severity || 'Info',
    count: sourceFindingCount,
    findingCount: sourceFindingCount,
    sourceFindingCount,
    originalIds,
    allEndpoints: Array.isArray(group.allEndpoints) ? group.allEndpoints : (group.affectedEndpoints || []),
    allCVEs: cveIds.length > 0
      ? cveIds.map(vulnerability_id => ({ vulnerability_id }))
      : (group.cveId ? [{ vulnerability_id: group.cveId }] : []),
    allMitigations: displayTicket.allMitigations,
    allDescriptions: displayTicket.allDescriptions,
    allImpacts: displayTicket.allImpacts,
    allDescriptionSources: displayTicket.allDescriptionSources,
    allImpactSources: displayTicket.allImpactSources,
    allTitles: Array.isArray(group.allTitles) ? group.allTitles : findingStates.map(state => state.title).filter(Boolean),
    endpointDetails,
    sourceGroups: displayTicket.sourceGroups,
    defectDojoProjectId: route.projectId,
    defectDojoProjectName: route.projectName,
    defectDojoEngagementId: route.engagementId,
    defectDojoEngagementName: route.engagementName,
    defectdojo_route: route,
    serverRedmineSync: group.redmineTicketId ? {
      action: group.redmineStatus && ['closed', 'done'].includes(normalizeRedmineStatus(group.redmineStatus)) ? 'existing_closed' : 'existing_open',
      issueId: group.redmineTicketId,
      status: group.redmineStatus,
      statusId: group.redmineStatusId,
      findingIds: originalIds,
    } : null,
    currentStatus: group.currentStatus,
    mitigationStates: findingStates,
    superTicketMarkdown: group.superTicketMarkdown || buildSuperTicketMarkdown(displayTicket),
  };
};

function App() {
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedEngagementId, setSelectedEngagementId] = useState('');
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [compactedCveFindings, setCompactedCveFindings] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [config, setConfig] = useState(() => createDefaultConfig());
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [openingRedmineId, setOpeningRedmineId] = useState(null);
  const [bulkOpeningRedmine, setBulkOpeningRedmine] = useState(false);
  const [showSyncAllFilters, setShowSyncAllFilters] = useState(false);
  const [syncAllPullFilters, setSyncAllPullFilters] = useState(() => createPullFiltersDraft());
  const [syncAllProgress, setSyncAllProgress] = useState(null);
  const [redmineSyncByTicket, setRedmineSyncByTicket] = useState({});

  useEffect(() => {
    localStorage.removeItem('defectdojo_redmine_sync');
  }, []);
  
  const findingsRefreshRef = useRef({ inFlight: false, queued: false });
  const dashboardSyncVersionRef = useRef(null);
  const dashboardSyncReconnectRef = useRef(0);
  const [configBackups, setConfigBackups] = useState([]);
  const [selectedConfigBackup, setSelectedConfigBackup] = useState('');
  const [user, setUser] = useState(() => getCurrentUser());
  const [dashboardSync, setDashboardSync] = useState({
    connected: false,
    reason: 'connecting',
    updatedAt: null,
  });
  const [redmineSyncStatus, setRedmineSyncStatus] = useState(DEFAULT_REDMINE_SYNC_STATUS);

  const loadFindingsFromApi = async () => {
    const res = await apiFetch('/findings');
    const data = await res.json();
    const fixedData = normalizeFetchedFindings(data);

    if (!fixedData) {
      console.error('Unexpected data format:', data);
      return [];
    }

    return fixedData;
  };

  const fetchFindings = async ({ silent = false } = {}) => {
    if (findingsRefreshRef.current.inFlight) {
      findingsRefreshRef.current.queued = true;
      return findings;
    }

    findingsRefreshRef.current.inFlight = true;
    if (!silent) setLoading(true);
    let nextFindings = [];
    try {
      nextFindings = await loadFindingsFromApi();
      setFindings(nextFindings);
    } catch (err) {
      console.error('Error fetching findings:', err);
    } finally {
      findingsRefreshRef.current.inFlight = false;
      if (!silent) setLoading(false);

      if (findingsRefreshRef.current.queued) {
        findingsRefreshRef.current.queued = false;
        fetchFindings({ silent: true });
      }
    }

    return nextFindings;
  };

  const buildScopedQuery = () => {
    const params = new URLSearchParams();
    if (selectedProductId) params.set('productId', selectedProductId);
    if (selectedEngagementId) params.set('engagementId', selectedEngagementId);
    if (activeFilter !== 'All') params.set('severity', activeFilter);
    const query = params.toString();
    return query ? `?${query}` : '';
  };

  const fetchDashboardData = async ({ silent = false } = {}) => {
    if (!user) return;
    if (!silent) setDashboardLoading(true);
    try {
      const query = buildScopedQuery();
      const [summaryRes, cveRes] = await Promise.all([
        apiFetch(`/dashboard/summary${query}`),
        apiFetch(`/compacted-cves${query}`),
      ]);
      if (summaryRes.ok) setDashboardSummary(await summaryRes.json());
      if (cveRes.ok) {
        const groups = await cveRes.json();
        setCompactedCveFindings(Array.isArray(groups) ? groups.map(normalizeBackendCveGroupForDisplay) : []);
      }
    } catch (err) {
      console.warn('Unable to fetch dashboard summary:', err);
    } finally {
      if (!silent) setDashboardLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await apiFetch('/config');
      if (res.ok) {
        const data = await res.json();
        const loadedConfig = normalizeConfig(data);
        setConfig(loadedConfig);
      }
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  };

  const fetchConfigBackups = async () => {
    try {
      const res = await apiFetch('/config/backups');
      if (!res.ok) return;

      const backups = await res.json();
      const backupList = Array.isArray(backups) ? backups : [];
      setConfigBackups(backupList);
      if (backupList.length > 0 && !backupList.some(backup => backup.fileName === selectedConfigBackup)) {
        setSelectedConfigBackup(backupList[0].fileName);
      } else if (backupList.length === 0) {
        setSelectedConfigBackup('');
      }
    } catch (err) {
      console.error('Error fetching config backups:', err);
    }
  };

  const updateConfig = async (newConfig) => {
    try {
      const res = await apiFetch('/config', {
        method: 'POST',
        body: JSON.stringify(newConfig)
      });
      if (res.ok) {
        const savedConfig = normalizeConfig(await res.json().then(data => data.config || newConfig));
        setConfig(savedConfig);
        fetchRedmineSyncStatus();
        fetchConfigBackups();
        return savedConfig;
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.details || 'Failed to update configuration');
    } catch (err) {
      console.error('Error updating config:', err);
      throw err;
    }
  };

  const backupConfig = async () => {
    try {
      const res = await apiFetch('/config/backup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(`Backup failed: ${data.error || 'Unknown error'}`);
        return;
      }

      await fetchConfigBackups();
      setSelectedConfigBackup(data.backup?.fileName || selectedConfigBackup);
      alert(`Config backup created${data.backup?.fileName ? `: ${data.backup.fileName}` : ''}.`);
    } catch (err) {
      console.error('Error backing up config:', err);
      alert('Failed to backup config.');
    }
  };

  const downloadBlobResponse = async (res, fallbackFileName) => {
    const blob = await res.blob();
    const contentDisposition = res.headers.get('Content-Disposition') || '';
    const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/);
    const fileName = fileNameMatch?.[1] || fallbackFileName;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const exportConfig = async () => {
    try {
      const res = await apiFetch('/config/export');
      if (!res.ok) {
        const data = await res.json();
        alert(`Export failed: ${data.error || 'Unknown error'}`);
        return;
      }

      await downloadBlobResponse(res, 'defectdojo-viewer-config.json');
    } catch (err) {
      console.error('Error exporting config:', err);
      alert('Failed to export config.');
    }
  };

  const downloadConfigBackup = async () => {
    if (!selectedConfigBackup) {
      alert('No backup selected.');
      return;
    }

    try {
      const res = await apiFetch(`/config/backups/${encodeURIComponent(selectedConfigBackup)}/export`);
      if (!res.ok) {
        const data = await res.json();
        alert(`Backup download failed: ${data.error || 'Unknown error'}`);
        return;
      }

      await downloadBlobResponse(res, selectedConfigBackup);
    } catch (err) {
      console.error('Error downloading config backup:', err);
      alert('Failed to download config backup.');
    }
  };

  const importConfigFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const importedConfig = JSON.parse(await file.text());
      const res = await apiFetch('/config/import', {
        method: 'POST',
        body: JSON.stringify(importedConfig),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Import failed: ${data.error || 'Unknown error'}`);
        return;
      }

      const loadedConfig = normalizeConfig(data.config);
      setConfig(loadedConfig);
      await fetchConfigBackups();
      alert('Config imported. A pre-import backup was created first.');
    } catch (err) {
      console.error('Error importing config:', err);
      alert('Failed to import config JSON.');
    }
  };

  const restoreConfigBackup = async () => {
    if (!selectedConfigBackup) {
      alert('No backup selected.');
      return;
    }

    if (!confirm(`Restore config from ${selectedConfigBackup}? Current config will be backed up first.`)) {
      return;
    }

    try {
      const res = await apiFetch('/config/restore', {
        method: 'POST',
        body: JSON.stringify({ fileName: selectedConfigBackup })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Restore failed: ${data.error || 'Unknown error'}`);
        return;
      }

      const loadedConfig = normalizeConfig(data.config);
      setConfig(loadedConfig);
      await fetchConfigBackups();
      alert(`Config restored from ${selectedConfigBackup}.`);
    } catch (err) {
      console.error('Error restoring config:', err);
      alert('Failed to restore config backup.');
    }
  };

  const fetchRedmineSyncStatus = async () => {
    try {
      const res = await apiFetch('/redmine/sync/status');
      if (!res.ok) return;
      const data = await res.json();
      setRedmineSyncStatus({
        ...DEFAULT_REDMINE_SYNC_STATUS,
        ...data,
      });
    } catch (err) {
      console.warn('Unable to fetch Redmine sync status:', err);
    }
  };

  const getTicketActionId = (finding) => finding.compactedSyncKey || finding.compactGroupId || finding.id || finding.title;

  const getRedmineSyncTimestamp = (sync) => (
    Date.parse(sync?.updatedAt || sync?.checkedAt || '') || 0
  );

  const chooseDashboardRedmineSync = (localSync, serverSync) => {
    if (!localSync) return serverSync || null;
    if (!serverSync) return localSync;

    const localTimestamp = getRedmineSyncTimestamp(localSync);
    const serverTimestamp = getRedmineSyncTimestamp(serverSync);
    if (!localTimestamp || !serverTimestamp || serverTimestamp >= localTimestamp) {
      return serverSync;
    }
    return localSync;
  };

  const getStoredRedmineSync = (finding) => {
    const candidateKeys = [
      getTicketActionId(finding),
      ...(Array.isArray(finding.legacySyncKeys) ? finding.legacySyncKeys : []),
    ].filter(Boolean);
    const localSync = candidateKeys.map(key => redmineSyncByTicket[key]).find(Boolean);
    return chooseDashboardRedmineSync(localSync, finding.serverRedmineSync);
  };

  const getKnownRedmineIssueId = (finding) => {
    const sync = getStoredRedmineSync(finding);
    return sync?.issueId || sync?.issue?.id || '';
  };

  const setSyncProgress = ({ phase, current, total, message, append = true }) => {
    setSyncAllProgress(prev => {
      const previousLines = prev?.lines || [];
      const nextLines = append && message
        ? [...previousLines, message].slice(-8)
        : previousLines;

      return {
        phase: phase ?? prev?.phase ?? 'Preparing',
        current: current ?? prev?.current ?? 0,
        total: total ?? prev?.total ?? 0,
        message: message ?? prev?.message ?? '',
        lines: nextLines,
      };
    });
  };

  const buildRedmineIssueRequest = (finding) => {
    const normalizedConfig = normalizeConfig(config);
    const findingRoute = getDefectDojoRoute(finding);
    const defectDojoRoute = {
      projectId: finding.defectDojoProjectId || findingRoute.projectId || normalizedConfig.pullFilters?.test__engagement__product || '',
      projectName: finding.defectDojoProjectName || findingRoute.projectName || '',
      engagementId: finding.defectDojoEngagementId || findingRoute.engagementId || normalizedConfig.pullFilters?.test__engagement || '',
      engagementName: finding.defectDojoEngagementName || findingRoute.engagementName || '',
    };
    const missingRedmineConfig = !normalizedConfig.redmineUrl
      || !normalizedConfig.redmineApiKey;

    if (missingRedmineConfig) {
      return {
        error: 'Please configure Redmine URL and API Key first.',
        openConfig: true,
        normalizedConfig,
      };
    }

    if (!finding.superTicketMarkdown) {
      return {
        error: 'Switch to Compacted View before opening a Redmine issue.',
        normalizedConfig,
      };
    }

    const hasProjectRouteCandidate = defectDojoRoute.projectName
      || (defectDojoRoute.projectId && !/^\d+$/.test(defectDojoRoute.projectId));

    if (!normalizedConfig.redmineProjectId && !hasProjectRouteCandidate) {
      return {
        error: 'Redmine Project Identifier override is empty and this compacted ticket has no DefectDojo project name or identifier to auto-route.',
        openConfig: true,
        normalizedConfig,
      };
    }

    return {
      normalizedConfig,
      body: {
        redmine: {
          url: normalizedConfig.redmineUrl,
          apiKey: normalizedConfig.redmineApiKey,
          projectId: normalizedConfig.redmineProjectId,
          trackerId: normalizedConfig.redmineTrackerId,
          priorityId: getRedminePriorityIdForSeverity(finding.severity, normalizedConfig),
        },
        issue: {
          subject: finding.title,
          description: finding.superTicketMarkdown,
          severity: finding.severity || '',
          syncKey: getTicketActionId(finding),
          issueId: getKnownRedmineIssueId(finding),
          legacySyncKeys: finding.legacySyncKeys || [],
          findingIds: finding.originalIds || [],
          route: defectDojoRoute,
        },
      },
    };
  };

  const syncRedmineIssue = async (finding, { openIssueTab = false, timeoutMs = 0 } = {}) => {
    const request = buildRedmineIssueRequest(finding);
    if (request.error) {
      const error = new Error(request.error);
      error.openConfig = request.openConfig;
      error.normalizedConfig = request.normalizedConfig;
      throw error;
    }

    const res = await runWithTimeout(
      (signal) => apiFetch('/redmine/issues', {
        method: 'POST',
        body: JSON.stringify(request.body),
        signal,
      }),
      timeoutMs,
      `Timed out syncing "${finding.title}" after ${formatTimeoutSeconds(timeoutMs)} seconds`
    );
    const data = await res.json();

    if (!res.ok) {
      if (data.serverSync) {
        setRedmineSyncByTicket(prev => ({
          ...prev,
          [getTicketActionId(finding)]: data.serverSync,
        }));
      }

      const details = typeof data.details === 'string'
        ? data.details
        : JSON.stringify(data.details || '');
      const error = new Error(`${data.error || 'Failed to create Redmine issue'}${details ? `\n${details}` : ''}`);
      error.responseData = data;
      throw error;
    }

    const ticketActionId = getTicketActionId(finding);
    const resolvedProjectLabel = data.resolvedProject?.project?.name
      || data.resolvedProject?.identifier
      || data.resolvedProject?.id
      || '';
    const nextSync = data.serverSync || {
      action: data.action,
      issueId: data.issue?.id,
      status: data.issue?.status?.name,
      issueUrl: data.issueUrl,
      isClosed: data.action === 'existing_closed',
      projectName: resolvedProjectLabel,
    };

    setRedmineSyncByTicket(prev => ({
      ...prev,
      [ticketActionId]: nextSync,
    }));

    if (openIssueTab && data.issueUrl) {
      window.open(data.issueUrl, '_blank', 'noopener,noreferrer');
    }

    return {
      ...data,
      resolvedProjectLabel,
    };
  };

  const openRedmineIssue = async (finding) => {
    if (user?.role !== 'admin') {
      alert('Only admins can create or check Redmine issues.');
      return;
    }

    const ticketActionId = getTicketActionId(finding);
    setOpeningRedmineId(ticketActionId);
    try {
      const data = await syncRedmineIssue(finding, { openIssueTab: true });
      const routeLabel = data.resolvedProjectLabel
        ? ` → Project: "${data.resolvedProjectLabel}"`
        : '';

      if (data.action === 'existing_open') {
        alert(`Existing Redmine issue is still ${data.issue?.status?.name || 'open'}; no new ticket created${data.issue?.id ? `: #${data.issue.id}` : ''}.${routeLabel}`);
      } else if (data.action === 'existing_closed') {
        alert(`Existing Redmine issue is closed; updated the compacted body${data.issue?.id ? ` on #${data.issue.id}` : ''}.${routeLabel}`);
      } else {
        alert(`Redmine issue created${data.issue?.id ? `: #${data.issue.id}` : ''}.${routeLabel}`);
      }
    } catch (err) {
      console.error('Error creating Redmine issue:', err);
      if (err.openConfig) {
        setHashRoute('#settings');
      }
      alert(err.message || 'Failed to connect to backend server.');
    } finally {
      setOpeningRedmineId(null);
    }
  };

  useEffect(() => {
    if (user) {
      let active = true;
      queueMicrotask(() => {
        if (!active) return;
        fetchFindings();
        if (user.role === 'admin') {
          fetchConfig();
          fetchConfigBackups();
        }
        fetchDashboardData({ silent: true });
        fetchRedmineSyncStatus();
      });

      return () => {
        active = false;
      };
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) {
      dashboardSyncVersionRef.current = null;
      queueMicrotask(() => {
        setDashboardSync({ connected: false, reason: 'signed-out', updatedAt: null });
      });
      return undefined;
    }

    let stopped = false;
    let reconnectTimer;
    let abortController;

    const connect = async () => {
      abortController = new AbortController();
      setDashboardSync(prev => ({
        ...prev,
        connected: false,
        reason: prev.updatedAt ? 'reconnecting' : 'connecting',
      }));

      try {
        await openDashboardSyncStream({
          signal: abortController.signal,
          onEvent: ({ event, data }) => {
            if (stopped) return;

            if (event === 'heartbeat') {
              setDashboardSync(prev => ({ ...prev, connected: true }));
              fetchRedmineSyncStatus();
              return;
            }

            if (event !== 'dashboard-sync') return;

            dashboardSyncReconnectRef.current = 0;
            setDashboardSync({
              connected: true,
              reason: data.reason || 'updated',
              updatedAt: data.updatedAt || new Date().toISOString(),
            });

            const previousVersion = dashboardSyncVersionRef.current;
            dashboardSyncVersionRef.current = data.version;
            fetchRedmineSyncStatus();
            if (previousVersion !== null && data.version !== previousVersion) {
              fetchFindings({ silent: true });
              fetchDashboardData({ silent: true });
            }
          }
        });
      } catch (err) {
        if (stopped || err.name === 'AbortError') return;
        console.warn('Dashboard live sync disconnected:', err);
      }

      if (!stopped) {
        const reconnectMs = Math.min(30000, 1000 * 2 ** dashboardSyncReconnectRef.current);
        dashboardSyncReconnectRef.current += 1;
        setDashboardSync(prev => ({ ...prev, connected: false, reason: 'reconnecting' }));
        reconnectTimer = setTimeout(connect, reconnectMs);
      }
    };

    dashboardSyncReconnectRef.current = 0;
    connect();

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      abortController?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setConfig(createDefaultConfig());
      setRedmineSyncStatus(DEFAULT_REDMINE_SYNC_STATUS);
      setDashboardSync({ connected: false, reason: 'signed-out', updatedAt: null });
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  useEffect(() => {
    if ((currentHash === '#settings' || currentHash === '#mitigation-review') && user?.role !== 'admin') {
      setHashRoute('');
    }
  }, [currentHash, user]);

  useEffect(() => {
    if (!user) return;
    queueMicrotask(() => fetchDashboardData({ silent: true }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedProductId, selectedEngagementId, activeFilter]);

  const handleLogout = () => {
    apiFetch('/logout', { method: 'POST' }).catch(() => {});
    removeAuthToken();
    removeCurrentUser();
    setConfig(createDefaultConfig());
    setRedmineSyncStatus(DEFAULT_REDMINE_SYNC_STATUS);
    setUser(null);
  };

  const handleLoginSuccess = (loggedInUser) => {
    if (loggedInUser?.role !== 'admin') {
      setConfig(createDefaultConfig());
    }
    setUser(loggedInUser);
  };

  const availableProducts = dashboardSummary?.filters?.products || [];
  const availableEngagements = dashboardSummary?.filters?.engagements || [];
  const uniqueProducts = availableProducts.map(product => product.name).filter(Boolean);

  let filteredFindings = findings;
  
  if (activeFilter !== 'All') {
    filteredFindings = filteredFindings.filter(f => f.severity === activeFilter);
  }

  if (selectedProductId) {
    filteredFindings = filteredFindings.filter(f => {
      const route = getDefectDojoRoute(f);
      return routeValueMatches(
        selectedProductId,
        route.projectId,
        route.projectName,
        route.productKey,
        getEntityRouteKey('product', route.projectId, route.projectName)
      );
    });
  }

  if (selectedEngagementId) {
    filteredFindings = filteredFindings.filter(f => {
      const route = getDefectDojoRoute(f);
      return routeValueMatches(
        selectedEngagementId,
        route.engagementId,
        route.engagementName,
        route.engagementKey,
        getEntityRouteKey('engagement', route.engagementId, route.engagementName)
      );
    });
  }

  const getCompactedFindings = (findingsToCompact) => {
    const groups = new Map();
    findingsToCompact.forEach(f => {
      const defectDojoRoute = getDefectDojoRoute(f);
      const fingerprint = getCompactFingerprint(f, defectDojoRoute, config);
      const key = fingerprint.groupKey;
      const target = parseUpgradeTarget(f);
      const cves = fingerprint.cves;
      const mitigation = getMitigationText(f);
      const description = getDescriptionText(f);
      const impact = getImpactText(f);
      const rawDescription = f.description || '';
      const rawImpact = f.impact || '';
      const endpoints = Array.isArray(f.endpoints) && f.endpoints.length > 0
        ? f.endpoints
        : [{ id: 'N/A', host: 'Unknown host' }];

      if (!groups.has(key)) {
        groups.set(key, {
          ...f,
          compactSourceKey: key,
          compactGroupId: `compact-${key}`,
          originalIds: [],
          compactFamilyKeysSet: new Set(),
          compactFamilyTitlesSet: new Set(),
          compactReasonsSet: new Set(),
          legacySyncSourceMap: new Map(),
          softwareFamilies: new Set(),
          allEndpointsMap: new Map(),
          allCVEsSet: new Set(),
          allMitigationsSet: new Set(),
          allDescriptionsMap: new Map(),
          allImpactsMap: new Map(),
          allTitlesSet: new Set(),
          sourceGroupsMap: new Map(),
          defectDojoProjectIdsSet: new Set(),
          defectDojoProjectNamesSet: new Set(),
          defectDojoEngagementIdsSet: new Set(),
          defectDojoEngagementNamesSet: new Set(),
          endpointDetailMap: new Map(),
          highestUpgradeTarget: null,
          serverRedmineSync: null,
          findingStates: [],
          activeCount: 0,
          mitigatedCount: 0,
          count: 0,
        });
      }

      const group = groups.get(key);
      group.serverRedmineSync = chooseRedmineSync(group.serverRedmineSync, f.redmineSync);
      group.count += 1;
      group.originalIds.push(f.id);
      group.severity = highestSeverity(group.severity || 'Info', f.severity || 'Info');
      if (fingerprint.compactFamilyKey) group.compactFamilyKeysSet.add(fingerprint.compactFamilyKey);
      if (fingerprint.compactFamilyTitle) group.compactFamilyTitlesSet.add(fingerprint.compactFamilyTitle);
      if (fingerprint.compactReason) group.compactReasonsSet.add(fingerprint.compactReason);
      if (fingerprint.softwareFamily) group.softwareFamilies.add(fingerprint.softwareFamily);
      const legacyGroupKey = getLegacyFindingGroupKey(f, defectDojoRoute, config);
      if (!group.legacySyncSourceMap.has(legacyGroupKey)) group.legacySyncSourceMap.set(legacyGroupKey, new Set());
      group.legacySyncSourceMap.get(legacyGroupKey).add(f.id);
      const sourceTitle = cleanText(f.title || f.name || 'Untitled finding');
      group.allTitlesSet.add(sourceTitle);
      cves.forEach(cve => group.allCVEsSet.add(cve));
      if (mitigation) group.allMitigationsSet.add(mitigation);
      addTextSource(group.allDescriptionsMap, rawDescription || description, f.id);
      addTextSource(group.allImpactsMap, rawImpact || impact, f.id);
      if (!group.sourceGroupsMap.has(sourceTitle)) {
        group.sourceGroupsMap.set(sourceTitle, {
          title: sourceTitle,
          findingIds: [],
          severity: f.severity || 'Info',
          cveIds: new Set(),
          endpointDetailMap: new Map(),
          descriptionsMap: new Map(),
          impactsMap: new Map(),
          mitigations: new Set(),
          activeCount: 0,
          mitigatedCount: 0,
        });
      }
      const sourceGroup = group.sourceGroupsMap.get(sourceTitle);
      sourceGroup.findingIds.push(f.id);
      sourceGroup.severity = highestSeverity(sourceGroup.severity, f.severity || 'Info');
      cves.forEach(cve => sourceGroup.cveIds.add(cve));
      if (mitigation) sourceGroup.mitigations.add(mitigation);
      addTextSource(sourceGroup.descriptionsMap, rawDescription || description, f.id);
      addTextSource(sourceGroup.impactsMap, rawImpact || impact, f.id);
      if (defectDojoRoute.projectId) group.defectDojoProjectIdsSet.add(defectDojoRoute.projectId);
      if (defectDojoRoute.projectName) group.defectDojoProjectNamesSet.add(defectDojoRoute.projectName);
      if (defectDojoRoute.engagementId) group.defectDojoEngagementIdsSet.add(defectDojoRoute.engagementId);
      if (defectDojoRoute.engagementName) group.defectDojoEngagementNamesSet.add(defectDojoRoute.engagementName);

      if (target && (!group.highestUpgradeTarget || compareVersions(target.version, group.highestUpgradeTarget.version) > 0)) {
        group.highestUpgradeTarget = target;
      }

      endpoints.forEach(endpoint => {
        const keyForEndpoint = endpointKey(endpoint);
        group.allEndpointsMap.set(keyForEndpoint, endpoint);

        if (!group.endpointDetailMap.has(keyForEndpoint)) {
          group.endpointDetailMap.set(keyForEndpoint, {
            endpoint,
            label: endpointLabel(endpoint),
            host: endpointHost(endpoint),
            severity: f.severity || 'Info',
            cves: new Set(),
            mitigations: new Set(),
            findingIds: [],
          });
        }

        const detail = group.endpointDetailMap.get(keyForEndpoint);
        detail.severity = highestSeverity(detail.severity, f.severity || 'Info');
        detail.findingIds.push(f.id);
        cves.forEach(cve => detail.cves.add(cve));
        if (mitigation) detail.mitigations.add(mitigation);

        if (!sourceGroup.endpointDetailMap.has(keyForEndpoint)) {
          sourceGroup.endpointDetailMap.set(keyForEndpoint, {
            endpoint,
            label: endpointLabel(endpoint),
            host: endpointHost(endpoint),
            severity: f.severity || 'Info',
            cves: new Set(),
            mitigations: new Set(),
            findingIds: [],
          });
        }

        const sourceDetail = sourceGroup.endpointDetailMap.get(keyForEndpoint);
        sourceDetail.severity = highestSeverity(sourceDetail.severity, f.severity || 'Info');
        sourceDetail.findingIds.push(f.id);
        cves.forEach(cve => sourceDetail.cves.add(cve));
        if (mitigation) sourceDetail.mitigations.add(mitigation);
      });

      const mitigatedState = Boolean(f.mitigated || f.is_mitigated);
      if (mitigatedState) {
        group.mitigatedCount += 1;
        sourceGroup.mitigatedCount += 1;
      } else if (f.active !== false) {
        group.activeCount += 1;
        sourceGroup.activeCount += 1;
      }
      group.findingStates.push({
        findingId: f.id,
        title: cleanText(f.title || f.name || 'Untitled finding'),
        severity: f.severity || 'Info',
        mitigated: mitigatedState,
        active: f.active !== false && !mitigatedState,
        endpoint: endpoints.map(endpointLabel).join(', '),
        cveIds: cves,
        mitigationConfirmedAt: f.mitigation_confirmed_at || f.mitigation_confirmed || f.mitigated_at || null,
      });
    });

    return Array.from(groups.values()).map(group => {
      const allMitigations = sortStrings(group.allMitigationsSet);
      const allDescriptionSources = sortTextSources(group.allDescriptionsMap);
      const allImpactSources = sortTextSources(group.allImpactsMap);
      const allDescriptions = allDescriptionSources.map(source => source.text);
      const allImpacts = allImpactSources.map(source => source.text);
      const allTitles = sortStrings(group.allTitlesSet);
      const softwareFamily = sortStrings(group.softwareFamilies)[0] || '';
      const defectDojoProjectIds = sortStrings(group.defectDojoProjectIdsSet);
      const defectDojoProjectNames = sortStrings(group.defectDojoProjectNamesSet);
      const defectDojoEngagementIds = sortStrings(group.defectDojoEngagementIdsSet);
      const defectDojoEngagementNames = sortStrings(group.defectDojoEngagementNamesSet);
      const originalIds = sortFindingIds(group.originalIds);
      const pullProjectId = cleanText(config.pullFilters?.test__engagement__product || '');
      const pullEngagementId = cleanText(config.pullFilters?.test__engagement || '');

      if (defectDojoProjectIds.length === 0 && pullProjectId) defectDojoProjectIds.push(pullProjectId);
      if (defectDojoEngagementIds.length === 0 && pullEngagementId) defectDojoEngagementIds.push(pullEngagementId);
      const compactedSyncKey = buildCompactedSyncKey({
        groupKey: group.compactSourceKey || group.compactGroupId || '',
        productIds: defectDojoProjectIds,
        engagementIds: defectDojoEngagementIds,
      });
      const legacySyncKeys = Array.from(new Set([
        buildLegacyCompactedSyncKey({
          groupKey: group.compactSourceKey || group.compactGroupId || '',
          findingIds: originalIds,
          productIds: defectDojoProjectIds,
          engagementIds: defectDojoEngagementIds,
        }),
        ...Array.from(group.legacySyncSourceMap.entries()).map(([legacyGroupKey, legacyFindingIds]) => (
          buildLegacyCompactedSyncKey({
            groupKey: legacyGroupKey,
            findingIds: sortFindingIds(legacyFindingIds),
            productIds: defectDojoProjectIds,
            engagementIds: defectDojoEngagementIds,
          })
        )),
      ].filter(key => key && key !== compactedSyncKey)));
      const compactFamilyTitle = sortStrings(group.compactFamilyTitlesSet)[0] || '';
      const compactFamilyKey = sortStrings(group.compactFamilyKeysSet)[0] || group.compactSourceKey || '';
      const compactReason = sortStrings(group.compactReasonsSet)[0] || 'strict-fingerprint';

      const endpointDetails = finalizeEndpointDetails(group.endpointDetailMap);
      const sourceGroups = finalizeSourceGroups(group.sourceGroupsMap);
      const currentStatus = group.activeCount > 0 && group.mitigatedCount > 0
        ? 'mixed'
        : group.activeCount > 0
          ? 'active'
          : 'mitigated';

      const compactedTicket = {
        ...group,
        compactedSyncKey,
        compactGroupId: compactedSyncKey,
        compactFamilyKey,
        compactFamilyTitle,
        compactReason,
        legacySyncKeys,
        originalIds,
        findingCount: originalIds.length || group.count || 1,
        sourceFindingCount: originalIds.length || group.count || 1,
        title: chooseDisplayTitle(allTitles, compactFamilyTitle || getSoftwareFamilyTitle(softwareFamily, allTitles) || group.title),
        description: allDescriptions[0] || group.description,
        impact: allImpacts[0] || group.impact,
        allEndpoints: Array.from(group.allEndpointsMap.values()),
        allCVEs: sortStrings(group.allCVEsSet).map(vulnerability_id => ({ vulnerability_id })),
        allMitigations,
        allDescriptions,
        allImpacts,
        allDescriptionSources,
        allImpactSources,
        allTitles,
        sourceGroups,
        softwareFamily,
        defectDojoProjectId: defectDojoProjectIds[0] || '',
        defectDojoProjectName: defectDojoProjectNames[0] || '',
        defectDojoEngagementId: defectDojoEngagementIds[0] || '',
        defectDojoEngagementName: defectDojoEngagementNames[0] || '',
        allDefectDojoProjectIds: defectDojoProjectIds,
        allDefectDojoProjectNames: defectDojoProjectNames,
        allDefectDojoEngagementIds: defectDojoEngagementIds,
        allDefectDojoEngagementNames: defectDojoEngagementNames,
        endpointDetails,
        currentStatus,
      };
      compactedTicket.redmineSubject = buildActionRequiredSubject(compactedTicket);
      compactedTicket.subject = compactedTicket.redmineSubject;

      delete compactedTicket.allEndpointsMap;
      delete compactedTicket.softwareFamilies;
      delete compactedTicket.allCVEsSet;
      delete compactedTicket.allMitigationsSet;
      delete compactedTicket.allDescriptionsMap;
      delete compactedTicket.allImpactsMap;
      delete compactedTicket.allTitlesSet;
      delete compactedTicket.compactFamilyKeysSet;
      delete compactedTicket.compactFamilyTitlesSet;
      delete compactedTicket.compactReasonsSet;
      delete compactedTicket.legacySyncSourceMap;
      delete compactedTicket.sourceGroupsMap;
      delete compactedTicket.defectDojoProjectIdsSet;
      delete compactedTicket.defectDojoProjectNamesSet;
      delete compactedTicket.defectDojoEngagementIdsSet;
      delete compactedTicket.defectDojoEngagementNamesSet;
      delete compactedTicket.endpointDetailMap;
      delete compactedTicket.compactSourceKey;

      return {
        ...compactedTicket,
        superTicketMarkdown: buildSuperTicketMarkdown(compactedTicket),
      };
    });
  };

  const getFindingRedmineSync = (finding) => {
    const candidateKeys = [
      getTicketActionId(finding),
      ...(Array.isArray(finding.legacySyncKeys) ? finding.legacySyncKeys : []),
    ].filter(Boolean);
    const localSync = candidateKeys.map(key => redmineSyncByTicket[key]).find(Boolean);
    return chooseDashboardRedmineSync(localSync, finding.serverRedmineSync);
  };

  const getFindingIdentity = (finding, fallback = '') => {
    const identityParts = [
      finding?.title,
      finding?.defectDojoProjectId,
      finding?.defectDojoEngagementId,
      finding?.date,
    ].map(value => cleanText(value)).filter(Boolean);

    return getTicketActionId(finding) || identityParts.join('|') || String(fallback);
  };

  const isSelectedFinding = (finding, idx) => (
    selectedFinding
    && getFindingIdentity(selectedFinding) === getFindingIdentity(finding, idx)
  );

  const formatCountLabel = (count, singular, plural = `${singular}s`) => {
    const normalizedCount = Number.parseInt(count, 10);
    const safeCount = Number.isFinite(normalizedCount) ? normalizedCount : 0;
    return `${safeCount} ${safeCount === 1 ? singular : plural}`;
  };

  const formatRouteSummary = (finding) => {
    const parts = [];
    if (finding.defectDojoProjectName || finding.defectDojoProjectId) {
      parts.push(formatRouteValue(finding.defectDojoProjectName, finding.defectDojoProjectId));
    }
    if (finding.defectDojoEngagementName || finding.defectDojoEngagementId) {
      parts.push(formatRouteValue(finding.defectDojoEngagementName, finding.defectDojoEngagementId));
    }
    return parts.join(' / ') || 'No route';
  };

  const getFindingCveCount = (finding) => finding.allCVEs?.length || 0;

  const renderFindingRow = (finding, idx) => {
    const findingRedmineSync = getFindingRedmineSync(finding);
    const endpointCount = finding.allEndpoints?.length || 0;
    const cveCount = getFindingCveCount(finding);
    const sourceFindingCount = getCompactedFindingCount(finding);
    const selected = isSelectedFinding(finding, idx);

    return (
    <article
      key={getFindingIdentity(finding, idx)}
      className={`finding-row ${selected ? 'selected' : ''}`}
      onClick={() => setSelectedFinding(finding)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setSelectedFinding(finding);
        }
      }}
      role="button"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`View details for ${finding.title || 'finding'}`}
    >
      <div className="finding-row-main">
        <span className={`severity-badge badge-${(finding.severity || 'Info').toLowerCase()}`}>
          {finding.severity || 'Info'}
        </span>
        <div className="finding-row-content">
          <h3>{finding.title}</h3>
          <p>{formatRouteSummary(finding)}</p>
        </div>
      </div>
      <div className="finding-row-meta" aria-label="Finding summary">
        <span>{formatCountLabel(sourceFindingCount, 'finding')}</span>
        <span>{formatCountLabel(endpointCount, 'endpoint')}</span>
        <span>{formatCountLabel(cveCount, 'CVE')}</span>
        <span>{finding.date || 'No date'}</span>
        {findingRedmineSync && (
          <span className={getRedmineSyncBadgeClass(findingRedmineSync)}>
            {getRedmineSyncLabel(findingRedmineSync)}
          </span>
        )}
      </div>
      {user?.role === 'admin' && (
        <div className="finding-actions">
          <button
            type="button"
            className="icon-btn redmine-action"
            onClick={(e) => {
              e.stopPropagation();
              openRedmineIssue(finding);
            }}
            disabled={bulkOpeningRedmine || openingRedmineId === getTicketActionId(finding)}
            title="Open issue in Redmine"
            aria-label={`Open Redmine issue for ${finding.title || 'finding'}`}
          >
            <ExternalLink size={18} />
          </button>
        </div>
      )}
    </article>
    );
  };

  const renderDetailTextList = (items, fallback) => {
    const textItems = (items || []).map(cleanText).filter(Boolean);
    if (textItems.length === 0 && fallback) textItems.push(cleanText(fallback));

    if (textItems.length === 0) {
      return <p className="detail-empty-text">No information provided.</p>;
    }

    return (
      <div className="compact-text-list">
        {textItems.map((item, i) => (
          <p key={`${item}-${i}`}>{item}</p>
        ))}
      </div>
    );
  };

  const renderFindingDetailModal = () => {
    if (!selectedFinding) return null;

    const findingRedmineSync = getFindingRedmineSync(selectedFinding);
    const endpoints = selectedFinding.allEndpoints || [];
    const cves = selectedFinding.allCVEs || [];
    const mitigations = selectedFinding.allMitigations || [];
    const sourceFindingCount = getCompactedFindingCount(selectedFinding);

    return (
      <div className="modal-overlay" role="presentation" onClick={() => setSelectedFinding(null)}>
        <div className="modal-content finding-detail-modal" role="dialog" aria-modal="true" aria-labelledby="finding-detail-title" onClick={e => e.stopPropagation()}>
          <div className="finding-detail-header">
            <div>
              <span className={`severity-badge badge-${(selectedFinding.severity || 'Info').toLowerCase()}`}>
                {selectedFinding.severity || 'Info'}
              </span>
              <h2 id="finding-detail-title">{selectedFinding.title}</h2>
            </div>
            <button
              type="button"
              className="icon-btn detail-close-btn"
              onClick={() => setSelectedFinding(null)}
              aria-label="Close finding details"
              title="Close details"
            >
              <X size={18} />
            </button>
          </div>

          <div className="detail-status-row">
            <span className="count-badge">{formatCountLabel(sourceFindingCount, 'finding')}</span>
            {findingRedmineSync && (
              <span className={getRedmineSyncBadgeClass(findingRedmineSync)}>
                {getRedmineSyncLabel(findingRedmineSync)}
              </span>
            )}
            <span className="detail-date">{selectedFinding.date || 'No date'}</span>
          </div>

          <section className="detail-section">
            <h3>DefectDojo Route</h3>
            <div className="meta-value-list">
              {(selectedFinding.defectDojoProjectId || selectedFinding.defectDojoProjectName) && (
                <span className="endpoint-tag id">
                  Project: {formatRouteValue(selectedFinding.defectDojoProjectName, selectedFinding.defectDojoProjectId)}
                </span>
              )}
              {(selectedFinding.defectDojoEngagementId || selectedFinding.defectDojoEngagementName) && (
                <span className="endpoint-tag id">
                  Engagement: {formatRouteValue(selectedFinding.defectDojoEngagementName, selectedFinding.defectDojoEngagementId)}
                </span>
              )}
              {!(selectedFinding.defectDojoProjectId || selectedFinding.defectDojoProjectName || selectedFinding.defectDojoEngagementId || selectedFinding.defectDojoEngagementName) && (
                <p className="detail-empty-text">No route information available.</p>
              )}
            </div>
          </section>

          <section className="detail-section">
            <h3>Description</h3>
            {renderDetailTextList(selectedFinding.allDescriptions, selectedFinding.description)}
          </section>

          <section className="detail-section">
            <h3>Impact</h3>
            {renderDetailTextList(selectedFinding.allImpacts, selectedFinding.impact)}
          </section>

          <section className="detail-section">
            <h3>Endpoints</h3>
            <div className="meta-value-list">
              {endpoints.length > 0 ? endpoints.map((ep, i) => {
                const label = endpointLabel(ep);
                return (
                  <span key={`${label}-${i}`} className={`endpoint-tag ${label.startsWith('ID:') ? 'id' : ''}`}>
                    {label}
                    {ep?.is_fallback && <small className="tag-note">(desc)</small>}
                  </span>
                );
              }) : <p className="detail-empty-text">No endpoints found.</p>}
            </div>
          </section>

          {selectedFinding.endpointDetails?.length > 0 && (
            <section className="detail-section">
              <h3>Endpoint Details</h3>
              <div className="endpoint-details-list">
                {selectedFinding.endpointDetails.map((detail, i) => (
                  <div key={`${detail.label}-${i}`} className="endpoint-detail-row">
                    <div className="endpoint-detail-main">
                      <span className={`severity-badge detail-severity badge-${(detail.severity || 'Info').toLowerCase()}`}>
                        {detail.severity || 'Info'}
                      </span>
                      <span className="endpoint-detail-target">{detail.label}</span>
                    </div>
                    <span className="endpoint-detail-cves">
                      CVEs: {detail.cves.length > 0 ? detail.cves.join(', ') : 'None'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="detail-section">
            <h3>CVEs</h3>
            <div className="meta-value-list">
              {cves.length > 0 ? cves.map((v, i) => (
                <span key={i} className="cve-tag">{typeof v === 'string' ? v : v.vulnerability_id}</span>
              )) : <p className="detail-empty-text">No CVEs listed.</p>}
            </div>
          </section>

          <section className="detail-section">
            <h3>Mitigation</h3>
            {mitigations.length > 0 ? (
              <div className="mitigation-list">
                {mitigations.map((item, i) => (
                  <span key={i} className="mitigation-item">{item}</span>
                ))}
              </div>
            ) : (
              <p className="detail-empty-text">No mitigation provided.</p>
            )}
          </section>

          {selectedFinding.superTicketMarkdown && (
            <section className="detail-section">
              <h3>Super Ticket Markdown</h3>
              <div className="ticket-preview compact">
                <pre>{selectedFinding.superTicketMarkdown}</pre>
              </div>
            </section>
          )}

          <section className="detail-section">
            <h3>Raw JSON Preview</h3>
            <div className="json-container compact">
              <pre>{JSON.stringify(selectedFinding, null, 2)}</pre>
            </div>
          </section>

          <div className="detail-actions">
            {selectedFinding.superTicketMarkdown && user?.role === 'admin' && (
              <button
                className="btn-secondary"
                onClick={() => openRedmineIssue(selectedFinding)}
                disabled={bulkOpeningRedmine || openingRedmineId === getTicketActionId(selectedFinding)}
              >
                <ExternalLink size={18} />
                {bulkOpeningRedmine || openingRedmineId === getTicketActionId(selectedFinding) ? 'Opening...' : 'Open in Redmine'}
              </button>
            )}
            <button className="btn-primary" onClick={() => setSelectedFinding(null)}>Done</button>
          </div>
        </div>
      </div>
    );
  };

  const fallbackCompactedFindings = getCompactedFindings(filteredFindings);
  const displayFindings = compactedCveFindings ?? fallbackCompactedFindings;
  const compactedFindingsForStats = compactedCveFindings ?? getCompactedFindings(findings);

  const openSyncAllFilters = () => {
    if (user?.role !== 'admin') {
      alert('Only admins can create or check Redmine issues.');
      return;
    }

    if (bulkOpeningRedmine) {
      return;
    }

    setSyncAllPullFilters(createPullFiltersDraft(config.pullFilters));
    setShowSyncAllFilters(true);
  };

  const updateSyncAllPullFilter = (field, value) => {
    setSyncAllPullFilters(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const toggleSyncAllSeverity = (severity) => {
    setSyncAllPullFilters(prev => {
      const current = prev.severity || [];
      const updated = current.includes(severity)
        ? current.filter(item => item !== severity)
        : [...current, severity];

      return { ...prev, severity: updated };
    });
  };

  const openAllRedmineIssues = async (pullFilters) => {
    if (user?.role !== 'admin') {
      alert('Only admins can create or check Redmine issues.');
      return;
    }

    if (bulkOpeningRedmine) {
      return;
    }

    const filtersForSync = createPullFiltersDraft(pullFilters);

    setSyncAllProgress({
      phase: 'Starting',
      current: 0,
      total: 0,
      message: 'Starting Sync All',
      lines: ['Starting Sync All'],
    });
    setBulkOpeningRedmine(true);
    try {
      setSyncProgress({
        phase: 'Syncing',
        message: 'Pulling DefectDojo data, syncing Redmine, and rechecking mitigations',
      });

      const normalizedConfig = normalizeConfig(config);
      const checkRes = await runWithTimeout(
        (signal) => apiFetch('/sync-all', {
          method: 'POST',
          body: JSON.stringify({
            url: normalizedConfig.defectDojoUrl,
            apiKey: normalizedConfig.defectDojoApiKey,
            filters: filtersForSync,
            redmine: {
              url: normalizedConfig.redmineUrl,
              apiKey: normalizedConfig.redmineApiKey,
              projectId: normalizedConfig.redmineProjectId,
              trackerId: normalizedConfig.redmineTrackerId,
            },
          }),
          signal,
        }),
        SYNC_ALL_REDMINE_REQUEST_TIMEOUT_MS,
        `Timed out during Sync All after ${formatTimeoutSeconds(SYNC_ALL_REDMINE_REQUEST_TIMEOUT_MS)} seconds`
      );
      const data = await checkRes.json();

      if (!checkRes.ok) {
        alert(`Error during Sync All: ${data.error || 'Failed'}\n${JSON.stringify(data.details || '')}`);
        return;
      }

      setSyncProgress({
        phase: 'Complete',
        current: data.redmine?.checked || 0,
        total: data.redmine?.checked || 0,
        message: 'Sync All finished',
      });
      await Promise.all([fetchFindings({ silent: true }), fetchDashboardData({ silent: true }), fetchRedmineSyncStatus()]);
      alert(
        'Sync All finished.\n\n'
        + `Findings pulled: ${data.pull?.count || 0}\n`
        + `Tickets checked: ${data.redmine?.checked || 0}\n`
        + `Tickets updated: ${data.redmine?.changed || 0}\n`
        + `Ticket priorities updated: ${data.redmine?.priorityUpdated || 0}\n`
        + `Tickets created/updated: ${data.redmine?.createdOrUpdated || 0}\n`
        + `Attempted Feedback changes: ${data.mitigationRecheck?.attemptedFeedback || 0}\n`
        + `Reopened from Resolve: ${data.mitigationRecheck?.reopened || 0}\n`
        + `Queued for review: ${data.mitigationRecheck?.reviewQueued || 0}\n`
        + `Skipped without linked findings: ${data.mitigationRecheck?.skippedNoLinkedFindings || 0}\n`
        + `Skipped without active linked findings: ${data.mitigationRecheck?.skippedNoActiveLinkedFindings || 0}`
        + `${data.mitigationRecheck?.warnings?.length ? `\n\nWarnings:\n${data.mitigationRecheck.warnings.slice(0, 5).join('\n')}` : ''}`
      );
    } catch (err) {
      console.error('Error during Sync All:', err);
      setSyncProgress({
        phase: 'Failed',
        message: err.message || 'Sync All failed unexpectedly.',
      });
      alert(err.message || 'Sync All failed unexpectedly.');
    } finally {
      setOpeningRedmineId(null);
      setBulkOpeningRedmine(false);
      setSyncAllProgress(null);
    }
  };

  const submitSyncAllFilters = async (event) => {
    event.preventDefault();
    const filtersForSync = createPullFiltersDraft(syncAllPullFilters);
    setShowSyncAllFilters(false);
    await openAllRedmineIssues(filtersForSync);
  };

  const dashboardSyncLabel = dashboardSync.connected
    ? 'Live sync'
    : dashboardSync.reason === 'connecting'
      ? 'Connecting'
      : 'Reconnecting';
  const dashboardSyncTitle = dashboardSync.updatedAt
    ? `Last server update: ${new Date(dashboardSync.updatedAt).toLocaleString()}`
    : 'Waiting for server sync';
  const redmineSyncLabel = redmineSyncStatus.running
    ? 'Redmine syncing'
    : redmineSyncStatus.enabled
      ? `Redmine ${redmineSyncStatus.intervalSeconds}s`
      : redmineSyncStatus.configured
        ? 'Redmine sync off'
        : 'Redmine not configured';
  const redmineSyncTitle = [
    redmineSyncStatus.enabled ? `Interval: ${redmineSyncStatus.intervalSeconds} seconds` : 'Background Redmine sync is disabled',
    `Last run: ${formatSyncTimestamp(redmineSyncStatus.lastFinishedAt)}`,
    `Next run: ${formatSyncTimestamp(redmineSyncStatus.nextRunAt)}`,
    `Checked: ${redmineSyncStatus.checkedCount || 0}`,
    `Changed: ${redmineSyncStatus.changedCount || 0}`,
    `Redmine API calls: ${(redmineSyncStatus.redmineMetadataRequests || 0) + (redmineSyncStatus.redmineIssueRequests || 0) + (redmineSyncStatus.redmineProjectIssueRequests || 0)}`,
    `Redmine issue checks: ${redmineSyncStatus.redmineIssueRequests || 0}`,
    `Redmine project issue lists: ${redmineSyncStatus.redmineProjectIssueRequests || 0}`,
    `Not found: ${redmineSyncStatus.redmineNotFoundCount || 0}`,
    `Errors: ${redmineSyncStatus.redmineErrorCount || 0}`,
    redmineSyncStatus.lastError ? `Last error: ${redmineSyncStatus.lastError}` : '',
  ].filter(Boolean).join('\n');

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (currentHash === '#settings') {
    if (user?.role !== 'admin') {
      return null;
    }
    return (
      <div className="app-shell">
        <header className="top-bar">
          <div className="top-bar-title">
            <Settings size={22} />
            <span>Configuration & Settings</span>
          </div>
          <div className="top-bar-actions">
            <button className="btn-secondary" onClick={() => { setHashRoute(''); }}>
              Back to Dashboard
            </button>
            <button className="icon-btn" onClick={handleLogout} title="Logout" aria-label="Logout">
              <LogOut size={20} />
            </button>
          </div>
        </header>
        <main className="main-content settings-main">
          <SettingsView 
            config={config} 
            onSaveConfig={async (newConfig) => {
              return updateConfig(newConfig);
            }}
            onClearData={async () => {
              if (confirm('Clear all local findings, Redmine ticket state, sync history, mitigation reviews, and dashboard data? Users and settings will be kept.')) {
                await apiFetch('/clear', { method: 'POST' });
                setSelectedFinding(null);
                setSelectedProductId('');
                setSelectedEngagementId('');
                setRedmineSyncByTicket({});
                setCompactedCveFindings([]);
                setDashboardSummary(null);
                await Promise.all([
                  fetchFindings({ silent: true }),
                  fetchDashboardData({ silent: true }),
                  fetchRedmineSyncStatus(),
                ]);
              }
            }}
            configBackups={configBackups}
            selectedConfigBackup={selectedConfigBackup}
            setSelectedConfigBackup={setSelectedConfigBackup}
            onBackupConfig={backupConfig}
            onExportConfig={exportConfig}
            onImportConfig={importConfigFile}
            onDownloadConfigBackup={downloadConfigBackup}
            onRestoreConfigBackup={restoreConfigBackup}
            user={user}
          />
        </main>
      </div>
    );
  }

  if (currentHash === '#sync-history') {
    if (user?.role !== 'admin') return null;
    return (
      <div className="app-shell">
        <header className="top-bar">
          <div className="top-bar-title">
            <History size={22} />
            <span>Sync History</span>
          </div>
          <div className="top-bar-actions">
            <button className="icon-btn" onClick={handleLogout} title="Logout" aria-label="Logout">
              <LogOut size={20} />
            </button>
          </div>
        </header>
        <main className="main-content">
          <SyncHistory onBack={() => setHashRoute('')} />
        </main>
      </div>
    );
  }

  if (currentHash === '#mitigation-review') {
    if (user?.role !== 'admin') return null;
    return (
      <div className="app-shell">
        <header className="top-bar">
          <div className="top-bar-title">
            <ShieldCheck size={22} />
            <span>Mitigation Review</span>
          </div>
          <div className="top-bar-actions">
            <button className="icon-btn" onClick={handleLogout} title="Logout" aria-label="Logout">
              <LogOut size={20} />
            </button>
          </div>
        </header>
        <main className="main-content">
          <MitigationReview onBack={() => setHashRoute('')} config={config} />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-title">
          <AlertTriangle size={22} />
          <span className="app-title">Security Dashboard</span>
          <span className="user-pill">
            User: {user.username} {user.role === 'admin' ? '(Admin)' : ''}
          </span>
          <span
            className={`dashboard-sync-pill ${dashboardSync.connected ? 'connected' : 'reconnecting'}`}
            title={dashboardSyncTitle}
          >
            <Database size={14} />
            {dashboardSyncLabel}
          </span>
          <span
            className={`redmine-sync-pill ${redmineSyncStatus.lastError ? 'error' : redmineSyncStatus.enabled ? 'enabled' : 'disabled'}`}
            title={redmineSyncTitle}
          >
            <RefreshCw size={14} className={redmineSyncStatus.running ? 'spin' : ''} />
            {redmineSyncLabel}
          </span>
        </div>
        <div className="top-bar-actions">
          {user?.role === 'admin' && (
            <button className="icon-btn" onClick={() => { setHashRoute('#sync-history'); }} title="Sync history" aria-label="Open sync history">
              <History size={20} />
            </button>
          )}
          {user?.role === 'admin' && (
            <button className="icon-btn" onClick={() => { setHashRoute('#mitigation-review'); }} title="Mitigation review" aria-label="Open mitigation review">
              <ShieldCheck size={20} />
            </button>
          )}
          {user?.role === 'admin' && (
            <button className="icon-btn" onClick={() => { setHashRoute('#settings'); }} title="Settings" aria-label="Open settings">
              <Settings size={20} />
            </button>
          )}
          <button className="icon-btn" onClick={() => { fetchFindings(); fetchDashboardData({ silent: true }); }} title="Refresh Findings" aria-label="Refresh findings" disabled={loading || dashboardLoading}>
            <RefreshCw size={20} className={loading ? "spin" : ""} />
          </button>
          <button className="icon-btn" onClick={handleLogout} title="Logout" aria-label="Logout">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-header" aria-labelledby="dashboard-title">
          <div>
            <p className="eyebrow">DefectDojo Viewer</p>
            <h1 id="dashboard-title">Security findings</h1>
          </div>
          <div className="dashboard-header-meta">
            <span>{displayFindings.length} shown</span>
            <span>{uniqueProducts.length} product{uniqueProducts.length !== 1 ? 's' : ''}</span>
          </div>
        </section>

        <SummaryCards summary={dashboardSummary} loading={dashboardLoading} />

        <section className="filters-bar" aria-label="Finding filters">
          <div className="filters-left">
            <span className="filter-label">
              <Filter size={16} />
              Filters
            </span>
            <div className="filter-chip-group" role="group" aria-label="Filter findings by severity">
              {['All', 'Critical', 'High', 'Medium', 'Low', 'Info'].map(sev => (
                <button
                  key={sev}
                  type="button"
                  className={`filter-btn ${sev.toLowerCase()} ${activeFilter === sev ? 'active' : ''}`}
                  onClick={() => setActiveFilter(sev)}
                  aria-pressed={activeFilter === sev}
                >
                  {sev}
                </button>
              ))}
            </div>
            {uniqueProducts.length > 0 && (
              <label className="product-filter">
                <span className="sr-only">Filter by product</span>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    setSelectedEngagementId('');
                  }}
                >
                  <option value="">All Products ({availableProducts.length})</option>
                  {availableProducts.map(product => (
                    <option key={product.id || product.key || product.name} value={product.id || product.key || product.name}>{product.name}</option>
                  ))}
                </select>
              </label>
            )}
            {availableEngagements.length > 0 && (
              <label className="product-filter">
                <span className="sr-only">Filter by engagement</span>
                <select
                  value={selectedEngagementId}
                  onChange={(e) => setSelectedEngagementId(e.target.value)}
                >
                  <option value="">All Engagements ({availableEngagements.length})</option>
                  {availableEngagements.map(engagement => (
                    <option key={engagement.id || engagement.key || engagement.name} value={engagement.id || engagement.key || engagement.name}>{engagement.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {user?.role === 'admin' && (
            <button
              type="button"
              className="btn-secondary sync-all-btn"
              onClick={openSyncAllFilters}
              disabled={bulkOpeningRedmine}
              title="Choose DefectDojo pull filters, then sync every compacted ticket in Redmine"
            >
              <RefreshCw size={14} className={bulkOpeningRedmine ? 'spin' : ''} />
              {bulkOpeningRedmine ? 'Syncing...' : `Sync All (${compactedFindingsForStats.length})`}
            </button>
          )}
        </section>

        <section className="findings-workspace" aria-label="Finding review workspace">
          <div className="findings-list-panel">
            <div className="findings-list-header">
              <div>
                <h2>Findings</h2>
                <p>{displayFindings.length} compacted row{displayFindings.length !== 1 ? 's' : ''}</p>
              </div>
            </div>

            <div className="findings-list" role="listbox" aria-label="Filtered findings">
              {displayFindings.length > 0 ? (
                !selectedProductId && uniqueProducts.length > 1 ? (
                  uniqueProducts.map(productName => {
                    const productFindings = displayFindings.filter(f => getDefectDojoRoute(f).projectName === productName);
                    if (productFindings.length === 0) return null;

                    return (
                      <div key={productName} className="product-group">
                        <div className="product-group-header">
                          <h2>{productName}</h2>
                          <span className="product-group-count">
                            {productFindings.length} finding{productFindings.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {productFindings.map((finding, idx) => renderFindingRow(finding, idx))}
                      </div>
                    );
                  })
                ) : (
                  displayFindings.map((finding, idx) => renderFindingRow(finding, idx))
                )
              ) : (
                <div className="empty-state" role="status">
                  <Info size={48} className="empty-state-icon" />
                  <h2>No matching findings</h2>
                  <p>No findings found for the selected filter.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {renderFindingDetailModal()}

      {syncAllProgress && (
        <div className="modal-overlay sync-progress-overlay">
          <div className="modal-content log-modal sync-progress-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-heading-with-icon">
                <RefreshCw size={20} className={bulkOpeningRedmine ? 'spin' : ''} />
                Sync All Progress
              </h2>
            </div>
            <div className="sync-progress-summary">
              <span>{syncAllProgress.phase}</span>
              <strong>
                {syncAllProgress.total > 0
                  ? `${syncAllProgress.current}/${syncAllProgress.total}`
                  : syncAllProgress.message}
              </strong>
            </div>
            {syncAllProgress.total > 0 && (
              <div className="sync-progress-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.round((syncAllProgress.current / syncAllProgress.total) * 100))}%` }} />
              </div>
            )}
            <div className="terminal-window sync-progress-log">
              {(syncAllProgress.lines || []).map((line, index) => (
                <div key={`${line}-${index}`} className="log-line">
                  <span className="log-time">[{index + 1}]</span>
                  <span className="log-level-info">{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSyncAllFilters && (
        <div className="modal-overlay" onClick={() => !bulkOpeningRedmine && setShowSyncAllFilters(false)}>
          <form className="modal-content config-modal" onClick={e => e.stopPropagation()} onSubmit={submitSyncAllFilters}>
            <div className="modal-header">
              <h2 className="modal-heading-with-icon">
                <Filter size={20} />
                Sync All Pull Filters
              </h2>
            </div>

            <div className="sync-filter-grid">
              <div className="form-group sync-filter-severity">
                <label>Severity</label>
                <div className="severity-picker">
                  <button
                    type="button"
                    className={`severity-choice severity-clear ${syncAllPullFilters.severity.length === 0 ? 'selected' : ''}`}
                    onClick={() => updateSyncAllPullFilter('severity', [])}
                    disabled={bulkOpeningRedmine}
                  >
                    All
                  </button>
                  {PULL_SEVERITY_OPTIONS.map(severity => (
                    <label
                      key={severity}
                      className={`severity-choice ${syncAllPullFilters.severity.includes(severity) ? 'selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={syncAllPullFilters.severity.includes(severity)}
                        onChange={() => toggleSyncAllSeverity(severity)}
                        disabled={bulkOpeningRedmine}
                      />
                      <span className={`severity-dot ${severity.toLowerCase()}`} />
                      {severity}
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Product IDs</label>
                <input
                  type="text"
                  value={syncAllPullFilters.test__engagement__product}
                  onChange={(e) => updateSyncAllPullFilter('test__engagement__product', e.target.value)}
                  placeholder="e.g. 5, 12, 23 (empty for all)"
                  disabled={bulkOpeningRedmine}
                />
              </div>

              <div className="form-group">
                <label>Engagement ID</label>
                <input
                  type="text"
                  value={syncAllPullFilters.test__engagement}
                  onChange={(e) => updateSyncAllPullFilter('test__engagement', e.target.value)}
                  placeholder="empty for all"
                  disabled={bulkOpeningRedmine}
                />
              </div>

              <div className="form-group">
                <label>Active</label>
                <select
                  value={syncAllPullFilters.active}
                  onChange={(e) => updateSyncAllPullFilter('active', e.target.value)}
                  disabled={bulkOpeningRedmine}
                >
                  <option value="">Any</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>

              <div className="form-group">
                <label>Verified</label>
                <select
                  value={syncAllPullFilters.verified}
                  onChange={(e) => updateSyncAllPullFilter('verified', e.target.value)}
                  disabled={bulkOpeningRedmine}
                >
                  <option value="">Any</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>

              <div className="form-group">
                <label>Mitigated</label>
                <select
                  value={syncAllPullFilters.is_mitigated}
                  onChange={(e) => updateSyncAllPullFilter('is_mitigated', e.target.value)}
                  disabled={bulkOpeningRedmine}
                >
                  <option value="">Any</option>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowSyncAllFilters(false)}
                disabled={bulkOpeningRedmine}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={bulkOpeningRedmine}>
                <RefreshCw size={16} className={bulkOpeningRedmine ? 'spin' : ''} />
                {bulkOpeningRedmine ? 'Syncing...' : 'Pull & Sync'}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}

export default App;
