#!/usr/bin/env bash
# Deploy (or roll back to) one release of the production stack.
#
#   deploy.sh <commit-sha>              deploy: pull → back up DB → migrate → start → verify
#   deploy.sh --rollback <commit-sha>   roll back to an EARLIER release that is still on the
#                                       server: pull → start → verify (no migrations)
#
# Run by the GitHub Actions deploy job on the server's own runner (as the `deploy` user),
# or by hand from /srv/mcq/releases/<sha>/deploy/prod/. The release folder must already
# contain that commit's docker-compose.prod.yml and deploy/ (the workflow stages it).
#
# Safety:
# - one deployment at a time (lock file); a second one waits, then runs
# - the database is backed up (and the dump checked) before any migration
# - migrations only move forward; nothing is ever dropped, reset or restored by this script
# - the volumes (database, media, static) are never removed
# - if the new release does not come up healthy, the previous release is started again
#   automatically (code only — a database backup is never restored automatically)
# - no secret is printed: values from .env.prod are never echoed, no `set -x`
set -Eeuo pipefail
umask 027

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/prod/lib.sh
. "$HERE/lib.sh"

MODE=deploy
if [[ "${1:-}" == "--rollback" ]]; then
    MODE=rollback
    shift
fi
SHA="${1:-}"
valid_sha "$SHA" || die "usage: deploy.sh [--rollback] <40-character commit sha>"
LOG_TAG="$MODE ${SHA:0:12}"

RELEASES="$MCQ_ROOT/releases"
RELEASE="$RELEASES/$SHA"
BACKUPS="$MCQ_ROOT/backups"
HISTORY="$MCQ_ROOT/deploy-history.log"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_DELAY="${HEALTH_DELAY:-3}"
REQUIRED_SETTINGS=(
    SITE_HOST ADMIN_HOST CERT_NAME HSTS_SECONDS
    DJANGO_SETTINGS_MODULE DJANGO_SECRET_KEY JWT_SIGNING_KEY DJANGO_ALLOWED_HOSTS DJANGO_ADMIN_URL
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_HOST
    REDIS_URL CELERY_BROKER_URL PAYMENT_PROVIDER
)

# ---- one deployment at a time ----------------------------------------------------------------
if [[ -z "${MCQ_LOCK_HELD:-}" ]]; then
    exec 9>"$MCQ_ROOT/.deploy.lock"
    if ! flock -n 9; then
        log "another deployment is running — waiting for it to finish"
        flock -w 1800 9 || die "timed out waiting for the other deployment"
    fi
    export MCQ_LOCK_HELD=1
fi

# ---- preflight (before anything changes) -------------------------------------------------------
[[ -f "$RELEASE/docker-compose.prod.yml" ]] || die "release folder $RELEASE is missing or incomplete"
# Every problem at once, each with its fix (docs/PRODUCTION_DEPLOYMENT.md).
problems=()
if [[ ! -f "$ENV_FILE" ]]; then
    problems+=("$ENV_FILE is missing — create it: $RELEASE/deploy/prod/init-env.sh")
else
    [[ "$(stat -c %a "$ENV_FILE")" == "600" ]] \
        || problems+=("$ENV_FILE must be mode 600 — run: chmod 600 $ENV_FILE")
    grep -qE '^PAYMENT_PROVIDER=mock$' "$ENV_FILE" \
        && problems+=("PAYMENT_PROVIDER=mock is never allowed in production")
    grep -qE '=change-me/?$' "$ENV_FILE" \
        && problems+=("$ENV_FILE still has change-me placeholders")
    # Required settings must be present and non-empty (values are never printed).
    for key in "${REQUIRED_SETTINGS[@]}"; do
        grep -qE "^${key}=.+" "$ENV_FILE" || problems+=("$ENV_FILE: $key is missing or empty")
    done
    grep -qE '^DJANGO_DEBUG=(false|False|0)$' "$ENV_FILE" \
        || problems+=("$ENV_FILE: DJANGO_DEBUG must be false")
fi
# Ports 80/443 must be free for this project's nginx (another project's web server on the
# same VPS would make the start fail half-way). Our own running nginx is fine.
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PROJECT-nginx-1"; then
    for port in 80 443; do
        if command -v ss >/dev/null && [[ -n "$(ss -Hltn "sport = :$port" 2>/dev/null)" ]]; then
            problems+=("port $port is already used by another program on this server (check: sudo ss -ltnp 'sport = :$port')")
        fi
    done
fi
[[ -s "$MCQ_ROOT/nginx/admin.htpasswd" ]] \
    || problems+=("$MCQ_ROOT/nginx/admin.htpasswd is missing — create it: $RELEASE/deploy/prod/set-admin-password.sh")
# The compose file reads .env.prod from its own folder: it must be the link stage-release.sh
# creates to the server's settings file.
[[ -L "$RELEASE/.env.prod" && "$(readlink "$RELEASE/.env.prod")" == "$ENV_FILE" ]] \
    || problems+=("$RELEASE/.env.prod must be a link to $ENV_FILE — run: ln -sfn $ENV_FILE $RELEASE/.env.prod")
[[ -d "$MCQ_ROOT/certbot-www" ]] \
    || problems+=("$MCQ_ROOT/certbot-www is missing — run: mkdir -p $MCQ_ROOT/certbot-www")
