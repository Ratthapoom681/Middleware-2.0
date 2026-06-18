import { useMemo, useState } from 'react';
import {
  Layers,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  FileText,
  Server,
} from 'lucide-react';
import { PageMain } from '../../shared/ui/Page';
import Topbar from '../../shared/ui/Topbar/Topbar';
import { DataTable, DataTablePagination, DataTableSection, DataTableRow, DataTableCell } from '../../shared/ui/DataTable/DataTable';
import {
  SearchOptionsCommandBar,
  SearchOptionsFilterGroup,
  SearchOptionsPanel,
  SearchOptionsSearch,
} from '../../shared/ui/SearchOptions/SearchOptions';
import { cleanText, formatRouteValue, getRedmineSyncBadgeClass } from '../../shared/lib/dashboardUtils';
import { getCompactedFindingCount } from '../../domain/findings/compactionUtils';
import { getRedmineSyncLabel } from '../../domain/redmine/redmineTicketFormat';
import { getDefectDojoRoute } from '../../domain/findings/findingUtils';
import './FindingsPage.css';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const DEFAULT_PAGE_SIZE = 10;
const FINDINGS_SEVERITY_FILTERS = ['Critical', 'High', 'Medium', 'Low'];
const FINDINGS_TABLE_COLUMNS = ['ID', 'Company', 'Severity', 'Name', 'Finding', 'Endpoints', 'CVEs/CWEs', 'Date', 'Status'];
const FINDINGS_TABLE_GRID = '88px 156px 104px minmax(240px, 1.8fr) 104px 112px 148px 116px 168px';

const formatRouteSummary = (finding) => {
  if (finding.defectDojoEngagementName || finding.defectDojoEngagementId) {
    return formatRouteValue(finding.defectDojoEngagementName, finding.defectDojoEngagementId);
  }
  return 'No engagement';
};

const formatCompanyName = (finding) => {
  const route = getDefectDojoRoute(finding);
  return cleanText(
    route.projectName
    || finding.defectDojoProjectName
    || finding.productName
    || finding.company
    || route.projectId
    || finding.defectDojoProjectId
  ) || 'Unknown';
};

const formatFindingTableRedmineStatus = (sync) => {
  const statusText = cleanText(sync?.status || sync?.issue?.status?.name);
  if (statusText) return statusText.toUpperCase();

  const actionText = cleanText(sync?.action).toLowerCase();
  if (actionText === 'created') return 'NEW';
  if (actionText === 'existing_open') return 'OPEN';
  if (actionText === 'existing_closed') return 'CLOSED';
  if (actionText === 'closed_with_new_findings') return 'NEW FINDINGS';
  if (actionText === 'not_found') return 'NOT FOUND';
  if (actionText === 'check_failed') return 'ERROR';

  const fallbackLabel = cleanText(getRedmineSyncLabel(sync))
    .replace(/^redmine\s+/i, '')
    .split('→')[0]
    .replace(/\s+->\s+.*$/, '');

  return fallbackLabel ? fallbackLabel.toUpperCase() : 'SYNCED';
};

