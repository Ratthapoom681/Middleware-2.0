import { ExternalLink, X, FileText, User, Calendar, Building2, ShieldAlert, MessageSquareText, Server } from 'lucide-react';

const formatDateTime = (value) => (
  value ? new Date(value).toLocaleString() : 'Not recorded'
);

const pluralizeCount = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

const getHistoryEndpointCount = (item = {}) => {
  if (Number.isFinite(Number(item.endpointCount)) && Number(item.endpointCount) > 0) return Number(item.endpointCount);
  if (Array.isArray(item.endpoints) && item.endpoints.length > 0) return item.endpoints.length;
  const endpointText = String(item.endpoint || '').trim();
  const endpointTextCount = endpointText.match(/^(\d+)\s+endpoints?/i);
  if (endpointTextCount) return Number.parseInt(endpointTextCount[1], 10) || 0;
  return endpointText && endpointText !== 'Not recorded' ? 1 : 0;
};

const getHistoryCveCount = (item = {}) => {
  if (Number.isFinite(Number(item.cveCount)) && Number(item.cveCount) > 0) return Number(item.cveCount);
  if (Array.isArray(item.cveIds) && item.cveIds.length > 0) return item.cveIds.length;
  return toList(item.cveId).filter(cve => cve.toLowerCase() !== 'none').length;
};

const getHistoryCweCount = (item = {}) => {
  if (Number.isFinite(Number(item.cweCount)) && Number(item.cweCount) > 0) return Number(item.cweCount);
  if (Array.isArray(item.cweIds) && item.cweIds.length > 0) return item.cweIds.length;
  const summary = item.raw?.groupedReviewSummary || {};
  if (Number.isFinite(Number(summary.cweCount)) && Number(summary.cweCount) > 0) return Number(summary.cweCount);
  if (Array.isArray(summary.cweIds) && summary.cweIds.length > 0) return summary.cweIds.length;
  return 0;
};

const formatHistoryEndpointCount = (item) => {
  const count = getHistoryEndpointCount(item);
  return count > 0 ? pluralizeCount(count, 'endpoint') : 'No endpoints';
};

const normalizeBaseUrl = (value = '') => (
  String(value || '').trim().replace(/\/api\/v2\/?$/, '').replace(/\/+$/, '')
);

const buildUrl = (baseUrl, path) => {
  const base = normalizeBaseUrl(baseUrl);
  return base ? `${base}${path}` : '';
};

const toList = (value) => {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
};

const getActionLabel = (action = '') => {
  if (action === 'close_redmine') return 'Closed Redmine';
  if (action === 'ignore') return 'Ignored';
  if (action === 'mark_reviewed') return 'Reviewed';
  return action || 'Action';
};

const getActionBadgeClass = (action = '') => {
  if (action === 'close_redmine') return 'success';
  if (action === 'ignore') return 'warning';
  return 'info';
};

