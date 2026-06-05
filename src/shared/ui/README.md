# Shared UI Layout

Use `PageHeader` and `PageMain` for every route-level page inside `AppShell`.

## Page Rules

- Do not create page-local sticky headers or hero/header CSS.
- Put route title, icon, description, metrics, and top-level actions in `PageHeader`.
- Put the route body in `PageMain`; add a page-specific class only for that page's content layout.
- Keep page-specific CSS focused on tables, forms, lists, cards, and workflow controls.

This keeps navigation, page spacing, mobile behavior, and title treatment consistent across dashboard, products, findings, admin, and history pages.
