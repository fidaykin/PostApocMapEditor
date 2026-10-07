#!/usr/bin/env bash
# usage: scripts/unreferenced.sh <fixed-string> [allowed-path ...]
# Exits 1 and prints the hits when <fixed-string> appears anywhere in the repository outside the allowed paths
# (paths relative to the repo root; a hit in an allowed FILE does not count). node_modules, .git, scratch worktrees,
# the .superpowers / docs/superpowers planning history and test output are never searched.
# The "2-hit" method: a symbol whose only hits are its definition and its export line is unreferenced.
set -u
needle="$1"; shift
hits=$(grep -rIn -F --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=playwright-report \
  --exclude-dir=test-results --exclude-dir=superpowers --exclude-dir=.superpowers --exclude-dir=.worktrees --exclude='*.bak' \
  -- "$needle" . | grep -v '^./scripts/unreferenced.sh' | grep -v '^./tests/dead-code.spec.ts')
for allowed in "$@"; do hits=$(printf '%s\n' "$hits" | grep -v "^./$allowed:"); done
hits=$(printf '%s\n' "$hits" | sed '/^$/d')
if [ -n "$hits" ]; then echo "STILL REFERENCED: $needle"; echo "$hits"; exit 1; fi
echo "unreferenced: $needle"
