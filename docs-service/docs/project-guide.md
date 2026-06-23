# Internal Security Middleware Hub Project Guide

This guide describes the repository as it exists now. The project is a small security-tool suite behind one gateway, not a standalone DefectDojo Viewer application. It covers the runtime topology, source layout, authentication and storage boundaries, development commands, and safe change workflow.

## 1. Product Scope

The suite provides one sign-in and a workspace switcher for two internal security interfaces:

- **DefectDojo Viewer** pulls and compacts DefectDojo findings, coordinates Redmine ticket workflows, tracks sync history, and manages mitigation review.
- **Wazuh Viewer** is a frontend-only SIEM and incident-management mockup backed by local fixture data.
- **Middleware Hub** owns login, sessions, user administration, the workspace switcher, and the in-app documentation reader.

The applications are served from one browser origin so they can share the Hub session stored in `localStorage`.

## 2. Runtime Architecture

Docker Compose is the canonical integrated runtime. It starts six services:

```text
Browser
  |
  v
gateway (Nginx, published host port)
  |-- /                 -> hub:3000
  |-- /api/*            -> hub:3000
  |-- /defectdojo/*     -> defectdojo:3001
  `-- /wazuh/*          -> wazuh:3002

hub --------------------> auth-db (users, memberships, sessions, audit)
  `---- legacy import --> db

defectdojo -------------> db (findings, config, sync and review state)
  `---- introspection --> hub

wazuh ------------------> static mock data only
```

The Compose service is still named `defectdojo`, but its build context is the `vulnerability-service/` directory.

Public URLs through the gateway are:

- Hub: `/`
- Hub API: `/api`
- DefectDojo Viewer: `/defectdojo/`
- DefectDojo API: `/defectdojo/api`
- Wazuh Viewer: `/wazuh/`

`GATEWAY_PORT` controls the published host port. The Compose fallback is `80`; the checked-in `.env.example` sets it to `8080`.

## 3. Repository Layout

```text
gateway-service/         Nginx gateway and path routing
hub-service/             Hub React frontend and Express auth backend
vulnerability-service/   DefectDojo Viewer React frontend and Express backend
wazuh-service/           Static React Wazuh mockup and its Nginx image
docs-service/            Documentation reader and Markdown content
docker-compose.yml       Integrated six-service deployment
.env.example             Gateway, database, JWT, and service-token settings
README.md                Operator-oriented repository overview
```

There is no root `package.json`. Run npm commands with `hub-service`, `vulnerability-service`, `wazuh-service`, or `docs-service` as the package prefix.

## 4. Technology Stack

Shared frontend stack:

- React 19 and Vite 8.
- Plain colocated CSS stylesheets.
- `lucide-react` icons.
- Hash-based application routing.

Hub:

- Express 5 backend and React frontend.
- PostgreSQL through `pg`, with a JSON-file fallback for auth storage.
- HMAC-SHA256 JWT access tokens.
- Markdown documentation rendered with `react-markdown`, `remark-gfm`, and Mermaid.

DefectDojo Viewer:

- Express 5 backend using CommonJS modules.
- PostgreSQL through `pg`, with JSON files as a fallback.
- `axios` clients for DefectDojo and Redmine integrations.
- Server-Sent Events (SSE) for dashboard and sync progress.

Wazuh Viewer:

- React frontend using fixture data under `wazuh-service/src/mock/`.
- Production assets served by Nginx; it has no backend or database.

## 5. Setup and Common Commands

### Integrated Docker runtime

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

With the sample environment, open `http://localhost:8080/`. If `.env` is absent and `GATEWAY_PORT` is not otherwise set, use `http://localhost/`.

Change `PG_PASSWORD`, `AUTH_PG_PASSWORD`, `JWT_SECRET`, and `AUTH_SERVICE_TOKEN` before a shared or deployed installation. PostgreSQL initialization values are retained in named volumes; changing database credentials later does not rewrite an existing volume.

Useful service operations:

```powershell
docker compose logs -f gateway hub defectdojo
docker compose up -d --build hub
docker compose up -d --build defectdojo
docker compose up -d --build wazuh
```

### Package checks

```powershell
npm --prefix hub-service run build
npm --prefix hub-service test

npm --prefix vulnerability-service run build
npm --prefix vulnerability-service test
npm --prefix vulnerability-service run lint

npm --prefix wazuh-service run build
```

The Hub and DefectDojo Viewer also expose `npm run dev`, `npm run start`, and related package scripts. For complete login, shared-origin navigation, database wiring, and gateway path behavior, use Docker Compose. The current Hub Vite development proxy sends `/api` to `localhost:3001`, so it is not by itself an equivalent replacement for the integrated gateway/auth runtime.

Local service defaults in the checked-in configuration are:

- Hub backend: `3000`; Hub Vite: `5174`.
- DefectDojo backend: `3001`; DefectDojo Vite: Vite's default port.
- Wazuh Vite: `5175`.

## 6. Configuration and Environment

Compose-level variables:

- `GATEWAY_PORT`: published gateway port.
- `PG_DB`, `PG_USER`, `PG_PASSWORD`: DefectDojo application database.
- `AUTH_PG_DB`, `AUTH_PG_USER`, `AUTH_PG_PASSWORD`: Hub authentication database.
- `JWT_SECRET`: shared JWT signing secret used by Hub and DefectDojo Viewer.
- `AUTH_SERVICE_TOKEN`: shared secret for Hub token introspection.

Important Hub runtime variables:

- `PORT`: defaults to `3000`.
- `AUTH_DATABASE_URL`: primary authentication store.
- `LEGACY_DATABASE_URL`: optional source for first-start import from `defectdojo_viewer_users`.
- `DATA_DIR`: Hub file-storage directory when PostgreSQL is not configured.
- `CLIENT_DIST_DIR`: built Hub frontend directory.
- `DOCS_DIR`: Markdown documentation directory; Compose mounts `docs-service/docs/` at `/app/docs` read-only.
- `JWT_ISSUER`: defaults to `middleware-hub`.

Important DefectDojo runtime variables:

- `PORT`: defaults to `3001`.
- `DATABASE_URL` or PostgreSQL `PG*` variables: enable PostgreSQL persistence.
- `PGSSLMODE`: enables PostgreSQL SSL; `no-verify` disables certificate verification.
- `DATA_DIR`: JSON fallback directory; defaults to `vulnerability-service/` locally and `/app/data` in Compose.
- `CLIENT_DIST_DIR`: built frontend directory; defaults to `vulnerability-service/dist`.
- `AUTH_INTROSPECTION_URL`: Hub session validation endpoint.
- `AUTH_REQUIRED_APP`: required app membership, `defectdojo` in Compose.
- `ENABLE_LEGACY_LOCAL_AUTH`: disabled in Compose; enable only as a temporary rollback path.
- `DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT`: optional endpoint-fetch fallback limit.
- `VITE_API_BASE`: frontend DefectDojo API base; defaults to `/defectdojo/api`.
- `VITE_AUTH_API_BASE`: frontend Hub API base; defaults to `/api`.

DefectDojo and Redmine connection details are operational configuration saved through the DefectDojo Viewer settings UI, not Compose secrets.

## 7. Authentication and Authorization

Hub is the identity owner:

1. `POST /api/login` validates the user against `auth-db` (or Hub file storage when no auth database is configured).
2. Hub creates a session and returns a one-hour JWT containing issuer, audience, session, role, membership, and product-scope claims.
3. The frontend stores the token as `middleware_token` and the public user as `middleware_user`.
4. The shared gateway origin makes those values available at `/`, `/defectdojo/`, and `/wazuh/`.
5. DefectDojo requests attach `Authorization: Bearer <token>`.
6. DefectDojo validates the signature and claims, then calls Hub introspection when `AUTH_INTROSPECTION_URL` is configured. Revoked sessions, suspended users, and changed permissions therefore take effect before JWT expiry.

The roles are `admin` and `viewer`:

- Hub user management and technical documentation require `admin`.
- DefectDojo routes declare admin-only pages in `vulnerability-service/src/app/routes.js`, and mutating/sensitive APIs use backend `requireAdmin` middleware.
- A viewer's `products` claim limits the findings returned by the backend. Admins are unrestricted.

If auth storage contains no users and no legacy users can be imported, Hub creates `admin` / `admin`. Change that password immediately outside local development.

DefectDojo's own `/api/login` and local user APIs return `410 Gone` unless `ENABLE_LEGACY_LOCAL_AUTH=true`. User administration in the normal runtime belongs to Hub.

## 8. Hub Architecture

```text
hub-service/
  backend/
    server.cjs           Auth API, JWTs, sessions, users, health, static serving
    auth-store.cjs       PostgreSQL/file auth adapter and legacy import
    docs-service.cjs     Safe, role-filtered reads from docs/
  src/
    app/App.jsx          Login state and hash route selection
    features/auth/       Login screen
    features/hub/        Workspace switcher and health badges
    features/users/      Central user administration
    features/docs/       Markdown/Mermaid documentation reader
    shared/ui/           Shared Hub UI components
```

Hub hash routes are intentionally small:

- Empty hash: workspace switcher.
- `#users`: user administration for admins.
- `#docs`: documentation reader. The technical documents are hidden from viewers by the backend, not only by the UI.

`docs-service/backend/docs-service.cjs` has the allowlist for documents exposed in the reader. At present it serves the user guides to all authenticated users and also serves `project-guide.md` to admins.

## 9. DefectDojo Viewer Architecture

### Frontend

```text
vulnerability-service/src/
  app/                   App composition, shell, and hash route resolver
  domain/findings/       Finding normalization and compaction logic
  domain/redmine/        Redmine ticket formatting
  features/              Route-sized UI features
  shared/api/            Authenticated Hub/DefectDojo fetch wrappers and SSE client
  shared/lib/            Cross-feature helpers
  shared/ui/             Reusable page, table, search, sidebar, and topbar components
  styles/                Global styles and design tokens
```

Routes include dashboard, findings, products, product dashboard/findings, sync history, mitigation review, management dashboard, settings, and users. The last five administrative routes are guarded by the route resolver and the server APIs they call.

Use `apiFetch` for DefectDojo calls and `authFetch` for Hub-owned user calls. A `401` clears the shared credentials and redirects to the Hub root.

### Backend

```text
vulnerability-service/backend/
  server.cjs             Bootstrap, storage loading, and sync orchestration
  routes/                Auth, config, findings, Redmine, sync, mitigation, system
  data/database.cjs      PostgreSQL adapter and automatic migrations
  domain/                Compaction and sync/history rules
  integrations/          DefectDojo and Redmine HTTP clients
  security/auth.cjs      Hub JWT validation, introspection, and admin middleware
  lib/                   Logging and shared utilities
  migrations/            Ordered SQL migrations applied at startup
```

`backend/routes/index.cjs` mounts the route modules under `/api`. `/api/health` is public; the route stack protects all later application routes. Administrative handlers also apply `requireAdmin`.

Keep external HTTP behavior in `integrations/`, reusable business rules in `domain/`, persistence in `data/database.cjs`, and request validation/response mapping in `routes/`. `server.cjs` is already large, so new independent orchestration should be extracted rather than added to the bootstrap file.

## 10. Persistence Boundaries

The two PostgreSQL services are deliberately separate.

`auth-db` is owned by Hub and contains:

- `auth_users`
- `auth_credentials`
- `auth_app_memberships`
- `auth_sessions`
- `auth_audit_events`

`db` is owned by DefectDojo Viewer and contains configuration, backups, findings, mapped products and engagements, Redmine state/tickets, sync history, mitigation rechecks/reviews, and admin actions. Its tables use the `defectdojo_viewer_` prefix. `defectdojo_viewer_users` remains only for legacy import/local-auth compatibility.

When PostgreSQL is not configured, DefectDojo falls back to files under `DATA_DIR`, including:

- `config.json`
- `config-backups/`
- `findings.json`
- `sync-state.json`
- `users.json` only when legacy local auth is enabled

Hub similarly falls back to `users.json` under its `DATA_DIR`; file-mode sessions are in memory and do not survive a restart. Production should use both PostgreSQL services.

Compose persists state in `auth-data`, `postgres-data`, and `defectdojo-data` volumes.

## 11. DefectDojo and Redmine Data Flow

A typical **Sync All** run is:

1. An admin starts Sync All in DefectDojo Viewer.
2. The frontend posts filters to `/defectdojo/api/sync-all`.
3. The backend pulls findings and product/engagement/endpoint context from DefectDojo.
4. Raw findings and mapped entities are persisted.
5. Backend and frontend compaction rules group repeated scan output into stable, ticket-sized records.
6. Redmine matching uses deterministic sync keys, while retaining legacy-key compatibility.
7. Existing tickets are checked and eligible tickets are created or updated.
8. Resolved Redmine tickets are rechecked against DefectDojo mitigation state.
9. Cases requiring a human decision enter the mitigation review queue.
10. Sync history and severity splits are persisted, while SSE events update progress and dashboard state.

The authenticated SSE endpoint is `/defectdojo/api/sync/events`. The gateway has a dedicated location that disables proxy buffering and extends the read timeout.

Mitigation review state is stored separately from the action history. Admins can close or ignore queued review groups; the backend confirms Redmine transitions and records the administrative action.

## 12. API Ownership

Hub owns:

- `/api/login`, `/api/logout`
- `/api/auth/introspect`
- `/api/users`
- `/api/docs`
- `/api/health`

DefectDojo Viewer owns these groups behind `/defectdojo/api` at the gateway:

- Configuration and backups: `/config*`
- Dashboard/findings/compaction: `/dashboard/summary`, `/findings`, `/compacted-cves`
- Pull and clearing: `/pull`, `/clear`
- Redmine: `/redmine/*`
- Sync: `/sync-all`, `/sync-history*`, `/sync/events`
- Mitigation: `/mitigation-rechecks`, `/admin/mitigation-*`
- Runtime logs: `/logs`
- Health: `/health`

Do not add Hub identity writes to the DefectDojo database or DefectDojo workflow state to `auth-db`.

## 13. Styling and UI Conventions

- Keep feature-specific CSS next to the owning component.
- Use shared page, table, search, sidebar, and topbar components instead of rebuilding common controls.
- In DefectDojo Viewer, use tokens from `vulnerability-service/src/styles/theme.css` for colors and status tones.
- Keep route IDs and permission metadata in `vulnerability-service/src/app/routes.js`.
- Keep the interfaces dense and scan-friendly; this is operational software, not a marketing site.
- Wazuh data under `wazuh-service/src/mock/` is demonstrative and should not be described as live SIEM ingestion.

## 14. Testing and Verification

Current automated coverage is package-specific:

- Hub tests the documentation service and documentation route utilities.
- DefectDojo tests compaction, sync keys, ticket markdown, Redmine status helpers, sync-history splitting, and mitigation recheck decisions.
- Wazuh currently has no test script; verify it with a production build and browser smoke test.

For a documentation-only change, run at least the Hub tests because the Hub is the delivery path for these Markdown files. For code changes, run the build and tests for every touched package and DefectDojo lint when that package changes.

`vulnerability-service/smoke-test.cjs` exercises live APIs and expects running Hub and DefectDojo services. Its defaults target the services directly. Through the gateway, use:

```powershell
$env:SMOKE_API_BASE = 'http://localhost:8080'
$env:SMOKE_API_PREFIX = '/defectdojo/api'
$env:SMOKE_AUTH_BASE = 'http://localhost:8080'
$env:SMOKE_AUTH_PREFIX = '/api'
node vulnerability-service/smoke-test.cjs
```

The smoke test logs in and exercises operational endpoints, so use it only against a disposable or intentionally selected environment.

## 15. Safe Change Workflow

For gateway or deployment changes:

1. Update `docker-compose.yml`, `gateway-service/nginx.conf`, and `.env.example` together when their contract changes.
2. Preserve the same-origin paths used by the frontend API defaults.
3. Validate with `docker compose config`, rebuild affected images, and check all three public health URLs.

For Hub/auth changes:

1. Keep credential, session, membership, and audit writes in `auth-store.cjs`.
2. Preserve issuer, audience, session ID, app membership, and role claims across signing and introspection.
3. Apply authorization in the backend even when the frontend hides a route.
4. Run Hub tests and build.

For DefectDojo frontend changes:

1. Work in the owning folder under `vulnerability-service/src/features/`.
2. Reuse `shared/ui`, `shared/api`, and domain helpers.
3. Keep hash routing and admin metadata centralized.
4. Run targeted lint while iterating, then the package build and tests.

For DefectDojo backend or database changes:

1. Add routes to the appropriate module in `vulnerability-service/backend/routes/`.
2. Put integration calls, business rules, and persistence in their existing layers.
3. Add an ordered migration under `vulnerability-service/backend/migrations/` for schema changes.
4. Preserve JSON fallback only where the feature already supports it.
5. Test PostgreSQL behavior and add focused unit coverage for compaction, ticket identity, sync history, or mitigation decisions.

For documentation changes:

1. Edit the source Markdown in `docs-service/docs/`.
2. If adding or removing a document, update the allowlist in `docs-service/backend/docs-service.cjs`.
3. Verify role visibility, headings, links, tables, code fences, and Mermaid rendering in the Hub reader.

## 16. Release Checklist

- `docker compose config` succeeds.
- Hub build and tests pass.
- DefectDojo build, tests, and lint pass, or unrelated lint failures are documented.
- Wazuh production build passes.
- `docker compose up -d --build` brings all six services up.
- `docker compose ps` reports healthy application and gateway services.
- `/api/health` returns Hub health and auth storage mode.
- `/defectdojo/api/health` returns DefectDojo health and application storage mode.
- `/wazuh/` serves the static application.
- Hub login, logout, user administration, and documentation role filtering work.
- Navigation preserves the shared session across all three browser paths.
- DefectDojo can reach configured DefectDojo and Redmine instances.
- Sync All, SSE progress, dashboard refresh, sync history, mitigation review, and config backup/restore work in the target storage mode.
- Default credentials and sample secrets have been replaced before deployment.

## 17. Current Maintenance Notes

- `vulnerability-service/backend/server.cjs` still owns substantial sync and Redmine orchestration. Prefer extracting bounded services during related backend work.
- `vulnerability-service/src/app/App.jsx` coordinates a large amount of cross-feature state. Keep new state local unless it truly affects routing, authentication, the global shell, or shared sync state.
- The source folder name `vulnerability-service/`, Compose service name `defectdojo`, and public path `/defectdojo/` are intentionally different; check all three layers when moving files or changing routes.
- The Hub documentation reader serves these Markdown files directly. Documentation accuracy is therefore a user-visible application behavior, not only a repository concern.
