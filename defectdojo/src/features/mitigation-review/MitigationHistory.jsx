import { useMemo, useState } from 'react';
import { ExternalLink, History, RefreshCw, Search } from 'lucide-react';
import { DataTable, DataTableCell, DataTablePagination, DataTableRow, DataTableSection } from '../../shared/ui/DataTable/DataTable';
import {
  SearchOptionsCommandBar,
  SearchOptionsPanel,
  SearchOptionsSearch,
} from '../../shared/ui/SearchOptions/SearchOptions';
import ModalDetails from './HistoryModalDetails';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const formatDate = (value) => (
  value
    ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : 'Not recorded'
);

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

const getHistorySearchText = (item = {}) => [
  item.action,
  item.actor,
  item.actorRole,
  item.productName,
  item.productId,
  item.engagementName,
  item.engagementId,
  item.issueId,
  item.ticketKey,
  item.reviewKey,
  item.title,
  item.endpoint,
  item.severity,
  item.cveId,
  item.defectdojoFindingId,
  item.reason,
  ...toList(item.cveIds),
  ...toList(item.defectdojoFindingIds),
  ...toList(item.endpoints),
].join(' ').toLowerCase();

const getSortValue = (item, key) => {
  if (key === 'product') return `${item.productName || item.productId || ''} ${item.engagementName || item.engagementId || ''}`.toLowerCase();
  if (key === 'finding') return `${item.title || ''}`.toLowerCase();
  if (key === 'redmine') return Number.parseInt(item.issueId, 10) || 0;
  if (key === 'foundDate') return item.createdAt ? new Date(item.createdAt).getTime() : 0;
  if (key === 'mitigateDate') return item.mitigationConfirmedAt ? new Date(item.mitigationConfirmedAt).getTime() : 0;
  return '';
};

