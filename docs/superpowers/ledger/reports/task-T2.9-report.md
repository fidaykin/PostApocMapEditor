# T2.9 report: layered clipboard (implementation b05bbcc, review fix round c9a88de, eb4983d, e45fe60)

## API (global names)
- `HexUtils.anchorOf(cubes) -> cube` (member closest to the mean, ties to the first).
- `footprintCells(col, row, entry) -> {col,row}[]` (global, next to `_buildSatelliteMap`; NOT bounds filtered): the single footprint definition used by `_buildSatelliteMap` and `Clipboard.plan`. Output of the satellite map is unchanged.
- `Clipboard`:
  - `capture(cells) -> Buffer|null`, `Buffer = { v:1, origin, cells:[{dq,dr,t,o?,rd?,b?,x?,z?}] }` (`b` = bridge axis, `x` = tileExtras copy, `z` zone id).
  - `plan(buf, target, xf) -> items[]` (which cells will be written; fixed point, see below). `write(items, layers, beforeWrite) -> n` (History is pushed through `beforeWrite` before the first write). `place(buf, target, xf, layers, beforeWrite)` = plan + write.
  - `previewCells(buf, target, xf) -> {col,row}[]` (in-map cells only).
  - `ghostGeometry(buf, xf)`: cached per (buffer, xf signature; `null` = 'id'). `ghostLayer(buf, target, xf) -> {geom, ox, oy, valid, crosses, md, W, H}`.
  - `get()`, `set(buf)`.
- `Canvas.setGhost(layer, {render})`, `Canvas.getGhostCells()` (world centre -> cell inverse; filtered to the map when `crosses`), `Canvas.getGhostStats() -> {sets, builds, masks, cellsTested, segsTested}`.
- `Tools.copySelection / cutSelection / deleteSelection / beginPaste(buf) / dropFloat(col,row) / isPasting()`, plus `Tools.removeSatellites(col,row,bldId)` (export of the existing `_removeSatellites`, used by `Clipboard.write`). Tool `'paste'`.
- Keys (map mode, not in text fields or modals): Ctrl/Cmd+C, Ctrl/Cmd+X, Ctrl/Cmd+V, Delete/Backspace, Esc (ends paste; honours `defaultPrevented`).

