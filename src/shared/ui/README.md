# Shared UI Layout

Use `PageHeader` and `PageMain` for every route-level page inside `AppShell`.

## Page Rules

- Do not create page-local sticky headers or hero/header CSS.
- Put route title, icon, description, metrics, and top-level actions in `PageHeader`.
- Put the route body in `PageMain`; add a page-specific class only for that page's content layout.
- Keep page-specific CSS focused on tables, forms, lists, cards, and workflow controls.

This keeps navigation, page spacing, mobile behavior, and title treatment consistent across dashboard, products, findings, admin, and history pages.

## Data Tables

Use `DataTableSection`, `DataTable`, `DataTablePagination`, `DataTableRow`, and `DataTableCell` for reusable list/table surfaces. Each page supplies its own `columns`, `gridTemplate`, `minWidth`, row data, pagination state, and cell content; shared section layout, panel spacing, table chrome, footer controls, row states, scrolling, severity accents, and mobile stacking stay in `DataTable.css`.

Keep page CSS focused on the meaning inside cells, such as badges, action buttons, monospace values, inline edit controls, and per-column mobile ordering.

## Search Options

Use `SearchOptionsPanel`, `SearchOptionsCommandBar`, `SearchOptionsSearch`, `SearchOptionsResultCount`, `SearchOptionsFilterGroup`, and `SearchOptionsFilterButton` for reusable search/filter controls above a list. Findings owns the visual source style; new pages should pass their own search value, clear handler, result counts, filter labels, active state, counts, and click handlers instead of copying search CSS.

Example:

```jsx
<SearchOptionsPanel bodyId="assets-filter-body" open={open} onToggle={() => setOpen(value => !value)}>
  <SearchOptionsCommandBar>
    <SearchOptionsSearch
      label="Search assets"
      value={query}
      onChange={setQuery}
      onClear={() => setQuery('')}
      placeholder="Search host, label, or port..."
      showClear={Boolean(query)}
    />
    <SearchOptionsResultCount value={`${rows.length}`} label="rows" />
  </SearchOptionsCommandBar>
  <SearchOptionsFilterGroup ariaLabel="Filter assets by severity" title="Severity" total={`${allRows.length} total`}>
    {filters.map(filter => (
      <SearchOptionsFilterButton
        key={filter.value}
        active={activeFilter === filter.value}
        count={filter.count}
        label={filter.label}
        meterPercent={filter.percent}
        onClick={() => setActiveFilter(filter.value)}
        tone={filter.tone}
      />
    ))}
  </SearchOptionsFilterGroup>
</SearchOptionsPanel>
```

## Typography Utilities

Use the global typography utility classes from `src/styles/index.css` when a shared UI surface needs explicit text treatment instead of page-local font declarations.

- `font-sans` uses the shared Prompt UI font stack.
- `font-mono` uses the shared technical monospace stack.
- `text-display`, `text-heading`, `text-title`, `text-body`, and `text-label` map to the app typography scale.
- `text-code` is for logs, JSON, CVEs, endpoints, IDs, and other technical values.
