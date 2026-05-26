import { Filter, Layers, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import './FindingsPage.css';

const FindingsPage = ({
  activeFilter,
  baseDisplayFindings,
  compactedFindingsForSeverity,
  compactedSearch,
  compactedSearchActive,
  compactedSeverityCounts,
  displayFindingGroups,
  displayFindings,
  embedded = false,
  findingStateCounts = { open: 0, closed: 0, all: 0 },
  findingStateFilter = 'open',
  onClearSearch,
  onFindingStateChange = () => {},
  onRedmineStatusChange = () => {},
  onSearchChange,
  redmineStatusCounts = {},
  redmineStatusFilter = 'all',
  redmineStatusOptions = [],
  renderFindingDetailModal,
  renderFindingRow,
  renderMitigationReviewToast,
  renderScopeMenu,
  selectedProductId,
  setActiveFilter,
  severityOptions,
}) => {
  const totalSeverityCount = compactedFindingsForSeverity.length;
  const findingStateOptions = [
    { id: 'open', label: 'Open', count: findingStateCounts.open || 0 },
    { id: 'closed', label: 'Closed', count: findingStateCounts.closed || 0 },
    { id: 'all', label: 'All', count: findingStateCounts.all || 0 },
  ];
  const getSeverityPercent = (count) => (
    totalSeverityCount > 0 ? Math.max(4, Math.round((count / totalSeverityCount) * 100)) : 0
  );
  const emptyMessage = compactedSearchActive
    ? 'No compacted findings match the current search. Try broadening your query.'
    : findingStateFilter === 'closed'
      ? 'No closed Redmine-linked findings match the current filters.'
      : findingStateFilter === 'open'
        ? 'No open findings match the current filters. Try All to include closed tickets.'
        : 'No findings found for the selected filters.';

  const findingsContent = (
    <>
      {/* ── Command Bar ── */}
      <div className="findings-command-bar">
        <label className="findings-search">
          <span className="sr-only">Search compacted findings</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={compactedSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search title, CVE, endpoint, Redmine..."
          />
          {compactedSearchActive && (
            <button
              type="button"
              className="findings-search-clear"
              onClick={onClearSearch}
              aria-label="Clear compacted findings search"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="findings-search-kbd">Ctrl K</kbd>
        </label>

        {renderScopeMenu()}

        <div className="finding-state-filter" role="group" aria-label="Filter findings by Redmine state">
          {findingStateOptions.map(option => {
            const isActive = findingStateFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`finding-state-option${isActive ? ' active' : ''}`}
                onClick={() => onFindingStateChange(option.id)}
                aria-pressed={isActive}
              >
                <span>{option.label}</span>
                <strong>{option.count}</strong>
              </button>
            );
          })}
        </div>

        <label className="redmine-status-filter">
          <span>Redmine</span>
          <select
            value={redmineStatusFilter}
            onChange={(event) => onRedmineStatusChange(event.target.value)}
            aria-label="Filter findings by Redmine status"
          >
            {redmineStatusOptions.map(option => (
              <option key={option.id} value={option.id}>
                {option.label} ({redmineStatusCounts[option.id] || 0})
              </option>
            ))}
          </select>
        </label>

        <span className="findings-result-count">
          <Layers size={14} />
          {compactedSearchActive
            ? `${displayFindings.length} of ${baseDisplayFindings.length}`
            : `${displayFindings.length}`}
          <span className="findings-result-count-label">
            {' '}row{displayFindings.length !== 1 ? 's' : ''}
          </span>
        </span>
      </div>

      {/* ── Severity Filter ── */}
      <div className="severity-filter-panel" aria-label="Filter by severity">
        <div className="severity-filter-head">
          <span>Severity</span>
          <strong>{totalSeverityCount} total</strong>
        </div>
        <div className="severity-filter-options">
          <button
            type="button"
            className={`severity-filter-option all${activeFilter === 'All' ? ' active' : ''}`}
            onClick={() => setActiveFilter('All')}
            aria-pressed={activeFilter === 'All'}
          >
            <Filter size={14} />
            <span>All</span>
            <strong>{totalSeverityCount}</strong>
          </button>

          {severityOptions.map(severity => {
            const count = compactedSeverityCounts[severity] || 0;
            const isActive = activeFilter === severity;
            return (
              <button
                key={severity}
                type="button"
                className={`severity-filter-option ${severity.toLowerCase()}${isActive ? ' active' : ''}`}
                onClick={() => setActiveFilter(severity)}
                aria-pressed={isActive}
              >
                <span className="severity-filter-dot" aria-hidden="true" />
                <span className="severity-filter-label">{severity}</span>
                <strong>{count}</strong>
                <span className="severity-filter-meter" aria-hidden="true">
                  <span style={{ width: `${getSeverityPercent(count)}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Findings List ── */}
      <section className="findings-container" aria-label="Finding review workspace">
        <div className="findings-list-panel">
          <div className="findings-list">
            {displayFindings.length > 0 ? (
              !selectedProductId && displayFindingGroups.length > 1 ? (
                displayFindingGroups.map(({ productName, productFindings }) => (
                  <div key={productName} className="product-group">
                    <div className="product-group-header">
                      <h2>{productName}</h2>
                      <span className="product-group-count">
                        {productFindings.length} finding{productFindings.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {productFindings.map((finding, idx) => (
                      <div key={finding.id || idx} className="findings-card-enter" style={{ animationDelay: `${Math.min(idx * 40, 600)}ms` }}>
                        {renderFindingRow(finding, idx)}
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                displayFindings.map((finding, idx) => (
                  <div key={finding.id || idx} className="findings-card-enter" style={{ animationDelay: `${Math.min(idx * 40, 600)}ms` }}>
                    {renderFindingRow(finding, idx)}
                  </div>
                ))
              )
            ) : (
              <div className="findings-empty" role="status">
                <div className="findings-empty-icon-wrap">
                  <span className="findings-empty-pulse" />
                  <ShieldCheck size={44} />
                </div>
                <h2>No matching findings</h2>
                <p>{emptyMessage}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );

  if (embedded) {
    return (
      <section className="dashboard-section dashboard-findings-section findings-main" aria-labelledby="dashboard-findings-title">
        <div className="dashboard-section-header">
          <div>
            <h2 id="dashboard-findings-title">Compacted Findings</h2>
            <span>Review grouped vulnerabilities and open ticket details from the dashboard.</span>
          </div>
        </div>
        {findingsContent}
        {renderFindingDetailModal()}
      </section>
    );
  }

  return (
    <>
      {/* ─── Hero Header ─── */}
      <header className="findings-hero">
        <div className="findings-hero-inner">
          <div className="findings-hero-icon-wrap">
            <span className="findings-hero-ring" />
            <span className="findings-hero-ring findings-hero-ring--delay" />
            <ShieldAlert size={28} />
          </div>
          <div className="findings-hero-copy">
            <p className="eyebrow">Compacted Findings</p>
            <h1>Ticket Management</h1>
            <p className="findings-hero-sub">
              Manage security findings vulnerability.
            </p>
          </div>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="main-content findings-main">
        {findingsContent}
      </main>

      {renderFindingDetailModal()}
      {renderMitigationReviewToast()}
    </>
  );
};

export default FindingsPage;
