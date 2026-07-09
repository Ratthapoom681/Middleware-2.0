#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

SOURCE_DIR="${1:-$ROOT_DIR/docs-service/docs}"
VOLUME_NAMESPACE="${VOLUME_NAMESPACE:-defectdojo-viewer}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_DIR="$ROOT_DIR/backups/docs-bind-$STAMP"

[[ -d "$SOURCE_DIR" ]] || {
  echo "Docs source directory does not exist: $SOURCE_DIR" >&2
  exit 1
}
if [[ "${CONFIRM_DOCS_IMPORT:-}" != "$VOLUME_NAMESPACE" ]]; then
  echo "Set CONFIRM_DOCS_IMPORT=$VOLUME_NAMESPACE to authorize this import." >&2
  exit 1
fi

mkdir -p "$ARCHIVE_DIR"
tar -C "$SOURCE_DIR" -czf "$ARCHIVE_DIR/docs-bind.tar.gz" .
(cd "$ARCHIVE_DIR" && sha256sum docs-bind.tar.gz > checksums.sha256)

docker compose stop docs
restart_docs() {
  docker compose start docs >/dev/null
}
trap restart_docs EXIT

docker compose run --rm --no-deps --entrypoint sh docs \
  -c 'tar -xzf - -C /app/docs' < "$ARCHIVE_DIR/docs-bind.tar.gz"

SOURCE_COUNT="$(find "$SOURCE_DIR" -type f | wc -l | tr -d ' ')"
TARGET_COUNT="$(docker compose run --rm --no-deps --entrypoint sh docs \
  -c "find /app/docs -type f | wc -l" | tr -d '[:space:]')"
if [[ "$TARGET_COUNT" -lt "$SOURCE_COUNT" ]]; then
  echo "Docs verification failed: source=$SOURCE_COUNT target=$TARGET_COUNT" >&2
  exit 1
fi

trap - EXIT
docker compose start docs
echo "Docs import complete; archive: $ARCHIVE_DIR"
