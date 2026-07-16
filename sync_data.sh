#!/usr/bin/env bash
# Pull latest DB JSONs from Drive into the repo before deploying.
# The file IDs come from the editor's published URLs (check network tab after publishing).
# Usage: bash sync_data.sh
set -euo pipefail

BUILDING_DB_ID="${BUILDING_DB_FILE_ID:-}"
UPGRADE_DB_ID="${UPGRADE_DB_FILE_ID:-}"

if [ -z "$BUILDING_DB_ID" ] || [ -z "$UPGRADE_DB_ID" ]; then
  echo "Set BUILDING_DB_FILE_ID and UPGRADE_DB_FILE_ID env vars, then re-run."
  echo "Find IDs in browser DevTools → Network tab after publishing from the editor."
  exit 1
fi

curl -Ls "https://drive.google.com/uc?export=download&id=${BUILDING_DB_ID}" -o building_database.json
echo "Downloaded building_database.json"

curl -Ls "https://drive.google.com/uc?export=download&id=${UPGRADE_DB_ID}" -o upgrade_database.json
echo "Downloaded upgrade_database.json"

echo "Done — run 'bash deploy.sh' to publish."
