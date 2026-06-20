import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import './SearchOptions.css';

const joinClassNames = (...classes) => classes.filter(Boolean).join(' ');

export const SearchOptionsPanel = ({
  bodyId,
  children,
  className = '',
  icon: Icon = SlidersHorizontal,
  open,
  onToggle,
  resultCount,
  resultIcon,
  resultLabel = 'rows',
  title = 'Search Options',
}) => (
  <section
    className={joinClassNames('search-options-panel', open && 'open', resultCount !== undefined && 'has-result-count', className)}
    aria-labelledby={`${bodyId}-title`}
  >
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
      {resultCount !== undefined && (
        <SearchOptionsResultCount
          icon={resultIcon}
          label={resultLabel}
          value={resultCount}
        />
      )}
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

const formatFilterOptionLabel = ({ count, label }) => (
  count === undefined || count === null ? label : `${label} (${count})`
);

export const SearchOptionsFilterGroup = ({
  ariaLabel,
  onChange,
  options = [],
  title,
  total,
  value,
}) => {
  const selectLabel = ariaLabel || (title ? `Filter by ${title}` : 'Filter options');

  return (
    <div className="search-options-filter-panel" aria-label={ariaLabel}>
      <div className="search-options-filter-head">
        <span>{title}</span>
        {total && <strong>{total}</strong>}
      </div>
      <label className="search-options-filter-select-wrap">
        <span className="sr-only">{selectLabel}</span>
        <select
          className="search-options-filter-select"
          value={value ?? ''}
          onChange={(event) => onChange?.(event.target.value)}
          aria-label={selectLabel}
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>
              {formatFilterOptionLabel(option)}
            </option>
          ))}
        </select>
        <ChevronDown className="search-options-filter-select-icon" size={16} aria-hidden="true" />
      </label>
    </div>
  );
};
