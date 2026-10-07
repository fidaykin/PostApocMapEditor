# T2.18 report: layer locks gate every tool

Commits: d256e56 (Part 1: T2.17 review fix + minors), 8e1642d (locks feat + tests), a04b83a (stronger lift/generator tests, CHANGELOG). Base 052ea04.

## Part 1 (d256e56)
- IMPORTANT fixed: `Tools.setActive('settlement'|'erase')` and `autoPlaceSettlements` now unhide a hidden Settlements layer (`Layers.setVisible('settlements', true)` + toast "Settlements layer shown"). RED: 2 failed on the base (layer stayed hidden), then green; tests also draw-compare the marker (pixels differ from the hidden render) and have a no-toast control.
- Minors: `_drawFlatMap`/`_drawOverview` comments fixed; random-fill `Layers.sync()` test added (mutation: sync line removed -> fails); hover test replaced its vacuous check by positive control (statusbar text contains the coordinates; identical text with the layer visible); CHANGELOG: hidden terrain loses the grid stroke.

## API
- `TOOL_LAYER` (tool -> layer) and `NON_WRITING_TOOLS` (eye, select, marquee, paste) in `Tools`; `Tools.toolLayers()` returns `{map, nonWriting, registered, codeTools}` for the inventory test. `_toolLayer(tool)` (Paint with a bridge axis selected = objects). `_layerLocked(layer, fresh)` toasts once per press/command. `_locks()`, `_allowed(lk)`.
- `Layers.refuse(name)` (true + toast when locked) and `Layers.label(name)`; used by every non-Tools writer. Lock buttons keep their markup; tooltip now: "Lock Roads (tools, paste, cut/delete and fills will not change it; undo still works)" / "Unlock Roads (allow editing it again)".
- `_onDown` refuses BEFORE `_isDown`/`_beginLazyStroke`/History (no stroke state, no step). `_onMove` re-checks for stroke tools (paint, eraser, scatter, object, erase-object, zone, road, erase-road); `_commitCells` (line/circle/polygon) and the Rectangle release re-check at commit.
- `Clipboard.write` applies the LIVE locks itself (no caller can bypass), returns 0 before `beforeWrite` when nothing is writable (no empty History step); `writeCarry(items, layers)`; `place` passes layers on.

## Gated-path inventory
| Path | Layer | Behaviour when locked |
|---|---|---|
| Paint (terrain), Fill, Rectangle, Line, Circle, Polygon, Scatter, Eraser, Replace tool (all with symmetry) | terrain | press refused (shapes: also at commit) |
| Paint in bridge mode | objects | refused (bridge overlay) |
| Place Building, Erase Building, Place Bridge | objects | refused; satellites follow the objects lock only |
| Draw / Connect / Erase Road | roads | refused |
| Place / Erase Settlement | settlements | refused |
| Zone Painter brush | zones | refused |
| Replace dialog/API (`applyReplace`, `_runReplace`, `replaceTerrain`) | terrain | refused, dialog stays open; bridges kept if objects locked |
| Eraser, Cut, Delete, Move (lift) | terrain primary; objects/bridges/satellites, roads, zones secondary | terrain locked: refused. Secondary locked: skipped, rest edited in ONE step, toast names kept layers |
| Paste / stamp place / move drop (`dropFloat`, `Clipboard.write`) | all four | only unlocked layers written, one step; nothing writable -> toast "Nothing pasted", no step, float stays |
| Move lift/drop | see below | |
| Terrain writers' side effect on legacy bridge overlays (`_writeTerrain`, fill, replace, paste) | objects | bridges kept when objects locked |
| Fill Map, Clear Map | terrain, bridges (objects), settlements | Fill Map refused (also re-checked at confirm); Clear Map skips locked layers, refused with no dialog when terrain AND settlements are locked; bridges go only with terrain when objects is free |
| Generate map apply | terrain (settlements marker re-add skipped if settlements locked) | refused up front and re-checked after the async generation ("result discarded") |
| Satellite apply | terrain (+ settlements rewrite skipped if locked) | refused |
| QA placer | terrain | refused |
| Auto-place settlements | settlements | refused before History.push |
| Settlement slots: add, remove, every field | settlements | refused; capture-phase guard reverts the field |
| Tile inspector / bridge-terrain modal under-terrain (tileExtras) | terrain | refused |
| Zone Painter: Fill all zones / Fill this zone | terrain + settlements | each skipped if locked; both locked: refused, no step |
| Zone Painter: Random fill | zones (+terrain, settlements) | zones locked: refused entirely; others skipped |
| Zone Painter: Clear assignments, Delete zone | zones | refused before the confirm |
| Copy, Stamps save, Eyedropper, Select, Marquee | none | allowed (reading) |
| Undo / redo | none | NOT blocked (restore history); stated in CHANGELOG |

