import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, AlertTriangle, BarChart3, Bug, CalendarDays, Check, CheckCircle2, ChevronDown, Clock, History, Search, Ticket, X, XCircle } from 'lucide-react';
import { apiFetch } from '../../shared/api/api';
import { PageHeader, PageMain } from '../../shared/ui/Page';
import '../findings/FindingsPage.css';
import './SyncHistory.css';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];
const METRICS = [
  ['findingsPulled', 'Findings pulled'],
  ['findingsMitigated', 'Mitigated'],
  ['findingsStillActive', 'Still active'],
  ['ticketsPulled', 'Tickets pulled'],
  ['findingsUpdated', 'Findings updated'],
  ['ticketsUpdated', 'Tickets updated'],
];
const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
];

const formatDate = (value) => (value ? new Date(value).toLocaleString() : 'Not finished');
const toNumber = (value) => Number.parseInt(value, 10) || 0;

const getRunTime = (item) => new Date(item.startedAt || item.createdAt || 0).getTime();

const getProductScopeName = (item) => item?.productName || item?.productId || 'All products';

const getGlobalRunLabel = (item) => (item?.id ? `Global #${item.id}` : 'Global run');

const getRunLabel = (item) => {
  if (!item) return 'Product run';
  const runNumber = Number.parseInt(item.productRunNumber, 10);
  if (Number.isInteger(runNumber) && runNumber > 0) {
    return `${getProductScopeName(item)} Run #${runNumber}`;
  }
  return item.id ? `Run #${item.id}` : 'Product run';
};

const getRunPositionLabel = (item) => {
  const runCount = Number.parseInt(item?.productRunCount, 10);
  return Number.isInteger(runCount) && runCount > 0
    ? `${getRunLabel(item)} of ${runCount}`
    : getRunLabel(item);
};

const getRunScopeLabel = (item) => (
  `${item?.syncType || 'Sync'} · ${getProductScopeName(item)} / ${item?.engagementName || item?.engagementId || 'All engagements'}`
);

const getRunCompareKey = (item) => [
  item?.syncType || '',
  item?.productId || item?.productName || '',
  item?.engagementId || item?.engagementName || '',
].join('|');

const isComparableRun = (left, right) => (
  Boolean(left && right)
  && left.id !== right.id
  && getRunCompareKey(left) === getRunCompareKey(right)
);

const getDateGroupLabel = (value) => {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDate) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const normalizeBreakdown = (item, section) => item?.severityBreakdown?.[section] || {};

const getBreakdownTotal = (item, section) => (
  SEVERITIES.reduce((sum, severity) => sum + toNumber(normalizeBreakdown(item, section)[severity]), 0)
);

const deltaLabel = (value) => {
  if (value > 0) return `+${value}`;
  return String(value);
};

const deltaClass = (value) => (
  value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
);

const getProductValue = (item) => String(item?.productId || item?.productName || '');
const getEngagementValue = (item) => String(item?.engagementId || item?.engagementName || '');

const getHistorySearchText = (item = {}) => [
  item.id,
  item.syncType,
  item.status,
  item.triggeredBy,
  item.productRunNumber,
  item.productRunCount,
  item.productId,
  item.productName,
  item.engagementId,
  item.engagementName,
  item.findingsPulled,
  item.findingsMitigated,
  item.findingsStillActive,
  item.ticketsPulled,
  item.findingsUpdated,
  item.ticketsUpdated,
  ...(item.warnings || []),
  ...(item.errors || []),
].join(' ').toLowerCase();

const MetricDelta = ({ label, before, after }) => {
  const delta = toNumber(after) - toNumber(before);
  return (
    <div className="sh-delta-card">
      <span>{label}</span>
      <strong>{toNumber(before)} → {toNumber(after)}</strong>
      <b className={`sh-delta ${deltaClass(delta)}`}>{deltaLabel(delta)}</b>
    </div>
  );
};

