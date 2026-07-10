#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <backup-directory> <target-volume-namespace>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="$(cd "$1" && pwd)"
TARGET_NAMESPACE="$2"
RESTORE_PROJECT="${COMPOSE_PROJECT_NAME:-internal-security-middleware}-restore"
COMPOSE=(docker compose
  --env-file "$ROOT_DIR/.env"
  -f "$ROOT_DIR/infra/compose/compose.yml"
  -f "$ROOT_DIR/infra/compose/compose.prod.yml")

if [[ ! "$TARGET_NAMESPACE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "Invalid target namespace: $TARGET_NAMESPACE" >&2
  exit 1
fi
if [[ "${CONFIRM_RESTORE:-}" != "$TARGET_NAMESPACE" ]]; then
  echo "Set CONFIRM_RESTORE=$TARGET_NAMESPACE to authorize this restore." >&2
  exit 1
fi

for required in manifest.json checksums.sha256 app-db.dump auth-db.dump \
  defectdojo-data.tar.gz docs-data.tar.gz; do
  [[ -f "$BACKUP_DIR/$required" ]] || {
    echo "Missing backup artifact: $required" >&2
    exit 1
  }
done
(cd "$BACKUP_DIR" && sha256sum --check checksums.sha256)

TARGET_VOLUMES=(
  "${TARGET_NAMESPACE}_postgres-data"
  "${TARGET_NAMESPACE}_auth-data"
  "${TARGET_NAMESPACE}_defectdojo-data"
  "${TARGET_NAMESPACE}_docs-data"
)
for volume in "${TARGET_VOLUMES[@]}"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "Refusing to overwrite existing target volume: $volume" >&2
    exit 1
  fi
done
for volume in "${TARGET_VOLUMES[@]}"; do
  docker volume create "$volume" >/dev/null
done

export VOLUME_NAMESPACE="$TARGET_NAMESPACE"
"${COMPOSE[@]}" -p "$RESTORE_PROJECT" up -d --wait db auth-db

"${COMPOSE[@]}" -p "$RESTORE_PROJECT" exec -T db pg_restore \
  -U "${PG_USER:-defectdojo}" \
  -d "${PG_DB:-defectdojo_viewer}" \
  --no-owner --clean --if-exists < "$BACKUP_DIR/app-db.dump"
"${COMPOSE[@]}" -p "$RESTORE_PROJECT" exec -T auth-db pg_restore \
  -U "${AUTH_PG_USER:-middleware_auth}" \
  -d "${AUTH_PG_DB:-middleware_auth}" \
  --no-owner --clean --if-exists < "$BACKUP_DIR/auth-db.dump"

"${COMPOSE[@]}" -p "$RESTORE_PROJECT" run --rm --no-deps --entrypoint sh defectdojo \
  -c 'tar -xzf - -C /app/data' < "$BACKUP_DIR/defectdojo-data.tar.gz"
"${COMPOSE[@]}" -p "$RESTORE_PROJECT" run --rm --no-deps --entrypoint sh docs \
  -c 'tar -xzf - -C /app/docs' < "$BACKUP_DIR/docs-data.tar.gz"

"${COMPOSE[@]}" -p "$RESTORE_PROJECT" exec -T db psql \
  -U "${PG_USER:-defectdojo}" -d "${PG_DB:-defectdojo_viewer}" -Atc \
  "SELECT count(*) AS findings FROM defectdojo_viewer_findings"
"${COMPOSE[@]}" -p "$RESTORE_PROJECT" exec -T auth-db psql \
  -U "${AUTH_PG_USER:-middleware_auth}" -d "${AUTH_PG_DB:-middleware_auth}" -Atc \
  "SELECT count(*) AS users FROM auth_users"

"${COMPOSE[@]}" -p "$RESTORE_PROJECT" down

echo "Restore complete in namespace: $TARGET_NAMESPACE"
echo "Set VOLUME_NAMESPACE=$TARGET_NAMESPACE and run the normal production startup."
echo "Legacy volumes remain untouched for rollback."
