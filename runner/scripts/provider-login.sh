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
  if ! command -v codex >/dev/null 2>&1; then
    echo "Codex CLI is not installed in this runner. Rebuild with INSTALL_CODEX_CLI=true." >&2
    exit 127
  fi
  exec codex login --device-auth
fi
if ! command -v agy >/dev/null 2>&1; then
  echo "Antigravity CLI is not installed in this runner. Rebuild with INSTALL_AGY_CLI=true." >&2
  exit 127
fi
exec agy
