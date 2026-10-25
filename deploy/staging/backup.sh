#!/usr/bin/env bash
# Back up the staging DEMO database (custom-format pg_dump, timestamped) and delete
# backups older than the retention period. No cloud upload (yet).
#
#   deploy/staging/backup.sh                       # → $BACKUP_DIR/online_mcq_demo-YYYYmmdd-HHMMSS.dump
#   BACKUP_DIR=/srv/mcq-demo/backups RETENTION_DAYS=7 deploy/staging/backup.sh
#
# Refuses unless .env.staging carries the demo marker and the database is a demo database.
# Exit codes: 0 ok · 2 refused/misconfigured · 3 dump failed
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKUP_DIR="${BACKUP_DIR:-/srv/mcq-demo/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "RETENTION_DAYS must be a whole number of days"

require_demo_env
umask 077                      # backups readable by the deploy user only
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%d-%H%M%S)"
# Claim a name atomically (noclobber), so two runs — even in the same second — never
# write to or overwrite the same file.
n=0
target="$BACKUP_DIR/${POSTGRES_DB}-${stamp}.dump"
until ( set -o noclobber; : > "$target" ) 2>/dev/null; do
  n=$((n + 1)); target="$BACKUP_DIR/${POSTGRES_DB}-${stamp}-${n}.dump"
done
partial="$(mktemp "$BACKUP_DIR/.${POSTGRES_DB}-${stamp}.XXXXXX")"
cleanup_failed() { rm -f "$partial" "$target"; }

if ! dc exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$partial"; then
  cleanup_failed
  die "pg_dump failed — no backup written" 3
fi
[ -s "$partial" ] || { cleanup_failed; die "pg_dump produced an empty file" 3; }
mv -f "$partial" "$target"
echo "demo: backup written: $target ($(du -h "$target" | cut -f1))"

# Retention: only our own dump files in this directory.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${POSTGRES_DB}-*.dump" -mtime "+$RETENTION_DAYS" -print -delete \
  | sed 's/^/demo: removed old backup: /'