## Decisions
- Eraser/Cut/Delete/Move treat terrain as primary: a terrain lock refuses them wholly (use Erase Building/Road for secondary layers); a locked objects layer keeps buildings, their satellites and bridge overlays, a locked roads layer keeps roads, a locked zones layer keeps zones. tileExtras (under-terrain) follow TERRAIN (as in the T2.9 clipboard), not objects as T2.19's draft says: T2.19 must reconcile (its Clear Map clears extras with objects; here the unit that always clears them is terrain).
- Cut = copy (everything, reading is allowed) + delete that skips locked layers; toast "locked layers were copied but not removed: ...".
- Move: layers locked at lift are stripped from the lifted buffer (stay at the source, never carried); at drop the locks are re-read (locking is not a map change so the signature does not see it): terrain locked -> drop refused, float stays, no step; a secondary layer locked at lift OR at drop stays at the source and is not written at the destination; never removed without being carried, never duplicated.
- Mid-stroke lock: the running stroke refuses its NEXT write (one toast per stroke); what it already wrote stays in its single step (undo reverts it); a lazy stroke that wrote nothing leaves no step; shape drags refuse at commit with no step and the preview cleared. A running Fill finishes (it is one job started before the lock).
- Terrain lock covers multi-tile terrain: no anchor and no footprint are written (tested with Rabbit_Flat_1); building satellites are objects, governed by the objects lock only (tested both ways).
- Indicator: the toast only (no cursor change, no layout change, no new shortcut); canvas 1491x808 at 1400x900 tested.
- Programmatic APIs (`Tools.eraseCells`, `scatterCells`, `_applyTerrainCells` direct calls) are not gated at the entry (they have no History/toast); `eraseCells` skips locked secondary layers, `replaceTerrain` and `Clipboard.write` are gated at the primitive.

## Tests (tests/layers.spec.ts, new 78 tests)
- Inventory: every registered tool (TOOL_NAMES, `.tool-btn[data-tool]`, CODE_TOOLS) is in exactly one of TOOL_LAYER/NON_WRITING_TOOLS; every layer valid; every writer has a matrix scenario; non-writers never refuse even with all layers locked.
- 19-scenario matrix: for each writing tool: locked layer -> whole-map snapshot string-equal, 0 History steps, no stroke/shape/connect-start state, lock toast; unlocked control changes the map by exactly 1 step; wrong-layer control (every OTHER layer locked) still works.
- Eraser/paste (5 lock sets)/stamp/cut/delete (4 sets each)/move (lift/drop timing, 6 cases)/replace/bridges/satellites/footprints/Clipboard.place; bulk ops (Fill Map, Clear Map x5, Generator x3 incl. lock-during-generation, Satellite, QA, Auto-place, slots, inspector); Zone Painter (fill all/this, random fill, clear, delete); persistence + reload, locking changes nothing, undo/redo, tooltip + layout, mid-stroke (Paint, Eraser, Place Building no-empty-step, zone brush, rect, line).
- RED: run against the unmodified HEAD d256e56 (html and zone-painter.js restored from `git show`, then my copies restored with `cmp`): `72 failed, 5 passed` of 77; the 5 passes are pure unlocked controls plus the T2.17 stored-state test.

