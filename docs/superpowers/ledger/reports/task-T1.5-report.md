# T1.5 report: cached incremental minimap colour layer

Status: DONE_WITH_CONCERNS

## Implemented
- MapEditorPro.html: `_colorOf` (memoised Terrain.color; COLORS is a static table, independent of HexDB/packages, so no getRev invalidation needed), `_makeColorLayer`, `_minimapLayer` above `drawMinimap`; `drawMinimap` now does `drawImage(_minimapLayer(mw, mh))`. Overlays (viewport rect, city dot, rulers, block grid) are still drawn per frame on top, never baked into the layer.
- Test hook `Canvas._test.minimapLayer(pw, ph)` for tests.
- `lastIds` seeded with a sentinel (not `undefined`) so a missing/undefined tile id still gets coloured exactly like the old code (default colour).
- tests/perf-minimap.spec.ts: brief's 3 tests + 4 correctness tests (in-place bulk write, History undo/redo, reassignment same size / New Map / new dimensions, randomized 60 mixed edits vs from-scratch rebuild).

## Design deviation (deliberate)
Caller suggested dirty-rect hooks + identity check. I kept the brief's compare-based design: each call compares the 48,400 sampled ids (fixed cost, independent of map size; NOT the 202,500-element map) against last-painted ids. Measured ~0.1 ms. This is exact for in-place writes that bypass any hook (setupScene, Generator, History._restore, `mapData.fill`, all write in place), which an identity/size safety net plus a hook would miss. So no write-site hook is needed; every `mapData[` write site (paint/fill/rect tools, History._restore in place, IO newMap/load/clear/autosave/side-copy restore reassign at lines ~7066-7332, Expand reassign ~7676, Generator/Satellite/ZonePainter in-place) is covered by the compare (reassign, size change via cache key MAP_WIDTH x MAP_HEIGHT, or in-place). tileExtras/bridges/settlements are not used by the minimap colour sampling.

## RED / GREEN
- RED: with the compare neutered (`if (lastIds[i] !== _UNSET) continue;`, a stale cache), 5 of 7 tests failed (only-changed, bulk write, undo/redo, reassign, randomized). Source restored.
- GREEN: `npx playwright test tests/perf-minimap.spec.ts --workers=1` 7 passed (3 runs).
- Full suite: 187 passed, 1 skipped, 1 failed: `minimap redraw is faster than baseline` under full-suite parallel load only (passes 3/3 alone). Concern: the 0.6x of 1.7 ms = 1.02 ms threshold is tight vs timer resolution (0.1 ms) and CPU contention; pre-existing style of the brief's threshold, not changed.

## Timing (450x450, 220x220 minimap, median incl. getImageData readback)
- Before (baseline t_minimap, full rebuild every call, pan or paint): 1.70 ms
- After: pan 0.7 ms, single-tile paint 0.7 ms (layer update ~0.1 ms; the rest is overlay drawing + readback).

## Hashes
perf-equivalence.spec.ts all 9 hashes incl. `minimap` pass unchanged; baseline file not touched.

## Files
MapEditorPro.html, tests/perf-minimap.spec.ts. Commit pre-commit hook restamps MapEditorPro.html as expected.
Incident: I briefly ran `git checkout HEAD -- MapEditorPro.html` (reverted work), restored from a saved copy before committing; final diff verified.

## Fix round 1
- Vacuous tests fixed in tests/perf-minimap.spec.ts (the only file with the bug; sweep of tests/perf-*.ts/specs and all other specs found no other `window.`/globalThis writes to mapData/MAP_*/roadsData/etc., so no Phase 0 hits). Now assigns bare `mapData`/`MAP_WIDTH`/`MAP_HEIGHT` (`declare let`), with sanity checks (assignment took effect, MAP_WIDTH===120, length 10800, recolored===pw*ph after key change; `first===0` used in only-changed test).
- RED: neutering compare+cache key: reassign, randomized (and others) fail; neutering only the cache key fails the new-dimensions test.
- Timing test replaced: in-page old full-rebuild loop vs `Canvas._test.minimapLayer`, 60 runs after 10 warm-ups, ratio <= 0.5, skip if old <0.3ms, plus deterministic `minimapRecolored===0`. No absolute ms. --repeat-each=5: 5/5 pass; full suite (parallel): 188 passed, 1 skipped, 0 failed.
- Minors: removed no-op replace; added comments on `_test.minimapLayer` and COLORS memo.
