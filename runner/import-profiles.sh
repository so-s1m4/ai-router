#!/bin/sh
set -eu
if [ "$#" -eq 0 ]; then
  echo 'Usage: runner/import-profiles.sh file.codexprofile.json [more files...]' >&2
  exit 2
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for archive in "$@"; do
  if [ ! -f "$archive" ]; then
    echo "File not found: $archive" >&2
    exit 2
  fi
  docker compose -f "$script_dir/compose.yaml" exec -T runner node /app/dist/import-profiles.js < "$archive"
done
