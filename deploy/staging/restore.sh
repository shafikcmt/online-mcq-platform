#!/usr/bin/env bash
# Restore the staging DEMO database from a backup made by deploy/staging/backup.sh:
#   1. back up the CURRENT database first (so a restore can itself be undone)
#   2. stop the application services (nginx keeps running; pages show errors briefly)
#   3. drop and recreate the demo database
#   4. pg_restore the chosen dump   5. migrate (a dump from an older release catches up)
#   6. start the services   7. health check
#
#   deploy/staging/restore.sh --yes /srv/mcq-demo/backups/online_mcq_demo-YYYYmmdd-HHMMSS.dump
#
# Refuses unless .env.staging carries the demo marker and POSTGRES_DB is a demo database, and
# unless the file is a readable PostgreSQL custom-format dump. Uploaded media (question
# images) are not part of a database dump; they live in the media volume.
# Exit codes: 0 ok · 2 refused/misconfigured · 3 backup of the current data failed ·
#             4 restore failed (the pre-restore backup's path is printed)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "${1:-}" = "--yes" ] || die "this REPLACES all demo data with the backup. Re-run with --yes <dump file>."
DUMP="${2:-}"
[ -n "$DUMP" ] || die "name the backup file: restore.sh --yes <file.dump>"
[ -f "$DUMP" ] && [ -r "$DUMP" ] || die "cannot read backup file: $DUMP"
[ -s "$DUMP" ] || die "backup file is empty: $DUMP"
# A custom-format dump starts with the 5-byte signature "PGDMP".
[ "$(head -c 5 "$DUMP")" = "PGDMP" ] || die "not a PostgreSQL custom-format dump: $DUMP"
require_demo_env
APP_SERVICES=(backend celery celery-beat admin website)

echo "demo: 1/7 backup of the current data"
"$(dirname "${BASH_SOURCE[0]}")/backup.sh" || die "could not back up the current data — nothing was changed" 3

echo "demo: 2/7 stopping application services"
dc stop "${APP_SERVICES[@]}"

echo "demo: 3/7 recreating database $POSTGRES_DB"
# Connects to the maintenance database; the name was validated against the demo pattern.
dc exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"
dc exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"

echo "demo: 4/7 restoring $DUMP"
# --no-owner / --no-acl: objects belong to the demo user whatever the dump says;
# --exit-on-error: a broken dump stops here instead of leaving half a database.
if ! dc exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --no-owner --no-acl --exit-on-error < "$DUMP"; then
  die "pg_restore failed. The data from before this restore is in the newest backup above; restore that file to go back." 4
fi

echo "demo: 5/7 migrate"
dc run --rm --no-deps backend python manage.py migrate --noinput

echo "demo: 6/7 starting services"
dc up -d --wait "${APP_SERVICES[@]}"

echo "demo: 7/7 health check"
dc run --rm --no-deps backend python manage.py check_services
echo "demo: restore complete from $DUMP"
