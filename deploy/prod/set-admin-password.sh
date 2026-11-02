#!/usr/bin/env bash
# Set the extra Basic Auth login that protects admin.livemodeltest.com (panel pages and the
# internal Django admin), at a hidden prompt:
#
#   /srv/mcq/releases/<sha>/deploy/prod/set-admin-password.sh [user name]
#
# Writes /srv/mcq/nginx/admin.htpasswd (one user, SHA-512 crypt hash, never the password)
# and, if nginx is already running, reloads it so the new password applies at once.
# This is NOT the Admin Panel account (that one is created with `create_admin`); use a
# different password for each.
set -Eeuo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/prod/lib.sh
. "$HERE/lib.sh"
LOG_TAG=admin-password

user="${1:-admin}"
[[ "$user" =~ ^[A-Za-z0-9._-]{3,32}$ ]] || die "user name: 3-32 letters, digits, . _ -"
[[ -t 0 ]] || die "run this in a terminal (the password is typed at a hidden prompt)"

read -r -s -p "New Basic Auth password for '$user' (hidden): " password
echo
read -r -s -p "Same password again (hidden): " again
echo
[[ "$password" == "$again" ]] || die "the passwords do not match; nothing changed"
[[ ${#password} -ge 12 ]] || die "use at least 12 characters; nothing changed"

mkdir -p "$MCQ_ROOT/nginx"
tmp="$(mktemp "$MCQ_ROOT/nginx/.htpasswd.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
hash="$(printf '%s' "$password" | openssl passwd -6 -stdin)"
unset password again
printf '%s:%s\n' "$user" "$hash" >"$tmp"
# Readable by nginx's unprivileged worker inside the container; it holds only the hash.
chmod 644 "$tmp"
mv "$tmp" "$MCQ_ROOT/nginx/admin.htpasswd"
trap - EXIT
log "Basic Auth set for user '$user' ($MCQ_ROOT/nginx/admin.htpasswd)"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PROJECT-nginx-1"; then
    docker exec "$PROJECT-nginx-1" nginx -s reload >/dev/null && log "nginx reloaded"
fi
