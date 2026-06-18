# DefectDojo Viewer Project Guide

This guide is a practical engineering overview for working on DefectDojo Viewer. It summarizes how the app is structured, how data moves through it, how to run it safely, and what to watch during future changes.

## 1. Product Purpose

DefectDojo Viewer is a React and Express application for security teams that need to:

- Pull findings from DefectDojo.
- Compact noisy scan results into ticket-sized groups.
- Create, check, and sync Redmine issues.
- Track sync history and mitigation review decisions.
- Manage users, configuration, mapped assets, and local operational state.

The app supports PostgreSQL as the main persistent store. When PostgreSQL is not configured, the backend falls back to JSON files under `DATA_DIR`.

## 2. Technology Stack

Frontend:

- React 19 with Vite.
- Plain CSS modules by feature/component file, plus global design tokens.
- `lucide-react` for icons.
- Hash-based routing via `window.location.hash`.

Backend:

- Express 5 on Node.
- CommonJS backend modules.
- PostgreSQL via `pg`.
- JSON-file fallback using `fs-extra`.
- Server-Sent Events for dashboard and sync progress updates.

Tooling:

- `npm run dev` starts Vite only.
- `npm run server` starts the backend only.
- `npm run dev:all` starts backend and frontend together.
- `npm run build` builds the frontend.
- `npm run lint` runs ESLint.
- `npm test` runs Node test files in `test/`.

## 3. Runtime Modes

Local development:

- Backend: `http://localhost:3001`
- Frontend: Vite URL printed by the dev server.
- Vite proxies `/api` to `http://localhost:3001`.
- The frontend API base defaults to `/api`, or `VITE_API_BASE` when set.

Docker:

- `docker compose up --build -d` builds the frontend and serves it from the Express app.
- The app containers listen on internal Docker ports; compose publishes only the gateway as `${GATEWAY_PORT:-80}:80`.
- PostgreSQL runs as the `db` service.
- `DATABASE_URL` is set automatically from compose environment variables.
- Runtime data is stored in Docker volumes:
  - `postgres-data`
  - `app-data`

Important environment values:

- `PORT`: backend port, default `3001`.
- `DATA_DIR`: JSON fallback data directory, default repo root locally and `/app/data` in Docker.
- `CLIENT_DIST_DIR`: frontend build directory served by Express, default `dist`.
- `DATABASE_URL` or `PG*`: enables PostgreSQL storage.
- `PGSSLMODE`: controls PostgreSQL SSL behavior.

## 4. Frontend Architecture

The frontend follows a simple layered structure:

```text
src/
  app/                  App composition, shell, hash route resolver
  domain/               Client-side domain logic for findings and Redmine formatting
  features/             Route-sized UI areas
  shared/               Reusable API, UI, hooks, and utility modules
  styles/               Global CSS and design tokens
```

Key frontend folders:

- `src/app/`
  - Owns `App.jsx`, `AppShell.jsx`, and `routes.js`.
  - Coordinates auth state, route rendering, sync state, filters, and shared page state.
- `src/features/dashboard/`
  - Dashboard page and dashboard-specific cards.
- `src/features/findings/`
  - Findings explorer and finding detail modal.
- `src/features/mitigation-review/`
  - Admin mitigation queue, history, and review detail modals.
- `src/features/settings/`
  - Settings tabs: connection, Redmine status, backups, mapped assets, user management.
- `src/shared/ui/`
  - Reusable shell and data components such as `Topbar`, `AppSidebar`, `DataTable`, `SearchOptions`, and `Page`.
- `src/domain/findings/`
  - Frontend compaction, endpoint, vulnerability, and text utilities.
- `src/domain/redmine/`
  - Redmine ticket label and markdown formatting utilities.

Frontend conventions:

- Keep CSS colocated with the component or feature it styles.
- Use shared UI components for tables, search/filter panels, sidebar, and topbar.
- Keep route IDs and hash routes in `src/app/routes.js`.
- Prefer domain helpers in `src/domain` over duplicating parsing or compaction logic in UI files.
- API calls should go through `apiFetch` from `src/shared/api/api.js` so auth handling stays consistent.

## 5. Backend Architecture

The backend is organized by responsibility:

