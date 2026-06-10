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
}) => {
  const hasRows = Children.count(children) > 0;

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
          {hasRows ? children : empty}
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
        <ChevronLeft size={16} />
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
        <ChevronRight size={16} />
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

export const DataTableCell = ({ children, className = '', label }) => (
  <div className={joinClassNames('data-table-cell', className)} role="cell" data-label={label}>
    {children}
  </div>
);
