#!/usr/bin/env bash
# Create /srv/mcq/.env.prod from the template staged with the release, with every secret
# generated HERE, on the server — nobody types, sees or copies a secret:
#
#   /srv/mcq/releases/<sha>/deploy/prod/init-env.sh
#
# Generates DJANGO_SECRET_KEY, JWT_SIGNING_KEY, POSTGRES_PASSWORD (random, 64 characters)
# and a random secret path for the internal Django admin. Everything else keeps the
# template's value (livemodeltest.com hosts, payments "unavailable", …).
# Refuses to overwrite an existing .env.prod (the database password inside it must never
# change once the database exists). Prints NO secret values.
set -Eeuo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/prod/lib.sh
. "$HERE/lib.sh"
LOG_TAG=init-env

TEMPLATE="${TEMPLATE:-$HERE/../../.env.prod.example}"
[[ -f "$TEMPLATE" ]] || die "template not found: $TEMPLATE"
[[ -e "$ENV_FILE" ]] && die "$ENV_FILE already exists — not touched. (Edit it with: nano $ENV_FILE)"

random_secret() { head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | head -c 64; }
random_path() { printf 'ops-%s/' "$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"; }

secret_key="$(random_secret)"
jwt_key="$(random_secret)"
db_password="$(random_secret)"
admin_path="$(random_path)"
[[ ${#secret_key} -ge 50 && ${#jwt_key} -ge 50 && ${#db_password} -ge 50 ]] \
    || die "could not generate random values"
[[ "$secret_key" != "$jwt_key" ]] || die "random values collided; run again"

tmp="$(mktemp "$MCQ_ROOT/.env.prod.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
        DJANGO_SECRET_KEY=change-me) line="DJANGO_SECRET_KEY=$secret_key" ;;
        JWT_SIGNING_KEY=change-me) line="JWT_SIGNING_KEY=$jwt_key" ;;
        POSTGRES_PASSWORD=change-me) line="POSTGRES_PASSWORD=$db_password" ;;
        DJANGO_ADMIN_URL=change-me/) line="DJANGO_ADMIN_URL=$admin_path" ;;
    esac
    printf '%s\n' "$line" >>"$tmp"
done <"$TEMPLATE"

if grep -qE '=change-me/?$' "$tmp"; then
    die "the template has a placeholder this script does not know; nothing was written"
fi
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT
log "created $ENV_FILE (mode 600) with freshly generated secrets — none were printed"
log "the secret Django admin path is in the file: grep DJANGO_ADMIN_URL $ENV_FILE"
