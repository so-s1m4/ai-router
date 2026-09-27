#!/bin/sh
set -eu
account="${1:-}"
session="${2:-}"
if [ -z "$account" ]; then
  echo "Использование: ./import-chatgpt.sh <accountId> [sessionToken/cookiesJSON]" >&2
  exit 1
fi
if [ -f /app/dist/import-chatgpt.js ]; then
  exec node /app/dist/import-chatgpt.js "$account" ${session:+"$session"}
else
  exec node "$(dirname "$0")/../dist/import-chatgpt.js" "$account" ${session:+"$session"}
fi
