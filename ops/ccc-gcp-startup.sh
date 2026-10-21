#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends nodejs python3 g++ util-linux
touch /var/lib/ccc-compute-ready
