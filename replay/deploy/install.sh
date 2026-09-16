#!/bin/sh
# Install, or update, prototype 2 as a permanent service at https://<ip>/ -- run as root from
# an extracted release:   ./deploy/install.sh 207.148.70.144
#
# Idempotent, and this is everything it touches:
#   /srv/pulsemind-replay/releases/<utc stamp>/   this release, root-owned and read-only
#   /srv/pulsemind-replay/current                 symlink to it, swapped atomically
#   /usr/local/bin/caddy                          official release binary, sha512-verified
#   /etc/caddy/Caddyfile, the `caddy` system user, two systemd units
#   ufw: 80/tcp (certificate challenge, redirect), 443/tcp and 443/udp (HTTPS, HTTP/3)
#
# Updating the bundle later is the same command from the new release: it adds a release,
# moves the symlink and restarts only the replay. Caddy and the certificate stay put.
set -eu
IP="${1:?usage: install.sh <public-ip>}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
ROOT=/srv/pulsemind-replay
REL="$ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$REL"
# The release only: never the runtime files an earlier ./run.sh or ./tunnel.sh left beside it.
tar -C "$SRC" --exclude='./releases' --exclude='./cloudflared' --exclude='./*.log' \
    --exclude='./*.pid' --exclude='./sessions.json' --exclude='./__pycache__' -cf - . \
  | tar -C "$REL" -xf -
chown -R root:root "$REL"
chmod -R a+rX,go-w "$REL"
ln -sfn "$REL" "$ROOT/current.new"
mv -Tf "$ROOT/current.new" "$ROOT/current"
echo "release: $REL"

if ! command -v caddy >/dev/null 2>&1; then
  TAG=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')
  VER=${TAG#v}
  TMP=$(mktemp -d)
  ( cd "$TMP"
    curl -fsSLO "https://github.com/caddyserver/caddy/releases/download/$TAG/caddy_${VER}_linux_amd64.tar.gz"
    curl -fsSLO "https://github.com/caddyserver/caddy/releases/download/$TAG/caddy_${VER}_checksums.txt"
    sha512sum -c --ignore-missing "caddy_${VER}_checksums.txt"
    tar xzf "caddy_${VER}_linux_amd64.tar.gz" caddy
    install -m 755 caddy /usr/local/bin/caddy )
  rm -rf "$TMP"
fi
caddy version

id caddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/caddy --create-home \
  --shell /usr/sbin/nologin caddy
mkdir -p /etc/caddy
sed "s/@IP@/$IP/g" "$SRC/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
install -m 644 "$SRC/deploy/caddy.service" /etc/systemd/system/caddy.service
install -m 644 "$SRC/deploy/pulsemind-replay.service" /etc/systemd/system/pulsemind-replay.service

ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null

systemctl daemon-reload
systemctl enable --now pulsemind-replay caddy
systemctl restart pulsemind-replay
systemctl reload caddy || systemctl restart caddy
sleep 2
systemctl --no-pager --lines=0 status pulsemind-replay caddy | grep -E "Loaded|Active"
curl -fsS http://127.0.0.1:8750/healthz; echo
