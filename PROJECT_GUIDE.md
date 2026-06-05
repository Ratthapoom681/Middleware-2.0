# DefectDojo Viewer Project Guide

This document explains how the project is organized and how the main workflows fit together. It is meant for developers who need to change the app without first reverse-engineering the whole codebase.

## What This App Does

DefectDojo Viewer is a React + Express application for:

- Pulling findings from DefectDojo.
- Compacting related findings into ticket-sized groups.
- Creating, checking, and tracking Redmine tickets.
- Showing dashboard, product, finding, sync history, and mitigation review views.
- Managing users and admin settings.
- Queueing mitigated Redmine tickets for human review before closure.

The app can run with PostgreSQL or fallback local JSON storage. PostgreSQL is the preferred mode for persistent data.

## Local Commands

```powershell
npm install
npm run dev:all
```

Useful checks:

```powershell
npm run lint
npm run build
npm test
```

Backend only:

```powershell
npm run server
```

Frontend only:

```powershell
npm run dev
```

## High-Level Architecture

```text
React frontend
  src/app/App.jsx
  src/features/*
        |
        | /api/*
        v
Express backend
  backend/server.cjs
  backend/routes/*
        |
        +-- DefectDojo API
        +-- Redmine API
        +-- PostgreSQL or JSON fallback
```

The frontend is route-driven with hash routes. The backend serves API routes under `/api` and, in production/container mode, also serves the built frontend.

## Important Frontend Files

### App Shell And Routing

- `src/app/App.jsx`
  - Main application state owner.
  - Handles auth, route selection, dashboard data fetching, finding compaction state, Sync All modals, Redmine sync status, and shared callbacks.

- `src/app/AppShell.jsx`
  - Sidebar/navigation shell.
  - Shows the Mitigation Review notification badge.

- `src/app/routes.js`
  - Hash route IDs and resolver.
  - Current routes include dashboard, products, product dashboard, findings, product findings, sync history, mitigation review, users, and settings.

### Dashboard

- `src/features/dashboard/DashboardPage.jsx`
  - Main dashboard page.
  - Shows global summary cards and embedded findings content.

- `src/features/dashboard/DashboardOverviewCards.jsx`
  - SOC-style dashboard cards for vulnerability status, ticket workflow, and severity distribution.

- `src/shared/lib/dashboardUtils.js`
  - Shared dashboard helpers for Redmine status labels, scope values, route matching, etc.

### Findings

- `src/features/findings/FindingsPage.jsx`
  - Findings page and embedded dashboard findings section.
  - Receives filtered compacted findings from `App.jsx`.
  - Contains search, scope menu (with integrated Redmine status pills), share/export snapshot actions, severity filter, and finding list rendering.

- `src/features/findings/FindingsPage.css`
  - Findings-specific layout and filter styling.

The scope menu and Redmine status filter are merged into a single dropdown panel rendered by `renderScopeMenu()` in `App.jsx`. The panel contains:

1. Search input (filters product/engagement list).
2. Redmine status pills (horizontal chip buttons with counts).
3. Product/engagement scope tree.

Current finding filters are layered roughly as:

```text
Scope panel (product/engagement + Redmine status)
  -> severity filter
  -> text search
```

Findings also support shareable snapshots:

- `Share View` copies a URL for the current product, engagement, severity, Redmine status, and text search filters.
- `Export CSV` downloads the currently visible compacted finding rows as a static CSV summary.
- The shared URL stores filter state only. It is not an immutable stored snapshot; it will reflect whatever data the recipient can access when they open it.
- CSV export intentionally includes summary fields such as title, severity, route, Redmine issue/status, finding IDs, endpoints, CVEs/CWEs, date, and snapshot URL. It does not export raw JSON, descriptions, impact, or mitigation text.

### Products

- `src/features/products/ProductsPage.jsx`
  - Product list and engagement drilldown entry point.

- `src/features/products/ProductDashboardPage.jsx`
  - Product-level dashboard before opening scoped findings.

### Sync History

- `src/features/sync-history/SyncHistory.jsx`
  - Admin-only sync audit page.
  - Supports filters, grouped history table, compare, and run detail modal.

- `src/features/sync-history/SyncHistory.css`
  - Sync History table, filter, compare, and modal styles.

### Mitigation Review

- `src/features/admin/MitigationReview/MitigationReview.jsx`
  - Admin queue for reviewing mitigated findings before closing Redmine tickets.
  - Rows are grouped by ticket/issue/review key, not only by finding.
  - Supports search, sorting, pagination, bulk actions, and confirmation dialogs.

### Settings And Users

- `src/features/settings/Settings.jsx`
  - Admin configuration UI.
  - DefectDojo, Redmine, backup/restore, clear data, rebuild Redmine status.

- `src/features/admin/UserManagement/UserManagement.jsx`
  - Admin-only user directory and user create/update modal.

## Important Backend Files

### Server And Routes

