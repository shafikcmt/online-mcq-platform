#!/usr/bin/env bash
# Stage one commit's deployment files as /srv/mcq/releases/<sha> — safely and atomically.
#
#   stage-release.sh <commit-sha> <checkout dir>
#
# Run by the deploy workflow from the checkout of <sha> (before deploy.sh). The checkout
# must contain docker-compose.prod.yml, .env.prod.example and deploy/.
#
# Rules:
# - A release folder is NEVER deleted or overwritten here. The live release (`current`)
#   and the rollback target (`previous`) are in use: nginx mounts its config files from
#   the live folder, and rollback starts the previous one.
# - The files are copied into a hidden staging folder on the same filesystem and then
#   renamed into place in one step (rename(2) is atomic): deploy.sh, a rollback or a
#   reader never sees a half-copied release.
# - Rerunning the same SHA is idempotent: if the release folder already exists with the
#   same content, nothing changes. A folder with DIFFERENT content for the same commit
#   means someone edited files on the server: that is refused (fix by hand) — never
#   silently replaced.
# - Holds the same lock as deploy.sh, so it never runs during a deployment.
set -Eeuo pipefail
umask 027

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/prod/lib.sh
. "$HERE/lib.sh"

SHA="${1:-}"
SOURCE="${2:-}"
valid_sha "$SHA" || die "usage: stage-release.sh <40-character commit sha> <checkout dir>"
LOG_TAG="stage ${SHA:0:12}"
[[ -d "$SOURCE" ]] || die "checkout folder not found: $SOURCE"
for item in docker-compose.prod.yml .env.prod.example deploy/prod/deploy.sh deploy/nginx; do
    [[ -e "$SOURCE/$item" ]] || die "checkout is incomplete: $item is missing"
done

RELEASES="$MCQ_ROOT/releases"
RELEASE="$RELEASES/$SHA"
mkdir -p "$RELEASES"

# One writer at a time (shared with deploy.sh and backup.sh).
exec 9>"$MCQ_ROOT/.deploy.lock"
flock -w 1800 9 || die "timed out waiting for another deployment"

# Leftovers of an interrupted earlier staging of this SHA (never a real release folder).
rm -rf -- "$RELEASES/.staging-$SHA".*

staging="$(mktemp -d "$RELEASES/.staging-$SHA.XXXXXX")"
trap 'rm -rf -- "$staging"' EXIT
cp -- "$SOURCE/docker-compose.prod.yml" "$SOURCE/.env.prod.example" "$staging/"
cp -R -- "$SOURCE/deploy" "$staging/deploy"
chmod +x "$staging"/deploy/prod/*.sh
chmod 750 "$staging"

role() {  # how a release folder is in use: "live", "rollback target" or ""
    local live="" previous=""
    [[ -L "$MCQ_ROOT/current" ]] && live="$(basename "$(readlink "$MCQ_ROOT/current")")"
    [[ -s "$MCQ_ROOT/previous" ]] && previous="$(cat "$MCQ_ROOT/previous")"
    if [[ "$1" == "$live" ]]; then echo "live"
    elif [[ "$1" == "$previous" ]]; then echo "rollback target"
    fi
}

if [[ -e "$RELEASE" ]]; then
    if diff -r -q "$staging" "$RELEASE" >/dev/null 2>&1; then
        log "release ${SHA:0:12} is already staged with identical files — reused, nothing changed"
        exit 0
    fi
    in_use="$(role "$SHA")"
    die "release folder $RELEASE already exists with DIFFERENT files${in_use:+ (it is the $in_use release)}. Nothing was changed. Files of a deployed commit must not be edited on the server; compare with: diff -r <checkout> $RELEASE"
fi

# Atomic promotion: the folder appears complete, or not at all. `mv -T` refuses to replace
# an existing folder, so a concurrent writer can never be overwritten either.
mv -T -- "$staging" "$RELEASE"
trap - EXIT
log "staged $RELEASE"