## Behaviour decisions (fix round)
- Paste replaces a building: the OLD building's satellites are removed first (`_removeSatellites`), before any write, so a pasted building that lands on a former satellite cell simply overwrites it. Pasted buildings do not carry or respawn satellites (T2.14 repairs `_spawnSatellites`); CHANGELOG states the limitation. Cut/Delete behave as before (satellites of removed buildings go).
- Cut = move. `_resettable(cells)` is the single filter (in map, unique, minus cells of a footprint whose anchor is not in the list); `_resetCells`, Cut capture, `_clearCells` (incl. zone zeroing) and the no-op check all use it. Copy keeps the whole selection (`plan` drops footprint cells of surviving anchors again).
- Cut/Delete push History only when something would change (`_hasContent`: terrain != Plain_1, building, road, extras, bridge or zone); Cut still fills the clipboard. A Cut whose selection resets nothing at all toasts and returns false.
- `plan()`: no iteration cap. Each pass drops HARD failures (clipped footprint, covers an existing anchor or existing footprint that stays, cell of a surviving anchor's footprint) based only on the surviving set, so they do not depend on buffer order; only when none remain are overlaps between pasted footprints resolved (earlier buffer cell wins) with claims recomputed from the survivors; repeat until stable.
- Ghost: `valid` mask only for buffers <= 1500 cells that cross the edge (the cell-by-cell path); big buffers use `crosses` (clip rectangle) and `getGhostCells` filters by bounds. `masks` stat counts masks received. `_ghostGeomsSeen` is a WeakSet (builds counts distinct geometries, retains nothing).
- `tileExtras` belong to the terrain layer (`layers.terrain=false` keeps destination extras; `layers.objects=false` still replaces them).
- Paste mode: Ctrl+C, Ctrl+X, Delete/Backspace are ignored with the toast 'Finish the paste first (Esc)' (via `_opBlocked`); Ctrl+V with another buffer rebuilds the ghost at the last hover cell at once; Esc is ignored when `defaultPrevented`.
- Undo while pasting: paste mode, ghost and selection stay (undo restores in place, the selection is not an undo target); the next click pastes on the restored map. Documented by a test.
- Not changed (as ruled): Cmd+C still calls preventDefault in map mode (commented in `copySelection`); selection after undo; the segment-path outline of a buffer crossing the map edge is clipped to the map rectangle, so its outline along the map edge is open (not closed along the border).

## Deviations / notes
- `_removeSatellites` relies on `_satelliteTilesInRadius`, whose legacy `_satelliteHexDist` misses one true neighbour (ring cell index 0 of `HexUtils.neighbors(225,224)`) for radius 1. The new tests therefore fabricate a 5-cell ring (neighbours 1..5). Pre-existing, belongs to T2.14; no code changed there.
- The brief's literal `Clipboard.place(buf,target,xf,layers)` is kept, with an extra `beforeWrite` parameter (History step before the first write).

## Tests (tests/selection.spec.ts, clipboard describe: 57 tests, all green alone: `-g clipboard`, 20.5 s)
New or rewritten, with what makes them non-vacuous:
- satellites on paste (fabricated T_A/T_S via BldDB.getAll monkeypatch): ring gone, far T_S kept, pasted building on a ring cell survives; cut of the anchor: ring removed, paste neither duplicates nor respawns.
- clipped footprint (real `Rabbit_Flat_1`): Cut and Delete leave terrain, building, road, extras and zone of the clipped cells; clipboard holds only the plain cell; no-step case for sats-only selection.
- Cut/Delete no-op: no History step, Cut still copies (9 cells).
- plan fixed point: 31 chained existing anchors (precondition asserted via `getSatelliteAnchor`), cascade of 30 passes writes nothing.
- two pasted overlapping anchors (earlier wins, 3 satellite cells all of one anchor, one step); pasted footprint covering an existing anchor is skipped; `footprintCells` equals the satellite map for both row parities.
- 451x451 buffer onto 450x450 map; undo while pasting; Cmd (Meta) C/X/V; paste-mode key blocking with toasts (3) and Ctrl+V refresh; Esc `defaultPrevented`; extras layer; geometry cache keyed by xf signature and mask counting.
- 202,500-cell ghost test rewritten: sets delta == 3 cursor-cell changes, builds == 1, masks == 0, cellsTested == 0, segsTested == 3598 (independently derived boundary of a full 450x450 stagger grid: 6n - 2*(450*449 + 449*899)), same cell again changes nothing; stray `cv.constructor` removed.
- Vacuous code fixed: undoSize compared with itself (now compared with the value before), fill test now asserts no step, ghost unchanged and no paste during a fill and that objects/roads survive, `void before` deleted. Independent pixel test: centres from `Canvas.hexScreenPos`, every ghost cell centre tinted (>10 levels), neighbours untouched (<= 3 levels antialias).
RED to GREEN: the new tests were written after the fixes (the fixes were committed first as c9a88de to keep the tree safe); their bite is shown by the mutation table (each mutation restored from a saved copy and `cmp`-verified).

## Mutation table (new tests; failing tests of 57 in the clipboard describe)
| # | Mutation | Failing |
|---|---|---|
| 1 | no satellite cleanup on paste (finding 1) | 1 (spawner paste) |
| 2 | Cut uses the unfiltered selection (finding 2) | 1 (clipped footprint) |
| 3 | ghost mask built for every edge-crossing buffer (finding 3, minor 6) | 1 (202,500 ghost) |
| 4 | plan loop capped at 20 passes (minor 1) | 1 (cascade) |
| 5 | geometry cache ignores xf (minor 5) | 1 |
| 6 | Ctrl+C/X allowed while pasting (minor 7) | 1 |
| 7 | Esc ignores defaultPrevented (minor 8) | 1 |
| 8 | no-op Cut pushes History (minor 10) | 1 |
| 9 | tileExtras under the objects layer (minor 9) | 1 |
| 10 | Ctrl+V does not refresh ghost (minor 7) | 1 |
| 11 | no-op Delete pushes History (minor 10) | 1 (same test as 8) |
| 12 | clipped-footprint hard check dropped | 1 (existing footprint test) |

## Suite evidence
Full default suite, run once to completion on HEAD e45fe60 (no overlapping runs): 546 passed, 5 skipped, 0 failed, wall 3.3 min, `startup retries: 0`. uptime afterwards: load averages 6.17 7.12 6.48. tests/perf-baseline.json untouched; test-results/ not committed.
