import { useMemo, useState } from 'react';
import {
  Filter,
  Layers,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader, PageMain } from '../../shared/ui/Page';
import { DataTable, DataTablePagination, DataTableSection } from '../../shared/ui/DataTable/DataTable';
import {
  SearchOptionsCommandBar,
  SearchOptionsFilterButton,
  SearchOptionsFilterGroup,
  SearchOptionsPanel,
  SearchOptionsResultCount,
  SearchOptionsSearch,
} from '../../shared/ui/SearchOptions/SearchOptions';
import './FindingsPage.css';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const DEFAULT_PAGE_SIZE = 10;
const FINDINGS_SEVERITY_FILTERS = ['Critical', 'High', 'Medium', 'Low'];
const FINDINGS_TABLE_COLUMNS = ['ID', 'Company', 'Severity', 'Name', 'Finding', 'Endpoints', 'CVEs/CWEs', 'Date', 'Status'];
const FINDINGS_TABLE_GRID = '88px 156px 104px minmax(240px, 1.8fr) 104px 112px 148px 116px 168px';

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
  const visibleSeverityOptions = useMemo(
    () => severityOptions.filter(severity => FINDINGS_SEVERITY_FILTERS.includes(severity)),
    [severityOptions]
  );
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

          <SearchOptionsResultCount
            icon={Layers}
            value={resultCountText}
            label={`row${displayFindings.length !== 1 ? 's' : ''}`}
          />
        </SearchOptionsCommandBar>

        <SearchOptionsFilterGroup ariaLabel="Filter by severity" title="Severity" total={`${totalSeverityCount} total`}>
          <SearchOptionsFilterButton
            active={activeFilter === 'All'}
            count={totalSeverityCount}
            icon={Filter}
            label="All"
            onClick={() => {
              setPage(1);
              setActiveFilter('All');
            }}
            tone="all"
          />
          {visibleSeverityOptions.map(severity => {
            const count = compactedSeverityCounts[severity] || 0;
            return (
              <SearchOptionsFilterButton
                key={severity}
                active={activeFilter === severity}
                count={count}
                label={severity}
                meterPercent={getSeverityPercent(count)}
                onClick={() => {
                  setPage(1);
                  setActiveFilter(severity);
                }}
                tone={severity.toLowerCase()}
              />
            );
          })}
        </SearchOptionsFilterGroup>
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
            footer={displayFindings.length > 0 && (
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
                renderFindingRow(finding, pageStartIndex + idx)
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
