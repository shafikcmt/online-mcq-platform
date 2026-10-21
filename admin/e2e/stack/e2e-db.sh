#!/usr/bin/env bash
# Disposable database for the full-stack (Playwright) suites — test tooling only.
#
# The suites create records the product deliberately never deletes (a published exam,
# its locked questions, audit history). They therefore run against a throwaway
# PostgreSQL database that this script creates, re-creates for every suite and drops at
# the end. Nothing in the application is relaxed for tests: no endpoint, no bypass.
#
#   e2e-db.sh template   create + migrate + seed the template database
#   e2e-db.sh fresh      (re)create the run database as a copy of the template
#   e2e-db.sh counts [template]  rows per table of the run (or template) database
#   e2e-db.sh drop       drop the run and template databases
#
# Every command first runs `guard`, which refuses unless ALL of these hold:
#   1. E2E_DISPOSABLE_DB=destroy-and-recreate   (explicit opt-in)
#   2. POSTGRES_HOST is the local machine        (never a remote/staging/production server)
#   3. E2E_DB_NAME matches ^mcq_e2e[a-z0-9_]*$  and differs from POSTGRES_DB in the repo's
#      .env and from the project default `online_mcq`
#   4. an EXISTING database is only dropped if it carries this tool's marker comment —
#      i.e. it was created by this script. A database with the right name but no marker
#      (someone's real data) is never touched.
set -euo pipefail

MARKER="online-mcq disposable E2E database - created by admin/e2e/stack/e2e-db.sh; safe to drop"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BACKEND="$REPO/backend"
RUN_DB="${E2E_DB_NAME:-mcq_e2e}"
TEMPLATE_DB="${RUN_DB}_template"

die() { echo "e2e-db: REFUSING: $*" >&2; exit 2; }

guard() {
  [ "${E2E_DISPOSABLE_DB:-}" = "destroy-and-recreate" ] ||
    die "set E2E_DISPOSABLE_DB=destroy-and-recreate to allow creating and dropping the E2E database"
  case "${POSTGRES_HOST:-}" in
    localhost|127.0.0.1|::1) ;;
    *) die "POSTGRES_HOST='${POSTGRES_HOST:-}' is not the local machine" ;;
  esac
  [[ "$RUN_DB" =~ ^mcq_e2e[a-z0-9_]*$ ]] || die "E2E_DB_NAME='$RUN_DB' must match ^mcq_e2e[a-z0-9_]*\$"
  [ "$RUN_DB" != "online_mcq" ] || die "refusing the project's default database name"
  if [ -f "$REPO/.env" ]; then
    local configured
    configured="$(sed -n 's/^POSTGRES_DB=//p' "$REPO/.env" | tail -1 | tr -d '"'\''\r')"
    if [ -n "$configured" ] && { [ "$configured" = "$RUN_DB" ] || [ "$configured" = "$TEMPLATE_DB" ]; }; then
      die "E2E_DB_NAME is the database configured in .env ($configured)"
    fi
  fi
  : "${POSTGRES_USER:?POSTGRES_USER is required}" "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
}

psql_admin() {  # SQL against the maintenance database, never against the target itself
  PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" \
    -U "$POSTGRES_USER" -d postgres "$@"
}

exists() { [ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]; }

marked() {
  [ "$(psql_admin -tAc "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '$1'")" = "$MARKER" ]
}

drop_marked() {  # drop $1 only if this tool created it
  if exists "$1"; then
    marked "$1" || die "database '$1' exists but was not created by this tool (no marker) — not dropping it"
    psql_admin -c "DROP DATABASE \"$1\" WITH (FORCE)"
  fi
}

create_marked() {  # $1 name, $2 optional template
  psql_admin -c "CREATE DATABASE \"$1\"${2:+ TEMPLATE \"$2\"}"
  psql_admin -c "COMMENT ON DATABASE \"$1\" IS '$MARKER'"
}

django() {  # manage.py against the given database, development settings
  (cd "$BACKEND" && POSTGRES_DB="$1" DJANGO_SETTINGS_MODULE=config.settings.dev "${PYTHON:-python}" manage.py "${@:2}")
}

cmd="${1:-}"
guard
case "$cmd" in
  template)
    drop_marked "$RUN_DB"
    drop_marked "$TEMPLATE_DB"
    create_marked "$TEMPLATE_DB"
    django "$TEMPLATE_DB" migrate --noinput -v 0
    django "$TEMPLATE_DB" shell -c "exec(open('$HERE/seed.py', encoding='utf-8').read())"
    ;;
  fresh)
    exists "$TEMPLATE_DB" && marked "$TEMPLATE_DB" || die "run '$0 template' first"
    drop_marked "$RUN_DB"
    create_marked "$RUN_DB" "$TEMPLATE_DB"
    ;;
  counts)  # every table of the application schema, "table=rows"
    target="$RUN_DB"; [ "${2:-}" = "template" ] && target="$TEMPLATE_DB"
    exists "$target" || die "database '$target' does not exist"
    PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" \
      -d "$target" -tA -F '=' -c "
        SELECT table_name,
               (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'django_migrations'
        ORDER BY 1"
    ;;
  exists)  # exit 0 if the run or template database exists (used after disposal)
    exists "$RUN_DB" || exists "$TEMPLATE_DB"
    ;;
  drop)
    drop_marked "$RUN_DB"
    drop_marked "$TEMPLATE_DB"
    ;;
  *) echo "usage: $0 template|fresh|counts [template]|drop|exists" >&2; exit 64 ;;
esac
