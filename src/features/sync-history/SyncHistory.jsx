import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Check, ChevronDown, Clock, History, RefreshCw, Search, X, XCircle } from 'lucide-react';
import { apiFetch } from '../../shared/api/api';
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

const getProductValue = (item) => item?.productId || item?.productName || '';
const getEngagementValue = (item) => item?.engagementId || item?.engagementName || '';

const SearchableMultiSelect = ({
  label,
  value,
  options,
  onChange,
  isOpen,
  onToggle,
  onClose,
  emptyLabel,
  placeholder,
}) => {
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setSearch('');
        onClose();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSearch('');
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedOptions = useMemo(
    () => options.filter(option => selectedSet.has(option.value)),
    [options, selectedSet]
  );
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter(option => (
      option.label.toLowerCase().includes(query)
      || option.value.toLowerCase().includes(query)
    ));
  }, [options, search]);

  const toggleValue = (nextValue) => {
    onChange(value.includes(nextValue)
      ? value.filter(item => item !== nextValue)
      : [...value, nextValue]);
  };

  const summary = selectedOptions.length === 0
    ? emptyLabel
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `${selectedOptions.length} selected`;

  return (
    <div ref={containerRef} className={`sh-popup-filter ${isOpen ? 'open' : ''}`}>
      <span className="sh-popup-label">{label}</span>
      <button
        type="button"
        className="sh-popup-trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => {
          if (!isOpen) setSearch('');
          onToggle();
        }}
      >
        <span>
          <strong>{summary}</strong>
          <small>{value.length === 0 ? `${options.length} available` : `${value.length} selected`}</small>
        </span>
        <ChevronDown size={16} />
      </button>

      {isOpen && (
        <div className="sh-filter-popover" role="dialog" aria-label={`${label} selector`}>
          <div className="sh-filter-search">
            <Search size={15} />
            <input
              type="search"
              value={search}
              autoFocus
              placeholder={placeholder}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button type="button" className="sh-search-clear" onClick={() => setSearch('')} aria-label={`Clear ${label} search`}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="sh-filter-popover-actions">
            <button type="button" className="btn-secondary" disabled={value.length === 0} onClick={() => onChange([])}>Clear</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setSearch('');
                onClose();
              }}
            >
              Done
            </button>
          </div>

          <div className="sh-filter-option-list" role="listbox" aria-multiselectable="true">
            {filteredOptions.length === 0 ? (
              <p className="sh-filter-empty">No matches</p>
            ) : filteredOptions.map(option => {
              const checked = selectedSet.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`sh-filter-option ${checked ? 'selected' : ''}`}
                  onClick={() => toggleValue(option.value)}
                >
                  <span className="sh-filter-checkmark">{checked && <Check size={14} />}</span>
                  <span className="sh-filter-option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.count || 0} runs</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

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

const SyncHistory = ({ onBack }) => {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [datePreset, setDatePreset] = useState('30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [productFilters, setProductFilters] = useState([]);
  const [engagementFilters, setEngagementFilters] = useState([]);
  const [compareIds, setCompareIds] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [openFilter, setOpenFilter] = useState(null);

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

  const productOptions = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      const value = getProductValue(item);
      if (!value) return;
      const previous = map.get(value);
      map.set(value, {
        value,
        label: item.productName || item.productId,
        count: (previous?.count || 0) + 1,
      });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const engagementOptions = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      const productValue = getProductValue(item);
      if (productFilters.length > 0 && !productFilters.includes(productValue)) return;
      const value = getEngagementValue(item);
      if (!value) return;
      const previous = map.get(value);
      map.set(value, {
        value,
        label: item.engagementName || item.engagementId,
        count: (previous?.count || 0) + 1,
      });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [items, productFilters]);

  const handleProductFiltersChange = (nextProducts) => {
    const allowedEngagements = new Set();
    items.forEach(item => {
      const productValue = getProductValue(item);
      if (nextProducts.length > 0 && !nextProducts.includes(productValue)) return;
      const engagementValue = getEngagementValue(item);
      if (engagementValue) allowedEngagements.add(engagementValue);
    });

    setProductFilters(nextProducts);
    setEngagementFilters(prev => {
      const next = prev.filter(value => allowedEngagements.has(value));
      return next.length === prev.length ? prev : next;
    });
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

  const visibleItems = useMemo(() => (
    items.filter(item => {
      const started = item.startedAt ? new Date(item.startedAt) : null;
      if (dateRange.start && (!started || started < dateRange.start)) return false;
      if (dateRange.end && (!started || started > dateRange.end)) return false;

      const productValue = getProductValue(item);
      if (productFilters.length > 0 && !productFilters.includes(productValue)) return false;

      const engagementValue = getEngagementValue(item);
      if (engagementFilters.length > 0 && !engagementFilters.includes(engagementValue)) return false;

      return true;
    })
  ), [dateRange, engagementFilters, items, productFilters]);

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

  const resetFilters = () => {
    setDatePreset('30');
    setCustomStart('');
    setCustomEnd('');
    setProductFilters([]);
    setEngagementFilters([]);
    setOpenFilter(null);
  };

  return (
    <>
      {/* ─── Hero Header ─── */}
      <header className="findings-hero">
        <div className="findings-hero-inner">
          <div className="findings-hero-icon-wrap">
            <span className="findings-hero-ring" />
            <span className="findings-hero-ring findings-hero-ring--delay" />
            <History size={28} />
          </div>
          <div className="findings-hero-copy">
            <p className="eyebrow">Sync History</p>
            <h1>Product and engagement sync log</h1>
            <p className="findings-hero-sub">
              {visibleItems.length} of {items.length} sync runs visible
            </p>
          </div>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="main-content findings-main sh-main">

        {/* ── Filter Panel ── */}
        <section className="sh-filter-panel" aria-label="Sync history controls">
          <div className="findings-command-bar sh-filter-bar">
            <div className="sh-filter-heading">
              <h3>Filters</h3>
              <span className="sh-muted">{visibleItems.length} of {items.length} runs</span>
            </div>
            <div className="sh-filter-group">
              <label htmlFor="sh-date-preset">Date range</label>
              <select id="sh-date-preset" value={datePreset} onChange={(event) => setDatePreset(event.target.value)}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="custom">Custom</option>
                <option value="all">All</option>
              </select>
            </div>
            {datePreset === 'custom' && (
              <>
                <div className="sh-filter-group">
                  <label htmlFor="sh-start-date">Start</label>
                  <input id="sh-start-date" type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} />
                </div>
                <div className="sh-filter-group">
                  <label htmlFor="sh-end-date">End</label>
                  <input id="sh-end-date" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} />
                </div>
              </>
            )}
            <SearchableMultiSelect
              label="Product"
              value={productFilters}
              options={productOptions}
              onChange={handleProductFiltersChange}
              isOpen={openFilter === 'product'}
              onToggle={() => setOpenFilter(prev => (prev === 'product' ? null : 'product'))}
              onClose={() => setOpenFilter(null)}
              emptyLabel="All products"
              placeholder="Search products..."
            />
            <SearchableMultiSelect
              label="Engagement"
              value={engagementFilters}
              options={engagementOptions}
              onChange={setEngagementFilters}
              isOpen={openFilter === 'engagement'}
              onToggle={() => setOpenFilter(prev => (prev === 'engagement' ? null : 'engagement'))}
              onClose={() => setOpenFilter(null)}
              emptyLabel="All engagements"
              placeholder="Search engagements..."
            />
            <button type="button" className="btn-secondary sh-reset-btn" onClick={resetFilters}>Reset</button>
            <button type="button" className="btn-secondary sh-refresh-btn" onClick={fetchHistory} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button type="button" className="btn-secondary sh-back-btn" onClick={onBack}>Back</button>
          </div>

          <div className="sh-compare-bar">
            <div className="sh-compare-info">
              <h3>Compare</h3>
              <span className="sh-muted">{compareIds.length}/2 selected · Open a run for auto-compare</span>
            </div>
            <div className="sh-compare-actions">
              <button type="button" className="btn-primary" disabled={compareIds.length !== 2} onClick={() => setShowCompare(true)}>
                <BarChart3 size={14} />
                Compare
              </button>
              <button type="button" className="btn-secondary" disabled={compareIds.length === 0} onClick={() => setCompareIds([])}>Clear</button>
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
            ) : groupedItems.map(([label, groupItems]) => (
              <div key={label} className="sh-date-group">
                <div className="sh-date-heading">
                  <CalendarDays size={14} />
                  <span>{label}</span>
                  <small>{groupItems.length} run{groupItems.length !== 1 ? 's' : ''}</small>
                </div>
                <div className="sh-table-scroll">
                  <table className="sh-history-table">
                    <thead>
                      <tr>
                        <th className="sh-col-select" scope="col">Compare</th>
                        <th scope="col">Run</th>
                        <th scope="col">Scope</th>
                        <th scope="col">Status</th>
                        <th scope="col">Findings</th>
                        <th scope="col">Tickets</th>
                        <th scope="col">Started</th>
                        <th scope="col">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupItems.map((item, idx) => (
                        <tr
                          key={item.id}
                          className={`${selected?.id === item.id ? 'selected' : ''} sh-card-enter`}
                          style={{ animationDelay: `${Math.min(idx * 20, 260)}ms` }}
                        >
                          <td className="sh-col-select">
                            <label className="sh-table-check">
                              <input
                                type="checkbox"
                                checked={compareIds.includes(item.id)}
                                onChange={() => toggleCompare(item.id)}
                                aria-label={`Select ${item.syncType} from ${formatDate(item.startedAt)} for compare`}
                              />
                              <span className="sr-only">Compare</span>
                            </label>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="sh-run-link"
                              onClick={() => setSelected(item)}
                              aria-haspopup="dialog"
                              aria-label={`Open details for ${getRunLabel(item)} ${item.syncType}`}
                            >
                              <strong>{item.syncType}</strong>
                              <span>{getRunLabel(item)}</span>
                            </button>
                          </td>
                          <td>
                            <span className="sh-scope-cell">
                              <strong>{item.productName || item.productId || 'All products'}</strong>
                              <span>{item.engagementName || item.engagementId || 'All engagements'}</span>
                            </span>
                          </td>
                          <td>
                            <span className={`sh-status-pill ${item.status}`}>{item.status}</span>
                          </td>
                          <td>
                            <span className="sh-metric-cell">
                              <strong>{toNumber(item.findingsPulled)}</strong>
                              <span>{toNumber(item.findingsMitigated)} mitigated · {toNumber(item.findingsStillActive)} active</span>
                            </span>
                          </td>
                          <td>
                            <span className="sh-metric-cell">
                              <strong>{toNumber(item.ticketsPulled)}</strong>
                              <span>{toNumber(item.ticketsUpdated)} updated</span>
                            </span>
                          </td>
                          <td>
                            <time className="sh-time-cell" dateTime={item.startedAt || item.createdAt || undefined}>
                              {formatDate(item.startedAt)}
                            </time>
                          </td>
                          <td>
                            <span className="sh-user-cell">{item.triggeredBy || 'system'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

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
