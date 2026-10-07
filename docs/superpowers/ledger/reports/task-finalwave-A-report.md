# Final fix wave A report

Commits (HEAD b556820 before): f133d5c (A1), 7a0cc88 (A2 A3 A4 A5 A8, plus parts of A6/A7), f2e6b9a (A6 A7), cb4b3b5 (A9), f52313f (A10), e00c935 (A11).
A2/A3/A4/A5/A8 all live in `_confirmImport` and the rollback helpers and could not be split into separate working commits; the commit body lists them.
New specs: `tests/final-wave-a-packages.spec.ts` (25 tests), `tests/final-wave-a-editor.spec.ts` (10 tests). FakeGitHub gained `hideContent(path)` (GET answers like GitHub for >1 MB files: sha, no content).

RED evidence method: tests written first; where the fix was already in the tree when a later test batch was added, the new tests were run against the pre-wave `MapEditorPro.html` (`git show` of the earlier version swapped in, then the current copy put back with cp) to show RED.

## A1 spriteName (security)
- `MapEditorPro.html`: `isSafeSpriteName(n)` (= `sanitizeSpriteName(n + '.png') === n`, exported); `validatePackageZip` refuses a hex/building record with an unsafe `spriteName` ("unsafe spriteName"); `publishPackage` refuses before ANY request (also `publishPackageSprites` throws), `exportPackage` fails with a toast and writes no ZIP; the local category is data too (`_spriteDir`, `_zipSpriteDir`).
- `GitHubSync._ghPath`: every Contents API URL (PUT/GET/DELETE/list, snapshot, sha) encodes each path segment; Pages fallback fetch in `publishPackageSprites` encodes category and name.
- Decision: `spriteName === ''` is allowed (means "no sprite"; no path is ever built from it).
- RED: 4/4 failed against pre-wave HTML (hostile table of 14 names for ZIP and publish, encoding test, export refusal + round trip). GREEN 4/4. Two older specs asserted hostile names (`x<img ...>`, `Old_A` with markup) as accepted; updated to use canonical names (`packages-import-validate`, `packages-export`).

