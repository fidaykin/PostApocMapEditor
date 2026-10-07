# T2.10 report: rotate, mirror and move for pasted / lifted regions

## API
- `HexUtils.transformOffset(c, rot, mh, mv)`: mirror left-right, then top-bottom, then rotate rot x 60 degrees screen-clockwise, about the origin cell.
- `Clipboard`: `_offset(e, xf)` uses it (xf = `{rot,mh,mv}`, null = identity); `plan/previewCells/write/place/ghostGeometry/ghostLayer` take xf. `write(items, layers, beforeWrite, xf)`. Geometry cache signature is canonical (any identity xf shares 'id').
- `Tools`: `rotateFloat(steps)`, `mirrorFloat('h'|'v')`, `setFloatTransform({rot,mh,mv})`, `getFloatTransform()`, `beginMove()`, `isMoving()`. Keys (only while a float exists, map mode, not typing/modal, no Shift/Alt/repeat): `.` rotate cw, `,` ccw, `/` mirror left-right, `;` mirror top-bottom; `Enter` begins a move (ignored with a focused button/link, a text field, no selection, while pasting). UI: `#paste-tools` row (4 buttons) in the LEFT palette, shown only in paste mode; "Move" button in the selection row. Canvas stays 1491x808 at 1400x900 (tested).

## Decisions
- Composition: state is (mirror h, mirror v, then rotate rot). Keys act on what the user sees: a screen mirror after a rotation by k equals mirror-first and rotation -k, so mirror keys negate rot (rotate then mirror == mirror then rotate by the opposite angle; tested).
- Multi-tile anchors: they keep their id and their own unrotated footprint (not rotatable). `plan()` already verifies the DESTINATION anchor's real footprint through the shared `footprintCells()`; clipped or overlapping anchors are skipped. Tested for 6 rotations + mirror (real footprint registered, no orphans), corner clipping, overlap with an existing anchor. A toast "Multi-tile terrain keeps its orientation" appears when a transformed paste/move placed an anchor.
- Bridges: axis 0 N-S, 1 NE-SW, 2 NW-SE. New axis = (odd number of mirrors ? -a : a) + rot (mod 3); Road_Bridge_NS/NEWS/SENW ids (terrain and object layers) follow the same map; axes outside 0..2 are carried unchanged. Verified against axis angles computed from pixel geometry for 24 transforms x 3 axes. Roads autotile at draw time (nothing to do).
- Directional water: after a transformed paste EVERY pasted cell is handed to the edge re-resolution (it skips non Water/Rivers cells); identity pastes keep the border-only behaviour. Tested: masks equal EdgeTiling.resolveEdgeTile on the final map for rot 1 and 2 of a one-cell-wide river lying INTERIOR to the copied rectangle (>= 8 directional cells). Caveat (K1, pre-existing): after an identity paste at another row parity copied interiors can differ from a fresh resolve; not changed.
- Move: lifting writes NOTHING (captures `_resettable(selection)` = cut semantics, skipped footprint cells stay; selection with only footprint cells cannot be lifted, toast). The drop does ONE `History.push` (token), clears the source, plans on the map WITHOUT the source (overlapping targets work), writes. If the plan is empty the token is rolled back (map, History unchanged, still moving, toast). Dropping on the source with identity does nothing (no step). Selection becomes the written cells; tool returns to the previous tool. Esc/tool switch/stale map just discard the float (nothing to restore). Undo/redo are ignored while a region is lifted (`isStroking`). Cells the plan drops (e.g. clipped anchors) are lost from the move and toasted (undo restores).
- Brief deviation: the brief's `Enter` cut at lift time; the task text prefers "nothing written until drop", which is what is implemented. The brief's test expecting Water_1 at the click cell assumed the wrong anchor (anchor = member closest to the mean, tie to the first in row-major order); the test compares with the real anchor cell.
- Ghost: key press rebuilds the ghost at the last hover cell, one ghost set per key; geometry is built once per distinct transform (second lap of 6 presses builds nothing); not transformed from the identity geometry (each distinct transform is one O(n) build, cached per buffer).
- Not done: arrow-key nudge and Ctrl+drag moving (brief specifies Enter + click); no separate test for hex-utils.spec (transformOffset tested in selection.spec).

## Tests (tests/selection.spec.ts, describe "transform and move (T2.10)", 24 tests, ~12 s)
Brief tests (adapted), transformOffset invariants, 6x rotate / 2x mirror / +1-1 pastes equal untransformed, pixel reference on 31x31, 30x30, 31x30, 30x31 (24 transforms x 9 targets of both parities incl. corner clipping; terrain/object/road/extras/zone), bridges, water masks, footprints, toast, ghost live (sets/builds/cells vs pixel reference), shortcut guards, palette buttons + canvas size, undo/redo one step, overlapping move, move with transform, no-op move, un-liftable selection and rollback, input handling (side buttons, undo ignored, fill busy, tool switch, map replacement).
RED honesty: the tests were committed (RED commit) before the implementation but I did not capture a failing run before implementing; their bite is shown by the mutation table.

