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

MAPS_FOLDER_ID="${MAPS_DRIVE_FOLDER_ID:-}"
DRIVE_API_KEY="${MAPS_DRIVE_API_KEY:-}"

if [ -n "$MAPS_FOLDER_ID" ] && [ -n "$DRIVE_API_KEY" ]; then
  echo "Syncing maps from Drive folder…"
  mkdir -p maps
  # Fetch file list from Drive folder
  LIST=$(curl -s "https://www.googleapis.com/drive/v3/files?q=%27${MAPS_FOLDER_ID}%27+in+parents+and+trashed+%3D+false&key=${DRIVE_API_KEY}&fields=files(id,name,size,modifiedTime)")
  # Download each .json file and build map_list.json
  python3 - <<'PYEOF'
import json, subprocess, sys, os, re

data = json.loads(subprocess.check_output(['bash', '-c', 'echo "$LIST"'], env={**os.environ}).decode())
files = [f for f in data.get('files', []) if f.get('name', '').endswith('.json')]

maps = []
for f in files:
    name = f['name']
    file_id = f['id']
    size = f.get('size', '0')
    modified = f.get('modifiedTime', '')[:10]
    display_name = re.sub(r'\.json$', '', name, flags=re.IGNORECASE)
    print(f"  Downloading {name}…", flush=True)
    subprocess.run(['curl', '-Ls', f'https://drive.google.com/uc?export=download&id={file_id}', '-o', f'maps/{name}'], check=True)
    maps.append({'name': display_name, 'fileName': name, 'size': size, 'uploadedTime': modified})

with open('maps/map_list.json', 'w') as fp:
    json.dump({'maps': maps}, fp, indent=2)
    fp.write('\n')

print(f"  map_list.json updated with {len(maps)} maps.", flush=True)
PYEOF
else
  echo "Skipping map sync (set MAPS_DRIVE_FOLDER_ID and MAPS_DRIVE_API_KEY to enable)."
fi
