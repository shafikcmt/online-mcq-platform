#!/usr/bin/env bash
# Reset the staging DEMO database to fresh, deterministic demo data:
#   1. back up the current demo database (deploy/staging/backup.sh)
#   2. stop the application services (nginx keeps running; the panel shows errors briefly)
#   3. drop and recreate the demo database
#   4. migrate   5. seed_demo   6. start the services   7. health check
# Admin accounts are NOT recreated here (that would need passwords in a script): run
# `create_demo_admin` afterwards, interactively (printed at the end).
#
#   deploy/staging/reset-demo.sh --yes
#
# Refuses unless .env.staging carries the demo marker and POSTGRES_DB is a demo database.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "${1:-}" = "--yes" ] || die "this DELETES all demo data. Re-run with --yes to confirm."
require_demo_env
APP_SERVICES=(backend celery celery-beat admin)

echo "demo: 1/7 backup"
"$(dirname "${BASH_SOURCE[0]}")/backup.sh"

echo "demo: 2/7 stopping application services"
dc stop "${APP_SERVICES[@]}"

echo "demo: 3/7 recreating database $POSTGRES_DB"
# Connects to the maintenance database; the name was validated against the demo pattern.
dc exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"
dc exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"

echo "demo: 4/7 migrate"
dc run --rm --no-deps backend python manage.py migrate --noinput

echo "demo: 5/7 seed_demo"
dc run --rm --no-deps backend python manage.py seed_demo

echo "demo: 6/7 starting services"
dc up -d --wait "${APP_SERVICES[@]}"

echo "demo: 7/7 health check"
dc run --rm --no-deps backend python manage.py check_services

cat <<'NEXT'
demo: reset complete. Now (re)create the admin accounts — passwords are typed at a hidden prompt:
  docker compose --env-file .env.staging -f docker-compose.staging.yml run --rm backend \
    python manage.py create_demo_admin --mobile <client-demo-number> --full-name "Client Demo"
NEXT
