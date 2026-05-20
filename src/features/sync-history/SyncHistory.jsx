import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Check, ChevronDown, Clock, RefreshCw, Search, X, XCircle } from 'lucide-react';
import { apiFetch } from '../../services/api';

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
    <div ref={containerRef} className={`history-popup-filter ${isOpen ? 'open' : ''}`}>
      <span className="history-popup-label">{label}</span>
      <button
        type="button"
        className="history-popup-trigger"
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
        <div className="history-filter-popover" role="dialog" aria-label={`${label} selector`}>
          <div className="history-filter-search">
            <Search size={15} />
            <input
              type="search"
              value={search}
              autoFocus
              placeholder={placeholder}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button type="button" className="history-search-clear" onClick={() => setSearch('')} aria-label={`Clear ${label} search`}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="history-filter-popover-actions">
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

          <div className="history-filter-option-list" role="listbox" aria-multiselectable="true">
            {filteredOptions.length === 0 ? (
              <p className="history-filter-empty">No matches</p>
            ) : filteredOptions.map(option => {
              const checked = selectedSet.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`history-filter-option ${checked ? 'selected' : ''}`}
                  onClick={() => toggleValue(option.value)}
                >
                  <span className="history-filter-checkmark">{checked && <Check size={14} />}</span>
                  <span className="history-filter-option-copy">
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
    <div className="history-delta-card">
      <span>{label}</span>
      <strong>{toNumber(before)} → {toNumber(after)}</strong>
      <b className={`history-delta ${deltaClass(delta)}`}>{deltaLabel(delta)}</b>
    </div>
  );
};

