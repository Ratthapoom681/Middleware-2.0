# DefectDojo Viewer

React and Express viewer for pulling DefectDojo findings, creating or checking Redmine tickets, and managing viewer users.

## Run Locally

Install dependencies:

```powershell
npm install
```

Start the API and Vite frontend:

```powershell
npm run dev:all
```

The backend listens on `http://localhost:3001` and the frontend uses the Vite URL printed by the dev server.

## Docker Deploy

Create a local `.env` from `.env.example`, then change `POSTGRES_PASSWORD`:

```powershell
Copy-Item .env.example .env
```

Build and start the app with PostgreSQL:

```powershell
docker compose up --build -d
```

Open `http://localhost:3001`. The container serves both the React frontend and the Express API from the same port, so the frontend uses `/api` by default. PostgreSQL data is stored in the `postgres-data` Docker volume, and fallback JSON data is stored in the `app-data` volume at `/app/data`.

Useful Docker commands:

```powershell
docker compose logs -f app
docker compose down
```

## Project Layout

- `backend/` contains the Express API server and PostgreSQL storage adapter.
- `src/app/` contains the React application shell.
- `src/features/` contains route-sized UI areas such as login and settings.
- `src/services/` contains client-side API and storage helpers.
- Root JSON files such as `config.json`, `users.json`, `sync-state.json`, and `config-backups/*.json` remain the default local data store. Set `DATA_DIR` before `npm run server` to point the backend at another data directory.

## PostgreSQL Storage

The app now supports PostgreSQL for persistent data. When PostgreSQL is configured, the backend stores users, configuration, configuration backups, Redmine sync state, and pulled findings in database tables. If PostgreSQL is not configured, it keeps using the existing local JSON files.

Set either `DATABASE_URL` or standard `PG*` environment variables before starting the server:

```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/defectdojo_viewer"
npm run server
```

For SSL connections, set `PGSSLMODE`:

```powershell
$env:PGSSLMODE = "require"
```

Use `PGSSLMODE=no-verify` only for environments that require TLS without local certificate validation.

On first PostgreSQL startup, the backend creates these tables automatically:

- `defectdojo_viewer_users`
- `defectdojo_viewer_config`
- `defectdojo_viewer_config_backups`
- `defectdojo_viewer_redmine_sync`
- `defectdojo_viewer_findings`

If the tables are empty, existing `users.json`, `config.json`, `config-backups/*.json`, `sync-state.json`, and findings from the configured scan folder are imported into PostgreSQL once. After that, PostgreSQL is treated as the source of truth while it remains configured.

## Config Backup Workflow

Admins can create server-side config backups from Settings. Backups are stored in `DATA_DIR/config-backups` when using local JSON storage, or in the PostgreSQL `defectdojo_viewer_config_backups` table when database storage is enabled.

- `Backup Now` saves the current server config as a restorable backup.
- `Download Selected` downloads a selected server backup as an importable JSON file for another deployment.
- `Import JSON` accepts either an older raw config export or a downloaded backup JSON with metadata, and creates a pre-import backup first.
- `Restore Selected` applies a backup already stored on the server, and creates a pre-restore backup first.

## Useful Commands

Build the frontend:

```powershell
npm run build
```

Run linting:

```powershell
npm run lint
```
# Middleware-2.0
# Middleware-2.0
# Middleware-2.0
