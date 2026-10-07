# T1.6 report: undo memory measurement

Verdict line (from tests/perf-undo-measure.json): `T1.7 VERDICT: JUSTIFIED (total=143.0 MB, p95=19.50 ms)`
Run: `MEASURE_UNDO=1 npx playwright test tests/perf-undo-measure.spec.ts --workers=1` (system Chrome, 450x450, 50 steps each of real edit [tile + road + object] then History.push(); push runs BEFORE the edit so a snapshot is the previous state).

| scenario | content | heap delta (50 snaps, forced GC) | per snapshot | push p50 / p95 / max | structural estimate (upper bound) |
|---|---|---|---|---|---|
| scene | T1.1 scene (101 roads, 57 objects, 1 settlement) | 48.5 MB | 0.97 MB | 0.2 / 1.2 / 2.4 ms | 87 MB |
| rich | 5k roads, 1.5k objects, 2k tileExtras, 40k zone tiles, 31 settlements/bridges | 59.7 MB | 1.19 MB | 2.2 / 3.7 / 4.4 ms | 117 MB |
| worst | Generator default seed 42, 30k roads, 15k objects, 20k tileExtras, full zone layer, 200 settlements/bridges | 143.0 MB | 2.86 MB | 12.8 / 19.5 / 20.2 ms | 342 MB |

## Which number the verdict rests on
The `performance.memory.usedJSHeapSize` delta with forced GC (`--js-flags=--expose-gc`, available; gc x3 with settle waits) and the push p95, taking the max over scenarios. Both thresholds (64 MB, 8 ms) are crossed ONLY by the `worst` scenario (143 MB, 19.5 ms). `rich` is just under on memory (59.7 vs 64 MB, within plausible noise) and well under on latency; `scene` is clearly under.
`measureUserAgentSpecificMemory` is NOT used (needs crossOriginIsolated; not available here). The structural estimate (8 B per pointer slot, ~40 B per dictionary entry, fresh strings for the tileExtras JSON copy) is a documented upper bound: actual per-snapshot cost for the grid is ~4 B/slot (0.8 MB for 202,500 refs), which indicates pointer compression, so estimates run ~2x the heap delta. The heap delta is the more trustworthy number; it is still a delta, not an exact sizeof, and includes small unrelated allocations.

## Recommendation
T1.7 SHOULD run: the verdict is JUSTIFIED, driven by large/heavily-edited maps (30k roads etc.), where object-dictionary copies and the tileExtras JSON deep copy dominate (p95 19.5 ms per push, i.e. a visible hitch per edit). On light/moderate maps the cost is already below threshold, so T1.7's win is for heavy maps; consider that when deciding scope. Not verified: that Generator.apply() in `worst` actually changed terrain (it is called with the default seed; counts confirm all other content).

## Files
- tests/perf-undo-measure.spec.ts (new; skipped unless MEASURE_UNDO=1; asserts nothing numeric, so cannot turn the default suite red)
- tests/perf-undo-measure.json (new, committed recorded numbers)
Deviation from brief: spec name/output path per caller instructions (perf-undo-measure, tests/ JSON), 3 scenarios instead of one, push latency percentiles p50/p95/max. No editor change. Default run of the spec: skipped (3 skipped). Full suite not run (new spec is skip-only; no source touched).
