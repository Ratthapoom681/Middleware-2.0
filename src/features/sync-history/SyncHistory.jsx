import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Clock, RefreshCw, XCircle } from 'lucide-react';
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

const MultiSelect = ({ label, value, options, onChange }) => {
  const toggleValue = (nextValue) => {
    onChange(value.includes(nextValue)
      ? value.filter(item => item !== nextValue)
      : [...value, nextValue]);
  };

  return (
    <fieldset className="history-filter-group">
      <legend>{label}</legend>
      <div className="history-option-list">
        {options.length === 0 ? (
          <span className="history-muted">No options</span>
        ) : options.map(option => (
          <label key={option.value} className="history-check-option">
            <input
              type="checkbox"
              checked={value.includes(option.value)}
              onChange={() => toggleValue(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
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

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/sync-history?limit=100');
      if (res.ok) {
        const data = await res.json();
        const nextItems = Array.isArray(data) ? data : [];
        const nextIds = new Set(nextItems.map(item => item.id));
        setItems(nextItems);
        setSelected(prev => (prev && nextIds.has(prev.id) ? prev : nextItems[0] || null));
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
      const value = item.productId || item.productName || '';
      if (value) map.set(value, item.productName || item.productId);
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [items]);

  const engagementOptions = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      const value = item.engagementId || item.engagementName || '';
      if (value) map.set(value, item.engagementName || item.engagementId);
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [items]);

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

      const productValue = item.productId || item.productName || '';
      if (productFilters.length > 0 && !productFilters.includes(productValue)) return false;

      const engagementValue = item.engagementId || item.engagementName || '';
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

      <div className="history-layout-3col">
        <aside className="history-sidebar glass-panel">
          <section className="history-filter-bar" aria-label="Sync history filters">
            <h3 className="sidebar-heading">Filters</h3>
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
            <MultiSelect label="Product" value={productFilters} options={productOptions} onChange={setProductFilters} />
            <MultiSelect label="Engagement" value={engagementFilters} options={engagementOptions} onChange={setEngagementFilters} />
            <button type="button" className="btn-secondary reset-btn" onClick={resetFilters}>Reset Filters</button>
          </section>

          <section className="history-compare-bar" aria-label="Compare selected sync runs">
            <h3 className="sidebar-heading">Compare</h3>
            <p className="compare-status">{compareIds.length}/2 selected</p>
            <div className="compare-actions">
              <button type="button" className="btn-primary" disabled={compareIds.length !== 2} onClick={() => setShowCompare(true)}>
                <BarChart3 size={16} />
                Compare
              </button>
              <button type="button" className="btn-secondary" disabled={compareIds.length === 0} onClick={() => setCompareIds([])}>Clear</button>
            </div>
          </section>
        </aside>

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
                    >
                      <strong>{item.syncType}</strong>
                      <span>{item.productName || item.productId || 'All products'} / {item.engagementName || item.engagementId || 'All engagements'}</span>
                      <span className={`status-pill ${item.status}`}>{item.status}</span>
                      <small>{formatDate(item.startedAt)}</small>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <aside className="history-detail glass-panel">
            {selected ? (
              <>
                <div className="detail-status-row">
                  <span className={`status-pill ${selected.status}`}>{selected.status}</span>
                  <span>{selected.triggeredBy || 'system'}</span>
                </div>
                <h2>{selected.syncType}</h2>
                <div className="history-metrics">
                  {METRICS.map(([key, label]) => (
                    <span key={key}>{label} <strong>{selected[key] || 0}</strong></span>
                  ))}
                </div>
                <div className="finding-meta-grid">
                  <div className="meta-item"><span className="meta-label">Started</span><span className="meta-value">{formatDate(selected.startedAt)}</span></div>
                  <div className="meta-item"><span className="meta-label">Finished</span><span className="meta-value">{formatDate(selected.finishedAt)}</span></div>
                  <div className="meta-item"><span className="meta-label">Product</span><span className="meta-value">{selected.productName || selected.productId || 'All'}</span></div>
                  <div className="meta-item"><span className="meta-label">Engagement</span><span className="meta-value">{selected.engagementName || selected.engagementId || 'All'}</span></div>
                </div>
                <SeverityBreakdown before={{}} after={selected} section="pulled" title="Severity pulled" />
                {(selected.warnings?.length > 0 || selected.errors?.length > 0) && (
                  <div className="json-container compact">
                    <pre>{JSON.stringify({ warnings: selected.warnings, errors: selected.errors }, null, 2)}</pre>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state compact-empty">
                <h2>Select a sync run</h2>
              </div>
            )}
          </aside>
        </main>
      </div>

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
              <span>{formatDate(compareItems[0].startedAt)}</span>
              <strong>to</strong>
              <span>{formatDate(compareItems[1].startedAt)}</span>
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
