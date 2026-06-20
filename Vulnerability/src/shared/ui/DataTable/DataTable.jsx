import { Children } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './DataTable.css';

const joinClassNames = (...classes) => classes.filter(Boolean).join(' ');

const createTableStyle = ({ gridTemplate, minWidth, style = {} }) => ({
  ...(gridTemplate ? { '--data-table-grid': gridTemplate } : {}),
  ...(minWidth ? { '--data-table-min-width': minWidth } : {}),
  ...style,
});

const getColumnLabel = (column) => (
  typeof column === 'string' ? column : column.label
);

const getColumnKey = (column) => (
  typeof column === 'string' ? column : column.key || column.label
);

export const DataTable = ({
  ariaLabel,
  children,
  className = '',
  columns = [],
  empty,
  footer,
  gridTemplate,
  minWidth,
  style,
  loading = false,
}) => {
  const hasRows = Children.count(children) > 0;

  const renderSkeletons = () => {
    const rowCount = 5;
    const widths = ['70%', '45%', '80%', '60%', '35%', '50%'];
    return Array.from({ length: rowCount }).map((_, rIdx) => (
      <DataTableRow key={`skeleton-row-${rIdx}`} className="data-table-row-skeleton">
        {columns.map((column, cIdx) => {
          const width = widths[(rIdx + cIdx) % widths.length];
          return (
            <DataTableCell key={`skeleton-cell-${rIdx}-${cIdx}`} className={column.className}>
              <span className="skeleton-line" style={{ width }} />
            </DataTableCell>
          );
        })}
      </DataTableRow>
    ));
  };

  return (
    <div className="data-table-stack">
      <div
        className={joinClassNames('data-table', className)}
        role="table"
        aria-label={ariaLabel}
        style={createTableStyle({ gridTemplate, minWidth, style })}
      >
        <div className="data-table-header" role="row">
          {columns.map(column => (
            <div
              key={getColumnKey(column)}
              className={joinClassNames('data-table-header-cell', column.className)}
              role="columnheader"
            >
              {getColumnLabel(column)}
            </div>
          ))}
        </div>
        <div className="data-table-body" role="rowgroup">
          {loading ? renderSkeletons() : (hasRows ? children : empty)}
        </div>
      </div>
      {footer}
    </div>
  );
};

export const DataTableSection = ({
  ariaLabel,
  children,
  className = '',
  panelClassName = '',
}) => (
  <section className={joinClassNames('data-table-section', className)} aria-label={ariaLabel}>
    <div className={joinClassNames('data-table-panel', panelClassName)}>
      {children}
    </div>
  </section>
);

export const DataTablePagination = ({
  ariaLabel = 'Table pagination',
  currentPage,
  firstResult,
  itemLabel = 'result',
  lastResult,
  onNextPage,
  onPageSizeChange,
  onPreviousPage,
  pageCount,
  pageSize,
  pageSizeOptions = [],
  rowsPerPageLabel = 'Rows per page',
  totalRows,
}) => (
  <div className="data-table-footer">
    <span className="data-table-page-summary">
      Showing {firstResult} to {lastResult} of {totalRows} {itemLabel}{totalRows !== 1 ? 's' : ''}
    </span>
    <label className="data-table-page-size">
      <span>{rowsPerPageLabel}</span>
      <select
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        aria-label={rowsPerPageLabel}
      >
        {pageSizeOptions.map(size => (
          <option key={size} value={size}>{size}</option>
        ))}
      </select>
    </label>
    <div className="data-table-page-controls" aria-label={ariaLabel}>
      <button
        type="button"
        className="btn-secondary data-table-page-btn"
        onClick={onPreviousPage}
        disabled={currentPage <= 1}
        aria-label={`Previous ${itemLabel} page`}
      >
        <ChevronLeft size={17} />
        Previous
      </button>
      <span>Page {currentPage} of {pageCount}</span>
      <button
        type="button"
        className="btn-secondary data-table-page-btn"
        onClick={onNextPage}
        disabled={currentPage >= pageCount}
        aria-label={`Next ${itemLabel} page`}
      >
        Next
        <ChevronRight size={17} />
      </button>
    </div>
  </div>
);

export const DataTableRow = ({
  ariaLabel,
  children,
  className = '',
  interactive = false,
  onClick,
  onKeyDown,
  selected = false,
  style,
  tone,
}) => (
  <article
    className={joinClassNames(
      'data-table-row',
      tone && `tone-${tone}`,
      selected && 'selected',
      interactive && 'interactive',
      className
    )}
    onClick={onClick}
    onKeyDown={onKeyDown}
    role="row"
    tabIndex={interactive ? 0 : undefined}
    aria-selected={selected || undefined}
    aria-label={ariaLabel}
    style={style}
  >
    {children}
  </article>
);

export const DataTableCell = ({ children, className = '', label, ...props }) => (
  <div className={joinClassNames('data-table-cell', className)} role="cell" data-label={label} {...props}>
    {children}
  </div>
);
