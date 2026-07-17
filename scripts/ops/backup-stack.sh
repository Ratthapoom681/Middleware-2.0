#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
COMPOSE=(docker compose
  --env-file "$ROOT_DIR/.env"
  -f "$ROOT_DIR/docker-compose.yml")

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${1:-$ROOT_DIR/backups/$STAMP}"
VOLUME_NAMESPACE="${VOLUME_NAMESPACE:-defectdojo-viewer}"
WRITE_SERVICES=(gateway defectdojo auto-sync-status auth docs)
RESTART_WRITERS=1

if [[ -e "$BACKUP_DIR" ]]; then
  echo "Backup destination already exists: $BACKUP_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

restart_writers() {
  if [[ "$RESTART_WRITERS" == "1" && "${LEAVE_STOPPED:-0}" != "1" ]]; then
    "${COMPOSE[@]}" start "${WRITE_SERVICES[@]}" >/dev/null
  fi
}
trap restart_writers EXIT

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" stop "${WRITE_SERVICES[@]}"

"${COMPOSE[@]}" exec -T defectdojo_db pg_dump \
  -U "${PG_USER:-defectdojo}" \
  -d "${PG_DB:-defectdojo_viewer}" \
  --format=custom --no-owner --file=- > "$BACKUP_DIR/app-db.dump"

"${COMPOSE[@]}" exec -T auth-db pg_dump \
  -U "${AUTH_PG_USER:-middleware_auth}" \
  -d "${AUTH_PG_DB:-middleware_auth}" \
  --format=custom --no-owner --file=- > "$BACKUP_DIR/auth-db.dump"

"${COMPOSE[@]}" run --rm --no-deps --entrypoint tar defectdojo \
  -C /app/data -czf - . > "$BACKUP_DIR/defectdojo-data.tar.gz"
"${COMPOSE[@]}" run --rm --no-deps --entrypoint tar docs \
  -C /app/docs -czf - . > "$BACKUP_DIR/docs-data.tar.gz"

APP_FINDINGS="$("${COMPOSE[@]}" exec -T defectdojo_db psql \
  -U "${PG_USER:-defectdojo}" -d "${PG_DB:-defectdojo_viewer}" -Atc \
  "SELECT count(*) FROM defectdojo_viewer_findings" 2>/dev/null || echo unknown)"
AUTH_USERS="$("${COMPOSE[@]}" exec -T auth-db psql \
  -U "${AUTH_PG_USER:-middleware_auth}" -d "${AUTH_PG_DB:-middleware_auth}" -Atc \
  "SELECT count(*) FROM auth_users" 2>/dev/null || echo unknown)"

(
  cd "$BACKUP_DIR"
  sha256sum app-db.dump auth-db.dump defectdojo-data.tar.gz docs-data.tar.gz \
    > checksums.sha256
)

cat > "$BACKUP_DIR/manifest.json" <<EOF
{
  "version": 1,
  "createdAt": "$STAMP",
  "composeProject": "${COMPOSE_PROJECT_NAME:-internal-security-middleware}",
  "volumeNamespace": "$VOLUME_NAMESPACE",
  "counts": {
    "findings": "$APP_FINDINGS",
    "authUsers": "$AUTH_USERS"
  }
}
EOF

RESTART_WRITERS=0
if [[ "${LEAVE_STOPPED:-0}" != "1" ]]; then
  "${COMPOSE[@]}" start "${WRITE_SERVICES[@]}"
fi

echo "Backup complete: $BACKUP_DIR"
echo "Legacy volumes were not modified or removed."