## Mutation table (failing tests of 24)
| # | Mutation | Failing |
|---|---|---|
| 1 | `_offset` ignores xf | 8 |
| 2 | rotate before mirror | 7 |
| 3 | bridge axis without mirror negation | 1 |
| 4 | bridge axis without rotation | 1 |
| 5 | Road_Bridge ids not mapped | 1 |
| 6 | border-only re-resolve after transform | 0 at first (test was too weak: river not interior), test fixed, now 1 |
| 7 | move drop keeps the source | 3 |
| 8 | mirror key does not negate rot | 2 |
| 9 | no ghost refresh on transform | 1 |
| 10 | undo allowed while moving | 1 |
| 11 | Enter ignores focused-button guard | 1 |
| 12 | no rollback on empty plan | 1 |
| 13 | keys swallowed without a float | 0 at first (equivalent via guard in rotateFloat), preventDefault assertion added, now 1 |
| 14 | no orientation toast | 1 |
All restored from saved copies and cmp-verified.

## Suite
Full default suite, once, to completion at the final code state: 570 passed, 5 skipped, 0 failed, 3.5 min (wall 3:30), no `startup retries` line in the output; uptime load 9.02 8.41 7.17. tests/perf-baseline.json untouched; test-results/ not committed.

---
# Fix round 1 (commit 8f8857d)