const compareValues = (left, right) => {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
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

const DEFAULT_SORT_CONFIG = { key: 'foundDate', direction: 'desc' };

const MitigationHistory = ({ historyItems, loading, fetchHistory, config = {} }) => {
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyFilterPanelOpen, setHistoryFilterPanelOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);

  const redmineIssueUrl = (item) => item.issueUrl || (item.issueId ? buildUrl(config.redmineUrl, `/issues/${encodeURIComponent(item.issueId)}`) : '');
  const productUrl = (item) => item.productId ? buildUrl(config.defectDojoUrl, `/product/${encodeURIComponent(item.productId)}`) : '';
  const engagementUrl = (item) => item.engagementId ? buildUrl(config.defectDojoUrl, `/engagement/${encodeURIComponent(item.engagementId)}`) : '';

  const filteredHistoryItems = useMemo(() => {
    const term = historySearchTerm.trim().toLowerCase();
    if (!term) return historyItems;
    return historyItems.filter(item => getHistorySearchText(item).includes(term));
  }, [historyItems, historySearchTerm]);

  const sortedHistoryItems = useMemo(() => {
    const sorted = [...filteredHistoryItems];
    sorted.sort((left, right) => {
      const result = compareValues(getSortValue(left, DEFAULT_SORT_CONFIG.key), getSortValue(right, DEFAULT_SORT_CONFIG.key));
      return DEFAULT_SORT_CONFIG.direction === 'asc' ? result : -result;
    });
    return sorted;
  }, [filteredHistoryItems]);

  const pageCount = Math.max(1, Math.ceil(sortedHistoryItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = sortedHistoryItems.slice(pageStart, pageStart + pageSize);

  const updateSearchTerm = (value) => {
    setHistorySearchTerm(value);
    setPage(1);
  };

  const updatePageSize = (value) => {
    setPageSize(Number.parseInt(value, 10) || 25);
    setPage(1);
  };

  const hasNoMatches = !loading && historyItems.length > 0 && sortedHistoryItems.length === 0;
  const hasNoItems = !loading && historyItems.length === 0;
  const firstResult = sortedHistoryItems.length === 0 ? 0 : pageStart + 1;
  const lastResult = Math.min(pageStart + pageItems.length, sortedHistoryItems.length);

  return (
    <section className="review-queue-wrap">
      <SearchOptionsPanel
        bodyId="mitigation-review-history-filter"
        open={historyFilterPanelOpen}
        onToggle={() => setHistoryFilterPanelOpen(open => !open)}
        resultCount={`${sortedHistoryItems.length}`}
        resultIcon={History}
        resultLabel={`log${sortedHistoryItems.length !== 1 ? 's' : ''}`}
        title="Search Options"
      >
        <SearchOptionsCommandBar>
          <SearchOptionsSearch
            inputType="text"
            label="Search mitigation review history"
            value={historySearchTerm}
            onChange={updateSearchTerm}
            onClear={() => updateSearchTerm('')}
            placeholder="Search reviewer, issue, product, endpoint, CVE..."
            showClear={Boolean(historySearchTerm)}
          />
          <div style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={fetchHistory}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Refresh Logs
            </button>
          </div>
        </SearchOptionsCommandBar>
      </SearchOptionsPanel>

      {loading && historyItems.length === 0 ? (
        <div className="empty-state compact-empty">
          <RefreshCw size={36} className="empty-state-icon spin" />
          <h2>Loading review logs</h2>
        </div>
      ) : hasNoItems ? (
        <div className="empty-state compact-empty">
          <History size={36} className="empty-state-icon" />
          <h2>No review logs found</h2>
          <p>Closed and ignored mitigation reviews will appear here.</p>
        </div>
      ) : hasNoMatches ? (
        <div className="empty-state compact-empty">
          <Search size={36} className="empty-state-icon" />
          <h2>No review logs match your search</h2>
        </div>
      ) : (
        <DataTableSection
          ariaLabel="Mitigation review history logs workspace"
          className="findings-container"
          panelClassName="findings-list-panel"
        >
          <DataTable
            ariaLabel="Mitigation review history logs"
            className="review-data-table findings-data-table"
            columns={['ID', 'Company', 'Severity', 'Name', 'Found Date', 'Mitigate Date', 'Actions']}
            gridTemplate="88px 156px 104px minmax(240px, 1.8fr) 128px 128px 100px"
            minWidth="1240px"
            loading={loading}
            empty={
              <div className="empty-state compact-empty">
                <h2>No review logs</h2>
              </div>
            }
            footer={
              !loading && sortedHistoryItems.length > 0 && (
                <DataTablePagination
                  ariaLabel="Mitigation review history pagination"
                  currentPage={currentPage}
                  firstResult={firstResult}
                  lastResult={lastResult}
                  itemLabel="log"
                  onNextPage={() => setPage(Math.min(pageCount, currentPage + 1))}
                  onPageSizeChange={(nextPageSize) => {
                    updatePageSize(nextPageSize);
                  }}
                  onPreviousPage={() => setPage(Math.max(1, currentPage - 1))}
                  pageCount={pageCount}
                  pageSize={pageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  totalRows={sortedHistoryItems.length}
                />
              )
            }
          >
            {pageItems.map((item, idx) => (
              <DataTableRow
                key={item.id || `${item.reviewKey}-${item.createdAt}`}
                className="review-row findings-table-row findings-card-enter"
                tone={(item.severity || 'Info').toLowerCase()}
                style={{ animationDelay: `${Math.min(idx * 40, 600)}ms` }}
              >
                <DataTableCell className={`cell-id ${item.issueId ? 'has-id' : ''}`} label="ID">
                  {item.issueId ? (
                    <ExternalAnchor href={redmineIssueUrl(item)}>
                      #{item.issueId}
                    </ExternalAnchor>
                  ) : (
                    <span className="cell-empty">-</span>
                  )}
                </DataTableCell>
                <DataTableCell className="cell-company" label="Company" title={item.productName || item.productId || 'Unknown'}>
                  <ExternalAnchor href={productUrl(item)}>
                    {item.productName || item.productId || 'Unknown'}
                  </ExternalAnchor>
                </DataTableCell>
                <DataTableCell className="cell-severity" label="Severity">
                  <span className={`severity-badge badge-${(item.severity || 'Info').toLowerCase()}`}>
                    {item.severity || 'Info'}
                  </span>
                </DataTableCell>
                <DataTableCell className="cell-name" label="Name" title={`${item.title || 'Compacted finding'} — ${item.engagementName || item.engagementId || 'No engagement'}`}>
                  <strong className="cell-name-title">
                    <ExternalAnchor>
                      {item.title || 'Compacted finding'}
                    </ExternalAnchor>
                  </strong>
                  <small className="cell-name-subtitle">
                    <ExternalAnchor href={engagementUrl(item)} className="muted">
                      {item.engagementName || item.engagementId || 'No engagement'}
                    </ExternalAnchor>
                  </small>
                </DataTableCell>
                <DataTableCell className="cell-date" label="Found Date" title={formatDate(item.createdAt)}>
                  {formatDate(item.createdAt)}
                </DataTableCell>
                <DataTableCell className="cell-date" label="Mitigate Date" title={formatDate(item.mitigationConfirmedAt)}>
                  {formatDate(item.mitigationConfirmedAt)}
                </DataTableCell>
                <DataTableCell className="cell-status" label="Actions" style={{ justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setSelectedHistoryItem(item)}
                    title="View Action Details"
                    aria-label="View Action Details"
                    style={{
                      width: '2.35rem',
                      height: '2.35rem',
                      padding: 0,
                      borderRadius: '0.55rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Search size={16} />
                  </button>
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTable>
        </DataTableSection>
      )}

      {selectedHistoryItem && (
        <ModalDetails
          item={selectedHistoryItem}
          onClose={() => setSelectedHistoryItem(null)}
          config={config}
        />
      )}
    </section>
  );
};

export default MitigationHistory;
