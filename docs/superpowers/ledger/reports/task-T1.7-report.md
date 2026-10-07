# T1.7 report: structural-sharing history snapshots

Status: DONE_WITH_CONCERNS (worst scenario still above both thresholds; see follow-up)

## Implemented (commit 0729b22)
`History` in MapEditorPro.html: snapshots store `mapData` and the zone layer (Uint8Array, verified) as per-row slices
(`gridRows`, `zoneRows`, `gridW`). Row length is `MAP_WIDTH` (flat `mapData[row*MAP_WIDTH+col]`, verified). A row equal to
the previous snapshot's row is reused, else `slice()`-copied (never aliases live storage). `_restore` copies rows back into
the live arrays (`_copyRows`, same in-place semantic as before). tileExtras: `_cloneExtras` reuses the previous snapshot's
entry object when JSON-equal; restore still deep-copies. `clear()` resets `_last`. `History.debugRowCount()` added.
Expand Map / New Map / loads call `History.clear()` (verified) and sharing refuses different widths/lengths anyway.
Restore still reassigns objectsData/roadsData/tileExtras/settlements as before, so T1.4/T1.5 caches behave as before
(perf-overlays and perf-minimap specs green). Brief followed as written; no scope widening (roads/objects/tileExtras not CoW).

## Tests (tests/perf-history.spec.ts, 5 tests)
round-trip of every field; 50-step cap; row sharing (debugRowCount <= 2*450+110; actual 941); aliasing test (live
mutation after push / after restore, nested tileExtras mutation, shared tileExtras object between consecutive snapshots);
randomized 300 mixed ops (paint, fill, road add/delete, tileExtras, settlements, objects, undo, redo, expand map)
vs a full-copy reference, with stack-size checks and a final drain by undo/redo. The test shrinks to a 120x120 map first
so Expand Map is possible (450 is the max). RED: only debugRowCount test failed on old code (other 4 pass there, as
behaviour-preserving reference tests). Mutation checks (GREEN code mutated, then restored): sharing changed rows by
reference -> 3 tests fail; restoring tileExtras without deep copy -> aliasing test fails.
Also green: perf-equivalence (9 hashes unchanged, baseline untouched), perf-overlays, perf-minimap.
Full suite: 193 passed, 4 skipped (measurement spec), 0 failed.

## Measurement (hardened spec, median of 3, 50 steps, 450x450; Apple M4 Pro, Chrome 154, pointer compression on)
Before = same spec run against pre-change HTML (label `before`), after = label `after`; both in tests/perf-undo-measure.json.
| scenario | heap before | heap after | push p95 before | push p95 after |
|---|---|---|---|---|
| scene | 48.4 MB | 1.4 MB | 0.2 ms | 1.4 ms |
| rich | 59.7 MB | 10.8 MB | 1.6 ms | 3.8 ms |
| worst | 143.0 MB | 77.3 MB | 20.5 ms | 16.3 ms |
Min/max across the 3 runs are within ~0.1 MB for heap; p95 ranges: worst after 15.8-18.3 ms. The one-tile-edit grid goal
is met (scene 1.4 MB vs target 15 MB). Row compare costs ~1 ms per push on 450x450 (p50 0.1 -> 1.1 ms scene), a small
absolute regression on light maps that is well under the 8 ms budget.

## Follow-up (not done, per ruling)
worst still has 77 MB / p95 16 ms, dominated by Object.assign copies of 30k roads / 15k objects and the 20k-entry
tileExtras JSON.stringify compare/copy per push. Needs copy-on-write or dirty-key tracking for roads/objects/tileExtras
(separate task). _cloneExtras stringifies each unchanged entry once per push for the compare.

## Measurement spec hardening (commit after 0729b22)
Scenario counts asserted before measuring (exact for tileExtras/settlements/bridges, bounded for roads/objects, zone
tiles, Generator changed tiles > 1000); addZone errors propagate; zone ids taken from addZone (old code used 1+i%n);
3 reps with median/min/max; per-label results replace (no stale mix), verdict tagged with scenarios and reps;
describe-level skip (default run launches no browser: 3 skipped); numbers rounded; `_meta` has os/cpu/node/slotBytes/
pointerCompression; stale comment fixed. JSON layout changed to `results[label]`.

## Files
MapEditorPro.html, tests/perf-history.spec.ts, tests/perf-undo-measure.spec.ts, tests/perf-undo-measure.json
