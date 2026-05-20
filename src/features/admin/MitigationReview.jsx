import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, History, Info, RefreshCw, Search, XCircle } from 'lucide-react';
import { apiFetch } from '../../services/api';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const formatDate = (value) => (value ? new Date(value).toLocaleString() : 'Not recorded');

const formatSourceCountLabel = (item) => {
  const count = Number.parseInt(item.findingCount, 10) || (Array.isArray(item.defectdojoFindingIds) ? item.defectdojoFindingIds.length : 0);
  if (count > 1) return `${count} source findings`;
  return '1 source finding';
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

const getSearchText = (item = {}) => [
  item.productName,
  item.productId,
  item.engagementName,
  item.engagementId,
  item.issueId,
  item.endpoint,
  item.compactedTitle,
  item.title,
  item.severity,
  item.redmineStatusName,
  ...toList(item.cveIds || item.cveId),
  ...toList(item.defectdojoFindingIds || item.defectdojoFindingId),
  ...toList(item.endpoints),
].join(' ').toLowerCase();

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
].join(' ').toLowerCase();

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

const getSortValue = (item, key) => {
  if (key === 'product') return `${item.productName || item.productId || ''} ${item.engagementName || item.engagementId || ''}`.toLowerCase();
  if (key === 'finding') return `${item.compactedTitle || item.title || ''}`.toLowerCase();
  if (key === 'endpoint') return `${item.endpoint || ''}`.toLowerCase();
  if (key === 'redmine') return Number.parseInt(item.issueId, 10) || 0;
  if (key === 'mitigated') return item.mitigationConfirmedAt ? new Date(item.mitigationConfirmedAt).getTime() : 0;
  return '';
};

const compareValues = (left, right) => {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
};