const SeverityBreakdown = ({ before, after, section, title }) => {
  const beforeData = normalizeBreakdown(before, section);
  const afterData = normalizeBreakdown(after, section);
  const total = getBreakdownTotal(after, section);
  const hasData = getBreakdownTotal(before, section) > 0 || total > 0;

  return (
    <section className="severity-breakdown-section">
      <h3>{title}</h3>
      {!hasData ? (
        <p className="detail-empty-text">No severity breakdown recorded.</p>
      ) : (
        <>
          <div className="severity-stacked-bar">
            {SEVERITIES.map(severity => {
              const value = toNumber(afterData[severity]);
              if (value === 0) return null;
              const percent = (value / (total || 1)) * 100;
              return (
                <div 
                  key={severity} 
                  className={`severity-bar-segment bg-${severity.toLowerCase()}`}
                  style={{ width: `${percent}%` }}
                  title={`${severity}: ${value}`}
                />
              );
            })}
          </div>
          <div className="severity-breakdown-grid">
            {SEVERITIES.map(severity => {
              const beforeValue = toNumber(beforeData[severity]);
              const afterValue = toNumber(afterData[severity]);
              const delta = afterValue - beforeValue;
              return (
                <div key={severity} className="severity-breakdown-item">
                  <span className={`severity-badge badge-${severity.toLowerCase()}`}>{severity}</span>
                  <strong>{beforeValue} → {afterValue}</strong>
                  <b className={`history-delta ${deltaClass(delta)}`}>{deltaLabel(delta)}</b>
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
  <section className="history-auto-compare">
    <div className="history-section-title-row">
      <div>
        <p className="eyebrow">Auto Compare</p>
        <h3>{getRunLabel(before)} → {getRunLabel(after)}</h3>
      </div>
      <span className="history-muted">{getRunScopeLabel(after)}</span>
    </div>
    <div className="history-delta-grid compact">
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
      <div className="modal-content history-detail-modal" role="dialog" aria-modal="true" aria-labelledby="history-detail-title" onClick={event => event.stopPropagation()}>
        <div className="modal-title-row">
          <div>
            <p className="eyebrow">Sync Run Details</p>
            <h2 id="history-detail-title" className="modal-heading-with-icon">{selected.syncType}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close sync run details">
            <XCircle size={16} />
          </button>
        </div>

        <div className="history-detail-modal-body">
          <div className="detail-status-row">
            <span className={`status-pill ${selected.status}`}>{selected.status}</span>
            <span className="history-run-badge">{getRunLabel(selected)}</span>
            <span>{selected.triggeredBy || 'system'}</span>
          </div>
          <div className="history-metrics">
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
            <section className="history-auto-compare muted">
              <div className="history-section-title-row">
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
    <div className="history-view">
      <div className="view-toolbar">
        <div>
          <p className="eyebrow">Sync History</p>
          <h1>Product and engagement sync log</h1>
        </div>
        <div className="view-toolbar-actions">
          <button type="button" className="btn-secondary" onClick={fetchHistory} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Refresh
          </button>
          <button type="button" className="btn-secondary" onClick={onBack}>Back</button>
        </div>
      </div>

      <section className="history-topbar glass-panel" aria-label="Sync history controls">
        <div className="history-filter-bar" aria-label="Sync history filters">
          <div className="history-topbar-heading">
            <h3 className="sidebar-heading">Filters</h3>
            <span className="history-muted">{visibleItems.length} of {items.length} runs</span>
          </div>
          <div className="history-filter-group">
            <label htmlFor="history-date-preset">Date range</label>
            <select id="history-date-preset" value={datePreset} onChange={(event) => setDatePreset(event.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="custom">Custom</option>
              <option value="all">All</option>
            </select>
          </div>
          {datePreset === 'custom' && (
            <>
              <div className="history-filter-group">
                <label htmlFor="history-start-date">Start</label>
                <input id="history-start-date" type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} />
              </div>
              <div className="history-filter-group">
                <label htmlFor="history-end-date">End</label>
                <input id="history-end-date" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} />
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
          <button type="button" className="btn-secondary reset-btn" onClick={resetFilters}>Reset Filters</button>
        </div>

        <section className="history-compare-bar" aria-label="Compare selected sync runs">
          <div>
            <h3 className="sidebar-heading">Compare</h3>
            <p className="compare-status">{compareIds.length}/2 selected</p>
          </div>
          <p className="history-muted">Open a run for auto-compare with the previous matching product/engagement/type.</p>
          <div className="compare-actions">
            <button type="button" className="btn-primary" disabled={compareIds.length !== 2} onClick={() => setShowCompare(true)}>
              <BarChart3 size={16} />
              Compare
            </button>
            <button type="button" className="btn-secondary" disabled={compareIds.length === 0} onClick={() => setCompareIds([])}>Clear</button>
          </div>
        </section>
      </section>

      <div className="history-layout-3col">
        <main className="history-main-content">
          <div className="history-list">
            {visibleItems.length === 0 ? (
              <div className="empty-state compact-empty">
                <Clock size={32} className="empty-state-icon" />
                <h2>{items.length === 0 ? 'No sync history yet' : 'No sync runs match filters'}</h2>
              </div>
            ) : groupedItems.map(([label, groupItems]) => (
              <div key={label} className="history-date-group">
                <div className="history-date-heading">
                  <CalendarDays size={16} />
                  <span>{label}</span>
                </div>
                {groupItems.map(item => (
                  <div key={item.id} className={`history-row-wrap ${selected?.id === item.id ? 'selected' : ''}`}>
                    <label className="history-compare-check">
                      <input
                        type="checkbox"
                        checked={compareIds.includes(item.id)}
                        onChange={() => toggleCompare(item.id)}
                        aria-label={`Select ${item.syncType} from ${formatDate(item.startedAt)} for compare`}
                      />
                    </label>
                    <button
                      type="button"
                      className="history-row"
                      onClick={() => setSelected(item)}
                      aria-haspopup="dialog"
                      aria-label={`Open details for ${getRunLabel(item)} ${item.syncType}`}
                    >
                      <div className="history-row-title">
                        <strong>{item.syncType}</strong>
                        <span className="history-run-badge">{getRunLabel(item)}</span>
                      </div>
                      <span>{item.productName || item.productId || 'All products'} / {item.engagementName || item.engagementId || 'All engagements'}</span>
                      <span className={`status-pill ${item.status}`}>{item.status}</span>
                      <small>{formatDate(item.startedAt)}</small>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </main>
      </div>

      <SyncHistoryDetailModal selected={selected} autoCompareItems={autoCompareItems} onClose={() => setSelected(null)} />

      {showCompare && compareItems.length === 2 && (
        <div className="modal-overlay" role="presentation" onClick={() => setShowCompare(false)}>
          <div className="modal-content history-compare-modal" role="dialog" aria-modal="true" aria-labelledby="history-compare-title" onClick={event => event.stopPropagation()}>
            <div className="modal-title-row">
              <h2 id="history-compare-title" className="modal-heading-with-icon">
                <BarChart3 size={18} />
                Compare sync runs
              </h2>
              <button type="button" className="icon-btn" onClick={() => setShowCompare(false)} aria-label="Close compare">
                <XCircle size={16} />
              </button>
            </div>
            <div className="history-compare-summary">
              <div className="history-compare-run-label">
                <b>First</b>
                <span>{getRunLabel(compareItems[0])}</span>
                <small>{formatDate(compareItems[0].startedAt)}</small>
              </div>
              <strong>to</strong>
              <div className="history-compare-run-label">
                <b>Second</b>
                <span>{getRunLabel(compareItems[1])}</span>
                <small>{formatDate(compareItems[1].startedAt)}</small>
              </div>
            </div>
            <div className="history-delta-grid">
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
    </div>
  );
};

export default SyncHistory;
