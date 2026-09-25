#!/usr/bin/env bash
set -euo pipefail

read -r action revision extra <<< "${SSH_ORIGINAL_COMMAND:-}"
if [[ "$action" != deploy || ! "$revision" =~ ^[0-9a-f]{40}$ || -n "${extra:-}" ]]; then
  echo 'Expected: deploy <40-character commit SHA>' >&2
  exit 2
fi

exec 9>/home/ubuntu/.config/ai-router/deploy.lock
flock 9

repo=/home/ubuntu/ai-router
webhook_file=/home/ubuntu/.config/ai-router/portainer-webhook-url
test -r "$webhook_file"

git -C "$repo" fetch --depth=1 origin refs/heads/main
head_revision=$(git -C "$repo" rev-parse FETCH_HEAD)
if [[ "$head_revision" != "$revision" ]]; then
  echo "Deployment skipped: $revision is no longer the main branch head"
  exit 0
fi
git -C "$repo" checkout --detach --force "$revision"

docker build --pull -t "ai-router-backend:$revision" -t ai-router-backend:latest "$repo/backend"
docker build --pull -t "ai-router-frontend:$revision" -t ai-router-frontend:latest "$repo/frontend"

webhook=$(cat "$webhook_file")
curl --fail --silent --show-error --max-time 60 --request POST "$webhook" >/dev/null

expected_backend=$(docker image inspect --format '{{.Id}}' ai-router-backend:latest)
expected_frontend=$(docker image inspect --format '{{.Id}}' ai-router-frontend:latest)
for _ in $(seq 1 90); do
  backend=$(docker ps --filter label=com.docker.compose.project=ai-router --filter label=com.docker.compose.service=backend --format '{{.ID}}' | head -1)
  frontend=$(docker ps --filter label=com.docker.compose.project=ai-router --filter label=com.docker.compose.service=frontend --format '{{.ID}}' | head -1)
  if [[ -n "$backend" && -n "$frontend" ]]; then
    actual_backend=$(docker inspect --format '{{.Image}}' "$backend")
    actual_frontend=$(docker inspect --format '{{.Image}}' "$frontend")
    if [[ "$actual_backend" == "$expected_backend" && "$actual_frontend" == "$expected_frontend" ]] && curl --fail --silent --max-time 3 http://127.0.0.1:18088/api/health | grep -q '"ok":true'; then
      echo "Deployed and healthy: $revision"
      exit 0
    fi
  fi
  sleep 2
done

echo 'Portainer did not activate the expected images within three minutes' >&2
exit 1
