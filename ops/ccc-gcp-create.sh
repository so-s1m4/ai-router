#!/bin/bash
set -euo pipefail
task_script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
task_project=${CCC_GCP_PROJECT:-project-37e84c09-c743-4b4c-8a8}
task_zone=${CCC_GCP_ZONE:-europe-west3-a}
task_instance=${CCC_GCP_INSTANCE:-ccc-compute}
gcloud services enable compute.googleapis.com --project="$task_project"
gcloud compute instances create "$task_instance" \
  --project="$task_project" --zone="$task_zone" \
  --machine-type=e2-standard-8 \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced \
  --no-service-account --no-scopes \
  --max-run-duration=3600s --instance-termination-action=STOP \
  --metadata-from-file="startup-script=$task_script_dir/ccc-gcp-startup.sh"
