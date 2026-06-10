import { ChevronDown, Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import './SearchOptions.css';

const joinClassNames = (...classes) => classes.filter(Boolean).join(' ');

export const SearchOptionsPanel = ({
  bodyId,
  children,
  className = '',
  icon: Icon = SlidersHorizontal,
  open,
  onToggle,
  title = 'Search Options',
}) => (
  <section className={joinClassNames('search-options-panel', open && 'open', className)} aria-labelledby={`${bodyId}-title`}>
    <button
      type="button"
      className="search-options-toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={bodyId}
    >
      <span className="search-options-toggle-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="search-options-toggle-copy">
        <strong id={`${bodyId}-title`}>{title}</strong>
      </span>
      <ChevronDown className="search-options-chevron" size={18} aria-hidden="true" />
    </button>

    {open && (
      <div className="search-options-body" id={bodyId}>
        {children}
      </div>
    )}
  </section>
);

export const SearchOptionsCommandBar = ({ children, className = '' }) => (
  <div className={joinClassNames('search-options-command-bar', className)}>
    {children}
  </div>
);

export const SearchOptionsSearch = ({
  inputType = 'search',
  kbd,
  label,
  onChange,
  onClear,
  placeholder,
  showClear,
  value,
}) => (
  <label className="search-options-search">
    <span className="sr-only">{label}</span>
    <Search size={16} aria-hidden="true" />
    <input
      type={inputType}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
    {showClear && (
      <button
        type="button"
        className="search-options-search-clear"
        onClick={onClear}
        aria-label={label ? `Clear ${label.toLowerCase()}` : 'Clear search'}
        title="Clear search"
      >
        <X size={14} />
      </button>
    )}
    {kbd && <kbd className="search-options-search-kbd">{kbd}</kbd>}
  </label>
);

export const SearchOptionsResultCount = ({ icon: Icon, label = 'rows', value }) => (
  <span className="search-options-result-count">
    {Icon && <Icon size={14} aria-hidden="true" />}
    {value}
    <span className="search-options-result-count-label">
      {' '}{label}
    </span>
  </span>
);

export const SearchOptionsFilterGroup = ({ ariaLabel, children, title, total }) => (
  <div className="search-options-filter-panel" aria-label={ariaLabel}>
    <div className="search-options-filter-head">
      <span>{title}</span>
      <strong>{total}</strong>
    </div>
    <div className="search-options-filter-options">
      {children}
    </div>
  </div>
);

export const SearchOptionsFilterButton = ({
  active,
  count,
  icon: Icon,
  label,
  meterPercent,
  onClick,
  tone = '',
}) => {
  const isAll = tone === 'all';

  return (
    <button
      type="button"
      className={joinClassNames('search-options-filter-option', tone, active && 'active')}
      onClick={onClick}
      aria-pressed={active}
    >
      {Icon ? <Icon size={14} /> : <span className="search-options-filter-dot" aria-hidden="true" />}
      <span className="search-options-filter-label">{label}</span>
      <strong>{count}</strong>
      {!isAll && (
        <span className="search-options-filter-meter" aria-hidden="true">
          <span style={{ width: `${meterPercent || 0}%` }} />
        </span>
      )}
    </button>
  );
};

export { Filter };