- `backend/server.cjs`
  - Express app bootstrap and shared orchestration logic.
  - Still contains important sync, Redmine status, and mitigation recheck logic.

- `backend/routes/index.cjs`
  - Route registration entry point.

- `backend/routes/auth.cjs`
  - Login/logout/auth endpoints.

- `backend/routes/config.cjs`
  - Config, backups, imports, restore.

- `backend/routes/findings.cjs`
  - Dashboard summary, findings, compacted CVEs.

- `backend/routes/redmine.cjs`
  - Redmine issue/status endpoints.

- `backend/routes/sync.cjs`
  - Pull and Sync All routes.

- `backend/routes/mitigation.cjs`
  - Mitigation Review queue and actions.

- `backend/routes/system.cjs`
  - Logs, health, clear data.

### Domain And Integration Helpers

- `backend/domain/compaction.cjs`
  - Backend compacted finding grouping logic.

- `backend/domain/sync-utils.cjs`
  - Concurrency/progress helpers.

- `backend/domain/history-utils.cjs`
  - Sync history formatting helpers.

- `backend/integrations/defectdojo-client.cjs`
  - DefectDojo API client helpers and entity enrichment.

- `backend/integrations/redmine-client.cjs`
  - Redmine API helpers, status matching, issue lookup, and ticket update logic.

- `backend/data/database.cjs`
  - PostgreSQL adapter and fallback-compatible formatting.
  - Creates/updates users, config, findings, Redmine sync records, tickets, sync history, and mitigation review records.

## Storage Modes

### PostgreSQL Mode

Set `DATABASE_URL` or standard `PG*` variables. The backend initializes tables automatically and imports existing local JSON data if the database is empty.

Important tables include:

- `defectdojo_viewer_users`
- `defectdojo_viewer_config`
- `defectdojo_viewer_config_backups`
- `defectdojo_viewer_products`
- `defectdojo_viewer_engagements`
- `defectdojo_viewer_findings`
- `defectdojo_viewer_redmine_sync`
- `defectdojo_viewer_redmine_tickets`
- `defectdojo_viewer_sync_history`
- `defectdojo_viewer_mitigation_rechecks`
- `defectdojo_viewer_mitigation_reviews`
- `defectdojo_viewer_admin_actions`

### JSON Fallback Mode

Without PostgreSQL, the backend uses local JSON files and scan path files. This is useful for development but some admin workflows, especially mitigation review persistence, are database-oriented.

Root/local data files include:

- `config.json`
- `users.json`
- `config-backups/*`
- Redmine sync state under the configured data directory.

## Main Data Flows

### DefectDojo Pull

```text
Frontend action
  -> backend pull route
  -> DefectDojo API findings
  -> normalize/enrich findings
  -> save findings/products/engagements
  -> write Sync History
  -> dashboard refresh
```

Direct pull creates a `DefectDojo Pull` history row.

### Sync All

```text
Sync All
  -> pull DefectDojo findings
  -> compact findings
  -> check Redmine status
  -> update existing tickets
  -> create missing tickets
  -> recheck mitigations for Resolve tickets
  -> queue Mitigation Review items
  -> write Sync History
```

Sync All is the full workflow. It can update Redmine state and create tickets.

### Background Redmine Sync

The existing background poller is controlled by Redmine status poll interval in Settings.

```text
Background Redmine poll
  -> refresh known Redmine ticket status
  -> find Resolve tickets
  -> pull only linked DefectDojo findings
  -> queue mitigated items into Mitigation Review
```

Important safety rule: background mitigation check does not close Redmine tickets and does not reopen Resolve tickets. It only queues review items or skips active findings.

### Mitigation Review

```text
Resolve Redmine ticket
  -> linked DefectDojo findings become mitigated
  -> mitigation recheck queues pending review
  -> admin reviews
  -> admin closes Redmine or ignores queue item
```

Notification counts are grouped by ticket/issue queue item, not individual finding rows.

## Finding Compaction

Compaction groups raw DefectDojo findings into review/ticket-sized rows. It uses:

- CVE/CWE data.
- Upgrade family detection.
- Title, mitigation, description, impact.
- Product and engagement route.
- Endpoint details.
- Legacy sync keys for matching old Redmine tickets.

Frontend compaction helpers live in:

- `src/domain/findings/compactionUtils.js`
- `src/domain/findings/findingUtils.js`
- `src/domain/findings/vulnerabilityUtils.js`
- `src/domain/findings/endpointUtils.js`

Backend compaction lives in:

- `backend/domain/compaction.cjs`

When changing compaction, preserve legacy sync key behavior unless you intentionally want old Redmine ticket matching to change.

## Redmine Status Model

Redmine state is normalized into buckets used by dashboard and findings:

- New
- In Progress
- Feedback
- Resolve / Resolved
- Closed / Done
- Not Found
- Error
- Other / Unlinked

Useful helpers:

- Frontend: `src/shared/lib/dashboardUtils.js`
- Backend: `backend/integrations/redmine-client.cjs`

