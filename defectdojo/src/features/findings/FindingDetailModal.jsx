import { X, ExternalLink } from 'lucide-react';
import { formatRouteValue, getRedmineSyncBadgeClass } from '../../shared/lib/dashboardUtils';
import { endpointLabel } from '../../domain/findings/endpointUtils';
import { getCompactedFindingCount } from '../../domain/findings/compactionUtils';
import { getRedmineSyncLabel } from '../../domain/redmine/redmineTicketFormat';
import { cleanBlockText } from '../../domain/findings/findingUtils';
import './FindingDetailModal.css';

const formatCountLabel = (count, singular, plural = `${singular}s`) => {
  const normalizedCount = Number.parseInt(count, 10);
  const safeCount = Number.isFinite(normalizedCount) ? normalizedCount : 0;
  return `${safeCount} ${safeCount === 1 ? singular : plural}`;
};

const renderDetailSourcesList = (sources, fallbackItems, fallbackText) => {
  let items = [];
  if (Array.isArray(sources) && sources.length > 0) {
    items = sources.map(s => ({
      text: cleanBlockText(s.text),
      findingIds: s.findingIds || []
    })).filter(item => item.text);
  } else if (Array.isArray(fallbackItems) && fallbackItems.length > 0) {
    items = fallbackItems.map(text => ({
      text: cleanBlockText(text),
      findingIds: []
    })).filter(item => item.text);
  } else if (fallbackText) {
    items = [{
      text: cleanBlockText(fallbackText),
      findingIds: []
    }];
  }

  if (items.length === 0) {
    return <p className="detail-empty-text">No information provided.</p>;
  }

  return (
    <div className="compact-text-list">
      {items.map((item, i) => {
        const idLabel = item.findingIds.length === 0
          ? ''
          : ` (DefectDojo Finding IDs: ${item.findingIds.join(', ')})`;
        return (
          <div key={i} className="detail-text-source">
            {items.length > 1 && (
              <h4 className="detail-source-title">Source {i + 1}{idLabel}</h4>
            )}
            <p className="detail-source-body">{item.text}</p>
          </div>
        );
      })}
    </div>
  );
};

const FindingDetailModal = ({
  selectedFinding,
  onClose,
  findingRedmineSync,
  isAdmin,
  bulkOpeningRedmine,
  openingRedmineId,
  getTicketActionId,
  openRedmineIssue,
}) => {
  if (!selectedFinding) return null;

  const endpoints = selectedFinding.allEndpoints || [];
  const cves = selectedFinding.allCVEs || [];
  const cwes = selectedFinding.allCWEs || (selectedFinding.cweIds || []).map(weakness_id => ({ weakness_id }));
  const mitigations = selectedFinding.allMitigations || [];
  const sourceFindingCount = getCompactedFindingCount(selectedFinding);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
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
            onClick={onClose}
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
          {renderDetailSourcesList(selectedFinding.allDescriptionSources, selectedFinding.allDescriptions, selectedFinding.description)}
        </section>

        <section className="detail-section">
          <h3>Impact</h3>
          {renderDetailSourcesList(selectedFinding.allImpactSources, selectedFinding.allImpacts, selectedFinding.impact)}
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
                    CVEs: {detail.cves?.length > 0 ? detail.cves.join(', ') : 'None'}
                    <br />
                    CWEs: {detail.cwes?.length > 0 ? detail.cwes.join(', ') : 'None'}
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
          <h3>CWEs</h3>
          <div className="meta-value-list">
            {cwes.length > 0 ? cwes.map((v, i) => (
              <span key={i} className="cve-tag">{typeof v === 'string' ? v : v.weakness_id || v.cwe_id || v.name || v.id}</span>
            )) : <p className="detail-empty-text">No CWEs listed.</p>}
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



        <div className="detail-actions">
          {isAdmin && selectedFinding.superTicketMarkdown && (
            <button
              className="btn-secondary"
              onClick={() => openRedmineIssue(selectedFinding)}
              disabled={bulkOpeningRedmine || openingRedmineId === getTicketActionId(selectedFinding)}
            >
              <ExternalLink size={18} />
              {bulkOpeningRedmine || openingRedmineId === getTicketActionId(selectedFinding) ? 'Opening...' : 'Open in Redmine'}
            </button>
          )}
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default FindingDetailModal;
