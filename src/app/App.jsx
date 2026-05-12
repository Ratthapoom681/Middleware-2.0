import { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  RefreshCw, 
  AlertTriangle, 
  Info,
  Filter,
  Database,
  Terminal,
  ExternalLink,
  LogOut,
  X
} from 'lucide-react';
import { AUTH_EXPIRED_EVENT, apiFetch, getCurrentUser, openDashboardSyncStream, removeAuthToken, removeCurrentUser } from '../services/api';
import Login from '../features/auth/Login';
import SettingsView from '../features/settings/Settings';

const PULL_SEVERITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low', 'Info'];
const DEFAULT_REDMINE_STATUS_POLL_SECONDS = 60;
const SYNC_ALL_REDMINE_CONCURRENCY = 5;
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
  active: 'true',
  verified: '',
  is_mitigated: 'false',
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

const runWithClientConcurrency = async (items, concurrency, mapper) => {
  const list = Array.from(items || []);
  if (list.length === 0) return [];

  const workerCount = Math.max(1, Math.min(Number.parseInt(concurrency, 10) || 1, list.length));
  const results = new Array(list.length);
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(list[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

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

const isTicketCreatedOrInProgress = (sync) => {
  if (!sync) return false;
  const status = normalizeRedmineStatus(sync.status);
  const isClosedStatus = sync.isClosed || ['closed', 'resolved', 'done', 'rejected'].includes(status);
  if (isClosedStatus || sync.action === 'existing_closed' || sync.action === 'not_found' || sync.action === 'check_failed') {
    return false;
  }

  if (sync.action === 'created') return !status || status === 'new' || status === 'in progress' || status === 'open';
  return sync.action === 'existing_open' && (!status || status === 'new' || status === 'in progress' || status === 'open');
};

const isTicketClosedInRedmine = (sync) => {
  if (!sync) return false;
  const status = normalizeRedmineStatus(sync.status);
  return Boolean(sync.isClosed)
    || sync.action === 'existing_closed'
    || sync.action === 'closed_with_new_findings'
    || ['closed', 'resolved', 'done', 'rejected'].includes(status);
};

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
  const field = REDMINE_PRIORITY_FIELD_BY_SEVERITY[severity];
  if (field && config[field]) return cleanText(config[field]);

  return severity ? '' : cleanText(config.redminePriorityId);
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
  };
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

const getCompactGroupKey = (finding) => {
  const target = parseUpgradeTarget(finding);
  const mitigationText = getMitigationText(finding);

  if (target) {
    const mitigationFamily = normalizeForGrouping(mitigationText || target.title);
    return `upgrade|${target.software.toLowerCase()}|${mitigationFamily}`;
  }

  return `finding|${normalizeForGrouping(finding.title || finding.name)}|${normalizeForGrouping(mitigationText)}`;
};

const collectVulnerabilityIds = (finding) => {
  const ids = new Set();

  const pushId = (value) => {
    const cleaned = cleanText(value);
    if (cleaned && cleaned.toLowerCase() !== 'none' && cleaned.toLowerCase() !== 'n/a') {
      ids.add(cleaned);
    }
  };

  if (Array.isArray(finding.vulnerability_ids)) {
    finding.vulnerability_ids.forEach(v => {
      if (typeof v === 'string') {
        pushId(v);
      } else if (v && typeof v === 'object') {
        pushId(v.vulnerability_id || v.name || v.id);
      }
    });
  }

  if (Array.isArray(finding.cves)) finding.cves.forEach(pushId);
  pushId(finding.cve || finding.CVE);

  return Array.from(ids).sort();
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

const sortStrings = (values) => Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const sortFindingIds = (ids = []) => (
  sortStrings(new Set(ids.map(id => cleanText(id)).filter(Boolean)))
    .map(id => (/^\d+$/.test(id) ? Number.parseInt(id, 10) : id))
);

const addTextSource = (sourceMap, text, findingId) => {
  const cleanedText = cleanBlockText(text);
  if (!cleanedText) return;

  if (!sourceMap.has(cleanedText)) {
    sourceMap.set(cleanedText, {
      text: cleanedText,
      findingIds: new Set(),
    });
  }

  const cleanedFindingId = cleanText(findingId);
  if (cleanedFindingId) sourceMap.get(cleanedText).findingIds.add(cleanedFindingId);
};

const sortTextSources = (sourceMap) => (
  Array.from(sourceMap.values())
    .map(source => ({
      text: source.text,
      findingIds: sortFindingIds(Array.from(source.findingIds)),
    }))
    .sort((a, b) => cleanText(a.text).localeCompare(cleanText(b.text), undefined, { numeric: true }))
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
  findingIds = [],
  productIds = [],
  engagementIds = [],
}) => {
  const source = [
    `group:${groupKey}`,
    `findings:${sortStrings(findingIds.map(id => cleanText(id)).filter(Boolean)).join(',')}`,
    `products:${sortStrings(productIds.map(id => cleanText(id)).filter(Boolean)).join(',')}`,
    `engagements:${sortStrings(engagementIds.map(id => cleanText(id)).filter(Boolean)).join(',')}`,
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

const compactMitigations = (values) => {
  const upgradeMitigations = new Map();
  const otherMitigations = new Set();

  sortStrings(values).forEach(value => {
    const mitigation = cleanText(value);
    if (!mitigation) return;

    const upgradeTarget = parseUpgradeText(mitigation);
    if (!upgradeTarget) {
      otherMitigations.add(mitigation);
      return;
    }

    const key = upgradeTarget.software.toLowerCase();
    const existing = upgradeMitigations.get(key);
    if (!existing || compareVersions(upgradeTarget.version, existing.version) > 0) {
      upgradeMitigations.set(key, upgradeTarget);
    }
  });

  return [
    ...Array.from(upgradeMitigations.values())
      .sort((a, b) => a.software.localeCompare(b.software, undefined, { numeric: true }))
      .map(item => item.title),
    ...sortStrings(otherMitigations),
  ];
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

const formatTextSourceLabel = (source, index) => {
  const findingIds = source.findingIds || [];
  const idLabel = findingIds.length === 0
    ? ''
    : ` (DefectDojo Finding ID${findingIds.length === 1 ? '' : 's'}: ${findingIds.join(', ')})`;

  return `Source ${index + 1}${idLabel}`;
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

const buildSuperTicketMarkdown = (ticket) => {
  const endpointsByHost = new Map();

  ticket.endpointDetails.forEach(detail => {
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

      return `Host: ${host}\n${endpointLines}`;
    })
    .join('\n\n');

  const mitigationBlock = ticket.allMitigations.length > 0
    ? `\n\n**${ticket.allMitigations.length === 1 ? 'Mitigation' : 'Mitigations'}:**\n${ticket.allMitigations.map(item => `- ${item}`).join('\n')}`
    : '';

  const descriptionBlock = formatTicketTextSection('Description', ticket.allDescriptionSources || ticket.allDescriptions || []);
  const impactBlock = formatTicketTextSection('Impact', ticket.allImpactSources || ticket.allImpacts || []);
  const defectDojoContextBlock = formatDefectDojoContext(ticket);

  return `**Vulnerability Overview:**\nThe targeted software is out of date and affected by one or more vulnerabilities. Please apply the mitigation to the endpoints listed below.${defectDojoContextBlock}${descriptionBlock}${impactBlock}${mitigationBlock}\n\n**Affected Assets & Details:**\n\n${hostBlocks}`;
};

function App() {
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [selectedProductFilter, setSelectedProductFilter] = useState('All');
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
  
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef(null);
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

  const fetchLogs = async () => {
    try {
      const res = await apiFetch('/logs');
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      console.error('Error fetching logs:', err);
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

  const pullFromApi = async (options = {}) => {
    const pullOptions = options && typeof options === 'object' && !options.nativeEvent ? options : {};
    const {
      showSuccessAlert = true,
      showFailureAlert = true,
      refreshFindingsAfterPull = true,
      filters = config.pullFilters,
    } = pullOptions;

    if (!config.defectDojoUrl || !config.defectDojoApiKey) {
      if (showFailureAlert) alert('Please configure DefectDojo URL and API Key first.');
      setHashRoute('#settings');
      return null;
    }

    try {
      await apiFetch('/logs', { method: 'DELETE' });
      setLogs([]);
    } catch (err) {
      console.warn('Unable to clear backend logs before pull:', err);
    }

    setPulling(true);
    try {
      const res = await apiFetch('/pull', {
        method: 'POST',
        body: JSON.stringify({
          url: config.defectDojoUrl,
          apiKey: config.defectDojoApiKey,
          filters
        })
      });
      const data = await res.json();
      if (res.ok) {
        const refreshedFindings = refreshFindingsAfterPull
          ? await loadFindingsFromApi()
          : [];

        if (refreshFindingsAfterPull) {
          setFindings(refreshedFindings);
        }

        if (showSuccessAlert) {
          alert(`Successfully pulled ${data.count} findings!`);
        }

        return { data, findings: refreshedFindings };
      } else {
        if (showFailureAlert) {
          alert(`Error: ${data.error || 'Failed to pull'}\n${JSON.stringify(data.details || '')}`);
        }
        return null;
      }
    } catch (err) {
      console.error('Error pulling from API:', err);
      if (showFailureAlert) alert('Failed to connect to backend server.');
      return null;
    } finally {
      setPulling(false);
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

  const getStoredRedmineSync = (finding) => (
    chooseDashboardRedmineSync(redmineSyncByTicket[getTicketActionId(finding)], finding.serverRedmineSync)
  );

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

  const applyRedmineTicketStatuses = (ticketStatuses = []) => {
    setRedmineSyncByTicket(prev => {
      const next = { ...prev };
      ticketStatuses.forEach(ticketStatus => {
        const previous = next[ticketStatus.ticketKey] || {};
        if (ticketStatus.action === 'check_failed') {
          next[ticketStatus.ticketKey] = {
            ...previous,
            action: previous.action || 'check_failed',
            lastCheckError: ticketStatus.error || 'Check failed',
            checkedAt: new Date().toISOString(),
          };
          return;
        }

        const resolvedProjectLabel = ticketStatus.resolvedProject?.project?.name
          || ticketStatus.resolvedProject?.name
          || ticketStatus.resolvedProject?.identifier
          || previous.projectName
          || '';

        const nextSync = {
          ...previous,
          action: (ticketStatus.action === 'not_found' && previous.action === 'staged')
            ? 'staged'
            : ticketStatus.action,
          status: ticketStatus.status || ticketStatus.issue?.status?.name || previous.status,
          projectName: resolvedProjectLabel,
          projectMissing: Boolean(ticketStatus.projectMissing),
          lastCheckError: '',
          checkedAt: new Date().toISOString(),
        };

        if (ticketStatus.action === 'not_found') {
          nextSync.issueId = undefined;
          nextSync.issueUrl = undefined;
          nextSync.isClosed = false;
        } else {
          nextSync.issueId = ticketStatus.issueId || ticketStatus.issue?.id || previous.issueId;
          nextSync.issueUrl = ticketStatus.issueUrl || previous.issueUrl;
          nextSync.isClosed = ticketStatus.action === 'existing_closed' || Boolean(ticketStatus.isClosed);
        }

        next[ticketStatus.ticketKey] = nextSync;
      });
      return next;
    });
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
        fetchRedmineSyncStatus();
        fetchLogs();
      });

      return () => {
        active = false;
      };
    }
    return undefined;
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
    if (currentHash === '#settings' && user?.role !== 'admin') {
      setHashRoute('');
    }
  }, [currentHash, user]);

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

  useEffect(() => {
    let interval;
    if (showLogs) {
      queueMicrotask(fetchLogs);
      interval = setInterval(fetchLogs, 1000);
    }
    return () => clearInterval(interval);
  }, [showLogs]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const uniqueProducts = Array.from(new Set(
    findings.map(f => getDefectDojoRoute(f).projectName).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let filteredFindings = findings;
  
  if (activeFilter !== 'All') {
    filteredFindings = filteredFindings.filter(f => f.severity === activeFilter);
  }

  if (selectedProductFilter !== 'All') {
    filteredFindings = filteredFindings.filter(f => getDefectDojoRoute(f).projectName === selectedProductFilter);
  }

  const getCompactedFindings = (findingsToCompact) => {
    const groups = new Map();
    findingsToCompact.forEach(f => {
      const defectDojoRoute = getDefectDojoRoute(f);
      const routeProjectKey = defectDojoRoute.projectId
        || defectDojoRoute.projectName
        || config.pullFilters?.test__engagement__product
        || '';
      const routeEngagementKey = defectDojoRoute.engagementId
        || defectDojoRoute.engagementName
        || config.pullFilters?.test__engagement
        || '';
      const key = `${getCompactGroupKey(f)}|route|${normalizeForGrouping(routeProjectKey)}|${normalizeForGrouping(routeEngagementKey)}`;
      const target = parseUpgradeTarget(f);
      const cves = collectVulnerabilityIds(f);
      const mitigation = getMitigationText(f);
      const description = getDescriptionText(f);
      const impact = getImpactText(f);
      const endpoints = Array.isArray(f.endpoints) && f.endpoints.length > 0
        ? f.endpoints
        : [{ id: 'N/A', host: 'Unknown host' }];

      if (!groups.has(key)) {
        groups.set(key, {
          ...f,
          compactSourceKey: key,
          compactGroupId: `compact-${key}`,
          originalIds: [],
          allEndpointsMap: new Map(),
          allCVEsSet: new Set(),
          allMitigationsSet: new Set(),
          allDescriptionsMap: new Map(),
          allImpactsMap: new Map(),
          allTitlesSet: new Set(),
          defectDojoProjectIdsSet: new Set(),
          defectDojoProjectNamesSet: new Set(),
          defectDojoEngagementIdsSet: new Set(),
          defectDojoEngagementNamesSet: new Set(),
          endpointDetailMap: new Map(),
          highestUpgradeTarget: null,
          serverRedmineSync: null,
          count: 0,
        });
      }

      const group = groups.get(key);
      group.serverRedmineSync = chooseRedmineSync(group.serverRedmineSync, f.redmineSync);
      group.count += 1;
      group.originalIds.push(f.id);
      group.severity = highestSeverity(group.severity || 'Info', f.severity || 'Info');
      group.allTitlesSet.add(cleanText(f.title || f.name || 'Untitled finding'));
      cves.forEach(cve => group.allCVEsSet.add(cve));
      if (mitigation) group.allMitigationsSet.add(mitigation);
      addTextSource(group.allDescriptionsMap, description, f.id);
      addTextSource(group.allImpactsMap, impact, f.id);
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
      });
    });

    return Array.from(groups.values()).map(group => {
      const allMitigations = compactMitigations(group.allMitigationsSet);
      const allDescriptionSources = sortTextSources(group.allDescriptionsMap);
      const allImpactSources = sortTextSources(group.allImpactsMap);
      const allDescriptions = allDescriptionSources.map(source => source.text);
      const allImpacts = allImpactSources.map(source => source.text);
      const allTitles = sortStrings(group.allTitlesSet);
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
        findingIds: originalIds,
        productIds: defectDojoProjectIds,
        engagementIds: defectDojoEngagementIds,
      });

      const endpointDetails = Array.from(group.endpointDetailMap.values())
        .map(detail => ({
          endpoint: detail.endpoint,
          label: detail.label,
          host: detail.host,
          severity: detail.severity,
          cves: sortStrings(detail.cves),
          mitigations: compactMitigations(detail.mitigations),
          findingIds: detail.findingIds,
        }))
        .sort((a, b) => (
          a.host.localeCompare(b.host, undefined, { numeric: true })
          || a.label.localeCompare(b.label, undefined, { numeric: true })
        ));

      const compactedTicket = {
        ...group,
        compactedSyncKey,
        compactGroupId: compactedSyncKey,
        originalIds,
        title: chooseDisplayTitle(allTitles, group.title),
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
        defectDojoProjectId: defectDojoProjectIds[0] || '',
        defectDojoProjectName: defectDojoProjectNames[0] || '',
        defectDojoEngagementId: defectDojoEngagementIds[0] || '',
        defectDojoEngagementName: defectDojoEngagementNames[0] || '',
        allDefectDojoProjectIds: defectDojoProjectIds,
        allDefectDojoProjectNames: defectDojoProjectNames,
        allDefectDojoEngagementIds: defectDojoEngagementIds,
        allDefectDojoEngagementNames: defectDojoEngagementNames,
        endpointDetails,
      };

      delete compactedTicket.allEndpointsMap;
      delete compactedTicket.allCVEsSet;
      delete compactedTicket.allMitigationsSet;
      delete compactedTicket.allDescriptionsMap;
      delete compactedTicket.allImpactsMap;
      delete compactedTicket.allTitlesSet;
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

  const getFindingRedmineSync = (finding) => (
    chooseDashboardRedmineSync(redmineSyncByTicket[getTicketActionId(finding)], finding.serverRedmineSync)
  );

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

  const formatCountLabel = (count, singular, plural = `${singular}s`) => (
    `${count} ${count === 1 ? singular : plural}`
  );

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
        {finding.count > 1 && <span>{formatCountLabel(finding.count, 'finding')}</span>}
        <span>{formatCountLabel(endpointCount, 'endpoint')}</span>
        <span>{formatCountLabel(cveCount, 'CVE')}</span>
        <span>{finding.date || 'No date'}</span>
        {findingRedmineSync && (
          <span className={`redmine-sync-badge ${findingRedmineSync.action}`}>
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

  const renderFindingDetailPanel = () => {
    if (!selectedFinding) {
      return (
        <aside className="finding-detail-panel empty" aria-label="Finding detail">
          <Info size={28} className="empty-state-icon" />
          <h2>Select a finding</h2>
          <p>Choose a row to review endpoints, CVEs, mitigation, and raw JSON without losing your place in the list.</p>
        </aside>
      );
    }

    const findingRedmineSync = getFindingRedmineSync(selectedFinding);
    const endpoints = selectedFinding.allEndpoints || [];
    const cves = selectedFinding.allCVEs || [];
    const mitigations = selectedFinding.allMitigations || [];

    return (
      <aside className="finding-detail-panel" aria-label="Selected finding detail">
        <div className="finding-detail-header">
          <div>
            <span className={`severity-badge badge-${(selectedFinding.severity || 'Info').toLowerCase()}`}>
              {selectedFinding.severity || 'Info'}
            </span>
            <h2>{selectedFinding.title}</h2>
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
          {selectedFinding.count > 1 && <span className="count-badge">{formatCountLabel(selectedFinding.count, 'finding')}</span>}
          {findingRedmineSync && (
            <span className={`redmine-sync-badge ${findingRedmineSync.action}`}>
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
      </aside>
    );
  };

  const displayFindings = getCompactedFindings(filteredFindings);
  const compactedFindingsForStats = getCompactedFindings(findings);
  const redmineCheckTickets = compactedFindingsForStats.filter(finding => finding.superTicketMarkdown);
  const redmineSyncValues = redmineCheckTickets
    .map(getFindingRedmineSync)
    .filter(Boolean);
  const dashboardStats = {
    totalFindings: findings.length,
    totalCompacted: compactedFindingsForStats.length,
    ticketsCreated: redmineSyncValues.filter(isTicketCreatedOrInProgress).length,
    ticketsClosed: redmineSyncValues.filter(isTicketClosedInRedmine).length,
  };

  const openSyncAllFilters = () => {
    if (user?.role !== 'admin') {
      alert('Only admins can create or check Redmine issues.');
      return;
    }

    if (bulkOpeningRedmine || pulling) {
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

    if (bulkOpeningRedmine || pulling) {
      return;
    }

    const filtersForSync = createPullFiltersDraft(pullFilters);

    const summary = {
      created: 0,
      existing_open: 0,
      existing_closed: 0,
      other: 0,
      failed: [],
    };
    let stoppedMessage = '';

    setSyncAllProgress({
      phase: 'Starting',
      current: 0,
      total: 0,
      message: 'Starting Sync All',
      lines: ['Starting Sync All'],
    });
    setBulkOpeningRedmine(true);
    try {
      setSyncProgress({ phase: 'Pulling', message: 'Pulling matching findings from DefectDojo' });
      const pullResult = await pullFromApi({
        showSuccessAlert: false,
        showFailureAlert: true,
        refreshFindingsAfterPull: true,
        filters: filtersForSync,
      });

      if (!pullResult) return;

      const freshFindings = Array.isArray(pullResult.findings) ? pullResult.findings : [];
      const tickets = getCompactedFindings(freshFindings).filter(finding => finding.superTicketMarkdown);
      setSyncProgress({
        phase: 'Preparing',
        current: 0,
        total: tickets.length,
        message: `Prepared ${tickets.length} compacted Redmine tickets`,
      });

      if (tickets.length === 0) {
        alert(`Pulled ${pullResult.data?.count || 0} DefectDojo findings, but no compacted tickets are available to sync to Redmine.`);
        return;
      }

      const ticketRequests = tickets.map(finding => ({ finding, request: buildRedmineIssueRequest(finding) }));
      const invalidTicket = ticketRequests.find(item => item.request.error);

      if (invalidTicket) {
        if (invalidTicket.request.openConfig) {
          setHashRoute('#settings');
        }
        alert(`${invalidTicket.finding.title}\n\n${invalidTicket.request.error}`);
        return;
      }

      const normalizedConfig = normalizeConfig(config);
      const ticketRefs = ticketRequests.map(({ finding, request }) => ({
        ticketKey: getTicketActionId(finding),
        subject: request.body.issue.subject,
        syncKey: request.body.issue.syncKey,
        issueId: getKnownRedmineIssueId(finding),
        findingIds: request.body.issue.findingIds,
        route: request.body.issue.route,
      }));

      setSyncProgress({
        phase: 'Checking Redmine',
        current: 0,
        total: ticketRefs.length,
        message: `Checking ${ticketRefs.length} Redmine tickets in batches`,
      });

      const checkRes = await runWithTimeout(
        (signal) => apiFetch('/redmine/issues/check', {
          method: 'POST',
          body: JSON.stringify({
            redmine: {
              url: normalizedConfig.redmineUrl,
              apiKey: normalizedConfig.redmineApiKey,
              projectId: normalizedConfig.redmineProjectId,
              trackerId: normalizedConfig.redmineTrackerId,
            },
            tickets: ticketRefs,
          }),
          signal,
        }),
        SYNC_ALL_REDMINE_REQUEST_TIMEOUT_MS,
        `Timed out checking Redmine tickets after ${formatTimeoutSeconds(SYNC_ALL_REDMINE_REQUEST_TIMEOUT_MS)} seconds`
      );
      const checkData = await checkRes.json();

      if (!checkRes.ok) {
        alert(`Error checking Redmine tickets: ${checkData.error || 'Failed'}\n${JSON.stringify(checkData.details || '')}`);
        return;
      }

      const ticketStatuses = checkData.tickets || [];
      applyRedmineTicketStatuses(ticketStatuses);
      setSyncProgress({
        phase: 'Checking Redmine',
        current: ticketStatuses.length,
        total: ticketRefs.length,
        message: `Checked ${ticketStatuses.length} Redmine ticket statuses`,
      });

      const statusByTicketKey = new Map(ticketStatuses.map(status => [status.ticketKey, status]));
      ticketStatuses.forEach(status => {
        if (status.action === 'existing_open') summary.existing_open += 1;
        else if (status.action === 'existing_closed') summary.existing_closed += 1;
        else if (status.action === 'check_failed') summary.failed.push(`${status.ticketKey}: ${status.error || 'Check failed'}`);
      });

      const ticketsToSync = ticketRequests.filter(({ finding }) => {
        const status = statusByTicketKey.get(getTicketActionId(finding));
        return !status || status.action === 'not_found';
      });

      setSyncProgress({
        phase: 'Syncing Redmine',
        current: 0,
        total: ticketsToSync.length,
        message: ticketsToSync.length > 0
          ? `Creating or updating ${ticketsToSync.length} Redmine tickets (concurrency ${SYNC_ALL_REDMINE_CONCURRENCY})`
          : 'No Redmine tickets need create/update work',
      });

      let completedSyncs = 0;
      await runWithClientConcurrency(ticketsToSync, SYNC_ALL_REDMINE_CONCURRENCY, async ({ finding }) => {
        const ticketActionId = getTicketActionId(finding);

        try {
          setOpeningRedmineId(ticketActionId);
          const data = await syncRedmineIssue(finding, {
            openIssueTab: false,
            timeoutMs: SYNC_ALL_REDMINE_REQUEST_TIMEOUT_MS,
          });
          if (summary[data.action] !== undefined) {
            summary[data.action] += 1;
          } else {
            summary.other += 1;
          }
        } catch (err) {
          console.error('Error opening compacted Redmine issue:', err);
          summary.failed.push(`${finding.title}: ${err.message || 'Failed'}`);
        } finally {
          completedSyncs += 1;
          setSyncProgress({
            phase: 'Syncing Redmine',
            current: completedSyncs,
            total: ticketsToSync.length,
            message: `Synced ${completedSyncs}/${ticketsToSync.length} Redmine tickets`,
            append: completedSyncs === 1 || completedSyncs === ticketsToSync.length || completedSyncs % 5 === 0,
          });
        }
      });

      setSyncProgress({
        phase: 'Complete',
        current: ticketRefs.length,
        total: ticketRefs.length,
        message: 'Sync All finished',
      });
    } catch (err) {
      console.error('Error during Sync All:', err);
      stoppedMessage = err.message || 'Sync All failed unexpectedly.';
      summary.failed.push(stoppedMessage);
      setSyncProgress({
        phase: 'Failed',
        message: stoppedMessage,
      });
    } finally {
      setOpeningRedmineId(null);
      setBulkOpeningRedmine(false);
      setSyncAllProgress(null);
    }

    const failedText = summary.failed.length > 0
      ? `\n\nFailed:\n${summary.failed.slice(0, 5).map(item => `- ${item}`).join('\n')}${summary.failed.length > 5 ? `\n- ...and ${summary.failed.length - 5} more` : ''}`
      : '';

    alert(
      `${stoppedMessage ? `Sync All stopped early.\n\n${stoppedMessage}\n\n` : 'Redmine bulk sync finished after pulling matching DefectDojo findings.\n\n'}`
      + `Created: ${summary.created}\n`
      + `Already open: ${summary.existing_open}\n`
      + `Already closed: ${summary.existing_closed}\n`
      + `Other: ${summary.other}\n`
      + `Failed: ${summary.failed.length}`
      + failedText
    );
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
            pulling={pulling}
            onPull={pullFromApi}
            onClearData={async () => {
              if (confirm('Clear all local findings?')) {
                await apiFetch('/clear', { method: 'POST' });
                fetchFindings();
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
            <button className="icon-btn" onClick={() => { setHashRoute('#settings'); }} title="Settings" aria-label="Open settings">
              <Settings size={20} />
            </button>
          )}
          <button className="icon-btn" onClick={fetchFindings} title="Refresh Findings" aria-label="Refresh findings" disabled={loading}>
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

        <section className="stats-grid">
          <div className="stat-card stat-primary">
            <span className="stat-value">{dashboardStats.totalFindings}</span>
            <span className="stat-label">Total Findings</span>
          </div>
          <div className="stat-card stat-warning">
            <span className="stat-value">{dashboardStats.totalCompacted}</span>
            <span className="stat-label">Compacted</span>
          </div>
          <div className="stat-card stat-danger">
            <span className="stat-value">{dashboardStats.ticketsCreated}</span>
            <span className="stat-label">Tickets Open</span>
          </div>
          <div className="stat-card stat-success">
            <span className="stat-value">{dashboardStats.ticketsClosed}</span>
            <span className="stat-label">Tickets Closed</span>
          </div>
        </section>

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
                  value={selectedProductFilter}
                  onChange={(e) => setSelectedProductFilter(e.target.value)}
                >
                  <option value="All">All Products ({uniqueProducts.length})</option>
                  {uniqueProducts.map(p => (<option key={p} value={p}>{p}</option>))}
                </select>
              </label>
            )}
          </div>
          {user?.role === 'admin' && (
            <button
              type="button"
              className="btn-secondary sync-all-btn"
              onClick={openSyncAllFilters}
              disabled={bulkOpeningRedmine || pulling}
              title="Choose DefectDojo pull filters, then sync every compacted ticket in Redmine"
            >
              <RefreshCw size={14} className={bulkOpeningRedmine || pulling ? 'spin' : ''} />
              {bulkOpeningRedmine ? 'Syncing...' : pulling ? 'Pulling...' : `Sync All (${compactedFindingsForStats.length})`}
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
                selectedProductFilter === 'All' && uniqueProducts.length > 1 ? (
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

          {renderFindingDetailPanel()}
        </section>
      </main>

      {syncAllProgress && (
        <div className="modal-overlay sync-progress-overlay">
          <div className="modal-content log-modal sync-progress-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-heading-with-icon">
                <RefreshCw size={20} className={bulkOpeningRedmine || pulling ? 'spin' : ''} />
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
        <div className="modal-overlay" onClick={() => !pulling && !bulkOpeningRedmine && setShowSyncAllFilters(false)}>
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
                    disabled={pulling || bulkOpeningRedmine}
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
                        disabled={pulling || bulkOpeningRedmine}
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
                  disabled={pulling || bulkOpeningRedmine}
                />
              </div>

              <div className="form-group">
                <label>Engagement ID</label>
                <input
                  type="text"
                  value={syncAllPullFilters.test__engagement}
                  onChange={(e) => updateSyncAllPullFilter('test__engagement', e.target.value)}
                  placeholder="empty for all"
                  disabled={pulling || bulkOpeningRedmine}
                />
              </div>

              <div className="form-group">
                <label>Active</label>
                <select
                  value={syncAllPullFilters.active}
                  onChange={(e) => updateSyncAllPullFilter('active', e.target.value)}
                  disabled={pulling || bulkOpeningRedmine}
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
                  disabled={pulling || bulkOpeningRedmine}
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
                  disabled={pulling || bulkOpeningRedmine}
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
                disabled={pulling || bulkOpeningRedmine}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={pulling || bulkOpeningRedmine}>
                <RefreshCw size={16} className={pulling || bulkOpeningRedmine ? 'spin' : ''} />
                {bulkOpeningRedmine ? 'Syncing...' : pulling ? 'Pulling...' : 'Pull & Sync'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showLogs && (
        <div className="modal-overlay" onClick={() => !pulling && setShowLogs(false)}>
          <div className="modal-content log-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <h2 className="modal-heading-with-icon">
                  <Terminal size={20} />
                  Backend Logs {pulling && <span className="pulse modal-status">(Pulling...)</span>}
                </h2>
                {!pulling && (
                  <button 
                    className="filter-btn active" 
                    onClick={() => setShowLogs(false)}
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
            <div className="terminal-window">
              {logs.length === 0 ? (
                <div className="log-line log-text">Waiting for logs...</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="log-line">
                    <span className="log-time">[{log.time}]</span>
                    <span className={`log-level-${log.level}`}>
                      {log.text}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
            {pulling && (
              <p className="helper-text">
                Please wait while the server fetches and resolves endpoints from DefectDojo. 
                If an endpoint fails to resolve here, it means the API Token lacks permission or the endpoint doesn't exist.
              </p>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
