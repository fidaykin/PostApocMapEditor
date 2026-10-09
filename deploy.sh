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
# gh-pages also receives content straight from the editor (Contents API publishes): start from the REMOTE tip, never from a
# stale local copy. --ff-only aborts (set -e) instead of ever rewriting published data.
git pull --ff-only origin gh-pages

if ! git merge "$BRANCH" --no-edit; then
  # The only conflict that is safe to settle automatically is MapEditorPro.html: both sides differ only by the
  # VERSION/COMMIT/<title> stamp (the editor file is owned by the source branch). Anything else needs a human.
  CONFLICTS=$(git diff --name-only --diff-filter=U)
  if [ "$CONFLICTS" = "MapEditorPro.html" ]; then
    git checkout --theirs MapEditorPro.html
    git add MapEditorPro.html
    git commit --no-edit --no-verify
  else
    echo "ERROR: merge conflicts in: $CONFLICTS — resolve by hand (git merge --abort to undo), nothing was pushed."
    exit 1
  fi
fi

# Stamp VERSION and COMMIT in-place — matches any existing value, not just "DEV"
sed -i '' "s/const VERSION = \"[^\"]*\"/const VERSION = \"${DATE}\"/" MapEditorPro.html
sed -i '' "s/const COMMIT  = \"[^\"]*\"/const COMMIT  = \"${SHA}\"/" MapEditorPro.html
sed -i '' "s|<title>Post Apo Map Editor[^<]*</title>|<title>Post Apo Map Editor ${BUILD}</title>|" MapEditorPro.html

git add MapEditorPro.html
# --no-verify: the pre-commit hook re-stamps COMMIT with the parent commit's hash, which would make the corner label
# (VERSION.COMMIT) disagree with the <title> stamped above.
git commit --no-verify -m "deploy: ${BUILD}"
git push origin gh-pages

git checkout "$BRANCH"
echo "Done → ${BUILD}"
