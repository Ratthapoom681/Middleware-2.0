# Internal Security Middleware Hub Project Guide

This guide describes the repository as it exists now. The project is a small security-tool suite behind one gateway, not a standalone DefectDojo Viewer application. It covers the runtime topology, source layout, authentication and storage boundaries, development commands, and safe change workflow.

## 1. Product Scope

The suite provides one sign-in and a workspace switcher for two internal security interfaces:

- **DefectDojo Viewer** pulls and compacts DefectDojo findings, coordinates Redmine ticket workflows, tracks sync history, and manages mitigation review.
- **Wazuh Viewer** is a frontend-only SIEM and incident-management mockup backed by local fixture data.
- **Middleware Hub** owns login, sessions, user administration, the workspace switcher, and the in-app documentation reader.

The applications are served from one browser origin so they can share the Hub session stored in `localStorage`.

## 2. Runtime Architecture

Docker Compose is the canonical integrated runtime. It starts the gateway, app services, and databases:

```text
Browser
  |
  v
gateway (Nginx, published host port)
  |-- /                 -> hub:3000
  |-- /login/           -> auth:3004
  |-- /api/login        -> auth:3004
  |-- /api/logout       -> auth:3004
  |-- /api/users        -> auth:3004
  |-- /api/auth/*       -> auth:3004
  |-- /defectdojo/*     -> defectdojo:3001
  |-- /docs/*           -> docs:3003
  `-- /wazuh/*          -> wazuh:3002

auth -------------------> auth-db (users, memberships, sessions, audit)
  `---- legacy import --> defectdojo_db

defectdojo -------------> defectdojo_db (findings, config, sync and review state)
  `---- introspection --> auth
  `---- access logs ----> linux-log-collector

wazuh ------------------> static mock data only
linux-log-collector ----> /host/var/log/secure or host journald
```

The Compose service is still named `defectdojo`, but its source is under
`apps/vulnerability/`.

Public URLs through the gateway are:

- Hub: `/`
- Login: `/login/`
- Authentication APIs: `/api/login`, `/api/logout`, `/api/users`, `/api/auth/*`
- DefectDojo Viewer: `/defectdojo/`
- DefectDojo API: `/defectdojo/api`
- Wazuh Viewer: `/wazuh/`

`GATEWAY_PORT` controls the published host port. The Compose fallback is `80`; the checked-in `.env.example` sets it to `80`.

## 3. Repository Layout

```text
apps/                    Deployable applications
  auth/{web,server}/     Login UI and identity/session API
  vulnerability/        Web, server, workers, and collectors
  docs/{web,server,content}/
packages/                Shared UI, auth, time, and test helpers
docker-compose.yml       Single Compose model with optional profiles
scripts/                 Operations and verification tooling
.env.example             Gateway, database, JWT, and service-token settings
README.md                Operator-oriented repository overview
```

There is no root `package.json`. Run npm commands with the owning directory
under `apps/` as the package prefix.

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

- React frontend using fixture data under `apps/wazuh/src/mock/`.
- Production assets served by Nginx; it has no backend or database.

## 5. Setup and Common Commands

### Integrated Docker runtime

```powershell
node scripts/compose-up.cjs
docker compose ps
```

The wrapper creates `.env` when missing, fills blank or missing managed values,
replaces known unsafe auth placeholders, and then runs
`docker compose up -d --build`. Existing non-empty secrets are preserved.

With the generated environment, open `http://localhost/`. If `.env` is absent and `GATEWAY_PORT` is not otherwise set, use `http://localhost/`.

Review `PG_PASSWORD`, `AUTH_PG_PASSWORD`, `JWT_SECRET`, `AUTH_SERVICE_TOKEN`,
`MFA_ENCRYPTION_KEY`, and `AUTH_BOOTSTRAP_ADMIN_PASSWORD` before a shared or
deployed installation.
PostgreSQL initialization values are retained in named volumes; changing
database credentials later does not rewrite an existing volume.

Useful service operations:

```powershell
docker compose logs -f gateway hub defectdojo
docker compose up -d --build hub
docker compose up -d --build defectdojo
docker compose up -d --build wazuh
```

### Package checks

```powershell
npm --prefix apps/hub run build

npm --prefix apps/auth run build
npm --prefix apps/auth test

npm --prefix apps/vulnerability run build
npm --prefix apps/vulnerability test
npm --prefix apps/vulnerability run lint

npm --prefix apps/wazuh run build
npm --prefix apps/docs run build
npm --prefix apps/docs test
```

For bounded concurrency testing, run `node scripts/concurrency-load-test.cjs --scenario=all` from the repository root. Use `LOAD_LEVELS`, `LOAD_REQUESTS_PER_WORKER`, and the latency/error thresholds documented in the root README; reports are written to ignored `load-results/` files.

Auth, Hub, and DefectDojo Viewer expose `npm run dev`, `npm run start`, and related package scripts. For shared-origin navigation, database wiring, and gateway path behavior, use Docker Compose.

Local service defaults in the checked-in configuration are:

- Hub static preview: `3000`; Hub Vite: `5174`.
- Auth backend: `3004`; Auth Vite: `5175`.
- DefectDojo backend: `3001`; DefectDojo Vite: Vite's default port.
- Wazuh Vite: `5175`.

## 6. Configuration and Environment

Compose-level variables:

- `GATEWAY_PORT`: published gateway port.
- `PG_DB`, `PG_USER`, `PG_PASSWORD`: DefectDojo application database.
- `AUTH_PG_DB`, `AUTH_PG_USER`, `AUTH_PG_PASSWORD`: authentication database.
- `JWT_SECRET`: shared JWT signing secret used by the Auth service, DefectDojo Viewer, and Docs.
- `AUTH_SERVICE_TOKEN`: shared secret for internal token introspection.

Important `auth` runtime variables:

- `PORT`: defaults to `3004`.
- `AUTH_DATABASE_URL`: primary authentication store.
- `LEGACY_DATABASE_URL`: optional source for first-start import from `defectdojo_viewer_users`.
- `DATA_DIR`: auth file-storage directory when PostgreSQL is not configured.
- `CLIENT_DIST_DIR`: built login frontend directory.
- `JWT_ISSUER`: defaults to `middleware-hub`.

Important DefectDojo runtime variables:

- `PORT`: defaults to `3001`.
- `DATABASE_URL` or PostgreSQL `PG*` variables: enable PostgreSQL persistence.
- `PGSSLMODE`: enables PostgreSQL SSL; `no-verify` disables certificate verification.
- `DATA_DIR`: JSON fallback directory; defaults to `apps/vulnerability/` locally and `/app/data` in Compose.
- `CLIENT_DIST_DIR`: built frontend directory; defaults to `apps/vulnerability/dist`.
- `AUTH_INTROSPECTION_URL`: auth session-validation endpoint.
- `AUTH_REQUIRED_APP`: required app membership, `defectdojo` in Compose.
- `ENABLE_LEGACY_LOCAL_AUTH`: disabled in Compose; enable only as a temporary rollback path.
- `DEFECTDOJO_ENDPOINT_INDIVIDUAL_FALLBACK_LIMIT`: optional endpoint-fetch fallback limit.
- `VITE_API_BASE`: frontend DefectDojo API base; defaults to `/defectdojo/api`.
- `VITE_AUTH_API_BASE`: frontend authentication API base; defaults to `/api`.

DefectDojo and Redmine connection details are operational configuration saved through the DefectDojo Viewer settings UI, not Compose secrets.

Important Linux Log Collector runtime variables:

- `AUTH_LOG_SOURCE_MODE`: `auto`, `files`, or `journal`; defaults to `auto`.
- `AUTH_LOG_PATHS`: comma-separated read-only host auth log paths; Compose checks Amazon Linux `/host/var/log/secure` before Debian-style `/host/var/log/auth.log`.
- `AUTH_JOURNAL_DIRS`: comma-separated mounted host journal directories used when file logs are unavailable.
- `AUTH_JOURNAL_UNITS`: comma-separated systemd units queried with `journalctl -o json`.
- `LINUX_AUTH_LOG_COLLECTOR_URL`: DefectDojo backend URL for the collector; defaults to `http://linux-log-collector:3011` in Compose.

## 7. Authentication and Authorization

Auth-service is the identity owner:

1. `POST /api/login` validates the user against `auth-db` (or auth file storage when no database is configured).
2. Accounts without MFA receive a one-hour JWT immediately. MFA-enabled accounts receive a five-minute, one-time challenge and obtain the JWT only after `POST /api/login/mfa` validates TOTP or an unused recovery code.
3. The frontend stores the token as `middleware_token` and the public user as `middleware_user`.
4. The shared gateway origin makes those values available at `/`, `/defectdojo/`, and `/wazuh/`.
5. DefectDojo and Docs requests attach `Authorization: Bearer <token>`.
6. Each backend validates the signature and claims locally, then calls the auth service. Explicit inactive/forbidden responses fail closed; transport and `502–504` failures temporarily use the unexpired local claims.

The roles are `admin` and `viewer`:

- Hub user management and technical documentation require `admin`.
- DefectDojo routes declare admin-only pages in `apps/vulnerability/web/src/app/routes.js`, and mutating/sensitive APIs use server `requireAdmin` middleware.
- A viewer's `products` claim limits the findings returned by the backend. Admins are unrestricted.

If production auth storage contains no users and no legacy users can be
imported, Auth requires `AUTH_BOOTSTRAP_ADMIN_PASSWORD`. It never creates
`admin` / `admin` in production or rewrites existing users.

Production also requires `MFA_ENCRYPTION_KEY`, a stable base64-encoded 32-byte key. Authenticator secrets are encrypted with AES-256-GCM; recovery codes and challenge tokens are stored only as hashes. TOTP uses SHA-1, six digits, a 30-second period, a one-period clock window, replay counters, per-challenge attempt limits, and account-level temporary locks. Production traffic must reach the gateway through TLS so setup keys and codes are never sent over plaintext networks.

DefectDojo's own `/api/login` and local user APIs return `410 Gone` unless `ENABLE_LEGACY_LOCAL_AUTH=true`. User administration in the normal runtime belongs to Hub.

## 8. Authentication and Hub Architecture

```text
apps/auth/
  server/
    server.cjs           Auth API, JWTs, sessions, users, health, static serving
    auth-store.cjs       PostgreSQL/file auth adapter and legacy import
    mfa-service.cjs      TOTP, secret encryption, recovery codes, challenge hashes
    profile-routes.cjs   Self-service Profile and MFA endpoints
  web/src/
    features/auth/       Login screen

apps/hub/
  src/
    app/App.jsx          Portal state and hash route selection
    features/hub/        Workspace switcher and health badges
    features/profile/    Profile, password, enrollment, and recovery UX
    features/users/      Central user administration
    shared/ui/           Shared Hub UI components
```

Hub hash routes are intentionally small:

- Empty hash: workspace switcher.
- `#profile`: authenticated self-service profile; an encoded internal `returnTo` restores the originating workspace.
- `#users`: user administration for admins.
- `#docs`: documentation reader. The technical documents are hidden from viewers by the backend, not only by the UI.

`apps/docs/server/docs-service.cjs` has the allowlist for documents exposed in
the reader. It serves user guides to authenticated users and technical
documents to administrators.

## 9. DefectDojo Viewer Architecture

### Frontend

```text
apps/vulnerability/web/src/
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
apps/vulnerability/server/
  server.cjs             Bootstrap, storage loading, and sync orchestration
  routes/                Auth, config, findings, Redmine, sync, mitigation, system
  data/database.cjs      PostgreSQL adapter and automatic migrations
  domain/                Compaction and sync/history rules
  integrations/          DefectDojo and Redmine HTTP clients
  security/auth.cjs      Hub JWT validation, introspection, and admin middleware
  lib/                   Logging and shared utilities
  migrations/            Ordered SQL migrations applied at startup
```

`server/routes/index.cjs` mounts the route modules under `/api`. `/api/health`
is public; the route stack protects all later application routes.
Administrative handlers also apply `requireAdmin`.

Keep external HTTP behavior in `integrations/`, reusable business rules in `domain/`, persistence in `data/database.cjs`, and request validation/response mapping in `routes/`. `server.cjs` is already large, so new independent orchestration should be extracted rather than added to the bootstrap file.

## 10. Persistence Boundaries

The two PostgreSQL services are deliberately separate.

`auth-db` is owned by Hub and contains:

- `auth_users`
- `auth_credentials`
- `auth_app_memberships`
- `auth_sessions`
- `auth_audit_events`
- `auth_mfa_config`
- `auth_mfa_recovery_codes`
- `auth_mfa_challenges`

`defectdojo_db` is owned by DefectDojo Viewer and contains configuration, backups, findings, mapped products and engagements, Redmine state/tickets, sync history, mitigation rechecks/reviews, and admin actions. Its tables use the `defectdojo_viewer_` prefix. `defectdojo_viewer_users` remains only for legacy import/local-auth compatibility.

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
- `/api/login/mfa`, `/api/profile`, `/api/profile/*`
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
- In DefectDojo Viewer, use tokens from `apps/vulnerability/web/src/styles/theme.css` for colors and status tones.
- Keep route IDs and permission metadata in `apps/vulnerability/web/src/app/routes.js`.
- Keep the interfaces dense and scan-friendly; this is operational software, not a marketing site.
- Wazuh data under `apps/wazuh/src/mock/` is demonstrative and should not be described as live SIEM ingestion.

## 14. Testing and Verification

Current automated coverage is package-specific:

- Hub tests the documentation service and documentation route utilities.
- DefectDojo tests compaction, sync keys, ticket markdown, Redmine status helpers, sync-history splitting, and mitigation recheck decisions.
- Wazuh currently has no test script; verify it with a production build and browser smoke test.

For a documentation-only change, run at least the Hub tests because the Hub is the delivery path for these Markdown files. For code changes, run the build and tests for every touched package and DefectDojo lint when that package changes.

`apps/vulnerability/test/smoke-test.cjs` exercises live APIs and expects
running Hub and DefectDojo services.

```powershell
$env:SMOKE_API_BASE = 'http://localhost'
$env:SMOKE_API_PREFIX = '/defectdojo/api'
$env:SMOKE_AUTH_BASE = 'http://localhost'
$env:SMOKE_AUTH_PREFIX = '/api'
node apps/vulnerability/test/smoke-test.cjs
```

The smoke test logs in and exercises operational endpoints, so use it only against a disposable or intentionally selected environment.

## 15. Safe Change Workflow

For gateway or deployment changes:

1. Update `docker-compose.yml`, `apps/gateway/nginx.conf`, and `.env.example` together when their contract changes.
2. Preserve the same-origin paths used by the frontend API defaults.
3. Validate with `docker compose config`, rebuild affected images, and check all three public health URLs.

For Hub/auth changes:

1. Keep credential, session, membership, and audit writes in `auth-store.cjs`.
2. Preserve issuer, audience, session ID, app membership, and role claims across signing and introspection.
3. Apply authorization in the backend even when the frontend hides a route.
4. Run Hub tests and build.

For DefectDojo frontend changes:

1. Work in the owning folder under `apps/vulnerability/web/src/features/`.
2. Reuse `shared/ui`, `shared/api`, and domain helpers.
3. Keep hash routing and admin metadata centralized.
4. Run targeted lint while iterating, then the package build and tests.

For DefectDojo backend or database changes:

1. Add routes to the appropriate module in `apps/vulnerability/server/routes/`.
2. Put integration calls, business rules, and persistence in their existing layers.
3. Add an ordered migration under `apps/vulnerability/server/migrations/` for schema changes.
4. Preserve JSON fallback only where the feature already supports it.
5. Test PostgreSQL behavior and add focused unit coverage for compaction, ticket identity, sync history, or mitigation decisions.

For documentation changes:

1. Edit the source Markdown in `apps/docs/content/`.
2. If adding or removing a document, update the allowlist in `apps/docs/server/docs-service.cjs`.
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

- `apps/vulnerability/server/server.cjs` still owns substantial sync and Redmine orchestration. Prefer extracting bounded services during related server work.
- `apps/vulnerability/web/src/app/App.jsx` coordinates a large amount of cross-feature state. Keep new state local unless it truly affects routing, authentication, the global shell, or shared sync state.
- The source folder `apps/vulnerability/`, Compose service name `defectdojo`,
  and public path `/defectdojo/` are intentionally different; check all three
  layers when moving files or changing routes.
- The Hub documentation reader serves these Markdown files directly. Documentation accuracy is therefore a user-visible application behavior, not only a repository concern.
