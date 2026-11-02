#!/usr/bin/env bash
# Daily backup of the production database (run by cron as the `deploy` user):
#   17 3 * * *  /srv/mcq/current/deploy/prod/backup.sh >>/srv/mcq/backups/backup.log 2>&1
#
# Writes /srv/mcq/backups/daily-<UTC time>.dump (PostgreSQL custom format, mode 600),
# checks that it is a readable dump, and keeps the newest 14. Read-only for the database.
# Copy backups off the server regularly as well (docs/PRODUCTION_DEPLOYMENT.md).
set -Eeuo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/prod/lib.sh
. "$HERE/lib.sh"
LOG_TAG=backup

[[ -L "$MCQ_ROOT/current" ]] || die "no release is live yet ($MCQ_ROOT/current is missing)"
RELEASE="$(readlink -f "$MCQ_ROOT/current")"
export IMAGE_TAG
IMAGE_TAG="$(basename "$RELEASE")"

# Never at the same time as a deployment.
exec 9>"$MCQ_ROOT/.deploy.lock"
flock -w 1800 9 || die "a deployment has held the lock for 30 minutes; backup skipped"

backup_database "$RELEASE" "$MCQ_ROOT/backups/daily-$(date -u +%Y%m%dT%H%M%SZ).dump"
keep_newest "$MCQ_ROOT/backups" 'daily-*.dump' 14
