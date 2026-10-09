# T2.7 report: Scatter tool
Status: DONE

## Implemented
- hex-utils.js: `HexUtils.scatterPick(cells, ids, density, rng)` and `HexUtils.makeRng(seed)` (mulberry32).
- MapEditorPro.html Tools: tool `scatter` (key A by e.code via CODE_TOOLS, no collision), `scatterCells(cells, hexId, density, {visited})`, `scatterVariants(id)`, `setScatterRng(fn|null)` (test hook), `getLastScatterSeed()`.
- UI in the LEFT palette: button in `#shape-tools`; `#scatter-row` (shown only while scatter is active) with `#scatter-density`, `#scatter-seed`, variant checkbox chips `#scatter-variants` (follow the selected terrain via a MutationObserver on `#palette-selected-id`). Canvas 1491x808 at 1400x900 verified. The brief's toolbar input was NOT used (standing rule).
- Variants: same HexDB type and first `_` segment, multi-tile entries and `/_test|kaiju|chicken/i` excluded; unchecked chips remove ids.
- Density: probability per cell (brief); clamped 0..100; empty/0 toasts and does nothing.
- Seed: field value, else `crypto.getRandomValues` per stroke (no Math.random); the used seed is recorded and shown as placeholder; one RNG and one visited set per stroke (a cell reached by several stamps is rolled once, including cells that failed the roll).
- Writes: grouped per variant through `_applyTerrainCells(..., {noSymmetry:true})` (edge re-resolution, bridge removal, footprint skips). The History step is pushed lazily right before the first write, so a stroke that places nothing leaves no step.
- Stroke state reuses the eraser's (`_eraseStroke/_eraseToken/_eraseMd`): left button only, lost mouseup, mouseleave, blur, tool switch, stale map toast "Scatter stopped — the map changed", `isFillBusy` gate, Escape rollback by token, undo/redo ignored mid-stroke, autosave on every exit. `_eraseToken` is now nulled on every exit path (also fixes the eraser retention minor).
- Hover: `Canvas.setHighlight('scatter', ...)` (brush area plus symmetric copies, area only, cached) by generalising the eraser hover helper.
- CHANGELOG bullet added. perf-baseline.json untouched.

## Decisions
- Symmetry: the brief's plan code expands by symmetry and then passes noSymmetry. Implemented that way: the AREA is mirrored, each cell rolls independently (mirrored copies are not identical). Tooltip and CHANGELOG say so.
- The anchor cell of a multi-tile terrain is replaceable (as with Paint); only satellite cells are skipped.
- Deviation from the brief: controls in the left palette, not the toolbar; chips, seed field, lazy push, visited set added per the task instructions.

## Tests (tests/paint-tools.spec.ts, 'scatter (T2.7)', 25)
scatterPick determinism/ids/0/100; binomial statistics (4.5 sigma, 4 densities x 12 seeds); makeRng; family variants; click reproducibility by seed, undo/redo; auto seed recorded and replayable; real-tool density statistics on 469 cells; chips; density 0/empty/clamp/no-cell stroke leaves no step; overlap visited (rng call count = 2 x union via independent pixel disc reference, cells stable); no re-roll of rejected cells; symmetry mirrored area with independent picks; symmetry off; map-corner clip vs pixel reference; footprints/bridge/edge re-resolution; fabricated multi-tile family entry; key A and non-collision; palette placement and canvas width; side/right buttons and tool switch; lost mouseup/mouseleave/blur/autosave; Escape rollback; undo ignored mid-stroke; stale map; fill gate; hover layer vs pixel reference and exit paths.
RED: before implementation all 24 then-existing tests failed (HexUtils.scatterPick/Tools.scatterCells missing). GREEN: 25 passed.
Mutation checks (each restored, byte-compared): no visited set (2 fail), Math.random rng (4), eager push (1), token never kept (2), density +10 (3), test entries not excluded (6), multi-tile not excluded (initially survived; added fabricated-entry test, now 1 fails), stale check off (1), chips ignored (1), no symmetry expansion (1), density 0 not rejected (1), hover ignores scatter (1), fill gate off (1), seed ignored (2), tool-switch stroke reset off (initially survived; added isStroking assertion, now 1 fails). Density clamp removal survives: equivalent mutant (rolls with density>100 always succeed), the clamp is only for the field value.

## Full default suite (once)
432 passed, 5 skipped, 0 failed; wall 162 s (2.7 min); no `startup retries` line; uptime after: load 9.17 9.40 7.40 (during-run load ~9). No background runs left.

## Concerns
- Scatter shares the eraser's stroke variables; a later refactor to a generic "brush stroke" would be cleaner.
- EdgeTiling's own Math.random still decides river sprite variants when scatter touches river-edge neighbours (separate, unchanged).
- Selecting a variant group relies on name prefix + type; Phase 5 package ids may need a package-aware rule (review focus in the brief).

## Fix round 1
- IMPORTANT: `_applyTerrainCells` now delegates to a new `_writeTerrain(cells, hexId|null)` (per-cell `id` when hexId is null). `_scatterStamp` writes all picks of a stamp in ONE pass (one footprint-map invalidation, one `_autoResolveEdgesAround` over the union, bridges dropped once; `noSymmetry` semantics and the visited set unchanged). Directional entries (`edgeFaces`) are excluded from the variant set (tooltip, CHANGELOG say so). Tests: rebuilds per stamp <= 2 for Forest_1, Water_1, Lake_1, River_L_1 at radius 4 (wrapper on `_buildSatelliteMap`; RED was 3 for Forest_1), single-pass equals the old per-variant writes for seed 21 (independent reference: `scatterPick` + one `applyTerrainCells` per id), directional pieces never in any group.
- Minor 1: empty variant set now toasts 'Scatter: the selected tile has no scatterable variants' (documented deviation from the brief's `[hexId]` fallback, kept safe). Minor 2: the legacy single-letter switch now uses `_isTypingOrModal()`; test: a focused chip does not trap P, seed/density text fields still block, range slider focus allows F. Minor 4: redo equals the seed-4243 stamp (and undo equals the pre-stamp region). Minor 5: symmetry test rewritten with pixel-mirror partners (no expansion-order pairing), dead variables gone. Minor 6: clamp test real (-5,0 nothing/no step; 100,250 write all 19 cells, one step; the clamp mutant is equivalent only for >100). Minor 7: pre-write undo window test. Minor 8: `_scatterRun` cleared in `setActive`. Minor 9: `scatterCells` takes `opts.seed`/`opts.rng` and then does not read the seed field or touch the recorded seed/placeholder (test). Minor 10: CHANGELOG reworded. Skipped 3 and 11 as ruled.
- Mutation checks (file restored and byte-compared): per-variant writes again (rebuild test fails 1), directional kept (1), inaccurate toast (1), opts.seed ignored (1), legacy switch with old INPUT/TEXTAREA check (1), legacy switch without typing guard (2), isStroking false until the first push (pre-write undo test, 1).
- Covering specs: `-g scatter` 31 passed. Full default suite (once): 438 passed, 5 skipped, 0 failed; wall 164 s; no `startup retries` line; uptime before 14.79 7.98 6.86, after 9.37 8.52 7.29 (before-run load spike came from the mutation run just ended). No background runs left. perf-baseline.json untouched.
