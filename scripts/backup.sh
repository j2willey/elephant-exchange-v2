#!/usr/bin/env bash
# Backs up the running app: a safe copy of the database, plus the Photos and Theme images,
# kept in the data volume and copied out to ./backups on this machine. The newest 14 are kept in each.
# Run from anywhere in the repo on the droplet; nightly from cron, for example:
#   15 3 * * * /opt/elephant-exchange/scripts/backup.sh >> /opt/elephant-exchange/backups/backup.log 2>&1
# To get copies off the droplet, from your laptop:  rsync -a droplet:/opt/elephant-exchange/backups/ ~/elephant-backups/
set -euo pipefail
cd "$(dirname "$0")/.."
keep=14

file=$(docker compose exec -T -e BACKUP_DIR=/data/backups -e BACKUP_KEEP=$keep app \
  node --import tsx packages/server/src/backup.ts)
mkdir -p backups
docker compose cp "app:$file" backups/ 2>/dev/null

# Photos and Theme images: the latest copy of each folder (they change little, and old Photos are meant to go).
for folder in photos themes; do
  if docker compose exec -T app test -d "/data/$folder"; then
    rm -rf "backups/$folder"
    docker compose cp "app:/data/$folder" "backups/$folder" 2>/dev/null
  fi
done

# Keep the newest $keep here too.
ls -1 backups/elephant-*.db | head -n -$keep | xargs -r rm --
echo "$(date -u +%FT%TZ) backed up to backups/$(basename "$file")"
