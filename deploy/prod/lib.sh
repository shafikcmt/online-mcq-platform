# Shared helpers for the production scripts (sourced, not run). Bash only.
#
# Layout on the server (docs/PRODUCTION_DEPLOYMENT.md):
#   /srv/mcq/.env.prod                 secrets + settings (mode 600, never committed)
#   /srv/mcq/nginx/admin.htpasswd      Basic Auth for the admin host (never committed)
#   /srv/mcq/releases/<sha>/           one folder per deployed commit (compose + deploy/)
#   /srv/mcq/current  → releases/<sha> the release that is running
#   /srv/mcq/previous                  SHA of the release before it (rollback target)
#   /srv/mcq/backups/                  database dumps (pre-deploy-* and daily-*)
#   /srv/mcq/deploy-history.log        one line per deploy / rollback (no secrets)
#
# Nothing here prints a secret: values from .env.prod are never echoed, and `set -x` is
# never used.

MCQ_ROOT="${MCQ_ROOT:-/srv/mcq}"
PROJECT=mcq-prod
ENV_FILE="$MCQ_ROOT/.env.prod"

log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${LOG_TAG:-mcq}" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

valid_sha() { [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]; }

# One NON-secret value from .env.prod (host names, certificate name). Never use it for
# secrets: callers print these values.
env_value() {
    local key="$1" line
    line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
    printf '%s' "${line#*=}"
}

# docker compose for one release folder: compose() <release dir> <args…>
# IMAGE_TAG must be exported by the caller (the release's commit SHA).
compose_in() {
    local release="$1"
    shift
    docker compose --project-name "$PROJECT" \
        --env-file "$ENV_FILE" \
        -f "$release/docker-compose.prod.yml" "$@"
}

# Custom-format dump of the production database, written atomically and checked.
# backup_database <release dir> <output file>
backup_database() {
    local release="$1" out="$2" tmp
    mkdir -p "$(dirname "$out")"
    tmp="$out.partial"
    # POSTGRES_USER / POSTGRES_DB are expanded INSIDE the container (single quotes).
    compose_in "$release" exec -T postgres \
        sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' \
        >"$tmp"
    [[ -s "$tmp" ]] || { rm -f "$tmp"; die "database backup is empty"; }
    compose_in "$release" exec -T postgres pg_restore --list <"$tmp" >/dev/null \
        || { rm -f "$tmp"; die "database backup is not a readable dump"; }
    chmod 600 "$tmp"
    mv "$tmp" "$out"
    log "database backup written: $(basename "$out") ($(du -h "$out" | cut -f1))"
}

# Keep the newest N files matching a glob pattern in a folder.
keep_newest() {
    local dir="$1" pattern="$2" keep="$3"
    find "$dir" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' 2>/dev/null \
        | sort -rn | tail -n +"$((keep + 1))" | cut -d' ' -f2- | xargs -r rm -f --
}
