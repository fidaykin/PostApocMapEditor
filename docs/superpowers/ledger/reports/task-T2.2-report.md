# T2.2 report
Status: DONE (see concerns).

## Implemented (MapEditorPro.html, Tools module)
- `_autoResolveEdgesAround` now takes `{col,row,prev?}`, uses HexUtils.neighbors, and also re-resolves directional neighbours when a water/river cell appears or disappears (prev rule). Original rule kept (painted directional tile re-resolves family neighbours).
- `_applyTerrainCells(cells, hexId, opts)`: footprint skip, bridge drop, invalidateSatelliteMap, edge re-resolve; returns `{col,row,prev}[]`. Used by `_paint` and `_applyRect` (synchronous, History.push stays with callers).
- `_fillRun` stays time-sliced with all T1.8 protections untouched (busy gate, stale-map abort, autosave gate, progress finally). Adjacency now from per-row-parity offset tables derived once from HexUtils (no per-cell allocation; K2). `opts.legacyAdjacency` (TESTS ONLY) keeps the old table. Fill passes `prev` to the shared edge re-resolution and drops bridges on filled cells (same as Paint).
- Exports added: `applyTerrainCells, autoResolveEdgesAround, fillAt, applyRect` (`fill` test hook kept; `fill(col,row,opts)`).
- K3 (Brush parity) NOT touched: the T2.2 brief does not mention it (plan assigns it to T2.3).

## Tests
- New: tests/editor-helpers.ts, tests/paint-tools.spec.ts (6): Rectangle re-resolves; land over river re-resolves neighbour; Rectangle == per-cell Paint on a river band (seeded Math.random, 0 diffs); Fill in a hex ring = 7 cells; Paint 1 undo step; Rect and Fill one undo step each.
- perf-fill.spec.ts: old reference test is now explicit LEGACY test (Tools.fill with legacyAdjacency, verbatim old algorithm); new hex test compares to an independent HexUtils BFS on random maps with 7-tile footprints + uniform map, and asserts hex-connected and maximal. Time-slicing/busy/abort/autosave tests unchanged and green.
- perf-equivalence.spec.ts: `fill result (scene)` no longer uses the baseline; compares to an independent HexUtils flood fill. `fill result (uniform)` still uses baseline.
- RED evidence: before implementation 5 of 6 failed (Tools.applyTerrainCells / fillAt not a function; Rectangle resolve calls 0). After the change, perf-fill legacy-reference and fill_scene failed as expected until split.
- Full default suite: 291 passed, 5 skipped, 0 failed (1.9m, 3 workers).

## Baseline (perf-baseline.json NOT edited)
- `fill_scene` (202500:bf5c6f24) no longer applies (captured with the legacy non-adjacent table). Not asserted any more.
- `fill_uniform` (202500:b4ba6a9f) is unchanged and still asserted (whole map is one region).
- Proposal for owner: on a pre-optimisation build run UPDATE_BASELINE=1 for `fill_scene` only and re-enable a baseline check if desired; the reference test already covers correctness. Note: under true adjacency the scene's click cell is a 1-cell region, so that scene is a weak fill test; real coverage is in perf-fill.

## Concerns
- Behaviour change in Paint: neighbour discovery for edge re-resolution now uses true adjacency (per the brief) rather than the K1 legacy tables, plus the new prev rule. All perf render hashes, paint/edge-drift tests stay green, but river painting near the two formerly mis-adjacent directions can differ in rare cases (EdgeTiling's own mask still uses K1 tables).
- Rectangle/Fill now also drop bridges on repainted cells (as Paint already did).

## Fix round 1
- IMPORTANT 1: `_autoResolveEdgesAround` now re-resolves the union of HexUtils neighbours and the legacy readers via new `EdgeTiling.legacyOffsets(row,H)` (cached, allocation-free); both offset tables cached per map size (`_hexOffsetsByRowParity`). New test sweeps painted cell P (rows of both parities, two places) against every true+legacy neighbour X at H=450 and H=452, asserting X's edgeFaces equal `resolveEdgeTile` on the final map. RED (legacy loop disabled): 8 failures at H=450 incl. P=225,224 X=226,223; H=452 passes. GREEN with the fix.
- IMPORTANT 2: Rectangle-vs-Paint test now has two variants over 4 rects (including one covering legacy-only neighbours): masks (edgeFaces) with a seeded RNG, and exact ids with Math.random constant; unused variable removed.
- MINOR 3: removed `legacyAdjacency` from `_fill/_fillRun` and the LEGACY test + legacy reference; HexUtils reference/property tests kept.
- MINOR 6: edge discovery uses offset tables (no HexUtils.neighbors per cell). Water_1 -> Plain on a full 450x450 map: total 83 ms (Plain->Forest 49 ms; reviewer measured 154 ms before). New responsiveness test (Water->Plain): 3 ticks during, max gap 10.2 ms. Tail not time-sliced (judged unnecessary at ~35 ms).
- MINOR 8: Fill passes only written cells (not footprint-skipped) to re-resolution; `opts` removed from `_applyTerrainCells`; contract comment corrected.
- CHANGELOG.md: three bullets added. perf-baseline.json untouched.
- Tests: covering specs 34 passed, 1 skipped; full default suite 294 passed, 5 skipped, 0 failed.