const getFindingCveCount = (finding) => finding.allCVEs?.length || 0;
const getFindingCweCount = (finding) => finding.allCWEs?.length || finding.cweIds?.length || 0;

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
  renderMitigationReviewToast,
  renderScopeMenu,
  setActiveFilter,
  severityOptions,
  loading = false,
  user,
  selectedFinding,
  setSelectedFinding,
  getFindingRedmineSync,
  getTicketActionId,
  openRedmineIssue,
  bulkOpeningRedmine,
  openingRedmineId,
}) => {
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

  const renderFindingRowLocal = (finding, idx) => {
    const findingRedmineSync = getFindingRedmineSync(finding);
    const redmineIssueId = cleanText(findingRedmineSync?.issueId || findingRedmineSync?.issue?.id);
    const endpointCount = finding.allEndpoints?.length || 0;
    const cveCount = getFindingCveCount(finding);
    const cweCount = getFindingCweCount(finding);
    const sourceFindingCount = getCompactedFindingCount(finding);
    const selected = isSelectedFinding(finding, idx);
    const severity = cleanText(finding.severity || 'Info');
    const severityClass = severity.toLowerCase();
    const statusLabel = cleanText(finding.currentStatus).toLowerCase() || 'active';
    const displayStatusLabel = statusLabel === 'mixed'
      ? 'Mixed'
      : statusLabel === 'mitigated'
        ? 'Mitigated'
        : 'Active';
    const rowStyle = { animationDelay: `${Math.min(idx * 40, 600)}ms` };

    return (
      <DataTableRow
        key={getFindingIdentity(finding, idx)}
        className="finding-row findings-table-row findings-card-enter"
        interactive={true}
        selected={selected}
        tone={severityClass}
        onClick={() => setSelectedFinding(finding)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedFinding(finding);
          }
        }}
        ariaLabel={`View details for ${finding.title || 'finding'}`}
        style={rowStyle}
      >
        <DataTableCell className={`cell-id ${redmineIssueId ? 'has-id' : ''}`} label="ID">
          {redmineIssueId ? `#${redmineIssueId}` : <span className="cell-empty">-</span>}
        </DataTableCell>
        <DataTableCell className="cell-company" label="Company">
          {formatCompanyName(finding)}
        </DataTableCell>
        <DataTableCell className="cell-severity" label="Severity">
          <span className={`severity-badge badge-${severityClass}`}>
            {severity}
          </span>
        </DataTableCell>
        <DataTableCell className="cell-name" label="Name">
          <strong className="cell-name-title">{finding.title || 'Untitled finding'}</strong>
          <small className="cell-name-subtitle">{formatRouteSummary(finding)}</small>
        </DataTableCell>
        <DataTableCell className="cell-finding" label="Finding">
          <FileText size={14} aria-hidden="true" />
          <span>{sourceFindingCount}</span>
        </DataTableCell>
        <DataTableCell className="cell-endpoints" label="Endpoints">
          <Server size={14} aria-hidden="true" />
          <span>{endpointCount || <span className="cell-empty">-</span>}</span>
        </DataTableCell>
        <DataTableCell className="cell-cve-cwe" label="CVEs/CWEs">
          {cveCount > 0 || cweCount > 0 ? (
            <>
              <span className="cve-cwe-tag cve">{cveCount} CVE</span>
              <span className="cve-cwe-separator" aria-hidden="true">·</span>
              <span className="cve-cwe-tag cwe">{cweCount} CWE</span>
            </>
          ) : (
            <span className="cell-empty">-</span>
          )}
        </DataTableCell>
        <DataTableCell className="cell-date" label="Date">
          {finding.date || <span className="cell-empty">-</span>}
        </DataTableCell>
        <DataTableCell className="cell-status" label="Status">
          {findingRedmineSync ? (
            <span className={getRedmineSyncBadgeClass(findingRedmineSync)}>
              {formatFindingTableRedmineStatus(findingRedmineSync)}
            </span>
          ) : (
            <span className={`status-pill status-${statusLabel}`}>
              {displayStatusLabel}
            </span>
          )}
          {user?.role === 'admin' && (
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
              <ExternalLink size={16} />
            </button>
          )}
        </DataTableCell>
      </DataTableRow>
    );
  };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const visibleSeverityOptions = useMemo(
    () => severityOptions.filter(severity => FINDINGS_SEVERITY_FILTERS.includes(severity)),
    [severityOptions]
  );
  const totalSeverityCount = compactedFindingsForSeverity.length;
  const severityFilterOptions = useMemo(() => [
    { value: 'All', label: 'All', count: totalSeverityCount },
    ...visibleSeverityOptions.map(severity => ({
      value: severity,
      label: severity,
      count: compactedSeverityCounts[severity] || 0,
    })),
  ], [compactedSeverityCounts, totalSeverityCount, visibleSeverityOptions]);
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
  const resultCountText = compactedSearchActive
    ? `${displayFindings.length} of ${baseDisplayFindings.length}`
    : `${displayFindings.length}`;
  const emptyMessage = compactedSearchActive
    ? 'No compacted findings match the current search. Try broadening your query.'
    : 'No findings found for the selected filters.';

  const findingsContent = (
    <>
      <SearchOptionsPanel
        bodyId="findings-filter-body"
        open={filterPanelOpen}
        onToggle={() => setFilterPanelOpen(open => !open)}
        resultCount={resultCountText}
        resultIcon={Layers}
        resultLabel={`row${displayFindings.length !== 1 ? 's' : ''}`}
      >
        <SearchOptionsCommandBar>
          <SearchOptionsSearch
            label="Search compacted findings"
            value={compactedSearch}
            onChange={(value) => {
              setPage(1);
              onSearchChange(value);
            }}
            onClear={() => {
              setPage(1);
              onClearSearch();
            }}
            placeholder="Search title, CVE, endpoint, Redmine..."
            showClear={compactedSearchActive}
            kbd="Ctrl K"
          />

          {renderScopeMenu()}
        </SearchOptionsCommandBar>

        <SearchOptionsFilterGroup
          ariaLabel="Filter by severity"
          title="Severity"
          value={activeFilter}
          options={severityFilterOptions}
          onChange={(nextFilter) => {
            setPage(1);
            setActiveFilter(nextFilter);
          }}
        />
      </SearchOptionsPanel>

      {/* ── Findings List ── */}
      <DataTableSection
        ariaLabel="Finding review workspace"
        className="findings-container"
        panelClassName="findings-list-panel"
      >
          <DataTable
            ariaLabel="Compacted findings"
            className="findings-data-table"
            columns={FINDINGS_TABLE_COLUMNS}
            gridTemplate={FINDINGS_TABLE_GRID}
            minWidth="1240px"
            loading={loading}
            empty={(
              <div className="findings-empty" role="status">
                <div className="findings-empty-icon-wrap">
                  <span className="findings-empty-pulse" />
                  <ShieldCheck size={44} />
                </div>
                <h2>No matching findings</h2>
                <p>{emptyMessage}</p>
              </div>
            )}
            footer={!loading && displayFindings.length > 0 && (
              <DataTablePagination
                ariaLabel="Findings pagination"
                currentPage={currentPage}
                firstResult={firstResult}
                lastResult={lastResult}
                onNextPage={() => setPage(Math.min(pageCount, currentPage + 1))}
                onPageSizeChange={(nextPageSize) => {
                  setPageSize(nextPageSize);
                  setPage(1);
                }}
                onPreviousPage={() => setPage(Math.max(1, currentPage - 1))}
                pageCount={pageCount}
                pageSize={pageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                totalRows={totalRows}
              />
            )}
          >
            {displayFindings.length > 0 ? (
              pagedDisplayFindings.map((finding, idx) => (
                renderFindingRowLocal(finding, pageStartIndex + idx)
              ))
            ) : null}
          </DataTable>
      </DataTableSection>
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
      <Topbar
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