const SeverityBreakdown = ({ before, after, section, title }) => {
  const beforeData = normalizeBreakdown(before, section);
  const afterData = normalizeBreakdown(after, section);
  const total = getBreakdownTotal(after, section);
  const hasData = getBreakdownTotal(before, section) > 0 || total > 0;

  return (
    <section className="sh-severity-breakdown">
      <h3>{title}</h3>
      {!hasData ? (
        <p className="detail-empty-text">No severity breakdown recorded.</p>
      ) : (
        <>
          <div className="sh-severity-bar">
            {SEVERITIES.map(severity => {
              const value = toNumber(afterData[severity]);
              if (value === 0) return null;
              const percent = (value / (total || 1)) * 100;
              return (
                <div
                  key={severity}
                  className={`sh-severity-bar-seg bg-${severity.toLowerCase()}`}
                  style={{ width: `${percent}%` }}
                  title={`${severity}: ${value}`}
                />
              );
            })}
          </div>
          <div className="sh-severity-grid">
            {SEVERITIES.map(severity => {
              const beforeValue = toNumber(beforeData[severity]);
              const afterValue = toNumber(afterData[severity]);
              const delta = afterValue - beforeValue;
              return (
                <div key={severity} className="sh-severity-item">
                  <span className={`severity-badge badge-${severity.toLowerCase()}`}>{severity}</span>
                  <strong>{beforeValue} → {afterValue}</strong>
                  <b className={`sh-delta ${deltaClass(delta)}`}>{deltaLabel(delta)}</b>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
};

const AutoComparePanel = ({ before, after }) => (
  <section className="sh-auto-compare">
    <div className="sh-section-title-row">
      <div>
        <p className="eyebrow">Auto Compare</p>
        <h3>{getRunLabel(before)} → {getRunLabel(after)}</h3>
      </div>
      <span className="sh-muted">{getRunScopeLabel(after)}</span>
    </div>
    <div className="sh-delta-grid compact">
      {METRICS.map(([key, label]) => (
        <MetricDelta key={key} label={label} before={before[key]} after={after[key]} />
      ))}
    </div>
    <SeverityBreakdown before={before} after={after} section="pulled" title="Pulled severity delta" />
  </section>
);

const SyncHistoryDetailModal = ({ selected, autoCompareItems, onClose }) => {
  if (!selected) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal-content sh-detail-modal" role="dialog" aria-modal="true" aria-labelledby="sh-detail-title" onClick={event => event.stopPropagation()}>
        <div className="modal-title-row">
          <div>
            <p className="eyebrow">Sync Run Details</p>
            <h2 id="sh-detail-title" className="modal-heading-with-icon">{selected.syncType}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close sync run details">
            <XCircle size={16} />
          </button>
        </div>

        <div className="sh-detail-body">
          <div className="detail-status-row">
            <span className={`sh-status-pill ${selected.status}`}>{selected.status}</span>
            <span className="sh-run-badge">{getRunLabel(selected)}</span>
            <span>{selected.triggeredBy || 'system'}</span>
          </div>
          <div className="sh-metrics-grid">
            {METRICS.map(([key, label]) => (
              <span key={key}>{label} <strong>{selected[key] || 0}</strong></span>
            ))}
          </div>
          <div className="finding-meta-grid">
            <div className="meta-item"><span className="meta-label">Started</span><span className="meta-value">{formatDate(selected.startedAt)}</span></div>
            <div className="meta-item"><span className="meta-label">Finished</span><span className="meta-value">{formatDate(selected.finishedAt)}</span></div>
            <div className="meta-item"><span className="meta-label">Product Run</span><span className="meta-value">{getRunPositionLabel(selected)}</span></div>
            <div className="meta-item"><span className="meta-label">Audit ID</span><span className="meta-value">{getGlobalRunLabel(selected)}</span></div>
            <div className="meta-item"><span className="meta-label">Product</span><span className="meta-value">{selected.productName || selected.productId || 'All'}</span></div>
            <div className="meta-item"><span className="meta-label">Engagement</span><span className="meta-value">{selected.engagementName || selected.engagementId || 'All'}</span></div>
          </div>
          {autoCompareItems.length === 2 ? (
            <AutoComparePanel before={autoCompareItems[0]} after={autoCompareItems[1]} />
          ) : (
            <section className="sh-auto-compare muted">
              <div className="sh-section-title-row">
                <div>
                  <p className="eyebrow">Auto Compare</p>
                  <h3>No previous matching run</h3>
                </div>
              </div>
              <p className="detail-empty-text">A previous run with the same sync type, product, and engagement will appear here automatically.</p>
            </section>
          )}
          <SeverityBreakdown before={{}} after={selected} section="pulled" title="Severity pulled" />
          {(selected.warnings?.length > 0 || selected.errors?.length > 0) && (
            <div className="json-container compact">
              <pre>{JSON.stringify({ warnings: selected.warnings, errors: selected.errors }, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SyncHistory = () => {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [datePreset, setDatePreset] = useState('30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productFilters, setProductFilters] = useState([]);
  const [engagementFilters, setEngagementFilters] = useState([]);
  const [compareIds, setCompareIds] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [scopeSearch, setScopeSearch] = useState('');
  const scopeMenuRef = useRef(null);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/sync-history?limit=100');
      if (res.ok) {
        const data = await res.json();
        const nextItems = Array.isArray(data) ? data : [];
        const nextIds = new Set(nextItems.map(item => item.id));
        setItems(nextItems);
        setSelected(prev => (prev && nextIds.has(prev.id)
          ? nextItems.find(item => item.id === prev.id) || null
          : null));
        setCompareIds(prev => prev.filter(id => nextIds.has(id)));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(fetchHistory);
  }, []);

  useEffect(() => {
    if (!scopeMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (scopeMenuRef.current && !scopeMenuRef.current.contains(event.target)) {
        setScopeMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setScopeMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [scopeMenuOpen]);

  const scopeProducts = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      const value = getProductValue(item);
      if (!value) return;
      const previous = map.get(value);
      const nextProduct = previous || {
        value,
        label: String(item.productName || item.productId || value),
        count: 0,
        engagements: new Map(),
      };

      nextProduct.count += 1;

      const engagementValue = getEngagementValue(item);
      if (engagementValue) {
        const previousEngagement = nextProduct.engagements.get(engagementValue);
        nextProduct.engagements.set(engagementValue, {
          value: engagementValue,
          label: String(item.engagementName || item.engagementId || engagementValue),
          count: (previousEngagement?.count || 0) + 1,
        });
      }

      map.set(value, nextProduct);
    });

    return Array.from(map.values())
      .map(product => ({
        ...product,
        engagements: Array.from(product.engagements.values())
          .sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const selectedProductValue = productFilters.length === 1 ? productFilters[0] : '';
  const selectedEngagementValue = engagementFilters.length === 1 ? engagementFilters[0] : '';
  const selectedScopeProduct = useMemo(
    () => scopeProducts.find(product => product.value === selectedProductValue),
    [scopeProducts, selectedProductValue]
  );
  const selectedScopeEngagement = useMemo(() => {
    if (!selectedEngagementValue) return null;
    return selectedScopeProduct?.engagements.find(engagement => engagement.value === selectedEngagementValue) || null;
  }, [selectedEngagementValue, selectedScopeProduct]);

  const visibleScopeProducts = useMemo(() => {
    const query = scopeSearch.trim().toLowerCase();
    if (!query) return scopeProducts;
    return scopeProducts
      .map(product => {
        const productMatches = product.label.toLowerCase().includes(query)
          || product.value.toLowerCase().includes(query);
        const engagements = productMatches
          ? product.engagements
          : product.engagements.filter(engagement => (
            engagement.label.toLowerCase().includes(query)
            || engagement.value.toLowerCase().includes(query)
          ));

        return productMatches || engagements.length > 0
          ? { ...product, engagements }
          : null;
      })
      .filter(Boolean);
  }, [scopeProducts, scopeSearch]);

  const scopeLabel = selectedScopeEngagement
    ? `${selectedScopeProduct?.label || 'Product'} / ${selectedScopeEngagement.label}`
    : selectedScopeProduct?.label || 'All products';

  const scopeDescription = selectedScopeEngagement
    ? `${selectedScopeEngagement.count} sync run${selectedScopeEngagement.count !== 1 ? 's' : ''}`
    : selectedScopeProduct
      ? `${selectedScopeProduct.count} sync run${selectedScopeProduct.count !== 1 ? 's' : ''} · ${selectedScopeProduct.engagements.length} engagement${selectedScopeProduct.engagements.length !== 1 ? 's' : ''}`
      : `${items.length} sync run${items.length !== 1 ? 's' : ''}`;
  const statusLabel = STATUS_FILTERS.find(option => option.value === statusFilter)?.label || 'All statuses';
  const datePresetLabel = {
    7: 'Last 7 days',
    30: 'Last 30 days',
    custom: 'Custom dates',
    all: 'All time',
  }[datePreset] || 'Last 30 days';
  const filterButtonLabel = `${scopeLabel} · ${statusLabel} · ${datePresetLabel}`;
  const filterDescription = `${filterButtonLabel} · ${scopeDescription}`;

  const closeScopeMenu = () => {
    setScopeMenuOpen(false);
    setScopeSearch('');
  };

  const selectAllScope = () => {
    setProductFilters([]);
    setEngagementFilters([]);
    closeScopeMenu();
  };

  const selectProductScope = (product) => {
    setProductFilters([product.value]);
    setEngagementFilters([]);
    closeScopeMenu();
  };

  const selectEngagementScope = (product, engagement) => {
    setProductFilters([product.value]);
    setEngagementFilters([engagement.value]);
    closeScopeMenu();
  };

  const dateRange = useMemo(() => {
    if (datePreset === 'all') return { start: null, end: null };
    if (datePreset === 'custom') {
      return {
        start: customStart ? new Date(`${customStart}T00:00:00`) : null,
        end: customEnd ? new Date(`${customEnd}T23:59:59.999`) : null,
      };
    }

    const days = Number.parseInt(datePreset, 10);
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - Math.max(days - 1, 0));
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, [customEnd, customStart, datePreset]);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const visibleItems = useMemo(() => (
    items.filter(item => {
      const started = item.startedAt ? new Date(item.startedAt) : null;
      if (dateRange.start && (!started || started < dateRange.start)) return false;
      if (dateRange.end && (!started || started > dateRange.end)) return false;

      if (statusFilter !== 'all' && item.status !== statusFilter) return false;

      const productValue = getProductValue(item);
      if (productFilters.length > 0 && !productFilters.includes(productValue)) return false;

      const engagementValue = getEngagementValue(item);
      if (engagementFilters.length > 0 && !engagementFilters.includes(engagementValue)) return false;

      if (normalizedSearch && !getHistorySearchText(item).includes(normalizedSearch)) return false;

      return true;
    })
  ), [dateRange, engagementFilters, items, normalizedSearch, productFilters, statusFilter]);

  const visibleSummary = useMemo(() => (
    visibleItems.reduce((summary, item) => {
      summary.total += 1;
      summary.findingsPulled += toNumber(item.findingsPulled);
      summary.ticketsUpdated += toNumber(item.ticketsUpdated);
      if (item.status === 'success') summary.success += 1;
      if (item.status === 'partial') summary.partial += 1;
      if (item.status === 'failed') summary.failed += 1;
      return summary;
    }, {
      total: 0,
      success: 0,
      partial: 0,
      failed: 0,
      findingsPulled: 0,
      ticketsUpdated: 0,
    })
  ), [visibleItems]);

  const groupedItems = useMemo(() => {
    const groups = new Map();
    visibleItems.forEach(item => {
      const label = getDateGroupLabel(item.startedAt || item.createdAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    });
    return Array.from(groups.entries());
  }, [visibleItems]);

  const compareItems = useMemo(() => (
    compareIds
      .map(id => items.find(item => item.id === id))
      .filter(Boolean)
      .sort((a, b) => getRunTime(a) - getRunTime(b))
  ), [compareIds, items]);

  const autoCompareItems = useMemo(() => {
    if (!selected) return [];
    const selectedTime = getRunTime(selected);
    const previous = items
      .filter(item => isComparableRun(item, selected) && getRunTime(item) < selectedTime)
      .sort((a, b) => getRunTime(b) - getRunTime(a))[0];

    return previous ? [previous, selected] : [];
  }, [items, selected]);

  const toggleCompare = (id) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(item => item !== id);
      return prev.length >= 2 ? [prev[1], id] : [...prev, id];
    });
  };

  return (
    <>
      <PageHeader
        icon={History}
        eyebrow="Administration"
        title="Sync History"
      />

      <PageMain className="findings-main sh-main">

        <section className="sh-filter-panel" aria-label="Sync history controls" aria-busy={loading}>
          <div className="sh-dashboard-grid" aria-label="Visible sync history summary">
            <div className="sh-stat-card neutral">
              <div className="sh-stat-header">
                <span className="sh-stat-title">Total Runs</span>
                <div className="sh-stat-icon-wrap"><Activity size={18} /></div>
              </div>
              <strong className="sh-stat-value">{visibleSummary.total}</strong>
            </div>
            
            <div className="sh-stat-card success">
              <div className="sh-stat-header">
                <span className="sh-stat-title">Success</span>
                <div className="sh-stat-icon-wrap"><CheckCircle2 size={18} /></div>
              </div>
              <strong className="sh-stat-value">{visibleSummary.success}</strong>
            </div>

            <div className="sh-stat-card partial">
              <div className="sh-stat-header">
                <span className="sh-stat-title">Partial</span>
                <div className="sh-stat-icon-wrap"><AlertTriangle size={18} /></div>
              </div>
              <strong className="sh-stat-value">{visibleSummary.partial}</strong>
            </div>

            <div className="sh-stat-card failed">
              <div className="sh-stat-header">
                <span className="sh-stat-title">Failed</span>
                <div className="sh-stat-icon-wrap"><AlertCircle size={18} /></div>
              </div>
              <strong className="sh-stat-value">{visibleSummary.failed}</strong>
            </div>

            <div className="sh-stat-card">
              <div className="sh-stat-header">
                <span className="sh-stat-title">Findings Pulled</span>
                <div className="sh-stat-icon-wrap"><Bug size={18} /></div>
              </div>
              <strong className="sh-stat-value">{visibleSummary.findingsPulled}</strong>
            </div>

            <div className="sh-stat-card">
              <div className="sh-stat-header">
                <span className="sh-stat-title">Tickets Updated</span>
                <div className="sh-stat-icon-wrap"><Ticket size={18} /></div>
              </div>
              <strong className="sh-stat-value">{visibleSummary.ticketsUpdated}</strong>
            </div>
          </div>

          <div className="sh-filter-card">
            <div className="sh-filter-layout">
              <label className="sh-history-search">
                <span className="sr-only">Search sync history</span>
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search runs..."
                />
                {searchTerm && (
                  <button type="button" className="sh-search-clear-btn" onClick={() => setSearchTerm('')} aria-label="Clear sync history search">
                    <X size={14} />
                  </button>
                )}
              </label>

              <div className="sh-filter-actions">
                <div className="scope-menu sh-scope-menu" ref={scopeMenuRef}>
                  <button
                    type="button"
                    className="scope-trigger sh-compact-trigger"
                    onClick={() => setScopeMenuOpen(open => !open)}
                    aria-haspopup="menu"
                    aria-expanded={scopeMenuOpen}
                    aria-controls="sync-history-scope-menu"
                    aria-label="Open sync history filters"
                    title={filterDescription}
                  >
                    <span>{filterButtonLabel}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {scopeMenuOpen && (
                    <>
                      <button
                        type="button"
                        className="scope-backdrop"
                        onClick={closeScopeMenu}
                        aria-label="Close scope menu"
                        tabIndex={-1}
                      />
                      <div className="scope-popover" id="sync-history-scope-menu" role="menu" aria-label="Select sync history product scope">
                        <label className="scope-search">
                          <span className="sr-only">Search products and engagements</span>
                          <Search size={15} aria-hidden="true" />
                          <input
                            type="search"
                            value={scopeSearch}
                            onChange={(event) => setScopeSearch(event.target.value)}
                            placeholder="Search product or engagement"
                            autoFocus
                          />
                        </label>

                        <div className="sh-scope-filter-fields">
                          <label className="sh-scope-filter-field" htmlFor="sh-status-filter">
                            <span>Status</span>
                            <select id="sh-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                              {STATUS_FILTERS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="sh-scope-filter-field" htmlFor="sh-date-preset">
                            <span>Date range</span>
                            <select id="sh-date-preset" value={datePreset} onChange={(event) => setDatePreset(event.target.value)}>
                              <option value="7">Last 7 days</option>
                              <option value="30">Last 30 days</option>
                              <option value="custom">Custom</option>
                              <option value="all">All time</option>
                            </select>
                          </label>

                          {datePreset === 'custom' && (
                            <>
                              <label className="sh-scope-filter-field" htmlFor="sh-start-date">
                                <span>Start</span>
                                <input id="sh-start-date" type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} />
                              </label>
                              <label className="sh-scope-filter-field" htmlFor="sh-end-date">
                                <span>End</span>
                                <input id="sh-end-date" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} />
                              </label>
                            </>
                          )}
                        </div>

                        <div className="scope-section-label">Product Scope</div>
                        <button
                          type="button"
                          className={`scope-option scope-product-row ${!selectedProductValue && !selectedEngagementValue ? 'active' : ''}`}
                          onClick={selectAllScope}
                          role="menuitem"
                          aria-current={!selectedProductValue && !selectedEngagementValue ? 'true' : undefined}
                        >
                          <span>
                            <strong>All Products</strong>
                            <small>{items.length} sync run{items.length !== 1 ? 's' : ''}</small>
                          </span>
                          {!selectedProductValue && !selectedEngagementValue && <Check size={15} aria-hidden="true" />}
                        </button>
                        <div className="scope-options">
                          {visibleScopeProducts.length > 0 ? (
                            visibleScopeProducts.map(product => {
                              const productActive = selectedProductValue === product.value && !selectedEngagementValue;
                              return (
                                <div className="scope-product-group" key={product.value}>
                                  <button
                                    type="button"
                                    className={`scope-option scope-product-row ${productActive ? 'active' : ''}`}
                                    onClick={() => selectProductScope(product)}
                                    role="menuitem"
                                    aria-current={productActive ? 'true' : undefined}
                                  >
                                    <span>
                                      <strong>{product.label}</strong>
                                      <small>{product.count} sync run{product.count !== 1 ? 's' : ''}</small>
                                    </span>
                                    {productActive && <Check size={15} aria-hidden="true" />}
                                  </button>
                                  {product.engagements.map(engagement => {
                                    const engagementActive = selectedProductValue === product.value
                                      && selectedEngagementValue === engagement.value;
                                    return (
                                      <button
                                        key={`${product.value}-${engagement.value}`}
                                        type="button"
                                        className={`scope-option scope-engagement-row ${engagementActive ? 'active' : ''}`}
                                        onClick={() => selectEngagementScope(product, engagement)}
                                        role="menuitem"
                                        aria-current={engagementActive ? 'true' : undefined}
                                      >
                                        <span>
                                          <strong>{engagement.label}</strong>
                                          <small>{engagement.count} sync run{engagement.count !== 1 ? 's' : ''}</small>
                                        </span>
                                        {engagementActive && <Check size={15} aria-hidden="true" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })
                          ) : (
                            <p className="scope-empty">No products or engagements match.</p>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Compare Bar */}
            <div className="sh-compare-bar">
              <div className="sh-compare-info">
                <h3><BarChart3 size={14} /> Compare</h3>
                <span className="sh-muted">— {compareIds.length}/2 selected · open a run for auto-compare</span>
              </div>
              <div className="sh-compare-actions">
                <button type="button" className="btn-primary" disabled={compareIds.length !== 2} onClick={() => setShowCompare(true)}>
                  <BarChart3 size={14} />
                  Compare
                </button>
                <button type="button" className="btn-secondary" disabled={compareIds.length === 0} onClick={() => setCompareIds([])}>Clear</button>
              </div>
            </div>
          </div>
        </section>

        {/* ── History Table ── */}
        <section className="sh-list-container">
          <div className="sh-table-shell">
            {visibleItems.length === 0 ? (
              <div className="sh-empty" role="status">
                <div className="sh-empty-icon-wrap">
                  <span className="sh-empty-pulse" />
                  <Clock size={40} />
                </div>
                <h2>{items.length === 0 ? 'No sync history yet' : 'No sync runs match filters'}</h2>
                <p>{items.length === 0 ? 'Sync data will appear here after your first pull.' : 'Try adjusting the date range or clearing filters.'}</p>
              </div>
            ) : (
              <>
                <div className="sh-history-table-head" aria-hidden="true">
                  <span />
                  <span>Run</span>
                  <span>Scope</span>
                  <span>Status</span>
                  <span>Metrics</span>
                  <span>Run time</span>
                  <span />
                </div>
                {groupedItems.map(([label, groupItems]) => (
                  <div key={label} className="sh-date-group">
                    <div className="sh-date-heading">
                      <CalendarDays size={14} />
                      <span>{label}</span>
                      <small>{groupItems.length} run{groupItems.length !== 1 ? 's' : ''}</small>
                    </div>
                    <div className="sh-run-list">
                      {groupItems.map((item, idx) => (
                        <div
                          key={item.id}
                          className={`sh-run-row-wrap ${selected?.id === item.id ? 'selected' : ''} sh-card-enter`}
                          style={{ animationDelay: `${Math.min(idx * 20, 260)}ms` }}
                        >
                          <label className="sh-compare-check">
                            <input
                              type="checkbox"
                              checked={compareIds.includes(item.id)}
                              onChange={() => toggleCompare(item.id)}
                              aria-label={`Select ${item.syncType} from ${formatDate(item.startedAt)} for compare`}
                            />
                            <span className="sr-only">Compare</span>
                          </label>
                          <div
                            className="sh-run-row"
                            onClick={() => setSelected(item)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') setSelected(item); }}
                            aria-label={`Open details for ${getRunLabel(item)}`}
                          >
                            <div className="sh-cell-primary">
                              <strong>{item.syncType}</strong>
                              <span>{getRunLabel(item)}</span>
                            </div>
                            <div className="sh-cell-primary">
                              <strong>{item.productName || item.productId || 'All products'}</strong>
                              <span>{item.engagementName || item.engagementId || 'All engagements'}</span>
                            </div>
                            <div>
                              <span className={`sh-status-pill ${item.status}`}>{item.status}</span>
                            </div>
                            <div className="sh-cell-metric">
                              <strong>{toNumber(item.findingsPulled)} findings</strong>
                              <span>{toNumber(item.ticketsPulled)} tickets</span>
                            </div>
                            <div className="sh-cell-time">
                              <strong>{formatDate(item.startedAt).split(',')[0]}</strong>
                              <span>{formatDate(item.startedAt).split(',')[1]?.trim() || ''}</span>
                            </div>
                            <div>
                              <button className="sh-row-action-btn" tabIndex={-1}>View Details</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      </PageMain>

      <SyncHistoryDetailModal selected={selected} autoCompareItems={autoCompareItems} onClose={() => setSelected(null)} />

      {showCompare && compareItems.length === 2 && (
        <div className="modal-overlay" role="presentation" onClick={() => setShowCompare(false)}>
          <div className="modal-content sh-compare-modal" role="dialog" aria-modal="true" aria-labelledby="sh-compare-title" onClick={event => event.stopPropagation()}>
            <div className="modal-title-row">
              <h2 id="sh-compare-title" className="modal-heading-with-icon">
                <BarChart3 size={18} />
                Compare sync runs
              </h2>
              <button type="button" className="icon-btn" onClick={() => setShowCompare(false)} aria-label="Close compare">
                <XCircle size={16} />
              </button>
            </div>
            <div className="sh-compare-summary">
              <div className="sh-compare-run-label">
                <b>First</b>
                <span>{getRunLabel(compareItems[0])}</span>
                <small>{formatDate(compareItems[0].startedAt)}</small>
              </div>
              <strong>to</strong>
              <div className="sh-compare-run-label">
                <b>Second</b>
                <span>{getRunLabel(compareItems[1])}</span>
                <small>{formatDate(compareItems[1].startedAt)}</small>
              </div>
            </div>
            <div className="sh-delta-grid">
              {METRICS.map(([key, label]) => (
                <MetricDelta key={key} label={label} before={compareItems[0][key]} after={compareItems[1][key]} />
              ))}
            </div>
            <SeverityBreakdown before={compareItems[0]} after={compareItems[1]} section="pulled" title="Pulled severity delta" />
            <SeverityBreakdown before={compareItems[0]} after={compareItems[1]} section="active" title="Active severity delta" />
            <SeverityBreakdown before={compareItems[0]} after={compareItems[1]} section="mitigated" title="Mitigated severity delta" />
          </div>
        </div>
      )}
    </>
  );
};

export default SyncHistory;
