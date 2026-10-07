# T6.6 report: dead code removal (verification first)

## Method
Re-ran the 2-hit check at execution time with `scripts/unreferenced.sh` (repo-wide fixed-string grep; excludes node_modules, .git, .superpowers, docs/superpowers, .worktrees, test output; includes tests and every script, also partial names). Candidate discovery: every function/const in MapEditorPro.html and the root scripts counted across the repo (names with 1 hit, or 2 hits where the second is only an export line), unreferenced CSS classes/ids. A positive control (`selectTerrain` is reported as referenced) was run. Each removal has a RED-first check in `tests/dead-code.spec.ts` (static "no longer defined" check and/or typeof check in the live page, with live neighbours as positive controls).

## Commits (each its own commit)
- cac1011 selectCustomTerrain, getSelectedCustomId (UI), getCustomSprite (Terrain): still exactly 2 hits each. Adds scripts/unreferenced.sh and tests/dead-code.spec.ts.
- 6599948 HexDB editor helpers `_numInput`, `_costRow` (1 hit each) and the `.hexdb-cost-row` CSS only they used.
- e57b946 GitHubSync `_getFileSha` (1 hit).
- 9f11953 zone-painter.js `_hexIdToTid` (1 hit); zone-painter.js ?v 18 -> 19 (workflow grep accepts any number).
- b1b2f50 LocalizationKeys.getGroups export (2 hits).
- beb0874 IO.resumeFolderAutosave (2 hits; never wired to a button).
- 61dae0a GitHubSync.loadBuildingDbFromServer (2 hits; startup uses syncContentFromServer).
- 78838a2 five unused CSS rules (.auto-sync-label, .fp-empty, .pub-drop-sub, .stub-editor, .stub-msg) in one commit.

## Skipped on purpose
- `getReport` (MapValidator), `isAvailable` (Bookmarks), `KNOWN_KEYS` (MapFormat): pass the 2-hit check but are deliberate public APIs of Phase 4/6 modules: kept, owner call.
- `initFsDir` / `_filter` look unused by name but are used (IO.initFsDir() call, DevTools._filter in onclick strings).
- CSS `mode-*` body rules and `#slots-main` (mode class built by concatenation), 31 HTML ids without a second hit (menu-*, tab-*, gen-*-v are built by concatenation or are test/style hooks): not removed.
- No `.bak` file exists.

## Focused specs
dead-code 12 (grows per commit), paint-tools + packages-palette + tile-classes (162 with dead-code), packages-details/reskin/perf-terrain-memo/startup-sync (58), package-delete/import/publish, sync-merge, registry-fresh-read, local-only (94), layers/fixwave1/map-json-contract/nav-minimap/perf-workers/no-native-dialogs (263 passed, 1 failed), autosave-recovery/storage-errors/dialogs (51), startup-sync/sync-merge/package-publish/local-only/registry (67), layout-narrow/packages-toolbar/help-menu (51).
Failure not caused by this task: `fixwave1.spec.ts:478` W1-3 "hostile package id" (expects inline `this.dataset.pkgId` handlers; T5.1 rebuilt the panel with DOM APIs). Pre-existing since T5.1; needs a test update by the owner/controller.
perf-*.spec.ts once at the end (machine load average 6-9): 122 passed, 4 skipped, 3 timeouts in perf-lod (two timing specs + one outline spec); re-run of perf-lod alone: 17 passed, 1 startup failure in openEditor, which passed alone. Load-caused, not hidden. perf-baseline.json untouched.

## T6.6b asset candidates (NOT deleted; owner-gated)
- sprites/hex_atlas.png 7,134,073 B (6.8 MB), sprites/hex_atlas.json 2,531 B, build_atlas.py 1,565 B. Evidence: `hex_atlas` appears only in those files; `build_atlas` only in build_atlas.py and README.md (my new file list; update it if deleted). The game may still read the atlas from the server.
- Root `sprites/` (65 MB, 177 tracked files: hex 44 MB, terrain 9.7 MB, buildings 4.5 MB, City.png 304 KB) duplicates `packages/postapoc/sprites/` (58 MB, 174 files) but is still written on purpose (GitHubSync compat writers at ~8850, ~9114 plus root database copies ~9004, ~9065). Removal needs owner confirmation that no game/tool reads `sprites/...`, then removing those writers.
- Untracked/ignored, local only: playwright-report/ (532 KB), test-results/ (empty).
