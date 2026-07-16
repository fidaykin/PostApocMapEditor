#!/usr/bin/env bash
# Lossless PNG compression using oxipng.
# Run before deploy to shrink sprites without any pixel changes.
# Requires: brew install oxipng
set -euo pipefail

SPRITES_DIR="$(dirname "$0")/sprites"

if ! command -v oxipng &>/dev/null; then
  echo "oxipng not found - install with: brew install oxipng"
  exit 1
fi

echo "Compressing PNGs in $SPRITES_DIR..."
find "$SPRITES_DIR" -name "*.png" | while read -r f; do
  before=$(stat -f%z "$f")
  oxipng -o 4 --quiet "$f"
  after=$(stat -f%z "$f")
  saved=$(( before - after ))
  if [ "$saved" -gt 0 ]; then
    pct=$(echo "scale=0; $saved * 100 / $before" | bc)
    echo "  ${pct}% - $(basename "$f")"
  fi
done

echo "Done."
