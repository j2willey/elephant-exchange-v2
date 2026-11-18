#!/usr/bin/env bash
# Deploys main to the droplet. The image is built here, not there: the droplet's one CPU is shared with other apps,
# and an npm install plus a Vite build would slow them all for minutes. Each image is tagged with its commit,
# so going back is one line in the droplet's .env (see "Rolling back" in the README).
# Run on Omarchy, from anywhere in the repo:  ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
host=${DEPLOY_HOST:-conductor}
dir=${DEPLOY_DIR:-ww/elephant-exchange-v2}
keep=3 # tagged images kept on the droplet, to roll back to

# Only what's on GitHub's main is deployed: the droplet pulls its compose files from there.
fail() { echo "deploy: $*" >&2; exit 1; }
[[ $(git rev-parse --abbrev-ref HEAD) == main ]] || fail "not on main"
[[ -z $(git status --porcelain) ]] || fail "uncommitted changes"
git fetch -q origin main
[[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] || fail "main isn't origin/main: push or pull first"

tag=$(git rev-parse --short HEAD)
echo "== Building elephant-exchange:$tag"
docker build -t "elephant-exchange:$tag" .

echo "== Shipping it to $host"
docker save "elephant-exchange:$tag" | gzip | ssh "$host" 'gunzip | docker load'

echo "== On $host: back up, pull, switch to $tag"
ssh "$host" bash -s -- "$dir" "$tag" "$keep" <<'REMOTE'
set -euo pipefail
cd "$1"
tag=$2 keep=$3
# Migrations can't be undone: back up before the new image starts.
./scripts/backup.sh
git pull -q --ff-only
if grep -q '^TAG=' .env; then sed -i "s/^TAG=.*/TAG=$tag/" .env; else printf '\nTAG=%s\n' "$tag" >> .env; fi
chmod 600 .env
docker compose up -d

printf 'Waiting for it to be healthy'
for _ in $(seq 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' elephant-exchange)
  [[ $status == healthy ]] && break
  printf '.'; sleep 2
done
echo " $status"
docker compose ps
docker compose logs app --since 2m --no-log-prefix | tail -5

# Keep the newest $keep tagged images (the running one among them) to roll back to.
docker images elephant-exchange --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r \
  | awk -F'\t' -v keep="$keep" '$2 != "latest" && $2 != "<none>" && ++n > keep { print $2 }' \
  | xargs -r -I{} docker rmi -f elephant-exchange:{} >/dev/null
[[ $status == healthy ]] || { echo "deploy: not healthy; roll back (README: Rolling back)" >&2; exit 1; }
echo "Deployed $tag. Reload any open tabs (Ctrl+Shift+R) to get the new screens."
REMOTE
