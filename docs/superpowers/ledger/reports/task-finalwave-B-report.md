# Final fix wave B report

Commits (HEAD e00c935 before): f633257 B1, de3bf0f B2, 615f96e B3, b96ad8c B4 history, af9af06 B4 PNG (+B7 PNG tests), 2591489 B4 layout, 8df2aec B5, f0cee0f B6 docs/shortcut, 95b524f B6 zone rename / polygon / test lint, 9f0136f B7.
New specs: `tests/final-wave-b-modals.spec.ts` (7), `tests/final-wave-b-editor.spec.ts` (B3 4, B4 layout 4, B5 8 + 1 unit via generation.spec, B6 3), `tests/phase4-auto-layout.spec.ts` (5). Helper `freshEditorAuto` in `tests/editor-helpers.ts`.
Final focused run (33 spec files touched or related): 1150 passed, 0 failed, 6.8 min, startup retries 0, machine sleeps 0. `tests/perf-baseline.json` untouched. No new top-toolbar controls (canvas 1491x808 classic at 1400x900 verified by the existing specs).

## B1 modals and gating (f633257)
- `MapEditorPro.html`: one scheme: `UI.raiseOverlay` gives every overlay (showModal, `#dialog-modal`, `#confirm-modal`, `#newmap-modal`) a z-index above all earlier ones when it opens; `_topOverlay()` = highest visible `.modal-overlay`. The shared dialog's capture Escape handler and showModal's Escape handler act only when their overlay is the topmost. New global `anyModalOpen()`; `History.initKeyboard` and `IO.initKeyboard` return while any modal is open (Ctrl+Z/Y/Shift+Z/S/N/O/Shift+S inert). `IO.gateExport` also compares `_mapWriteSeq` and the History sizes captured before the summary opened.
- RED: 6 of the 7 new tests failed first (stacking inverted, hidden dialog cancelled, Ctrl+S exported under a modal, in-place undo did not cancel). The first Ctrl+Z test passed vacuously (undo then redo cancelled out): rewritten, then it passes only with the gate.
- Tests: Escape order both ways, confirm overlay on top, Ctrl+N not opening under a modal (+ positive control), Ctrl+Z/Y inert, Ctrl+S/Ctrl+Shift+S inert, in-place undo cancels 'Export anyway'. Existing `validator-gate` (14), `modal`, `dialogs`, `shortcuts` green.

## B2 layouts (de3bf0f)
- Behaviour chosen (least invasive): a typed `[`/`]` sets the brush on ANY physical key (Dvorak Minus/Equal, QWERTZ AltGr+8/9 = Ctrl+Alt with AltGraph, macOS Option+5/6); the physical BracketLeft/Right keys still set the brush unless they type `+ = -`, which now zoom (QWERTZ `+`, Dvorak `=`). Consequence: on QWERTZ `+` no longer grows the brush (AltGr+9 / Option+6 does); on Dvorak `=` no longer grows it (typed `]` on the Equal-position key does).
- Help panel note, EN + UK guide bullets, CHANGELOG. `shortcut-layouts.spec.ts`: new block with digit row, Minus, Equal and both bracket keys on all nine layouts (hand-written expectations, 14 keys each + AZERTY shifted digits + QWERTZ AltGr/Option/Ctrl cases). RED on qwertz and dvorak first. `paint-tools` test 'a key that types [ on another code does nothing' deliberately changed (typed bracket now works anywhere).

## B3 validator (615f96e)
- `IMPASSABLE` = types water / rivers / volcanic/rift + id prefix `mountain_` (Mountain_1, Mountain_Kaiju_1/2); Hills_1 stays passable. Decision: type `Hills/Mountains` cannot be used alone (it contains Hills_1), so mountains are told apart by prefix; the old id list stays only as a fallback for ids missing from the HexDB (lava_plain_1, lava_rift_1, rift_1). `HexDB._autoSave` and `BldDB._autoSave` call `_validatorStale()` ('Results outdated').
- Tests: Kaiju ring blocks, custom Volcanic/Rift and Rivers types block, outdated after HexDB/BldDB edit (RED first), `validator-core` IMPASSABLE test updated. CHANGELOG notes the K1 orphan-road disagreement.

## B4 (b96ad8c, af9af06, 2591489)
- History: `_evictedCount` (push/rollback/clear); after an eviction the panel gets a bottom row 'Earlier state (before X)' whose jump is `-done.length` and reaches `_undo[0]` (test after 61 pushes, RED: bottom row reached T11 only... it did not exist). Existing display-cap test now expects 51 rows (50 + that row). Without eviction `_undo[0]` is the freshly opened map (the 'Open map' row), so no extra row.
- PNG: `doneLabel` + `finally { UI.progressDone }` (every early return), 0.999 factor also when 'Largest allowed' reaches the cap (450x450 gave 5582 x 6450 = 36,003,900 > 36 MP: RED), `getContext` null and `toBlob` null give 'could not create a W x H px image ... Choose a smaller size' (stubbed test).
- Resize across 1920: `RightPanel._apply(fromResize)` no longer calls `Canvas.resize()` for window resize events (Canvas has its own listener); counted via the canvas width setter: 2 before, 1 after; toggle still 1.
- Toolbar scroll: MORE dropdown closes, hovered tooltip re-placed (mutation of the re-place line caught: 'off by 8,6').
- Minimap buttons (Bigger / Zones / Towns): disabled with title 'Expand the right panel to see the minimap' while the effective layout is the rail; original titles restored. This test was written after the code (not shown RED separately).