```text
backend/
  server.cjs            Express app bootstrap and orchestration helpers
  routes/               API route modules
  data/                 PostgreSQL and JSON persistence adapter
  domain/               Backend domain logic
  integrations/         DefectDojo and Redmine clients
  lib/                  Shared backend utilities and logging
  security/             Auth, sessions, user normalization
  migrations/           SQL migrations
```

Route registration:

- `backend/routes/index.cjs` mounts all API routes under `/api`.
- `/api/health` is registered directly in `server.cjs` and does not require auth.
- `/api/login` is public.
- Most routes after login are protected by `requireAuth`.
- Admin-only routes use `requireAdmin`.

Important route groups:

- Auth/users: `backend/routes/auth.cjs`
- Config/backups: `backend/routes/config.cjs`
- Findings/dashboard/clear: `backend/routes/findings.cjs`
- Redmine issue operations: `backend/routes/redmine.cjs`
- Sync history and Sync All: `backend/routes/sync.cjs`
- Mitigation review: `backend/routes/mitigation.cjs`
- Logs and SSE events: `backend/routes/system.cjs`

Persistence:

- `backend/data/database.cjs` is the central storage adapter.
- PostgreSQL stores users, config, backups, findings, Redmine sync state, sync history, mitigation reviews, admin actions, and mapped product/engagement data.
- JSON fallback uses repo or `DATA_DIR` files such as `users.json`, `config.json`, `sync-state.json`, and `findings.json`.

## 6. Data Flow

Typical Sync All flow:

1. Admin starts Sync All from the frontend.
2. Frontend calls `/api/sync-all`.
3. Backend pulls findings from DefectDojo.
4. Backend enriches findings with product, engagement, and endpoint context.
5. Findings are saved to PostgreSQL or JSON fallback.
6. Compaction groups findings into ticket-sized records.
7. Redmine sync checks existing issues or creates/updates issues.
8. Resolve-status tickets are rechecked against DefectDojo mitigation state.
9. Mitigated findings that require human decision enter the mitigation review queue.
10. SSE events update dashboard counts and progress UI.

Mitigation review flow:

1. Backend queues pending review items in `defectdojo_viewer_mitigation_reviews`.
2. Frontend `MitigationReview.jsx` fetches queue rows from `/api/admin/mitigation-queue`.
3. Admin reviews grouped queue rows.
4. On `Review & Close`, backend validates Redmine configuration and closes the issue.
5. Backend records a history row in admin actions.
6. Frontend history tab fetches `/api/admin/mitigation-actions?limit=200`.

## 7. Authentication and Permissions

Auth is owned by the Hub service:

- Hub stores users, credentials, app memberships, sessions, and audit events in the separate auth database configured by `AUTH_DATABASE_URL`.
- On first auth DB startup, Hub can import legacy `defectdojo_viewer_users` rows from `LEGACY_DATABASE_URL`.
- Login stores `middleware_token` and `middleware_user` in local storage so the same origin gateway can share state across `/`, `/defectdojo/`, and `/wazuh/`.
- DefectDojo `apiFetch` attaches `Authorization: Bearer <token>` to `/defectdojo/api` requests.
- DefectDojo validates Hub JWT issuer/audience/app claims and, when `AUTH_INTROSPECTION_URL` is set, calls Hub to reject revoked, suspended, or changed sessions before token expiry.
- DefectDojo local password login and local user tables are disabled by default. Set `ENABLE_LEGACY_LOCAL_AUTH=true` only as a temporary rollback path.
- A `401` response clears local auth state and dispatches `defectdojo_auth_expired`.
- Admin-only UI routes are guarded in the frontend and backed by backend `requireAdmin`.

Default local behavior:

- If no users exist in auth storage and no legacy users can be imported, Hub creates a default `admin` user with password `admin`.
- Change this immediately in any shared or deployed environment.

## 8. Styling and UI System

Global design tokens live in `src/styles/theme.css`.

Important styling conventions:

- Use CSS custom properties for colors, spacing, borders, and status tones.
- Keep product UI dense and scan-friendly.
- Use `Topbar`, `AppSidebar`, `DataTable`, and `SearchOptions` instead of rebuilding common shell controls.
- Keep feature-specific CSS inside the feature folder.
- Avoid moving component CSS into `index.css` unless it is genuinely global.

Key status tokens:

