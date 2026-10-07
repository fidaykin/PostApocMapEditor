# T1.4 report
Implemented: `_syncKeyCache` (revalidating cache: compares live key order, plus values for objects, no string parsing; bumps `_stats.overlayRebuilds` on rebuild) with `_roadCache`/`_objectCache`; Canvas.render road/object passes use cached cols/rows/vals in insertion order (same as Object.entries; keys like "12,7" are not integer-like). Revalidation instead of invalidation hooks covers every mutation/reassignment site (Tools, History._restore reassigns copies, IO load/newMap/clear, expand map, autosave) without enumerating them. Additionally, roads/objects/bridges are culled by the T1.3 visible col/row range (range is a superset of the exact screen test, which remains authoritative). Bridges: no cache, cull only.
Tests (tests/perf-overlays.spec.ts): rebuild counting (add/value change/reassign), mutation paths (in-place delete, reorder, object delete, History undo, IO.newMap) vs pixels, 30k-roads timing, pixel baselines render_25/render_100.
RED: with a stale cache (early return), "revalidated" (expected >2, got 2) and "mutation path" tests fail; GREEN with the real code.
Timing (30k roads in map, 1400x900 zoom 100, median render): before 13.9 -> 21.9 ms (+8.0); after 13.7 -> 16.2 ms (+2.5), 15.4 -> 16.5 (+1.1).
Full suite: 181 passed, 1 skipped. perf-equivalence 9 hashes unchanged (baseline file not touched).
Concerns: calcBitmask still runs per on-screen road. Deviation: added the range prefilter beyond the brief (the brief's version hovered at ~2.8ms vs the 3ms limit).

## Fix round 1
- Timing test is now machine-independent: same page measures base render, render with 30k roads, and the legacy Object.entries+split+map(Number) parse (medians of 15 after 3 warm-ups); asserts overhead < 60% of legacy; skipped via test.skip if legacy < 1 ms; absolute ms only logged/annotated. Deterministic overlayRebuilds assertions unchanged.
- Note: the new range cull also skips entries whose col/row lie outside the map bounds (previously drawn if on screen); only matters for malformed maps.
- Fixed the misleading comment ("no per-entry array/split allocation").
- Evidence: perf-overlays --repeat-each=5: 20 passed (overhead 2.3-2.6 ms vs legacy 7.7-8.9 ms, ratio ~0.29). Full suite: 181 passed, 1 skipped; perf-equivalence baseline unchanged.
