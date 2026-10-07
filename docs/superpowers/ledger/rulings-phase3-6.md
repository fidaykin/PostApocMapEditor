# Controller rulings for Phases 3-6 (BINDING; they amend the plan text where they conflict)

Source: preflight-phase3-6.md (read its Part A/B/C rows for your task: it lists the exact stale anchors, missing helpers and conflicts), the Phase 2 ledger (progress.md), and the user's directive of 2026-10-06 (speed: implementers run FOCUSED specs only; the controller runs the full suite and the whole-plan reviews at the very end).

## Always (every task, every phase)
1. Standing rules (implementer-rules.md 'Standing rules added during Phase 2' + the typed-letter shortcut rule): RED-first real tests; no vacuous assertions (positive controls); no wall-clock assertions; no `window.x =` on top-level `let`; independent references; input handling standard (left button only, side buttons rejected, lost mouseup via `e.buttons===0`, window mouseup/blur, tool switch resets state, stale map cancels with toast, `Tools.isFillBusy`/`isStroking` gates, Escape without History step, one History step per gesture, no empty steps); controls ONLY in the LEFT palette (never the top toolbar row, never the right panel; canvas must stay 1491x808 at 1400x900); `_isTypingOrModal(e)` (checks e.target too); no inner/outerHTML with data (DOM APIs/textContent; ids and names are untrusted); never touch `tests/perf-baseline.json`; the baselines/hashes (`generator_seed42` etc.) must not change: if your change would shift default output, make it opt-in or default-preserving.
2. Bulk-writer contract (Phase 2 final review): every in-place writer of map layers must: refuse while `Tools.isFillBusy()` or a stroke is active (`isStroking`), honour Layers locks (`Layers.refuse(<layer>)`/`_layerLocked`), call `Tools.cancelFloat()`, bump/invalidate the footprint map (`_mapWriteSeq` helper / `invalidateSatelliteMap()`), clear the Connect Road start (`clearRoadStart`), and re-check the map identity after any dialog/await. Add ONE shared helper `Tools.guardBulkWrite(layers, {label})` (returns false + toast when refused; calls cancelFloat/clearRoadStart) in the first task that needs it and use it in every later bulk writer; do not copy the guard list again.
3. Locks: every NEW writing tool/command must be registered in `TOOL_LAYER` (the inventory test fails otherwise) and gated by the layer it edits.
4. Shortcuts: tool keys follow the typed letter on Latin layouts (see CHANGELOG/implementer-rules); any new key must be added to ALL nine rows of `tests/shortcut-layouts.spec.ts` (hand-written expectations) and checked against the registered list: P F R E S T D Z L O G Y X A M H B W C Q U [ ] , . / ; Enter Tab Space Delete Backspace Esc + Ctrl combos. Prefer NO new shortcuts. Never register `[`/`]` (Brush owns them). Reassign the plan's `G` (go to), `M` (minimap), `C` (centre), Shift+H to free keys or drop them.
5. Test helpers: use `freshEditor` (450x450 map) for anything that needs a real-size map and `reloadEditor` instead of `page.reload()`; `openEditor` gives a 30x30 map.
6. Deploy files: any new root script must be added in the SAME commit to `.github/workflows/deploy-dev.yml` (paths, rewrite into `dev/`, copy, `?v=` grep) and to the deploy lint in `tests/perf-workers.spec.ts` (~L393-411); `deploy.sh` publishes the whole branch.
7. K1 (legacy `_DIRS_*` tables) stays unfixed: do not rely on legacy adjacency; use `HexUtils.neighbors`; if a test only passes on the N axis because of K1, say so in a comment.
8. Report: ONE short file `task-<ID>-report.md` per task (what/where, decisions, focused specs run + results, anything not done/needs product decision). Commit per task; conventional messages ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; leave test-results/ out.

## Phase 3 (generation and map design)
- Generator maths lives in `map-jobs.js` plus the page `Generator` job builder (`_buildJob` stays); anything the plan says about `Generator.getParams`/`generateInto`/main-thread generation is stale: target the worker architecture; `applyToRegion` runs through `WorkerJobs.run('generate', ...)` with every existing `apply()` guard (fill busy, satellite busy, map identity, `_applying`) plus the bulk-writer contract; bump `MapJobs.VERSION` and the `?v=` of `map-jobs.js`/`map-worker.js` ONCE per task that changes them, update the workflow greps and the agreement test.
- City centre: the default flatten/exclusion centre stays `(halfW, halfH)` when the city is at its default `(225, 224)`: use `cityR = halfH + (cityRow - defaultCityRow)` (same for col). `generator_seed42` must not change.
- UI placement for T3.5/T3.6: left palette 'Map design' section, not `#map-tools`.
- City derivation (T3.5): enumerate EVERY site that builds the city from `getCityCol()` (New Map, applyNewMap, load with no settlements, expand, side-copy restore); memoise `_cityEntry`; `moveCity` uses `History.push()`; add `DistanceBands` to `_snapshotMapState/_restoreMapState` and every restore site; `moveCity` honours busy gates and the settlements lock.
- T3.1 whole-map semantics: no boundary means weight 1; accept a mask input; add a test.
- New root `gen-utils.js` (T3.3): add to deploy-dev.yml + lint in the same commit.
- Owner questions to LOG in the report, not block: ore counts, `bunker`/`megacity` ids, object vs settlement for artifacts, whether the game accepts an off-centre city.