- `--critical-*`
- `--high-*`
- `--medium-*`
- `--low-*`
- `--info-*`
- `--success-*`
- `--warning-*`
- `--danger-*`

## 9. Testing and Verification

Recommended checks before handoff:

```powershell
npm run build
npm test
```

Use targeted ESLint while working on known files:

```powershell
./node_modules/.bin/eslint.cmd src/path/to/File.jsx
```

Use full lint before larger changes:

```powershell
npm run lint
```

Current test coverage is concentrated in `test/history-utils.test.cjs`, which exercises compaction, sync-key behavior, markdown generation, Redmine status helpers, sync history splitting, and mitigation review recheck decisions.

## 10. Senior Review Notes

Strengths:

- Clear feature/shared/domain split in the frontend.
- Backend has route modules, integration clients, domain helpers, and a storage adapter instead of putting everything directly into route files.
- Compaction and Redmine ticket identity logic have meaningful tests.
- Docker deployment path is straightforward and includes a PostgreSQL health check.
- SSE is used well for long-running sync feedback.

Risks and maintainability concerns:

- `backend/server.cjs` is very large and still owns many orchestration responsibilities. Future backend work should extract sync orchestration and Redmine polling into smaller services.
- `src/app/App.jsx` owns a lot of cross-feature state. New feature state should be kept local unless it truly affects routing, global shell state, or shared sync state.
- Some docs are stale compared with the current code. Treat source code as truth when docs disagree.
- Full lint may expose unrelated existing issues in dirty worktrees. Prefer targeted lint during small UI changes, then full lint before release cleanup.
- The JSON fallback mode is useful locally, but production should prefer PostgreSQL to avoid file-store consistency issues.
- Default admin credentials are convenient for first boot but unsafe for any deployed environment.

## 11. Safe Change Workflow

For UI changes:

1. Identify the owning feature folder.
2. Reuse shared UI components where possible.
3. Keep style changes colocated with the feature/component CSS.
4. Run targeted ESLint on touched JSX files.
5. Run `npm run build`.

For backend route changes:

1. Find the route module under `backend/routes`.
2. Keep external API calls inside `backend/integrations`.
3. Put reusable business rules in `backend/domain`.
4. Put persistence reads/writes in `backend/data/database.cjs`.
5. Add or update tests when changing compaction, sync identity, Redmine matching, or mitigation review behavior.

For database changes:

1. Add a SQL migration under `backend/migrations`.
2. Update the PostgreSQL adapter in `backend/data/database.cjs`.
3. Preserve JSON fallback behavior when the feature still supports local file mode.
4. Test with PostgreSQL enabled and, when feasible, with JSON fallback.

## 12. Common Tasks

Add a new frontend route:

1. Add the route ID and hash in `src/app/routes.js`.
2. Add navigation behavior in `AppShell` only if it should appear in the sidebar.
3. Render the new route in `App.jsx`.
4. Put the route UI under `src/features/<feature-name>/`.

Add a new admin API endpoint:

1. Add the route to the relevant file in `backend/routes/`.
2. Use `ctx.requireAdmin`.
3. Keep request validation close to the route.
4. Move reusable logic into `backend/domain` or `backend/data`.
5. Call from the frontend through `apiFetch`.

Add a new reusable UI component:

1. Create a folder under `src/shared/ui/<ComponentName>/`.
2. Include `<ComponentName>.jsx` and `<ComponentName>.css`.
3. Keep public props small and behavior-focused.
4. Document non-obvious usage in `src/shared/ui/README.md` if it is intended for broad reuse.

## 13. Release Checklist

- `npm run build` passes.
- `npm test` passes.
- Full lint either passes or known unrelated failures are documented.
- Docker image builds.
- `docker compose up -d` brings `auth-db`, `hub`, `db`, `defectdojo`, `wazuh`, and `gateway` to healthy state.
- Gateway smoke test passes with `SMOKE_API_BASE=http://localhost`, `SMOKE_API_PREFIX=/defectdojo/api`, `SMOKE_AUTH_BASE=http://localhost`, and `SMOKE_AUTH_PREFIX=/api`.
- `/api/health` returns `{ ok: true }`.
- Admin login works.
- Sync All can reach DefectDojo and Redmine with configured credentials.
- Dashboard counts update after sync.
- Mitigation review queue and history load from API-only data.
- Config backup/export/restore works in the target storage mode.
