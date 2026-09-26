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
import pathlib
import re
import sqlite3
import subprocess
import sys

database = sqlite3.connect(sys.argv[1])
matches = []
for cert_id, provider, domains in database.execute(
    "SELECT id, provider, domain_names FROM certificate WHERE is_deleted = 0"
):
    if provider != "other":
        continue
    try:
        names = json.loads(domains)
    except (TypeError, ValueError):
        names = []
    certificate = pathlib.Path(sys.argv[1]).parent / "custom_ssl" / f"npm-{cert_id}" / "fullchain.pem"
    if not certificate.is_file():
        continue
    details = subprocess.run(
        ["openssl", "x509", "-in", str(certificate), "-noout", "-ext", "subjectAltName"],
        capture_output=True, text=True, check=True,
    ).stdout
    if "*.s1m4.com" in names or re.search(r"DNS:\*\.s1m4\.com(?:\s|,|$)", details):
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
changed=0
if ! cmp -s "$cert_dir/fullchain.pem" "$destination/fullchain.pem" || \
   ! cmp -s "$cert_dir/privkey.pem" "$destination/privkey.pem"; then
  install -m 0644 "$cert_dir/fullchain.pem" "$destination/fullchain.pem"
  install -m 0600 "$cert_dir/privkey.pem" "$destination/privkey.pem"
  changed=1
fi

python3 - "$npm_data/database.sqlite" "$certificate_id" "$cert_dir/fullchain.pem" <<'PY'
import datetime
import json
import re
import sqlite3
import subprocess
import sys

database_path, cert_id, certificate = sys.argv[1:]
expiry = subprocess.check_output(
    ["openssl", "x509", "-in", certificate, "-noout", "-enddate"], text=True,
).strip().split("=", 1)[1]
expires_on = datetime.datetime.strptime(expiry, "%b %d %H:%M:%S %Y %Z").strftime("%Y-%m-%d %H:%M:%S")
details = subprocess.check_output(
    ["openssl", "x509", "-in", certificate, "-noout", "-ext", "subjectAltName"], text=True,
)
domains = re.findall(r"DNS:([^,\s]+)", details)
if "*.preview.s1m4.com" not in domains:
    raise SystemExit("Installed certificate does not cover preview subdomains")
database = sqlite3.connect(database_path)
with database:
    database.execute(
        "UPDATE certificate SET expires_on = ?, domain_names = ? WHERE id = ? AND provider = 'other' AND is_deleted = 0",
        (expires_on, json.dumps(domains), cert_id),
    )
PY

if [[ "$changed" -eq 0 ]]; then
  echo "NPM wildcard certificate is current"
  exit 0
fi

docker exec "$npm_container" nginx -t
docker exec "$npm_container" nginx -s reload
echo "Updated NPM wildcard certificate $certificate_id"
