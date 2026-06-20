#!/usr/bin/env bash
set -Eeuo pipefail

GITHUB_REPOSITORY="${MIDDLEWARE_GITHUB_REPOSITORY:-Ratthapoom681/Middleware-2.0}"
INSTALL_DIR="${MIDDLEWARE_HUB_HOME:-/opt/middleware-hub}"
VERSION="latest"
GATEWAY_PORT="8080"
PORT_WAS_SET="false"
ALL_IN_ONE="false"
UPGRADE="false"

show_help() {
  cat <<'EOF'
Middleware Hub installer

Usage:
  sudo bash middleware-install.sh --all-in-one [options]

Options:
  -a, --all-in-one       Install the complete stack
      --version VERSION  Install a release such as 1.0.0 (default: latest)
      --port PORT        Host HTTP port (default: 8080)
      --install-dir DIR  Installation directory (default: /opt/middleware-hub)
      --upgrade          Preserve configuration and upgrade an existing install
  -h, --help             Show this help
EOF
}

log() {
  printf '[middleware-hub] %s\n' "$*"
}

fail() {
  printf '[middleware-hub] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

generate_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

set_env_value() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "${file}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${file}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--all-in-one)
      ALL_IN_ONE="true"
      shift
      ;;
    --version)
      [[ $# -ge 2 ]] || fail "--version requires a value"
      VERSION="${2#v}"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || fail "--port requires a value"
      GATEWAY_PORT="$2"
      PORT_WAS_SET="true"
      shift 2
      ;;
    --install-dir)
      [[ $# -ge 2 ]] || fail "--install-dir requires a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --upgrade)
      UPGRADE="true"
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

[[ "${ALL_IN_ONE}" == "true" ]] || fail "Use --all-in-one (or -a) to install the stack"
[[ "${EUID}" -eq 0 ]] || fail "Run this installer with sudo"
[[ "${GATEWAY_PORT}" =~ ^[0-9]+$ ]] || fail "Port must be a number"
(( GATEWAY_PORT >= 1 && GATEWAY_PORT <= 65535 )) || fail "Port must be between 1 and 65535"

require_command curl
require_command tar
require_command sha256sum
require_command docker
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
docker info >/dev/null 2>&1 || fail "Docker is not running"

if [[ "${UPGRADE}" == "true" && ! -f "${INSTALL_DIR}/.env" ]]; then
  fail "No existing installation found in ${INSTALL_DIR}"
fi
if [[ "${UPGRADE}" != "true" && -f "${INSTALL_DIR}/.env" ]]; then
  fail "Middleware Hub is already installed. Use middleware-hub upgrade instead."
fi

temp_dir="$(mktemp -d)"
trap 'rm -rf "${temp_dir}"' EXIT

if [[ "${VERSION}" == "latest" ]]; then
  release_base="https://github.com/${GITHUB_REPOSITORY}/releases/latest/download"
else
  release_base="https://github.com/${GITHUB_REPOSITORY}/releases/download/v${VERSION}"
fi

log "Downloading the ${VERSION} release from GitHub"
curl -fL --retry 3 --connect-timeout 15 -o "${temp_dir}/middleware-hub-bundle.tar.gz" "${release_base}/middleware-hub-bundle.tar.gz"
curl -fL --retry 3 --connect-timeout 15 -o "${temp_dir}/SHA256SUMS" "${release_base}/SHA256SUMS"

(
  cd "${temp_dir}"
  grep ' middleware-hub-bundle.tar.gz$' SHA256SUMS | sha256sum -c -
) || fail "Release checksum verification failed"

tar -xzf "${temp_dir}/middleware-hub-bundle.tar.gz" -C "${temp_dir}"
bundle_dir="${temp_dir}/middleware-hub"
[[ -f "${bundle_dir}/compose.yaml" ]] || fail "Release bundle is missing compose.yaml"
[[ -f "${bundle_dir}/VERSION" ]] || fail "Release bundle is missing VERSION"
release_version="$(tr -d '[:space:]' < "${bundle_dir}/VERSION")"
[[ -n "${release_version}" ]] || fail "Release VERSION is empty"

previous_version=""
if [[ -f "${INSTALL_DIR}/VERSION" ]]; then
  previous_version="$(tr -d '[:space:]' < "${INSTALL_DIR}/VERSION")"
fi

install -d -m 0755 "${INSTALL_DIR}"
install -m 0644 "${bundle_dir}/compose.yaml" "${INSTALL_DIR}/compose.yaml"
install -m 0644 "${bundle_dir}/VERSION" "${INSTALL_DIR}/VERSION"
install -m 0755 "${bundle_dir}/middleware-install.sh" "${INSTALL_DIR}/middleware-install.sh"
install -m 0755 "${bundle_dir}/middleware-hub" "${INSTALL_DIR}/middleware-hub"
install -m 0755 "${bundle_dir}/middleware-hub" /usr/local/bin/middleware-hub

credentials_file="${INSTALL_DIR}/initial-credentials.txt"
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  umask 077
  pg_password="$(generate_hex 24)"
  auth_pg_password="$(generate_hex 24)"
  jwt_secret="$(generate_hex 48)"
  auth_service_token="$(generate_hex 48)"
  admin_password="$(generate_hex 12)"

  cat > "${INSTALL_DIR}/.env" <<EOF
APP_VERSION=${release_version}
IMAGE_REGISTRY=ghcr.io/ratthapoom681
IMAGE_PREFIX=middleware-2.0
GATEWAY_BIND_ADDRESS=0.0.0.0
GATEWAY_PORT=${GATEWAY_PORT}
PG_DB=defectdojo_viewer
PG_USER=defectdojo
PG_PASSWORD=${pg_password}
AUTH_PG_DB=middleware_auth
AUTH_PG_USER=middleware_auth
AUTH_PG_PASSWORD=${auth_pg_password}
JWT_SECRET=${jwt_secret}
AUTH_SERVICE_TOKEN=${auth_service_token}
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=${admin_password}
EOF
  cat > "${credentials_file}" <<EOF
Middleware Hub initial administrator
Username: admin
Password: ${admin_password}
EOF
  chmod 0600 "${INSTALL_DIR}/.env" "${credentials_file}"
else
  set_env_value "${INSTALL_DIR}/.env" APP_VERSION "${release_version}"
  if [[ "${PORT_WAS_SET}" == "true" ]]; then
    set_env_value "${INSTALL_DIR}/.env" GATEWAY_PORT "${GATEWAY_PORT}"
  else
    GATEWAY_PORT="$(sed -n 's/^GATEWAY_PORT=//p' "${INSTALL_DIR}/.env" | tail -n 1)"
    GATEWAY_PORT="${GATEWAY_PORT:-8080}"
  fi
fi

compose=(docker compose --project-directory "${INSTALL_DIR}" --env-file "${INSTALL_DIR}/.env" -f "${INSTALL_DIR}/compose.yaml")
log "Validating deployment configuration"
"${compose[@]}" config --quiet

if [[ "${UPGRADE}" == "true" ]]; then
  log "Creating a database backup before upgrading"
  bash "${INSTALL_DIR}/middleware-hub" backup
fi

log "Pulling version ${release_version} container images"
"${compose[@]}" pull
log "Starting Middleware Hub"
"${compose[@]}" up -d --remove-orphans

healthy="false"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "http://127.0.0.1:${GATEWAY_PORT}/api/health" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    healthy="true"
    break
  fi
  sleep 5
done

if [[ "${healthy}" != "true" ]]; then
  "${compose[@]}" ps >&2 || true
  if [[ -n "${previous_version}" && "${previous_version}" != "${release_version}" ]]; then
    log "Health check failed; restoring image version ${previous_version}"
    set_env_value "${INSTALL_DIR}/.env" APP_VERSION "${previous_version}"
    "${compose[@]}" up -d --remove-orphans || true
  fi
  fail "The stack did not become healthy. Run: middleware-hub logs"
fi

log "Middleware Hub ${release_version} is ready at http://SERVER_IP:${GATEWAY_PORT}/"
if [[ -f "${credentials_file}" ]]; then
  log "Initial credentials: ${credentials_file} (delete it after changing the password)"
fi