## Mutation table (each restored from a saved copy; run on the matching -g subset; "failed" = failing tests)
| # | Mutation | Failed |
|---|---|---|
| 1 | `_onDown` gate removed | 15 |
| 2 | Paint bridge-mode layer override removed | 1 |
| 3 | road-connect missing from TOOL_LAYER | 2 |
| 4 | `_onMove` mid-stroke check removed | 3 |
| 5 | `_commitCells` gate removed | 1 |
| 6 | Rectangle release gate removed | 1 |
| 7 | `_resetCells` ignores locked objects | 3 |
| 8 | `_resetCells` drops bridges although locked | 1 |
| 9 | satellites removed although building kept | 1 |
| 10 | `_resetCells` ignores locked roads | 5 |
| 11 | cut terrain gate removed | 1 |
| 12 | delete terrain gate removed | 1 |
| 13 | `_clearCells` zeroes locked zones | 3 |
| 14 | `_hasContent` ignores locks | 1 |
| 15 | `beginMove` keeps locked layers in the buffer | SURVIVED (redundant with the drop-time union), test strengthened (float buffer holds no `o`), then 1 |
| 16 | `_dropMove` forgets lift-time locks | 1 |
| 17 | `_dropMove` terrain gate removed | 1 |
| 18 | `Clipboard.write` no-work check removed | 1 |
| 19 | `Clipboard.write` ignores live locks | 1 |
| 20 | `_writeTerrain` drops locked bridges | 1 |
| 21 | fill drops locked bridges | 1 |
| 22 | `_runReplace` gate removed | 1 |
| 23 | `replaceTerrain` low-level gate removed | 1 |
| 24 | Clear Map clears terrain though locked | 1 |
| 25 | Generator up-front gate removed | SURVIVED (post-await check also refused), test strengthened (no progress, no "discarded" toast), then 1 |
| 26 | Generator post-await re-check removed | 1 |
| 27 | Auto-place refuse removed | 1 |
| 28 | slot field guard removed | 1 |
| 29 | Fill Map confirm-time re-check removed | 1 |
| 30 | toast de-duplication removed | 1 |
| 31 | zone random fill zones gate removed | 1 |
| 32 | zone fill ignores terrain lock | 1 |
| 33 | Satellite refuse removed | 1 |
| 34 | QA refuse removed | 1 |
Not run: 35 (tile-inspector refuse) and 36 (zone delete refuse): the mutation driver script hung (python spinning at 100% CPU, killed); these two paths ARE covered by tests but their mutations were not executed. 34 mutations executed, 32 caught first time, 2 survived and were fixed. Mutation-run subsets used `--max-failures=3` in one batch, so some counts are capped.

## Suite evidence
Full default suite once to completion on a04b83a (second, definitive run with the default reporters): 941 passed, 5 skipped, 0 failed, 5.6 min, `startup retries: 0`, load averages after: 5.85 7.50 6.41. (A first full run with `--reporter=line` also gave 941 passed / 5 skipped / 0 failed, 5.8 min, but that reporter hides the retries line.) `tests/perf-baseline.json` untouched; test-results not committed.

## Not gated / honesty
- Programmatic entry points listed above; Fill started before a lock completes; the ghost/preview is not dimmed for a locked layer; no cursor indicator.
- zone-painter.js edited (`?v=9` to `?v=10`): on the dev deploy the gh-pages root copy of zone-painter.js is stale (same note as T2.17), so there the Zone Painter actions (fill, random fill, clear, delete) are NOT lock-gated until prod republishes; the brush and everything in MapEditorPro.html are.
- Settlement city marker move/Generator city re-add skipped only under settlements lock; New/Load/Expand/autosave restore/undo are intentionally not gated.
- T2.19 note: Clear Map above only adds lock skipping to the existing semantics (terrain, bridges, settlements); T2.19 should keep `Layers.isLocked` and decide the extras ownership (see Decisions).
