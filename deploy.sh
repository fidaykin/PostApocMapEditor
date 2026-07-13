#!/usr/bin/env bash
# Deploy MapEditorPro to gh-pages with an auto-stamped version.
# Usage: bash deploy.sh
# Stamped version format: YYYY.MM.DD.<short-sha>  e.g. 2026.07.09.2da19f4

set -euo pipefail

BRANCH=$(git branch --show-current)
DATE=$(date +%Y.%m.%d)
SHA=$(git rev-parse --short HEAD)
BUILD="${DATE}.${SHA}"

if [ "$BRANCH" = "gh-pages" ]; then
  # Already on gh-pages — stamp and push directly
  echo "Deploying $BUILD (already on gh-pages)…"
  sed -i '' "s/const VERSION = \"[^\"]*\"/const VERSION = \"${DATE}\"/" MapEditorPro.html
  sed -i '' "s/const COMMIT  = \"[^\"]*\"/const COMMIT  = \"${SHA}\"/" MapEditorPro.html
  sed -i '' "s|<title>Post Apo Map Editor[^<]*</title>|<title>Post Apo Map Editor ${BUILD}</title>|" MapEditorPro.html
  git add MapEditorPro.html
  git commit -m "deploy: ${BUILD}" || echo "Version already up to date."
  git push origin gh-pages
else
  # On a feature branch — require MapEditorPro.html to be committed, then copy to gh-pages
  if [ -n "$(git status --porcelain MapEditorPro.html)" ]; then
    echo "ERROR: MapEditorPro.html has uncommitted changes — commit before deploying."
    exit 1
  fi
  echo "Deploying $BUILD from $BRANCH → gh-pages…"
  git checkout gh-pages
  git checkout "$BRANCH" -- MapEditorPro.html
  sed -i '' "s/const VERSION = \"[^\"]*\"/const VERSION = \"${DATE}\"/" MapEditorPro.html
  sed -i '' "s/const COMMIT  = \"[^\"]*\"/const COMMIT  = \"${SHA}\"/" MapEditorPro.html
  sed -i '' "s|<title>Post Apo Map Editor[^<]*</title>|<title>Post Apo Map Editor ${BUILD}</title>|" MapEditorPro.html
  git add MapEditorPro.html
  git commit -m "deploy: ${BUILD}"
  git push origin gh-pages
  git checkout "$BRANCH"
fi

echo "Done → ${BUILD}"