const ExternalAnchor = ({ href, children, className = '' }) => {
  if (!href) return <>{children}</>;

  return (
    <a className={`review-link ${className}`} href={href} target="_blank" rel="noreferrer">
      <span>{children}</span>
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
};

const MetaCard = ({ icon: Icon, label, children }) => (
  <div className="mitigation-detail-meta-card">
    <div className="mitigation-detail-meta-label">
      {Icon && <Icon size={12} />}
      <span>{label}</span>
    </div>
    <div className="mitigation-detail-meta-value">{children}</div>
  </div>
);

const ModalDetails = ({ item, onClose, config = {} }) => {
  if (!item) return null;

  const redmineIssueUrl = (entry) =>
    entry.issueUrl || (entry.issueId ? buildUrl(config.redmineUrl, `/issues/${encodeURIComponent(entry.issueId)}`) : '');
  const productUrl = (entry) =>
    entry.productId ? buildUrl(config.defectDojoUrl, `/product/${encodeURIComponent(entry.productId)}`) : '';
  const engagementUrl = (entry) =>
    entry.engagementId ? buildUrl(config.defectDojoUrl, `/engagement/${encodeURIComponent(entry.engagementId)}`) : '';

  const cveCount = getHistoryCveCount(item);
  const cweCount = getHistoryCweCount(item);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-content mitigation-detail-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mitigation-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="modal-header">
          <div className="modal-title-row">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className={`severity-badge badge-${(item.severity || 'Info').toLowerCase()}`}>
                  {item.severity || 'Info'}
                </span>
                <span className={`action-badge ${getActionBadgeClass(item.action)}`}>
                  {getActionLabel(item.action)}
                </span>
              </div>
              <h2 id="mitigation-detail-title" style={{ margin: '0.4rem 0 0', fontSize: '1.05rem' }}>
                {item.title || 'Mitigation review'}
              </h2>
              {item.issueId && (
                <p className="modal-subtitle" style={{ margin: '0.25rem 0 0' }}>
                  <ExternalAnchor href={redmineIssueUrl(item)}>
                    Redmine Issue #{item.issueId}
                  </ExternalAnchor>
                </p>
              )}
            </div>
            <button
              type="button"
              className="icon-btn detail-close-btn"
              onClick={onClose}
              aria-label="Close details"
              title="Close details"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Meta Grid ── */}
        <div className="mitigation-detail-meta-grid">
          <MetaCard icon={FileText} label="Action">
            <span className={`action-badge ${getActionBadgeClass(item.action)}`} style={{ fontSize: '0.72rem' }}>
              {getActionLabel(item.action)}
            </span>
          </MetaCard>
          <MetaCard icon={User} label="Reviewer">
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
              {item.actor || 'Unknown'}
            </span>
            {item.actorRole && (
              <small style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>
                {item.actorRole}
              </small>
            )}
          </MetaCard>
          <MetaCard icon={Calendar} label="Review Date">
            <span style={{ color: 'var(--text-soft)', fontSize: '0.82rem' }}>
              {formatDateTime(item.createdAt)}
            </span>
          </MetaCard>
          <MetaCard icon={Calendar} label="Mitigate Date">
            <span style={{ color: 'var(--text-soft)', fontSize: '0.82rem' }}>
              {formatDateTime(item.mitigationConfirmedAt)}
            </span>
          </MetaCard>
        </div>

        {/* ── Company & References ── */}
        <div className="mitigation-detail-meta-grid" style={{ marginTop: '0.65rem' }}>
          <MetaCard icon={Building2} label="Company / Engagement">
            <ExternalAnchor href={productUrl(item)}>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                {item.productName || 'Unknown'}
              </span>
            </ExternalAnchor>
            <small style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.1rem' }}>
              <ExternalAnchor href={engagementUrl(item)} className="muted">
                {item.engagementName || 'No engagement'}
              </ExternalAnchor>
            </small>
          </MetaCard>
          <MetaCard icon={ShieldAlert} label="CVEs/CWEs">
            <div className="mitigation-detail-reference-summary">
              {cveCount > 0 && <span className="cve-cwe-tag cve">{cveCount} CVE</span>}
              {cweCount > 0 && <span className="cve-cwe-tag cwe">{cweCount} CWE</span>}
              {cveCount === 0 && cweCount === 0 && <span className="detail-empty-text">No CVEs/CWEs</span>}
            </div>
          </MetaCard>
        </div>

        {/* ── Finding & Endpoint ── */}
        <div className="mitigation-detail-meta-grid" style={{ marginTop: '0.65rem' }}>
          <MetaCard icon={FileText} label="Finding">
            <span className="mitigation-detail-primary-text">
              {pluralizeCount(item.findingCount || 1, 'finding')}
            </span>
          </MetaCard>
          <MetaCard icon={Server} label="Endpoint">
            <span className="mitigation-detail-primary-text">
              {formatHistoryEndpointCount(item)}
            </span>
          </MetaCard>
        </div>

        {/* ── Reviewer Note ── */}
        <div className="mitigation-detail-note-section">
          <div className="mitigation-detail-meta-label">
            <MessageSquareText size={12} />
            <span>Reviewer Note / Reason</span>
          </div>
          {item.reason ? (
            <blockquote className="mitigation-detail-quote">
              &ldquo;{item.reason}&rdquo;
            </blockquote>
          ) : (
            <p className="detail-empty-text" style={{ margin: 0 }}>
              No reviewer note was recorded for this action.
            </p>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default ModalDetails;