## Routing Notes

The app uses hash routes, not React Router.

Common routes:

```text
# or empty hash                 Dashboard
#products                       Products
#product-dashboard?productId=9  Product dashboard
#findings                       All findings
#product-findings?productId=9   Product-scoped findings
#sync-history                   Admin sync history
#mitigation-review              Admin mitigation review
#users                          Admin users
#settings                       Admin settings
```

Product findings can also preserve filter state in the URL, such as:

```text
#product-findings?productId=9&engagementId=75&redmineStatus=resolve
#product-findings?productId=9&severity=Critical&redmineStatus=new&q=openssl
```

## API And Auth

Frontend API helper:

- `src/shared/api/api.js`

Backend auth:

- `backend/security/auth.cjs`

Most API calls require a token. Admin-only routes use `requireAdmin`.

Viewer users should not see admin-only pages such as Sync History, Settings, Users, or Mitigation Review.

## UI Guidelines For This Project

Use the existing styling approach:

- Plain React components.
- CSS files per feature where already established.
- Shared CSS variables from `src/styles/theme.css` and `src/styles/index.css`.
- `lucide-react` icons.

Avoid:

- New heavy UI libraries.
- Decorative dashboard effects unless the surrounding page already uses them.
- Rewriting unrelated layout while making targeted behavior changes.
- Duplicating business logic between frontend and backend unless it is presentation-only.

## Where To Change Common Things

### Add A Dashboard Card

Start in:

- `src/features/dashboard/DashboardOverviewCards.jsx`
- `src/features/dashboard/DashboardPage.jsx`

If the card needs backend counts, update:

- `backend/data/database.cjs`
- `backend/routes/findings.cjs`

### Change Finding Filters

Start in:

- `src/app/App.jsx` — contains `renderScopeMenu()` with Redmine status pills and product/engagement scope, plus `REDMINE_STATUS_FILTER_OPTIONS`, `handleRedmineStatusChange`, and all filter state.
- `src/features/findings/FindingsPage.jsx` — command bar layout, share/export snapshot controls, severity filter panel.
- `src/features/findings/FindingsPage.css` — severity filter and command bar styling.
- `src/styles/index.css` — scope menu, Redmine pill, and popover panel styles (`.scope-*`, `.scope-redmine-pill`).

The Redmine status filter and product/engagement scope are combined in a single dropdown panel inside `renderScopeMenu()`. Redmine filter state and counts are managed in `App.jsx` and no longer passed as props to `FindingsPage`.

Share/export behavior is also coordinated from `App.jsx`:

- `buildFindingsSnapshotHash()` and `buildFindingsSnapshotUrl()` serialize the current Findings filters into `#product-findings`.
- `shareFindingsView()` copies that URL to the clipboard.
- `exportFindingsSnapshot()` exports only the currently visible compacted rows.

### Change Product Navigation

Start in:

- `src/features/products/ProductsPage.jsx`
- `src/features/products/ProductDashboardPage.jsx`
- `src/app/routes.js`
- `src/app/App.jsx`

### Change Sync History

Start in:

- `src/features/sync-history/SyncHistory.jsx`
- `src/features/sync-history/SyncHistory.css`
- `backend/data/database.cjs` for stored history shape/counts.

### Change Mitigation Review

Start in:

- `src/features/admin/MitigationReview/MitigationReview.jsx`
- `src/features/admin/MitigationReview/MitigationReview.css`
- `backend/routes/mitigation.cjs`
- `backend/data/database.cjs`
- `backend/server.cjs` for mitigation recheck orchestration.

### Change Redmine Ticket Matching

Start in:

- `backend/integrations/redmine-client.cjs`
- `backend/server.cjs`
- `src/domain/redmine/redmineTicketFormat.js`

Be careful with sync keys and legacy matching. Incorrect matching can attach findings to the wrong Redmine ticket.

## Testing Checklist

Run these before handing off code changes:

```powershell
npm run lint
npm run build
npm test
```

Manual checks for frontend changes:

- Admin login.
- Viewer login.
- Dashboard loads.
- Products page opens product dashboard.
- Findings filters work and reset correctly.
- Findings Share View opens the same filter state in a fresh tab.
- Findings CSV export contains only visible rows.
- Mitigation Review queue count matches grouped queue rows.
- Sync History table opens details and compare modal.
- Settings save still works.

Manual checks for sync changes:

- Direct DefectDojo pull.
- Sync All.
- Background Redmine poll.
- Mitigation Review queue.
- Redmine issue close from review.

## Safety Notes

- Do not auto-close Redmine tickets outside Mitigation Review.
- Do not silently preserve stale Redmine cache after clearing local data.
- Do not remove legacy Redmine sync key behavior unless the migration path is clear.
- Do not expose admin pages or admin APIs to viewer users.
- Be careful changing compaction because it affects ticket identity, Redmine matching, dashboard counts, and review queue grouping.
