#!/usr/bin/env sh
set -eu

repository_url="${REPOSITORY_URL:-https://github.com/Ratthapoom681/Middleware-2.0.git}"
version="${VERSION:-V1.4}"
if [ "$(id -u)" -eq 0 ]; then
    default_install_directory='/opt/middleware-2.0'
else
    default_install_directory="$HOME/Middleware-2.0"
fi
install_directory="${INSTALL_DIRECTORY:-$default_install_directory}"
skip_start="${SKIP_START:-false}"

usage() {
    cat <<'EOF'
Usage: ./install.sh [options]

Options:
  -a, --all-in-one   Install and start the complete stack (default mode)
  --repository URL    Main Git repository URL
  --version REF       Git branch or tag to install (default: V1.4)
  --directory PATH    Installation directory
  --skip-start        Clone and configure without starting Docker
  -h, --help          Show this help
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        -a|--all-in-one)
            skip_start='false'
            shift
            ;;
        --repository)
            [ "$#" -ge 2 ] || { echo 'Missing value for --repository' >&2; exit 2; }
            repository_url="$2"
            shift 2
            ;;
        --version)
            [ "$#" -ge 2 ] || { echo 'Missing value for --version' >&2; exit 2; }
            version="$2"
            shift 2
            ;;
        --directory)
            [ "$#" -ge 2 ] || { echo 'Missing value for --directory' >&2; exit 2; }
            install_directory="$2"
            shift 2
            ;;
        --skip-start)
            skip_start='true'
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

require_command() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "Required command '$1' was not found. $2" >&2
        exit 1
    }
}

random_hex() {
    byte_count="${1:-32}"
    od -An -N "$byte_count" -tx1 /dev/urandom | tr -d ' \n'
}

set_env_value() {
    env_path="$1"
    env_key="$2"
    env_value="$3"
    temp_path="${env_path}.tmp.$$"

    awk -v key="$env_key" -v value="$env_value" '
        BEGIN { found = 0 }
        index($0, key "=") == 1 { print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
    ' "$env_path" > "$temp_path"
    mv "$temp_path" "$env_path"
}

get_env_value() {
    env_path="$1"
    env_key="$2"
    default_value="$3"
    value=$(awk -F= -v key="$env_key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$env_path")
    if [ -n "$value" ]; then
        printf '%s' "$value"
    else
        printf '%s' "$default_value"
    fi
}

require_command git 'Install Git using your operating system package manager.'
require_command docker 'Install Docker Engine with the Docker Compose v2 plugin.'
require_command od 'Install the standard core utilities package.'

docker compose version >/dev/null 2>&1 || {
    echo 'Docker Compose v2 is required.' >&2
    exit 1
}

if [ -e "$install_directory" ] && [ -n "$(ls -A "$install_directory" 2>/dev/null)" ]; then
    echo "Install directory is not empty: $install_directory" >&2
    echo 'Choose a new --directory. Existing installations are never overwritten.' >&2
    exit 1
fi

mkdir -p "$(dirname "$install_directory")"
echo "Cloning Middleware 2.0 ($version)..."
git clone --branch "$version" --depth 1 "$repository_url" "$install_directory"

env_example_path="$install_directory/.env.example"
env_path="$install_directory/.env"
if [ ! -f "$env_example_path" ]; then
    echo "The cloned release does not contain .env.example: $env_example_path" >&2
    exit 1
fi

created_environment='false'
generated_admin_password=''
if [ ! -f "$env_path" ]; then
    created_environment='true'
    generated_admin_password=$(random_hex 16)
    cp "$env_example_path" "$env_path"
    set_env_value "$env_path" PG_PASSWORD "$(random_hex 32)"
    set_env_value "$env_path" AUTH_PG_PASSWORD "$(random_hex 32)"
    set_env_value "$env_path" JWT_SECRET "$(random_hex 48)"
    set_env_value "$env_path" AUTH_SERVICE_TOKEN "$(random_hex 48)"
    set_env_value "$env_path" BOOTSTRAP_ADMIN_PASSWORD "$generated_admin_password"
    chmod 600 "$env_path" 2>/dev/null || true
fi

gateway_port=$(get_env_value "$env_path" GATEWAY_PORT 8080)
admin_username=$(get_env_value "$env_path" BOOTSTRAP_ADMIN_USERNAME admin)

if [ "$skip_start" = 'true' ]; then
    echo "Clone and configuration completed at $install_directory"
    echo 'Docker startup was skipped.'
    exit 0
fi

echo 'Building and starting the Docker stack...'
(
    cd "$install_directory"
    docker compose up -d --build
)

application_url="http://127.0.0.1:${gateway_port}/"
health_url="${application_url}api/health"
healthy='false'
health_client=''
if command -v curl >/dev/null 2>&1; then
    health_client='curl'
elif command -v wget >/dev/null 2>&1; then
    health_client='wget'
fi

if [ -n "$health_client" ]; then
    echo 'Waiting for the Hub health check...'
    attempt=1
    while [ "$attempt" -le 60 ]; do
        if [ "$health_client" = 'curl' ]; then
            curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null 2>&1 && healthy='true'
        else
            wget -q -T 5 -O /dev/null "$health_url" >/dev/null 2>&1 && healthy='true'
        fi
        [ "$healthy" = 'true' ] && break
        sleep 2
        attempt=$((attempt + 1))
    done

    if [ "$healthy" != 'true' ]; then
        echo "The stack started, but the Hub did not become healthy within two minutes." >&2
        echo "Run 'docker compose ps' in $install_directory." >&2
        exit 1
    fi
else
    echo 'curl/wget was not found; skipping the HTTP health check.'
fi

echo ''
echo 'Middleware 2.0 is ready.'
echo "URL: $application_url"
if [ "$created_environment" = 'true' ]; then
    echo "Bootstrap admin username: $admin_username"
    echo "Bootstrap admin password: $generated_admin_password"
    echo 'Save this password securely. It is shown only during this installation.'
fi