if ((${#problems[@]})); then
    for problem in "${problems[@]}"; do log "NOT READY: $problem" >&2; done
    die "the server is not ready; nothing was changed"
fi

SITE_HOST="$(env_value SITE_HOST)"
ADMIN_HOST="$(env_value ADMIN_HOST)"
[[ -n "$SITE_HOST" && -n "$ADMIN_HOST" ]] || die "SITE_HOST and ADMIN_HOST must be set in $ENV_FILE"

PREVIOUS=""
if [[ -L "$MCQ_ROOT/current" ]]; then
    PREVIOUS="$(basename "$(readlink "$MCQ_ROOT/current")")"
fi
export IMAGE_TAG="$SHA"
compose() { compose_in "$RELEASE" "$@"; }

CHANGED=0
on_error() {
    local status=$?
    trap - ERR
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $MODE $SHA FAILED" >>"$HISTORY"
    if [[ "$CHANGED" == 1 && "$MODE" == deploy && -n "$PREVIOUS" && "$PREVIOUS" != "$SHA" \
        && -x "$RELEASES/$PREVIOUS/deploy/prod/deploy.sh" ]]; then
        log "the new release is not healthy — rolling back to ${PREVIOUS:0:12}"
        if "$RELEASES/$PREVIOUS/deploy/prod/deploy.sh" --rollback "$PREVIOUS"; then
            log "rolled back to ${PREVIOUS:0:12}; the failed release is NOT live"
        else
            log "AUTOMATIC ROLLBACK FAILED — run the Rollback production workflow"
        fi
    elif [[ "$CHANGED" == 0 ]]; then
        log "failed before any running service was changed; the live site is untouched"
    fi
    exit "$status"
}
trap on_error ERR

log "starting (previous release: ${PREVIOUS:0:12})"

# ---- images: the exact commit, from GHCR ---------------------------------------------------------
log "pulling images for ${SHA:0:12}"
compose pull --quiet

# ---- server configuration, with the NEW images, before anything changes -----------------------
# Django's production checks against the real .env.prod (refuses placeholders, DEBUG, mock
# payments, weak HTTPS settings …) and nginx's own test of the real templates, certificate
# and Basic Auth file. Output is shown; neither prints secret values.
log "checking production settings (manage.py check --deploy)"
compose run --rm --no-deps -T backend python manage.py check --deploy --fail-level WARNING
log "checking nginx configuration, certificate and Basic Auth file (nginx -t)"
compose run --rm --no-deps -T nginx nginx -t -q

# ---- data services (unchanged images normally; volumes are kept) --------------------------------
compose up -d --wait --wait-timeout 120 postgres redis

if [[ "$MODE" == deploy ]]; then
    # ---- back up BEFORE migrating ---------------------------------------------------------------
    backup_database "$RELEASE" "$BACKUPS/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:12}.dump"

    # ---- forward-only migrations (Django) --------------------------------------------------------
    log "applying database migrations"
    compose run --rm --no-deps -T backend python manage.py migrate --noinput
fi

log "collecting static files"
compose run --rm --no-deps -T backend python manage.py collectstatic --noinput --verbosity 0

# ---- start / replace the application containers ------------------------------------------------
CHANGED=1
log "starting services"
compose up -d --wait --wait-timeout 300 --remove-orphans

# ---- verify through nginx, exactly as visitors reach it (TLS, host names, routing) -------------
http_status() {  # http_status <host> <path>
    curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
        --resolve "$1:443:127.0.0.1" "https://$1$2" || true
}
expect() {  # expect <description> <wanted status> <host> <path>
    local got="" attempt
    for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
        got="$(http_status "$3" "$4")"
        [[ "$got" == "$2" ]] && { log "ok: $1 ($got)"; return 0; }
        sleep "$HEALTH_DELAY"
    done
    log "health check failed: $1 — wanted $2, got ${got:-no answer}"
    return 1
}
expect "website home page"                200 "$SITE_HOST"        /bn
expect "www redirects to the main address" 301 "www.$SITE_HOST"   /
expect "API health"                       200 "$ADMIN_HOST"       /api/v1/health/
expect "admin pages need Basic Auth"      401 "$ADMIN_HOST"       /
for service in celery celery-beat; do
    [[ -n "$(compose ps --status running --quiet "$service")" ]] \
        || { log "health check failed: $service is not running"; false; }
    log "ok: $service running"
done
celery_ping() { compose exec -T celery celery -A config inspect ping --timeout 10 >/dev/null 2>&1; }
for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    celery_ping && break
    sleep "$HEALTH_DELAY"
done
celery_ping || { log "health check failed: the Celery worker does not answer (broker/Redis?)"; false; }
log "ok: Celery worker answers through Redis"

# ---- record the release ------------------------------------------------------------------------
ln -sfn "$RELEASE" "$MCQ_ROOT/current.new"
mv -T "$MCQ_ROOT/current.new" "$MCQ_ROOT/current"
if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$SHA" ]]; then
    echo "$PREVIOUS" >"$MCQ_ROOT/previous"
fi
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $MODE $SHA ok" >>"$HISTORY"
trap - ERR

# ---- housekeeping (never touches volumes or the running/previous release) ---------------------
keep_newest "$BACKUPS" 'pre-deploy-*.dump' 10
KEEP_PREVIOUS="$(cat "$MCQ_ROOT/previous" 2>/dev/null || true)"
KEEP_LIVE="$(basename "$(readlink "$MCQ_ROOT/current")")"
# Only real release folders (40-character SHA names; never hidden staging folders), newest
# 5 kept, and never the live release or the rollback target.
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended \
    -regex '.*/[0-9a-f]{40}' -printf '%T@ %f\n' | sort -rn | tail -n +6 \
    | cut -d' ' -f2 | while read -r old; do
        [[ "$old" == "$SHA" || "$old" == "$KEEP_LIVE" || "$old" == "$KEEP_PREVIOUS" ]] && continue
        rm -rf -- "${RELEASES:?}/$old"
    done
docker image prune --all --force --filter "until=168h" >/dev/null || true

log "done: ${SHA:0:12} is live"