## A2 / A3 / A4 / A5 / A8 import
- `_putContents` returns the new blob sha; `_putText/_putBinary` pass it on. New `_fileSha`; `_snapshotFile` throws "too large to read back ... cannot be backed up" when the Contents API omits content; `_removeFile/_restoreFile(path, ..., onlyIfSha)` act only while the server still holds the sha this import wrote (`'changed'` otherwise).
- `_confirmImport`: every target path is snapshotted BEFORE the first write (A5: a >1 MB server file refuses with zero writes, toast "Import refused: ... Nothing was written to the server."); each write is conditional on its snapshot sha (null = create-only, A2); New mode refuses if package.json/DBs appeared meanwhile; `_rollback` returns `{remaining, changed}`, an unknown PUT outcome is acted on only when the file provably holds the attempted content; the failure modal lists "changed by someone else, left alone" separately; `getImportResult().changed`.
- A3: after the registry write `_removeLocalRecord(newId)` before `_mergeLocal`; an import over a local-only id whose id exists on the server (not ours) is refused.
- A4: Merge/New skip the server PUT for sprites kept locally (toast says not overwritten here or on the server); Replace writes all.
- A8: new `HexDB/BldDB.snapshotPackage/restorePackage` (entries with positions); rollback restores only the package's entries, its sprites, its trash item (plus anything the 5-item cap evicted) and its details.
- RED (8 failed pre-implementation, 1 regression guard passed): two imports racing (snapshot sees the other's file: refuse, zero writes), create-only 409 with their file left alone and listed, file changed between write and rollback, local-only claim + publish, taken id over local-only, Merge sprite divergence, >1 MB refusal, mid-import edit of another package survives. GREEN 13/13.

## A6 sprite names/paths
- `sanitizeSpriteName`: NFC, trailing dots/spaces stripped, Windows device names (CON PRN AUX NUL COM1-9 LPT1-9, with/without extension), `__`-prefixed names rejected; `_uploadedUrls = Object.create(null)`.
- `normalizeSpriteFile` refuses when the header carries no size (JPEG SOF past 64 KB, short PNG, unknown WebP), no decode. Shared `ImageHeader` (kind/dims, also BMP/GIF) is used by Packages and A11.
- Import: server and local paths are built as `sprites/<lowercase folder>/<name>.png`; names differing only by case are refused ("used twice, ignoring case").
- RED against pre-wave HTML: sanitize table, uploaded-URL test, header test, case test (4 of 4). GREEN.

## A7 smaller package fixes
- M2: publish re-checks `pkgFile`/registry listing for an unclaimed local-only package after reading them. M6: `_parseVersion` accepts `-pre`/`+build` tails; bumps use the numeric core (1.0.0-beta + patch = 1.0.1, + keep = 1.0.0; documented in code); older nextVersion/publish tests updated. M7: import keeps the ZIP's version (package.json and registry entry) and the server's `changelog`. M8: `_reloadDetails()` before each details read-modify-write (updateDetails, import, rollback). M10: `UI.showModal({canClose})` vetoes Escape/backdrop; publish dialog uses `!_publishBusy`. M11: details dialog stores the preview first and rolls it back if the details save fails; a failing store shows the error and keeps the dialog open. M12: `_validate(..., serverOnly)` / `_graph(..., serverOnly)`: publish uses the server graph plus only this package's details.
- RED against pre-wave HTML: 7 of the 8 A7 tests (plus A6) failed; GREEN.

## A9
- `autoPlaceSettlements` removes only slot types (settlement, outpost, trading_post, custom slot types) minus the city and `Placement.settlementTypes()` (new export); `ZonePainter.fillZoneSettlements` removes only `type === 'settlement'` in the zone; `zone-painter.js?v=20`. Tests: Place then Auto-place, zone fill, undo restores. RED 2/2, GREEN.

## A10
- Non-override startup restore: `MapFormat.validate` failure sets `_restoreProblem` + `_protected` (override path untouched). `MapFormat.validate`: truthy non-array `biomePresets` and a `zoneMap` that is not base64 text are errors (all `maps/*.json` still validate); `map-format.js?v=2` (workflow + deploy lint pinned to v=2). `_loadFromJSON` returns true/false; the file input and the server maps list change file name / toast "Loaded" only on true (a refusal closes the maps popover so the error dialog is visible).
- RED 5/5 against the previous HTML (+ valid-autosave control passes), GREEN 6/6.

## A11
- `importElevation` reads PNG/JPEG/WebP/BMP/GIF dims from the header first: unknown kind or size is refused, > 16384 per side or > 64 Mpx refused before `createImageBitmap` (post-decode check kept). `generation.spec.ts` validation test adapted (no-header junk is now refused pre-decode; a small-size header + garbage still reaches the decoder). RED 2/2, GREEN.

## Focused runs
- Packages and related: package-* + packages-* + final-wave-a-packages + registry-fresh-read + startup-sync + sync-merge + modal + dialogs + no-native-dialogs + phase5-helpers: 218 passed (before A9-A11), then see the final line below.
- A9: placement + city + perf-workers lint + layers (zone/settlement filter) + fixwave1 + docs-lint + dead-code: 42 + 50 + 60 passed.
- A10: autosave-recovery + map-json-contract + map-load-warnings + no-native-dialogs + startup: 39 passed.
- A11: generation + final-wave-a-editor + city: 70 passed.
- Final combined run after A11 (package-*, packages-*, final-wave-a-*, registry-fresh-read, startup-sync, sync-merge, modal, dialogs, no-native-dialogs, phase5-helpers, map-load-warnings, autosave-recovery, map-json-contract, placement, generation, city, perf-workers, docs-lint, dead-code): 418 passed (2.4 min).

## Not done / notes
- `spriteName === ''` is accepted (no path built from it).
- Replace over a package whose server sprites exceed 1 MB is refused (backup impossible through the Contents API); it does not use the raw media type.
- Full suite not run (wave B, then the controller).
