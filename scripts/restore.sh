#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh: the database, plus the Photos and Theme images beside it in ./backups.
# Works on the droplet, or on a new server once the repo, .env and the image are there (see "Moving to a new
# server" in the README). Takes a backup of what's there now first, if the app is running, so this can be undone.
#   ./scripts/restore.sh backups/elephant-2026-12-13T0315Z.db
set -euo pipefail
cd "$(dirname "$0")/.."
file=${1:?usage: scripts/restore.sh backups/elephant-<time>.db}
[[ -f $file ]] || { echo "restore: no such file: $file" >&2; exit 1; }
dir=$(cd "$(dirname "$file")" && pwd)
name=$(basename "$file")

if [[ $(docker compose ps -q app 2>/dev/null) ]] && docker compose exec -T app true 2>/dev/null; then
  echo "== Backing up what's there now"
  ./scripts/backup.sh </dev/null
fi

echo "== Stopping the app"
docker compose stop app 2>/dev/null || true

# A throwaway container on the same data volume. The old -wal and -shm files go too: SQLite would otherwise replay
# the old database's last writes onto the restored one.
echo "== Restoring $name"
docker compose run --rm --no-deps -T -v "$dir:/restore:ro" --entrypoint sh app -c '
  set -e
  rm -f /data/elephant.db-wal /data/elephant.db-shm
  cp "/restore/$0" /data/elephant.db
  for d in photos themes; do
    if [ -d "/restore/$d" ]; then rm -rf "/data/$d"; cp -R "/restore/$d" "/data/$d"; fi
  done
  echo "restored: $(ls /data)"' "$name"

echo "== Starting the app"
docker compose up -d
printf 'Waiting for it to be healthy'
for _ in $(seq 30); do
  status=$(docker inspect -f "{{.State.Health.Status}}" "$(docker compose ps -q app)" 2>/dev/null || echo starting)
  [[ $status == healthy ]] && break
  printf '.'; sleep 2
done
echo " $status"
[[ $status == healthy ]] || { echo "restore: not healthy; see docker compose logs app" >&2; exit 1; }
