#!/usr/bin/env bash
# Deploy MapEditorPro to gh-pages with an auto-stamped version.
# Usage: bash deploy.sh
# Stamped version format: YYYY.MM.DD.<short-sha>  e.g. 2026.07.03.e6103b4

set -euo pipefail

BRANCH=$(git branch --show-current)
DATE=$(date +%Y.%m.%d)
SHA=$(git rev-parse --short HEAD)
BUILD="${DATE}.${SHA}"

if [ -n "$(git status --porcelain | grep -v '^??')" ]; then
  echo "ERROR: uncommitted changes — commit or stash before deploying."
  exit 1
fi

echo "Deploying $BUILD from $BRANCH → gh-pages…"

git checkout gh-pages
git merge "$BRANCH" --no-edit

# Stamp VERSION and COMMIT in-place — matches any existing value, not just "DEV"
sed -i '' "s/const VERSION = \"[^\"]*\"/const VERSION = \"${DATE}\"/" MapEditorPro.html
sed -i '' "s/const COMMIT  = \"[^\"]*\"/const COMMIT  = \"${SHA}\"/" MapEditorPro.html
sed -i '' "s|<title>Post Apo Map Editor[^<]*</title>|<title>Post Apo Map Editor ${BUILD}</title>|" MapEditorPro.html

bash compress_sprites.sh
git add MapEditorPro.html sprites/
git add building_database.json upgrade_database.json 2>/dev/null || true
git commit -m "deploy: ${BUILD}"
git push origin gh-pages

git checkout "$BRANCH"
echo "Done → ${BUILD}"
