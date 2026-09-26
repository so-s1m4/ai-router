#!/usr/bin/env bash
set -euo pipefail

# Run as root after acme.sh renews the certificate or after NPM imports it.
cert_dir="${CERT_DIR:-/etc/ai-router/ssl}"
npm_data="${NPM_DATA_DIR:-/data/compose/1/data}"
npm_container="${NPM_CONTAINER:-nginx-proxy-manager}"

test -s "$cert_dir/fullchain.pem"
test -s "$cert_dir/privkey.pem"
test -f "$npm_data/database.sqlite"

certificate_id="$(python3 - "$npm_data/database.sqlite" <<'PY'
import json
import sqlite3
import sys

database = sqlite3.connect(sys.argv[1])
matches = []
for cert_id, provider, domains in database.execute(
    "SELECT id, provider, domain_names FROM certificate WHERE is_deleted = 0"
):
    try:
        names = json.loads(domains)
    except (TypeError, ValueError):
        names = []
    if provider == "other" and "*.s1m4.com" in names:
        matches.append(cert_id)
if len(matches) > 1:
    raise SystemExit("Multiple custom wildcard certificates found in NPM")
print(matches[0] if matches else "")
PY
)"

if [[ -z "$certificate_id" ]]; then
  echo "NPM custom wildcard certificate is not imported yet; nothing to sync"
  exit 0
fi

destination="$npm_data/custom_ssl/npm-$certificate_id"
test -d "$destination"
if cmp -s "$cert_dir/fullchain.pem" "$destination/fullchain.pem" && \
   cmp -s "$cert_dir/privkey.pem" "$destination/privkey.pem"; then
  echo "NPM wildcard certificate is current"
  exit 0
fi

install -m 0644 "$cert_dir/fullchain.pem" "$destination/fullchain.pem"
install -m 0600 "$cert_dir/privkey.pem" "$destination/privkey.pem"
docker exec "$npm_container" nginx -t
docker exec "$npm_container" nginx -s reload
echo "Updated NPM wildcard certificate $certificate_id"
