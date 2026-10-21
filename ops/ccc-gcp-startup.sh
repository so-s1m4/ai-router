#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
rm -f /var/lib/ccc-compute-ready
if ! (node --version && python3 --version && g++ --version && command -v setsid && command -v timeout) >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends nodejs python3 g++ util-linux
fi
node -e 'require("node:fs"); require("node:child_process")'
python3 -c 'import json, pathlib, sys'
warm_dir=$(mktemp -d /tmp/ccc-warmup-XXXXXX)
trap 'rm -rf "$warm_dir"' EXIT
printf 'int main(){return 0;}' | g++ -std=c++17 -O2 -pipe -x c++ - -o "$warm_dir/probe"
"$warm_dir/probe"
touch /var/lib/ccc-compute-ready
