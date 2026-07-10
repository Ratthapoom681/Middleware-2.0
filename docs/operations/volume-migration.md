# Persistent Volume Migration

These steps are for the Linux production host. They never delete the legacy
volumes and require a brief maintenance window.

## 1. Import Existing Docs Bind Data

Run this once before switching an existing deployment from the repository bind
mount to `docs-data`:

```bash
export CONFIRM_DOCS_IMPORT="${VOLUME_NAMESPACE:-defectdojo-viewer}"
scripts/ops/import-docs-bind.sh
```

The script archives the source directory first, stops only Docs, imports the
content, verifies file counts, and restarts Docs.

## 2. Back Up the Current Namespace

```bash
scripts/ops/backup-stack.sh
```

The script stops write-producing services, creates logical dumps for both
PostgreSQL databases, archives DefectDojo and Docs volumes, writes SHA-256
checksums and a manifest, then restarts the services. Set `LEAVE_STOPPED=1`
only when continuing directly into a maintenance migration.

## 3. Restore Into a New Namespace

```bash
export CONFIRM_RESTORE="internal-security-middleware"
scripts/ops/restore-volume-namespace.sh \
  backups/<timestamp> \
  internal-security-middleware
```

The restore refuses existing target volumes, verifies checksums, restores into
an isolated temporary Compose project, prints database counts, and leaves the
new volumes stopped.

## 4. Cut Over and Verify

Set the new namespace in `.env`:

```dotenv
VOLUME_NAMESPACE=internal-security-middleware
```

Start production and verify login, dashboard counts, configuration, Docs
history, Sync History, and health endpoints:

```bash
docker compose --env-file .env -f infra/compose/compose.yml -f infra/compose/compose.prod.yml -f infra/compose/compose.observability.yml --profile host-logs up -d --build
docker compose --env-file .env -f infra/compose/compose.yml -f infra/compose/compose.prod.yml ps
```

Rollback is changing `VOLUME_NAMESPACE` back to `defectdojo-viewer` and
restarting. Do not delete legacy volumes until the agreed retention period has
passed and a restore drill has succeeded.
