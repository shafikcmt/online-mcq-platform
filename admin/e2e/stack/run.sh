#!/usr/bin/env bash
# Run Playwright suites against a disposable backend: for EACH suite a fresh copy of the
# seeded template database, empty test-only Redis databases and an empty media folder;
# at the end everything is dropped/deleted, so no QA record survives the run.
#
#   E2E_DISPOSABLE_DB=destroy-and-recreate POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=… \
#   POSTGRES_USER=… POSTGRES_PASSWORD=… PYTHON=/path/to/backend-venv/bin/python \
#   E2E_ADMIN_MOBILE=… E2E_ADMIN_PASSWORD=… E2E_BASE_URL=http://localhost:8088 \
#   admin/e2e/stack/run.sh exams content admin-shell api-proxy
#
# Expects the panel (`next start`) and the reverse proxy to be running already, the proxy
# sending /api/ to 127.0.0.1:$E2E_DJANGO_PORT (default 8000). This script starts that
# Django server itself (development settings) on the disposable database and stops it.
# Redis: only database numbers 14 (broker) and 15 (cache) of a LOCAL Redis are used and
# emptied (FLUSHDB of those two, never FLUSHALL).
# Optional: E2E_CELERY_WORKER=1 also starts a Celery worker on the same disposable stack
# (SMS codes are issued by the worker); E2E_PROJECT_DIR runs the suites of another
# Playwright project (default: this admin panel, e.g. ../mobile for the app's web build).
# The mock SMS text (with the code) is written to the server log, exported to the suites
# as E2E_DJANGO_LOG — development settings with the mock provider only, as everywhere here.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN="$(cd "$HERE/../.." && pwd)"
BACKEND="$(cd "$ADMIN/../backend" && pwd)"
DB="$HERE/e2e-db.sh"
PORT="${E2E_DJANGO_PORT:-8000}"
REDIS_HOST="${E2E_REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${E2E_REDIS_PORT:-6379}"
RUN_DB="${E2E_DB_NAME:-mcq_e2e}"
PROJECT="$(cd "${E2E_PROJECT_DIR:-$ADMIN}" && pwd)"

die() { echo "e2e: $*" >&2; exit 2; }
[ "$#" -gt 0 ] || die "name the suites to run, e.g. exams content admin-shell api-proxy"
case "$REDIS_HOST" in localhost|127.0.0.1|::1) ;; *) die "E2E_REDIS_HOST must be local" ;; esac
: "${E2E_ADMIN_MOBILE:?}" "${E2E_ADMIN_PASSWORD:?}" "${E2E_BASE_URL:?}" "${PYTHON:?path to the backend Python}"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  die "port $PORT is already in use — stop that server first (this script starts its own Django)"
fi
export E2E_ADMIN_MOBILE E2E_ADMIN_PASSWORD PYTHON

MEDIA="$(mktemp -d "${TMPDIR:-/tmp}/mcq-e2e-media.XXXXXX")"
DJANGO_PID=""
WORKER_PID=""
flush_redis() { for n in 14 15; do redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -n "$n" FLUSHDB >/dev/null; done; }
cleanup() {
  set +e  # always finish: a stopped server's exit code must not abort the disposal
  if [ -n "$DJANGO_PID" ]; then kill "$DJANGO_PID" 2>/dev/null; wait "$DJANGO_PID" 2>/dev/null; fi
  if [ -n "$WORKER_PID" ]; then kill "$WORKER_PID" 2>/dev/null; wait "$WORKER_PID" 2>/dev/null; fi
  "$DB" drop
  flush_redis
  rm -rf "$MEDIA"
  # Verify the disposal instead of assuming it.
  local left=""
  "$DB" exists && left="$left databases"
  [ -e "$MEDIA" ] && left="$left media"
  for n in 14 15; do
    [ "$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -n "$n" DBSIZE)" = "0" ] || left="$left redis-db-$n"
  done
  if [ -n "$left" ]; then echo "e2e: CLEANUP FAILED, still present:$left" >&2; else
    echo "e2e: disposed — run/template databases dropped, media folder removed, Redis DBs 14/15 empty"; fi
}
trap cleanup EXIT

"$DB" template
echo "e2e: template seeded"
"$DB" counts template > "$MEDIA/.baseline"

# One backend process with the disposable settings (exec: its PID is the process itself).
backend_env() {
  exec env POSTGRES_DB="$RUN_DB" DJANGO_SETTINGS_MODULE=config.settings.dev DJANGO_DEBUG=true \
    REDIS_URL="redis://$REDIS_HOST:$REDIS_PORT/14" REDIS_CACHE_URL="redis://$REDIS_HOST:$REDIS_PORT/15" \
    CELERY_BROKER_URL="redis://$REDIS_HOST:$REDIS_PORT/14" MEDIA_ROOT="$MEDIA" \
    SMS_PROVIDER=mock SMS_MOCK_LOG_CONTENT=true \
    TRUSTED_PROXY_COUNT=1 CSRF_TRUSTED_ORIGINS= DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1 "$@"
}
export E2E_DJANGO_LOG="$MEDIA/.django.log"
(cd "$BACKEND" && backend_env "$PYTHON" manage.py runserver "127.0.0.1:$PORT" --noreload) >> "$E2E_DJANGO_LOG" 2>&1 &
DJANGO_PID=$!
if [ "${E2E_CELERY_WORKER:-0}" = "1" ]; then
  (cd "$BACKEND" && backend_env "$PYTHON" -m celery -A config worker --pool=solo --loglevel=warning) >> "$E2E_DJANGO_LOG" 2>&1 &
  WORKER_PID=$!
fi

status=0
for suite in "$@"; do
  "$DB" fresh
  flush_redis
  find "$MEDIA" -mindepth 1 -not -name '.*' -exec rm -rf {} + 2>/dev/null || true
  for _ in $(seq 50); do curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/v1/health/" && break; sleep 0.2; done
  echo "e2e: === $suite (fresh database) ==="
  (cd "$PROJECT" && npx playwright test "e2e/$suite.spec.ts") || status=$?
  # What this suite left behind (rows above the seed baseline) — removed with the database.
  echo "e2e: rows '$suite' added above the seed (discarded with its database):"
  "$DB" counts | awk -F= 'NR == FNR { base[$1] = $2; next } $2 != base[$1] { printf "  %s +%d\n", $1, $2 - base[$1] }' "$MEDIA/.baseline" -
  echo "  media files: $(find "$MEDIA" -type f -not -name '.*' | wc -l)"
done
exit "$status"