const getActionCopy = ({ action, count = 1, item }) => {
  const issueLabel = item?.issueId ? `Redmine Issue #${item.issueId}` : 'this review item';
  const isBulk = !item || count > 1;

  if (action === 'close_redmine') {
    return {
      title: isBulk ? `Close ${count} selected reviews?` : `Close ${issueLabel}?`,
      message: isBulk
        ? 'This will close the selected Redmine issues and mark their grouped mitigation reviews as closed.'
        : 'This will close the Redmine issue and mark every grouped mitigation review as closed.',
      confirmLabel: isBulk ? 'Close Selected' : 'Review & Close',
      confirmClass: 'btn-primary',
    };
  }

  return {
    title: isBulk ? `Ignore ${count} selected reviews?` : `Ignore ${issueLabel}?`,
    message: isBulk
      ? 'This removes the selected items from the pending review queue without closing Redmine issues.'
      : 'This removes the item from the pending review queue without closing the Redmine issue.',
    confirmLabel: isBulk ? 'Ignore Selected' : 'Ignore review',
    confirmClass: 'btn-danger',
  };
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

const SkeletonRows = () => (
  <tbody className="review-skeleton" aria-hidden="true">
    {Array.from({ length: 5 }).map((_, index) => (
      <tr key={index}>
        <td><span className="skeleton-line short" /></td>
        <td><span className="skeleton-line wide" /><span className="skeleton-line short" /></td>
        <td><span className="skeleton-line wide" /><span className="skeleton-line medium" /></td>
        <td><span className="skeleton-line medium" /></td>
        <td><span className="skeleton-line short" /><span className="skeleton-line medium" /></td>
        <td><span className="skeleton-line medium" /></td>
        <td><span className="skeleton-line action" /></td>
      </tr>
    ))}
  </tbody>
);

const SortableHeader = ({ sortKey, sortConfig, onSort, children }) => {
  const active = sortConfig.key === sortKey;
  return (
    <button type="button" className="sortable-header" onClick={() => onSort(sortKey)} aria-sort={active ? sortConfig.direction : 'none'}>
      <span>{children}</span>
      <span className="sort-indicator" aria-hidden="true">{active ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );
};

const MitigationReview = ({ onBack, config = {} }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [sortConfig, setSortConfig] = useState({ key: 'mitigated', direction: 'desc' });
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pendingAction, setPendingAction] = useState(null);
  const [activeView, setActiveView] = useState('queue');
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/admin/mitigation-queue');
      if (res.ok) {
        const data = await res.json();
        const nextItems = Array.isArray(data) ? data : [];
        const nextKeys = new Set(nextItems.map(item => item.reviewKey));
        setItems(nextItems);
        setSelectedKeys(prev => new Set([...prev].filter(key => nextKeys.has(key))));
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiFetch('/admin/mitigation-actions?limit=200');
      if (res.ok) {
        const data = await res.json();
        setHistoryItems(Array.isArray(data) ? data : []);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      fetchQueue();
      fetchHistory();
    });
  }, []);

  const redmineIssueUrl = (item) => item.issueUrl || (item.issueId ? buildUrl(config.redmineUrl, `/issues/${encodeURIComponent(item.issueId)}`) : '');
  const productUrl = (item) => item.productId ? buildUrl(config.defectDojoUrl, `/product/${encodeURIComponent(item.productId)}`) : '';
  const engagementUrl = (item) => item.engagementId ? buildUrl(config.defectDojoUrl, `/engagement/${encodeURIComponent(item.engagementId)}`) : '';

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return items;
    return items.filter(item => getSearchText(item).includes(term));
  }, [items, searchTerm]);

  const sortedItems = useMemo(() => {
    const sorted = [...filteredItems];
    sorted.sort((left, right) => {
      const result = compareValues(getSortValue(left, sortConfig.key), getSortValue(right, sortConfig.key));
      return sortConfig.direction === 'asc' ? result : -result;
    });
    return sorted;
  }, [filteredItems, sortConfig]);

  const filteredHistoryItems = useMemo(() => {
    const term = historySearchTerm.trim().toLowerCase();
    if (!term) return historyItems;
    return historyItems.filter(item => getHistorySearchText(item).includes(term));
  }, [historyItems, historySearchTerm]);

  const pageCount = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = sortedItems.slice(pageStart, pageStart + pageSize);
  const selectedItems = items.filter(item => selectedKeys.has(item.reviewKey));
  const pageKeys = pageItems.map(item => item.reviewKey);
  const selectedPageCount = pageKeys.filter(key => selectedKeys.has(key)).length;
  const allPageSelected = pageKeys.length > 0 && selectedPageCount === pageKeys.length;
  const somePageSelected = selectedPageCount > 0 && !allPageSelected;
  const isBusy = Boolean(busyKey);

  const applyAction = async (item, action) => {
    const res = await apiFetch(`/admin/mitigation-queue/${encodeURIComponent(item.reviewKey)}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });

    if (!res.ok) {
      const data = await res.json();
      return { ok: false, error: data.error || 'Action failed' };
    }

    return { ok: true };
  };

  const runSingleAction = async (item, action) => {
    setBusyKey(item.reviewKey);
    try {
      const result = await applyAction(item, action);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      if (action === 'close_redmine') {
        alert('Redmine issue closed and review marked closed.');
      }
      setSelectedKeys(prev => {
        const next = new Set(prev);
        next.delete(item.reviewKey);
        return next;
      });
      await fetchQueue();
      await fetchHistory();
    } finally {
      setBusyKey('');
    }
  };

  const runBulkAction = async (bulkItems, action) => {
    setBusyKey('bulk');
    const completedKeys = new Set();
    const failures = [];

    try {
      for (const item of bulkItems) {
        const result = await applyAction(item, action);
        if (result.ok) {
          completedKeys.add(item.reviewKey);
        } else {
          failures.push(`#${item.issueId || item.reviewKey}: ${result.error}`);
        }
      }

      setSelectedKeys(prev => new Set([...prev].filter(key => !completedKeys.has(key))));
      await fetchQueue();
      await fetchHistory();

      const actionLabel = action === 'close_redmine' ? 'closed' : 'ignored';
      if (failures.length > 0) {
        alert(`${completedKeys.size} review item(s) ${actionLabel}. ${failures.length} failed:\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? `\n...and ${failures.length - 5} more` : ''}`);
      } else {
        alert(`${completedKeys.size} review item(s) ${actionLabel}.`);
      }
    } finally {
      setBusyKey('');
    }
  };

  const requestConfirmation = (item, action) => {
    setPendingAction({
      type: 'single',
      item,
      items: [item],
      action,
      ...getActionCopy({ action, item }),
    });
  };

  const requestBulkConfirmation = (action) => {
    if (selectedItems.length === 0) return;
    setPendingAction({
      type: 'bulk',
      items: selectedItems,
      action,
      ...getActionCopy({ action, count: selectedItems.length }),
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction.action;
    const actionItems = pendingAction.items;
    const type = pendingAction.type;
    setPendingAction(null);

    if (type === 'bulk') {
      await runBulkAction(actionItems, action);
      return;
    }

    await runSingleAction(actionItems[0], action);
  };

  const toggleSort = (key) => {
    setSortConfig(prev => (
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    ));
  };

  const toggleRowSelection = (key) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePageSelection = () => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageKeys.forEach(key => next.delete(key));
      } else {
        pageKeys.forEach(key => next.add(key));
      }
      return next;
    });
  };

  const updateSearchTerm = (value) => {
    setSearchTerm(value);
    setPage(1);
  };

  const updatePageSize = (value) => {
    setPageSize(Number.parseInt(value, 10) || 25);
    setPage(1);
  };

  const hasNoMatches = !loading && items.length > 0 && sortedItems.length === 0;
  const hasNoItems = !loading && items.length === 0;
  const firstResult = sortedItems.length === 0 ? 0 : pageStart + 1;
  const lastResult = Math.min(pageStart + pageItems.length, sortedItems.length);

  return (
    <div className="review-view">
      <div className="view-toolbar">
        <div>
          <p className="eyebrow">Mitigation Review</p>
          <h1>Resolved Redmine tickets awaiting closure</h1>
        </div>
        <div className="view-toolbar-actions">
          <button type="button" className="btn-secondary" onClick={() => { fetchQueue(); fetchHistory(); }} disabled={loading || historyLoading || isBusy}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Refresh
          </button>
          <button type="button" className="btn-secondary" onClick={onBack}>Back</button>
        </div>
      </div>

      <div className="review-view-tabs" role="tablist" aria-label="Mitigation review pages">
        <button
          type="button"
          className={activeView === 'queue' ? 'active' : ''}
          onClick={() => setActiveView('queue')}
          role="tab"
          aria-selected={activeView === 'queue'}
        >
          <CheckCircle2 size={16} />
          Queue
          <span>{items.length}</span>
        </button>
        <button
          type="button"
          className={activeView === 'history' ? 'active' : ''}
          onClick={() => setActiveView('history')}
          role="tab"
          aria-selected={activeView === 'history'}
        >
          <History size={16} />
          History & Logs
          <span>{historyItems.length}</span>
        </button>
      </div>

      {activeView === 'history' ? (
        <section className="review-history-wrap">
          <div className="review-tools">
            <label className="review-search">
              <span className="sr-only">Search mitigation review history</span>
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={historySearchTerm}
                onChange={(event) => setHistorySearchTerm(event.target.value)}
                placeholder="Search reviewer, issue, product, endpoint, CVE..."
              />
            </label>
            <div className="review-bulk-actions">
              <span>{filteredHistoryItems.length} log{filteredHistoryItems.length !== 1 ? 's' : ''}</span>
              <button type="button" className="btn-secondary" onClick={fetchHistory} disabled={historyLoading}>
                <RefreshCw size={16} className={historyLoading ? 'spin' : ''} />
                Refresh Logs
              </button>
            </div>
          </div>

          {historyLoading && historyItems.length === 0 ? (
            <div className="empty-state compact-empty">
              <RefreshCw size={36} className="empty-state-icon spin" />
              <h2>Loading review logs</h2>
            </div>
          ) : filteredHistoryItems.length === 0 ? (
            <div className="empty-state compact-empty">
              <History size={36} className="empty-state-icon" />
              <h2>No review logs found</h2>
              <p>Closed and ignored mitigation reviews will appear here.</p>
            </div>
          ) : (
            <div className="review-history-list">
              {filteredHistoryItems.map(item => (
                <article key={item.id || `${item.reviewKey}-${item.createdAt}`} className="review-history-card">
                  <div className="review-history-main">
                    <span className={`action-badge ${getActionBadgeClass(item.action)}`}>{getActionLabel(item.action)}</span>
                    <div>
                      <h2>
                        <ExternalAnchor href={redmineIssueUrl(item)}>
                          {item.issueId ? `Redmine #${item.issueId}` : item.title || 'Mitigation review'}
                        </ExternalAnchor>
                      </h2>
                      <p>{item.title || 'No compacted finding title recorded'}</p>
                    </div>
                  </div>
                  <div className="review-history-meta">
                    <span><strong>Reviewer</strong>{item.actor || 'Unknown'} {item.actorRole ? `(${item.actorRole})` : ''}</span>
                    <span><strong>When</strong>{formatDate(item.createdAt)}</span>
                    <span><strong>Product</strong>{item.productName || item.productId || 'Unknown'}</span>
                    <span><strong>Engagement</strong>{item.engagementName || item.engagementId || 'Unknown'}</span>
                    <span><strong>Endpoint</strong>{item.endpoint || 'Not recorded'}</span>
                    <span><strong>CVE</strong>{item.cveId || 'None'}</span>
                  </div>
                  {item.reason && <p className="review-history-reason">{item.reason}</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
      <section className="review-table-wrap">
        <div className="review-tools">
          <label className="review-search">
            <span className="sr-only">Search mitigation reviews</span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => updateSearchTerm(event.target.value)}
              placeholder="Search product, Redmine ID, endpoint, CVE..."
            />
          </label>
          <div className="review-bulk-actions">
            <span>{selectedKeys.size} selected</span>
            <button type="button" className="btn-primary" disabled={selectedKeys.size === 0 || isBusy} onClick={() => requestBulkConfirmation('close_redmine')}>
              Close Selected
            </button>
            <button type="button" className="btn-danger" disabled={selectedKeys.size === 0 || isBusy} onClick={() => requestBulkConfirmation('ignore')}>
              Ignore Selected
            </button>
          </div>
        </div>

        {loading && items.length === 0 && (
          <div className="sr-only" role="status">Loading mitigation reviews</div>
        )}
        {hasNoItems ? (
          <div className="empty-state compact-empty">
            <CheckCircle2 size={40} className="empty-state-icon" />
            <h2>No pending closure reviews</h2>
          </div>
        ) : hasNoMatches ? (
          <div className="empty-state compact-empty">
            <Search size={36} className="empty-state-icon" />
            <h2>No reviews match your search</h2>
          </div>
        ) : (
          <>
            <table className="review-table">
              <thead>
                <tr>
                  <th className="review-select-cell">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = somePageSelected;
                      }}
                      onChange={togglePageSelection}
                      aria-label="Select visible mitigation reviews"
                    />
                  </th>
                  <th><SortableHeader sortKey="product" sortConfig={sortConfig} onSort={toggleSort}>Product</SortableHeader></th>
                  <th><SortableHeader sortKey="finding" sortConfig={sortConfig} onSort={toggleSort}>Compacted Finding</SortableHeader></th>
                  <th><SortableHeader sortKey="endpoint" sortConfig={sortConfig} onSort={toggleSort}>Endpoint</SortableHeader></th>
                  <th><SortableHeader sortKey="redmine" sortConfig={sortConfig} onSort={toggleSort}>Redmine</SortableHeader></th>
                  <th><SortableHeader sortKey="mitigated" sortConfig={sortConfig} onSort={toggleSort}>Mitigated</SortableHeader></th>
                  <th>Actions</th>
                </tr>
              </thead>
              {loading && items.length === 0 ? (
                <SkeletonRows />
              ) : (
                <tbody>
                  {pageItems.map(item => (
                    <tr key={item.reviewKey}>
                      <td className="review-select-cell">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(item.reviewKey)}
                          onChange={() => toggleRowSelection(item.reviewKey)}
                          aria-label={`Select ${item.compactedTitle || item.title || item.issueId || 'review item'}`}
                        />
                      </td>
                      <td>
                        <div className="review-cell-stack">
                          <strong>
                            <ExternalAnchor href={productUrl(item)}>
                              {item.productName || item.productId || 'Unknown'}
                            </ExternalAnchor>
                          </strong>
                          <span>
                            <ExternalAnchor href={engagementUrl(item)} className="muted">
                              {item.engagementName || item.engagementId || 'No engagement'}
                            </ExternalAnchor>
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong>
                          <ExternalAnchor href={redmineIssueUrl(item)}>
                            {item.compactedTitle || item.title || 'Compacted finding'}
                          </ExternalAnchor>
                        </strong>
                        <span>{formatSourceCountLabel(item)} · {item.severity || 'Info'}</span>
                      </td>
                      <td>{item.endpoint || 'Unknown'}</td>
                      <td>
                        <strong>
                          <ExternalAnchor href={redmineIssueUrl(item)}>
                            #{item.issueId || 'Unknown'}
                          </ExternalAnchor>
                        </strong>
                        <span>{item.redmineStatusName || 'Resolve'}</span>
                      </td>
                      <td>{formatDate(item.mitigationConfirmedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn-primary" disabled={busyKey === item.reviewKey || busyKey === 'bulk'} onClick={() => requestConfirmation(item, 'close_redmine')}>
                            Review & Close
                          </button>
                          <button type="button" className="icon-btn danger-icon" disabled={busyKey === item.reviewKey || busyKey === 'bulk'} onClick={() => requestConfirmation(item, 'ignore')} aria-label="Ignore review">
                            <XCircle size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
            <div className="review-pagination">
              <span>Showing {firstResult}-{lastResult} of {sortedItems.length}</span>
              <label className="review-page-size">
                <span>Rows</span>
                <select value={pageSize} onChange={(event) => updatePageSize(event.target.value)}>
                  {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <div className="review-page-controls">
                <button type="button" className="btn-secondary" disabled={currentPage <= 1} onClick={() => setPage(prev => Math.max(1, prev - 1))}>Previous</button>
                <span>Page {currentPage} of {pageCount}</span>
                <button type="button" className="btn-secondary" disabled={currentPage >= pageCount} onClick={() => setPage(prev => Math.min(pageCount, prev + 1))}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>
      )}

      {pendingAction && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-content review-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="review-confirm-title">
            <div className="modal-header">
              <div className="modal-title-row">
                <h2 id="review-confirm-title" className="modal-heading-with-icon">
                  <Info size={18} />
                  {pendingAction.title}
                </h2>
                <button type="button" className="icon-btn" onClick={() => setPendingAction(null)} aria-label="Cancel review action">
                  <XCircle size={16} />
                </button>
              </div>
              <p className="modal-subtitle">{pendingAction.message}</p>
            </div>
            <div className="finding-meta-grid">
              <div className="meta-item"><span className="meta-label">Selected</span><span className="meta-value">{pendingAction.items.length}</span></div>
              <div className="meta-item"><span className="meta-label">Action</span><span className="meta-value">{pendingAction.confirmLabel}</span></div>
              {pendingAction.type === 'single' && (
                <>
                  <div className="meta-item"><span className="meta-label">Issue</span><span className="meta-value">#{pendingAction.item.issueId || 'Unknown'}</span></div>
                  <div className="meta-item"><span className="meta-label">Finding</span><span className="meta-value">{pendingAction.item.compactedTitle || pendingAction.item.title || 'Compacted finding'}</span></div>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setPendingAction(null)}>Cancel</button>
              <button type="button" className={pendingAction.confirmClass} onClick={confirmPendingAction} disabled={isBusy}>
                {pendingAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MitigationReview;