## Changes per finding
- I1 bridges: removed the Road_Bridge building id re-mapping (terrain and object ids keep their id under rotate/mirror; buildings keep their orientation). `bridgesData` axis mapping kept (0 N-S, 1 NE-SW, 2 NW-SE; mirror negates, rotation adds k mod 3). New test derives the expected axis from the pixel directions of the cell and its N / NE / NW neighbour found by scanning `Canvas.hexCenterWorld` (not from the code's table), 24 transforms x 3 axes: the axis mapping was already right (RED run failed only on the id assertions). CHANGELOG corrected.
- I2 Enter in self-blurring fields: `_isTypingOrModal(e)` also checks `e.target`; transform keys and the lift use it; the lift also refuses when the active element or target is any BUTTON/A/INPUT/SELECT/TEXTAREA (input[type=button] activates instead). Tests: #scatter-density, #scatter-seed (real Enter), zone-config-name keydown, input[type=button] click count, text-field target on a transform key.
- I3 in-place writers: lift stores a compact signature (count + two 32-bit hashes over terrain id, building id, road, bridge, extras, zone of the lifted cells); `_dropMove` compares first and cancels with 'The map changed while the region was lifted — move cancelled' (nothing written, no step). `Tools.cancelFloat()` (cancels a MOVE float only; a plain paste buffer stays valid) is called by Clear Map, Fill Map, Satellite apply and the QA placer after their guards, before History.push. Tests: each of the 4 writers (lift cancelled at once, only the writer's own step, a later drop writes nothing) and 7 in-place edits behind the float (terrain, object appears, object id changes, road, bridge, extras, zone) plus 'an edit outside the lifted cells does not cancel'.
- I4 clipped moves: `lost = buf.cells.length - (carried-away satellites under a transform) - items.length`; toast 'N cells fell off the map or were skipped (undo restores them)'; the orientation toast is no longer suppressed (both can show). Rule: a move may clip cells only with the toast; undo restores. Tests: corner drop (count equals sources minus written), no toast when nothing is lost, rotated clipped move with an anchor shows both toasts.
- Minor 1: `capture` marks satellite cells whose anchor is in the buffer (`sat`); `plan` skips them when the transform is not identity (no stray tiles; identity keeps them, so their zones/roads/extras still travel). Documented in CHANGELOG: under a rotation/mirror the roads/zones/extras of source footprint cells are not carried. Test: Rabbit_Flat_1 on Forest copied to Desert, 5 transforms, only the anchor differs from Desert and the real footprint is registered.
- Minor 2: `_xfSig` canonical (mirror parity, rot + 3 if mv): equivalent transforms share one geometry; LRU cap 6 per buffer; `Clipboard._geomCacheSize(buf)` test hook. Test covers sharing and cap/eviction/rebuild equality.
- Minor 3: dead variables removed from the water test; asserts n === 147 for each paste and identity `dir >= 8`.
- Minor 4: CHANGELOG (top of terrain palette under the tool row; bridge claim; clipped-cell loss and toast; lift cancelled by writers; footprints).
- Minor 5: test at 1100x700: Move button and the four transform buttons visible and fully inside the viewport, one click works (passed at once; palette layout needed no change).

## RED to GREEN
New tests were run RED first (20 failing of 24 new/changed; the 4 that passed were palette visibility, 'keeps every cell' toast, 'outside edit', and the Enter-on-disabled-case guard was RED). Focused: `npx playwright test tests/selection.spec.ts -g "T2.10|T2.9"` 103 passed after the fix.

## Mutation table (new tests; each restored from a saved copy, cmp verified)
| # | Mutation | Failing |
|---|---|---|
| 1 | Clear Map does not cancel the lift | 1 |
| 2 | Fill Map does not cancel | 1 |
| 3 | QA placer does not cancel | 1 |
| 4 | Satellite apply does not cancel | 1 |
| 5 | drop does not revalidate | 7 |
| 6 | signature ignores zones | 1 |
| 7 | lost = inMap - items (old rule) | 2 |
| 8 | source satellite cells carried under a transform | 1 |
| 9 | non-canonical _xfSig | 1 |
| 10 | no LRU cap | 1 |
| 11 | Enter guard ignores e.target | 3 |
| 12 | transform keys ignore e.target | 1 |
| 13 | bridge axis ignores mirror | 1 |
| 14 | Road_Bridge building ids re-mapped | 1 |
| 15 | orientation toast suppressed when cells lost | 1 |

## Suite
Full default suite once to completion on 8f8857d: 592 passed, 5 skipped, 0 failed, 3.6 min (wall 3:37), no startup retries line; uptime load 9.19 6.98 5.92. perf-baseline.json untouched; test-results not committed.

## Not done
Plain paste floats are not cancelled by the writers (their buffer is a snapshot). Fully off-map move drops still do nothing silently (as before).

---
# Fix round 2 (commit 8fc1686)

## Changes
- Footprint cells under a transform: `Clipboard.plan()` (wrapper over the old planner `_plan`) now also returns `items.carry` (the zone and road of every source footprint `sat` cell, with the in-map transformed target cell) and `items.dropped`. `Clipboard.writeCarry(items)` writes the carry list inside the SAME History step (moves: right after `write`; pastes: right after the main write, whose beforeWrite already pushed the step) through `write(carry, {terrain:false, objects:false})`. `write` no longer runs edge re-resolution when `layers.terrain === false` (edges depend on terrain only).
- Carry rules: ZONE and ROAD of satellite cells travel to the transformed position of each cell (the destination anchor's real footprint cells are ordinary cells, zone/road may land there; no other exclusion except out of the map). Objects, bridges and extras (under-terrain; written only with the terrain layer, so they would drag a terrain write along) on satellite cells are NOT carried: counted in `items.dropped` (also a zone/road that falls off the map when the cell carries none of those). Toast for moves AND transformed pastes: 'N objects/bridges/extras on multi-tile footprints were not carried' (moves add '(undo restores them)'). The lost-cells count still subtracts the satellite cells (they are carried or counted separately).
- `_xfIdentity` is now canonical (`_xfSig === 'id'`, exposed as `Clipboard.isIdentity`); `Tools._xfOf` uses it, so `{rot:3,mh:true,mv:true}` behaves exactly like no transform: satellites kept as in the identity case, in-place drop shortcut works, no orientation toast.
- Lift signature (`_moveSig`) now hashes the road content, the extras content and the bridge axis, not only presence.
- Enter with a range slider / checkbox / `#symmetry-select` focused still refuses to lift (documented, unchanged). CHANGELOG footprint clause replaced by the accurate rule.

## Tests (tests/selection.spec.ts, 'fix round 2 (T2.10)', 11 tests, ~6 s)
Rotated / mirrored move x4 transforms (rot 1; rot 2+mh; rot 4+mv; rot 5+mh+mv: zones 3,5 and roads on footprint cells, a road-only footprint cell, anchor zone, a plain neighbour, destinations from an independent pixel-geometry mapping via `Canvas.hexCenterWorld`, source vacated, far data untouched, ONE step, undo restores the whole snapshot); object + bridge + extras on footprint cells dropped and toasted ('3 objects/bridges/extras...', no lost-cells toast) with zone/road still carried; transformed paste carries zone/road (source intact, one step, toast); identity-equivalent keys (`/ ; . . .`) drop in place with no change, no step, no toast; identity-equivalent move to another cell is a pure translation without orientation toast; 3 signature tests (road type, extras content, bridge axis changed behind the float cancel the move).
Focused run: 11 passed. RED evidence: I did not run the new tests against 8f8857d; their bite is the mutation table below (each restored from a saved copy, cmp verified).

## Mutation table (failing of the 11 new tests)
| # | Mutation | Failing |
|---|---|---|
| 1 | writeCarry writes nothing | 6 |
| 2 | `_xfIdentity` back to the raw rot/mh/mv test | 2 |
| 3 | signature back to presence only | 3 |
| 4 | no 'not carried' toast on moves | 1 |
| 5 | carry written at the UNtransformed cell | 6 |
| 6 | carry writes objects too | 1 |
| 7 | carry writes terrain too | 1 |
| 8 | extras not counted as dropped | 2 |
| 9 | pastes do not call writeCarry | 1 |
| 10 | carry skips road-only cells (zone required) | 0 first (every footprint cell had a zone), seed changed to a road-only cell, now 5 |
| 11 | carry skips zone-only cells (road required) | 5 |

## Suite
Full default suite once, to completion, on 8fc1686: 603 passed, 5 skipped, 0 failed, 3.7 min (wall 3:40), `startup retries: 0`; uptime load 8.64 6.80 5.84. perf-baseline.json untouched; test-results not committed.

## Not done
Objects, bridges and extras on footprint cells under a transform are dropped by design (counted and undoable). The toast for a plain transformed paste says nothing about undo. Enter with a focused slider/checkbox/select still refuses to lift.
