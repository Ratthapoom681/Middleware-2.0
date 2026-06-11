import { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, History, Layers, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../shared/api/api';
import { PageHeader, PageMain } from '../../shared/ui/Page';
import { DataTable, DataTableCell, DataTablePagination, DataTableRow, DataTableSection } from '../../shared/ui/DataTable/DataTable';
import {
  SearchOptionsCommandBar,
  SearchOptionsFilterButton,
  SearchOptionsFilterGroup,
  SearchOptionsPanel,
  SearchOptionsResultCount,
  SearchOptionsSearch,
} from '../../shared/ui/SearchOptions/SearchOptions';
import ModalPopupDetails from './ModalPopupDetails';
import './SyncHistory.css';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 10;
const SYNC_HISTORY_COLUMNS = ['ID', 'Number', 'Company', 'Scope', 'Finding', 'Status', 'Date/Time'];
const SYNC_HISTORY_GRID = '88px 96px minmax(170px, 1fr) minmax(170px, 1.05fr) 108px 128px 188px';
const FINDING_SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const STATUS_FILTERS = [
  { id: 'all', label: 'All', tone: 'all' },
  { id: 'success', label: 'Success', tone: 'low' },
  { id: 'partial', label: 'Partial', tone: 'medium' },
  { id: 'failed', label: 'Failed', tone: 'critical' },
];

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeStatus = (value) => cleanText(value).toLowerCase().replace(/[_-]+/g, ' ');

const getStatusFilter = (status) => {
  const normalized = normalizeStatus(status);
  if (['success', 'succeeded', 'complete', 'completed'].includes(normalized)) return 'success';
  if (['failed', 'failure', 'error'].includes(normalized)) return 'failed';
  if (['partial', 'warning', 'warnings'].includes(normalized)) return 'partial';
  return normalized || 'partial';
};

const formatStatusLabel = (status) => {
  const cleaned = cleanText(status);
  if (!cleaned) return 'Partial';
  return cleaned
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
};

const formatSyncDateTime = (value) => {
  const cleaned = cleanText(value);
  if (!cleaned) return '';
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return cleaned;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const getRowTimestamp = (row = {}) => {
  const timestamp = Date.parse(row.finishedAt || row.startedAt || row.createdAt || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const getScopeKey = (row = {}) => [
  cleanText(row.productId) || cleanText(row.productName),
  cleanText(row.engagementId) || cleanText(row.engagementName),
].join('|').toLowerCase();

const toCount = (value) => {
  const count = Number.parseInt(value, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
};

const getPulledSeverityCount = (row = {}, severity) => (
  toCount(row.severityBreakdown?.pulled?.[severity])
);

const createEmptySeverityDelta = () => Object.fromEntries(FINDING_SEVERITIES.map(severity => [severity, 0]));

const buildFindingDeltaMap = (rows = []) => {
  const rowsByScope = new Map();

  rows.forEach(row => {
    if (!row.complete) return;
    const scopeKey = getScopeKey(row);
    if (!rowsByScope.has(scopeKey)) rowsByScope.set(scopeKey, []);
    rowsByScope.get(scopeKey).push(row);
  });

  const deltaById = new Map();
  rowsByScope.forEach(scopeRows => {
    scopeRows
      .slice()
      .sort((left, right) => getRowTimestamp(left) - getRowTimestamp(right) || Number(left.id || 0) - Number(right.id || 0))
      .forEach((row, index, orderedRows) => {
        const previousRow = index > 0 ? orderedRows[index - 1] : null;
        const severityDelta = FINDING_SEVERITIES.reduce((acc, severity) => {
          const currentPulled = getPulledSeverityCount(row, severity);
          const previousPulled = previousRow ? getPulledSeverityCount(previousRow, severity) : 0;
          acc[severity] = Math.max(0, currentPulled - previousPulled);
          return acc;
        }, createEmptySeverityDelta());
        const total = FINDING_SEVERITIES.reduce((sum, severity) => sum + severityDelta[severity], 0);
        deltaById.set(row.id, { total, severityDelta });
      });
  });

  return deltaById;
};

const normalizeHistoryRow = (row = {}, index = 0) => {
  const company = cleanText(row.productName) || cleanText(row.productId);
  const scope = cleanText(row.engagementName) || cleanText(row.engagementId);
  const number = cleanText(row.productRunNumber) || String(index + 1);
  const dateTime = formatSyncDateTime(row.finishedAt || row.startedAt || row.createdAt);
  const status = cleanText(row.status) || 'partial';

  return {
    ...row,
    company,
    scope,
    number,
    dateTime,
    status,
    statusFilter: getStatusFilter(status),
    complete: Boolean(company && scope),
  };
};

const getSearchText = (row) => [
  row.id,
  row.number,
  row.company,
  row.scope,
  row.findingLabel,
  row.status,
  row.dateTime,
].map(cleanText).join(' ').toLowerCase();

const SyncHistory = ({ onBack }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterPanelOpen, setFilterPanelOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedFindingRow, setSelectedFindingRow] = useState(null);

  const fetchSyncHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/sync-history?limit=200');
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(data.error || data.details || 'Failed to load sync history.');
      }
      setRows(Array.isArray(data) ? data : []);
      setPage(1);
    } catch (err) {
      setError(err.message || 'Failed to load sync history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(fetchSyncHistory);
  }, [fetchSyncHistory]);

  useEffect(() => {
    if (!selectedFindingRow) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedFindingRow(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFindingRow]);

  const normalizedRows = useMemo(
    () => rows.map((row, index) => normalizeHistoryRow(row, index)),
    [rows]
  );
  const visibleRows = useMemo(
    () => normalizedRows.filter(row => row.complete),
    [normalizedRows]
  );
  const findingDeltaById = useMemo(
    () => buildFindingDeltaMap(visibleRows),
    [visibleRows]
  );
  const visibleRowsWithFindingDelta = useMemo(
    () => visibleRows.map(row => {
      const delta = findingDeltaById.get(row.id) || { total: 0, severityDelta: createEmptySeverityDelta() };
      const newFindingCount = delta.total || 0;
      return {
        ...row,
        newFindingCount,
        severityDelta: delta.severityDelta || createEmptySeverityDelta(),
        findingLabel: `${newFindingCount} new`,
      };
    }),
    [findingDeltaById, visibleRows]
  );
  const hiddenIncompleteCount = normalizedRows.length - visibleRows.length;

  const statusCounts = useMemo(() => {
    const counts = { all: visibleRowsWithFindingDelta.length, success: 0, partial: 0, failed: 0 };
    visibleRowsWithFindingDelta.forEach(row => {
      if (counts[row.statusFilter] !== undefined) counts[row.statusFilter] += 1;
    });
    return counts;
  }, [visibleRowsWithFindingDelta]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return visibleRowsWithFindingDelta.filter(row => {
      const matchesStatus = statusFilter === 'all' || row.statusFilter === statusFilter;
      const matchesSearch = !query || getSearchText(row).includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [searchQuery, statusFilter, visibleRowsWithFindingDelta]);

  const filterActive = Boolean(searchQuery.trim()) || statusFilter !== 'all';
  const resultCountText = filterActive ? `${filteredRows.length} of ${visibleRowsWithFindingDelta.length}` : `${filteredRows.length}`;
  const getFilterPercent = (count) => (
    visibleRowsWithFindingDelta.length > 0 ? Math.max(4, Math.round((count / visibleRowsWithFindingDelta.length) * 100)) : 0
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStartIndex = (currentPage - 1) * pageSize;
  const firstResult = filteredRows.length === 0 ? 0 : pageStartIndex + 1;
  const lastResult = Math.min(filteredRows.length, pageStartIndex + pageSize);
  const pagedRows = filteredRows.slice(pageStartIndex, pageStartIndex + pageSize);

  const emptyMessage = filterActive
    ? 'No complete sync history rows match the current search and filters.'
    : hiddenIncompleteCount > 0
      ? 'No complete sync history rows are available yet.'
      : 'No sync history rows are available yet.';

  return (
    <>
      <PageHeader
        icon={History}
        eyebrow="Administration"
        title="Sync History"
        description="Check DefectDojo to middleware sync results and verify pulled data by company and scope."
        actions={(
          <>
            {onBack && (
              <button type="button" className="btn-secondary" onClick={onBack}>
                Back to dashboard
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={fetchSyncHistory} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </>
        )}
      />

      <PageMain className="sync-history-main">
        <SearchOptionsPanel
          bodyId="sync-history-filter-body"
          open={filterPanelOpen}
          onToggle={() => setFilterPanelOpen(open => !open)}
        >
          <SearchOptionsCommandBar className="sync-history-command-bar">
            <SearchOptionsSearch
              inputType="text"
              label="Search sync history"
              value={searchQuery}
              onChange={(value) => {
                setSearchQuery(value);
                setPage(1);
              }}
              onClear={() => {
                setSearchQuery('');
                setPage(1);
              }}
              placeholder="Search ID, company, scope, status, or time..."
              showClear={Boolean(searchQuery)}
            />

            <SearchOptionsResultCount
              icon={Layers}
              value={resultCountText}
              label={`row${filteredRows.length !== 1 ? 's' : ''}`}
            />

            {hiddenIncompleteCount > 0 && (
              <span className="sync-history-hidden-warning" role="status">
                {hiddenIncompleteCount} incomplete history row{hiddenIncompleteCount === 1 ? '' : 's'} hidden
              </span>
            )}
          </SearchOptionsCommandBar>

          <SearchOptionsFilterGroup ariaLabel="Filter sync history by status" title="Status" total={`${visibleRowsWithFindingDelta.length} total`}>
            {STATUS_FILTERS.map(filter => (
              <SearchOptionsFilterButton
                key={filter.id}
                active={statusFilter === filter.id}
                count={statusCounts[filter.id] || 0}
                icon={filter.id === 'all' ? Filter : undefined}
                label={filter.label}
                meterPercent={getFilterPercent(statusCounts[filter.id] || 0)}
                onClick={() => {
                  setStatusFilter(filter.id);
                  setPage(1);
                }}
                tone={filter.tone}
              />
            ))}
          </SearchOptionsFilterGroup>
        </SearchOptionsPanel>

        {error && (
          <div className="sync-history-error" role="alert">
            {error}
          </div>
        )}

        <DataTableSection
          ariaLabel="Sync history workspace"
          className="sync-history-table-section"
          panelClassName="sync-history-table-panel"
        >
          <DataTable
            ariaLabel="Sync history"
            className="sync-history-data-table"
            columns={SYNC_HISTORY_COLUMNS}
            gridTemplate={SYNC_HISTORY_GRID}
            minWidth="880px"
            loading={loading}
            empty={(
              <div className="sync-history-empty" role="status">
                <h2>No sync history rows</h2>
                <p>{emptyMessage}</p>
              </div>
            )}
            footer={!loading && filteredRows.length > 0 && (
              <DataTablePagination
                ariaLabel="Sync history pagination"
                currentPage={currentPage}
                firstResult={firstResult}
                lastResult={lastResult}
                itemLabel="row"
                onNextPage={() => setPage(Math.min(pageCount, currentPage + 1))}
                onPageSizeChange={(nextPageSize) => {
                  setPageSize(nextPageSize);
                  setPage(1);
                }}
                onPreviousPage={() => setPage(Math.max(1, currentPage - 1))}
                pageCount={pageCount}
                pageSize={pageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                totalRows={filteredRows.length}
              />
            )}
          >
            {pagedRows.map(row => (
              <DataTableRow
                key={row.id}
                className="sync-history-row"
                tone={row.statusFilter === 'failed' ? 'critical' : row.statusFilter === 'partial' ? 'medium' : 'low'}
                interactive
                onClick={() => setSelectedFindingRow(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedFindingRow(row);
                  }
                }}
                ariaLabel={`Show new finding details for ${row.company} ${row.scope}`}
              >
                <DataTableCell className="sync-history-cell-id" label="ID">
                  {row.id}
                </DataTableCell>
                <DataTableCell className="sync-history-cell-number" label="Number">
                  {row.number}
                </DataTableCell>
                <DataTableCell className="sync-history-cell-company" label="Company">
                  {row.company}
                </DataTableCell>
                <DataTableCell className="sync-history-cell-scope" label="Scope">
                  {row.scope}
                </DataTableCell>
                <DataTableCell className="sync-history-cell-finding" label="Finding">
                  <span className={row.newFindingCount > 0 ? 'sync-history-finding-count has-new' : 'sync-history-finding-count'}>
                    {row.findingLabel}
                  </span>
                </DataTableCell>
                <DataTableCell className="sync-history-cell-status" label="Status">
                  <span className={`sync-history-status ${row.statusFilter}`}>
                    {formatStatusLabel(row.status)}
                  </span>
                </DataTableCell>
                <DataTableCell className="sync-history-cell-date" label="Date/Time">
                  {row.dateTime}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTable>
        </DataTableSection>
      </PageMain>

      {selectedFindingRow && (
        <ModalPopupDetails
          row={selectedFindingRow}
          onClose={() => setSelectedFindingRow(null)}
        />
      )}
    </>
  );
};

export default SyncHistory;
  