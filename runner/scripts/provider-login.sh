#!/bin/sh
set -eu
provider="${1:-}"
account="${2:-}"
case "$provider" in codex|antigravity) ;; *) echo "Provider must be codex or antigravity" >&2; exit 2;; esac
case "$account" in *[!a-zA-Z0-9_-]*|'') echo "Invalid account ID" >&2; exit 2;; esac
home="/runner-data/accounts/$account/home"
mkdir -p "$home"
export HOME="$home"
if [ "$provider" = codex ]; then
  export CODEX_HOME="$home/.codex"
  mkdir -p "$CODEX_HOME"
  exec codex login --device-auth
fi
exec agy