## Phase 4 (navigation and feedback)
- T4.0 (NEW prerequisite, do it first): provide `UI.showModal({title, el|text, actions, onClose}) -> {el, close}` on top of the dialog infrastructure (own overlay element per instance, id ending `-modal`, Escape handling that honours `defaultPrevented`, focus trap/return, textContent-safe API: HTML bodies only via DOM nodes passed in), with tests. T4.4/T4.7/T5.x use it.
- T4.10 must EXTEND History, not replace it: keep the token return, `rollback`, fill/stroke gating, structural row sharing, `_last`, `debugRowCount`; labels optional via a second argument; meta arrays maintained in push/evict/undo/redo/clear/rollback; History panel and bookmarks controls go in the LEFT palette.
- T4.11 (narrow layout): option B as rewritten in the plan (collapsible right panel, auto-collapsed below ~1931 px, overlay drawer, toolbar scrolls horizontally) — do it BEFORE T4.2/T4.3 so those controls land in a reachable place; T4.1/T4.2/T4.3 controls still go to the left palette.
- T4.3 minimap: zones/settlements are drawn into a cached layer (invalidated on change), never per `drawMinimap()` call; a pixel/counter guard proves the minimap with overlays off is unchanged.
- T4.5 validator: no `city-off-center` rule; use `HexUtils.neighbors`; define missing-sprite semantics (loaded-or-failed); single-source the IMPASSABLE list.
- T4.7: gate after the fill-idle wait and before the file write; `publishMap` gate after the name prompt.
- T4.4 shortcut registry: matches by the typed-letter rule (not raw `e.key` alone), exports `Tools.isTypingOrModal(e)`, documents tool keys too; do not double-handle keys.
- T4.9 (game-format decision): PASS-first characterization tests need a manual sanity mutation noted in the report.

## Phase 5 (packages UX)
- T5.0: delete the duplicate helpers; extend `FakeGitHub`/`tests/helpers.ts` (add only what is missing, e.g. DELETE support); all Phase 5 tests use `openEditor(page, { gh, pat: true })` + `await __startupSyncDone` (routes registered AFTER `openEditor` shadow the fake: never call a separate `mockGitHub` before it).
- Integrate, do NOT replace, Phase 0 code: edit `renderPanel` additively (keep the trash/restore UI), keep `openPublishConfirm`'s diff as step one of the publish dialog, reuse `_readRegistry`, `GitHubSync.readRepoFile`, sha-conditional writes, `HexDB.addEntries`; forbid redefining `_fetchPackageJson`. True write orders: publish = DBs, sprites, registry, package.json; import = package.json, DBs, sprites, registry: tests wait on the LAST write.
- Local description/dependencies override the server's (T5.10); `bump` applies to the server-derived base version.
- Copy `docs/guides/content-packages-editor-guide.pdf` from the MAIN checkout (`/Users/sergii.tyshchenko/Post Apo Map Editor/docs/guides/`) into this worktree in T5.1 and commit it (verify deploy publishes `docs/`); do not modify the main checkout.
- T5.12 local-only: offline `_serverIdProblem` behaves as 'cannot verify, allow with a warning'; persist details of local-only packages.
- Variant groups: assign to T5.11 (name prefix + type must not mix art styles/packages: restrict variants to the SAME package).
- All modals use `UI.showModal` (T4.0); all HTML from package data via DOM APIs (XSS: Phase 2 final review).

## Phase 6 (quality and docs)
- New modules go to the repo root (matches hex-utils/map-jobs/gen-utils); update deploy-dev.yml (current rewrite-into-`dev/` scheme) and the lint in T6.2/T6.4; bump `?v=`.
- MapFormat validation mirrors the loader's leniency (accept null/empty cells, coerce numeric width/height, tolerate missing rows, size problems are warnings not errors, avoid the stringify deep copy); merge its warnings with T0.10's load dialog (one report).
- Characterization tests: T6.1 neighbour test uses `HexUtils.neighbors` or `test.fixme` with a K1 reference; PASS-first tests carry a manual sanity-mutation note.
- CHANGELOG: merge into `## Unreleased`; README lists all root modules.
- T6.6: re-run the 2-hit check at execution time; T6.6b is OWNER-GATED (do not delete assets without the user).
