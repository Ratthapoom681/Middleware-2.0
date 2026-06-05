import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Layers,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { PageHeader, PageMain } from '../../shared/ui/Page';
import './FindingsPage.css';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const DEFAULT_PAGE_SIZE = 10;
const FINDINGS_TABLE_COLUMNS = ['ID', 'Company', 'Severity', 'Name', 'Finding', 'Endpoints', 'CVEs/CWEs', 'Date', 'Status'];

const FindingsPage = ({
  activeFilter,
  baseDisplayFindings,
  compactedFindingsForSeverity,
  compactedSearch,
  compactedSearchActive,
  compactedSeverityCounts,
  displayFindings,
  embedded = false,
  onClearSearch,
  onSearchChange,
  renderFindingDetailModal,
  renderFindingRow,
  renderMitigationReviewToast,
  renderScopeMenu,
  setActiveFilter,
  severityOptions,
}) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [filterPanelOpen, setFilterPanelOpen] = useState(true);
  const totalSeverityCount = compactedFindingsForSeverity.length;
  const totalRows = displayFindings.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStartIndex = (currentPage - 1) * pageSize;
  const firstResult = totalRows === 0 ? 0 : pageStartIndex + 1;
  const lastResult = Math.min(totalRows, pageStartIndex + pageSize);
  const pagedDisplayFindings = useMemo(
    () => displayFindings.slice(pageStartIndex, pageStartIndex + pageSize),
    [displayFindings, pageSize, pageStartIndex]
  );
  const getSeverityPercent = (count) => (
    totalSeverityCount > 0 ? Math.max(4, Math.round((count / totalSeverityCount) * 100)) : 0
  );
  const emptyMessage = compactedSearchActive
    ? 'No compacted findings match the current search. Try broadening your query.'
    : 'No findings found for the selected filters.';

  const findingsContent = (
    <>
      <section className={`findings-filter-panel${filterPanelOpen ? ' open' : ''}`} aria-labelledby="findings-filter-title">
        <button
          type="button"
          className="findings-filter-toggle"
          onClick={() => setFilterPanelOpen(open => !open)}
          aria-expanded={filterPanelOpen}
          aria-controls="findings-filter-body"
        >
          <span className="findings-filter-toggle-icon">
            <SlidersHorizontal size={18} aria-hidden="true" />
          </span>
          <span className="findings-filter-toggle-copy">
            <strong id="findings-filter-title">Search Options</strong>
          </span>
          <ChevronDown className="findings-filter-chevron" size={18} aria-hidden="true" />
        </button>

        {filterPanelOpen && (
          <div className="findings-filter-body" id="findings-filter-body">
            {/* ── Command Bar ── */}
            <div className="findings-command-bar">
              <label className="findings-search">
                <span className="sr-only">Search compacted findings</span>
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={compactedSearch}
                  onChange={(event) => {
                    setPage(1);
                    onSearchChange(event.target.value);
                  }}
                  placeholder="Search title, CVE, endpoint, Redmine..."
                />
                {compactedSearchActive && (
                  <button
                    type="button"
                    className="findings-search-clear"
                    onClick={() => {
                      setPage(1);
                      onClearSearch();
                    }}
                    aria-label="Clear compacted findings search"
                    title="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
                <kbd className="findings-search-kbd">Ctrl K</kbd>
              </label>

              {renderScopeMenu()}

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
                  onClick={() => {
                    setPage(1);
                    setActiveFilter('All');
                  }}
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
                      onClick={() => {
                        setPage(1);
                        setActiveFilter(severity);
                      }}
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
          </div>
        )}
      </section>

      {/* ── Findings List ── */}
      <section className="findings-container" aria-label="Finding review workspace">
        <div className="findings-list-panel">
          <div className="findings-table" role="table" aria-label="Compacted findings">
            <div className="findings-table-header" role="row">
              {FINDINGS_TABLE_COLUMNS.map(column => (
                <div key={column} className="findings-table-header-cell" role="columnheader">
                  {column}
                </div>
              ))}
            </div>
            <div className="findings-table-body" role="rowgroup">
            {displayFindings.length > 0 ? (
              pagedDisplayFindings.map((finding, idx) => (
                renderFindingRow(finding, pageStartIndex + idx)
              ))
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
          {displayFindings.length > 0 && (
            <div className="findings-table-footer">
              <span className="findings-page-summary">
                Showing {firstResult} to {lastResult} of {totalRows} result{totalRows !== 1 ? 's' : ''}
              </span>
              <label className="findings-page-size">
                <span>Rows per page</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  aria-label="Rows per page"
                >
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
              <div className="findings-page-controls" aria-label="Findings pagination">
                <button
                  type="button"
                  className="btn-secondary findings-page-btn"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous findings page"
                >
                  <ChevronLeft size={16} />
                  Previous
                </button>
                <span>Page {currentPage} of {pageCount}</span>
                <button
                  type="button"
                  className="btn-secondary findings-page-btn"
                  onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
                  disabled={currentPage >= pageCount}
                  aria-label="Next findings page"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );

  if (embedded) {
    return (
      <section className="dashboard-section dashboard-findings-section findings-main" aria-labelledby="dashboard-findings-title">
        {findingsContent}
        {renderFindingDetailModal()}
      </section>
    );
  }

  return (
    <>
      <PageHeader
        icon={ShieldAlert}
        eyebrow="Compacted Findings"
        title="Ticket Management"
        description="Manage security findings and Redmine ticket workflow."
      />

      <PageMain className="findings-main">
        {findingsContent}
      </PageMain>

      {renderFindingDetailModal()}
      {renderMitigationReviewToast()}
    </>
  );
};

export default FindingsPage;