## B5 (8df2aec)
- `generation.spec` / `city.spec` assert `WorkerJobs.usingWorker()` (true) instead of the nonexistent `lastUsedWorker`.
- Region generation skips the city cell(s): tests with water-everywhere and mountain-everywhere params (RED: city cell became Water_1 / Lava_Plain_1). `generation.spec` 'whole-map selection' now expects n = total-1 and 1 cell left. The 'ore' variant was dropped: with seed 42 the scatter did not land on the city cell, so it could not show RED.
- `guardBulkWrite(layers, {satellite:true})` refuses while Satellite classification runs; `Placement.place` uses it (test stubs `Satellite.isBusy`, no write, no step, then works).
- `GenUtils.spreadPick(..., taken)`: the artifacts pass `takenCubes` (mega cities); with taken points the first pick is the farthest candidate; without taken the behaviour is unchanged (random first pick). Pure unit test with brute-force replay; integration test compares with an independent best-possible distance (RED: 210 vs 240). gen-utils.js ?v=5 and deploy-dev.yml grep updated.
- Bunker spacing now also counts every existing settlement (RED: a bunker 12 tiles from an existing settlement with spacing 57).
- Edge resolver (`_autoResolveEdgesAround`) takes flat-water fallbacks from `HexDB.getRoles()` (WATER_DARK/LIGHT/ROCK); `_riverFallbackId` removed. Tests: isolated directional tiles with `Water_Dirty_1` removed from the HexDB (RED: it came back) and a region generation run writing only known ids (RED: Water_Dirty_1).

## B6 (f0cee0f, 95b524f)
- Ctrl+Shift+S: on the HEX DB tab both HexDB.save and the map save ran (IO handler matched 's' with Shift); IO now skips Shift+S in hexdb mode (test RED: second download map_export.json). Registry gets a documentation entry `hexdb-save` (probe added in shortcuts.spec). Guides EN+UK: Ctrl+Shift+S row, 'tool/brush/zoom/overlay keys work on the MAP tab; Ctrl+Z/Y/N/O/S on every tab; all ignored while typing in a text field and while any dialog is open' (true after B1), 'generated from' reworded to 'follows'. Also fixed: guides said the minimum map size is 10 x 10 (the New Map dialog minimum is 20). HTML regenerated with scripts/build-guides.js; sync test green.
- Ukrainian guide proofread end to end: 'Карта — це сітка', 'у відсотках', 'підтайл' -> 'рельєф під мостом', 'відмовляє' -> 'відмовляється працювати / неможливий', 'поважає' -> 'враховує', 'Delete можна скасувати' (was 'зворотне'), 'ввід' -> 'введено', dashes before 'це'. No 'Гайд' wording existed in the guides (title already 'посібник').
- Zone rename: the row click no longer rebuilds the list while the name is being edited, and it now only moves the highlight (no rebuild) so a real double-click works. A real `dblclick` never entered edit mode before (the first click rebuilt the row; RED showed contenteditable not set); the old tests used synthetic dblclick events. zone-painter.js ?v=21.
- Polygon preview computes `_polyCells(verts, true)` once (counted: 2 before, 1 after per update).
- `dead-code.spec`: whole-identifier matcher with positive/negative controls (`_numInputs`, `getGroupsFor`, `fp-empty-row` no longer match); `docs-lint.spec`: `brokenLinks()` is the real loop, the control runs it on a temp Markdown tree (missing file, bad anchor, leaves repo, good links).

## B7 (af9af06, 9f0136f)
- `phase4-auto-layout.spec` (5): default auto layout at 1400x900 (rail, canvas 1152) for go to, bookmarks, validator Run + jump, History panel. The palette scrolls, so controls are checked with `toBeVisible` and real clicks, not 'inside the viewport'.
- `validator-gate.spec`: all `waitForTimeout` removed; the export/publish promise is kept page-side (`__exp`, `__pub`) and awaited after Cancel/Escape, a `createObjectURL` spy proves no file is built while the summary is open, and Escape is pressed only after the modal is visible.
- `export-png.spec`: 'no map' test asserts no download, progress bar not active, control enabled, on both paths (no map at the call, map vanishing during the paint yield: RED); new 'Largest allowed' test (<= 36 MP, <= 8192 px side, > 30 MP).

## Skipped / not done
- None skipped. Notes: the B4 minimap-button test and the 'ore' variant (see B5) lack separate RED runs; Windows AltGr behaviour in B2 relies on `getModifierState('AltGraph')` (tested with a synthetic event, not a real QWERTZ keyboard).
