#!/usr/bin/env bash
# Copies the droplet's backups (the databases, Photos and Theme images) to this machine, so they survive losing the
# droplet. Old databases are kept here even after the droplet deletes them (it keeps 14). deploy.sh runs it after
# every deploy; run it by hand any time, and weekly through December.
#   ./scripts/pull-backups.sh            # into ~/elephant-backups
set -euo pipefail
host=${DEPLOY_HOST:-ej}
dir=${DEPLOY_DIR:-ww/elephant-exchange-v2}
to=${BACKUP_COPY_DIR:-$HOME/elephant-backups}
mkdir -p "$to"
# Photos and Theme images mirror the droplet's latest copy (so deleted Photos go from here too); the databases are
# protected from that, so they only accumulate. rsync uses $RSYNC_RSH for ssh when it's set (deploy.sh sets it).
rsync -a --delete --filter='P elephant-*.db' "$host:$dir/backups/" "$to/"
latest=$(ls -1 "$to"/elephant-*.db 2>/dev/null | tail -1)
echo "Backups in $to: $(ls -1 "$to"/elephant-*.db 2>/dev/null | wc -l) databases, newest $(basename "${latest:-none}")"
