# Shared guards for the staging demo scripts (sourced, not executed).
# Every script runs from the repository root of the deployed tag, next to .env.staging.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.staging}"
COMPOSE_FILE="$REPO_ROOT/docker-compose.staging.yml"
DEMO_DB_PATTERN='^online_mcq_demo(_[a-z0-9]{1,20})?$'

die() { echo "demo: $1" >&2; exit "${2:-2}"; }   # die <message> [exit code]

# Read one KEY=value from the env file without sourcing it (no code execution).
env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

require_demo_env() {
  [ -f "$ENV_FILE" ] || die "missing $ENV_FILE (create it from .env.staging.example)"
  [ "$(env_value DEMO_ENVIRONMENT)" = "staging-demo" ] \
    || die "refusing: $ENV_FILE has no DEMO_ENVIRONMENT=staging-demo marker"
  POSTGRES_DB="$(env_value POSTGRES_DB)"
  POSTGRES_USER="$(env_value POSTGRES_USER)"
  [[ "$POSTGRES_DB" =~ $DEMO_DB_PATTERN ]] \
    || die "refusing: POSTGRES_DB=$POSTGRES_DB is not a demo database (expected online_mcq_demo)"
  [ -n "$POSTGRES_USER" ] || die "POSTGRES_USER is empty in $ENV_FILE"
  export POSTGRES_DB POSTGRES_USER
}

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
