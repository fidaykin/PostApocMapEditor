# T1.3 report: range-based culling in Canvas.render

Status: DONE_WITH_CONCERNS

## Implemented
- `Canvas.render` tile loop now iterates only the row/col range derived from camera/viewport/padding (+1 cell margin each side, y range includes the odd-q STAGGER). The exact per-tile cull test is kept as the final authority; draw order unchanged. Other passes (anchor pass, settlements, bridges, roads, objects, zones, rulers) are untouched; the anchor pass consumes only tiles that passed the loop cull, so it is equivalent by construction.
- `Canvas.getStats()` (`tilesVisited`, `tilesDrawn`, `overlayRebuilds`, `minimapRecolored`); first two reset per render.
- Test-only hook `Canvas._test = { setCamera(x,y), setFullScan(bool) }`: `setFullScan(true)` restores the old visit-everything loop as the reference implementation (added because there is no camera setter and the tests need a reference).

## Tests (tests/perf-culling.spec.ts, all pass)
- tiles visited: zoom 100 < 2500, zoom 25 < 12000 (actual ~5300 at zoom 25 vs 202,500), drawn > 100.
- Random/edge/corner cameras (6 zooms, ~30 cameras each incl. beyond-clamp, off-map, corners, 3 variants each): ranged render pixel hash AND tilesDrawn equal the full-scan reference.
- Multi-tile anchor/satellite sweep: 5 anchors (centre + 4 corners), sliding across all four viewport edges in 1/3-cell steps at zoom 25/100/200: identical to full scan.
- Timing: render at 25% <= 0.7 x baseline.
- RED evidence: tightening the xi margin (+1/-1 instead of -1/+1) made both equivalence tests fail (drawn counts differ); getStats absent initially -> failure.
- Dropped the brief's "identical at every zoom" test: the 4 hashes are covered by perf-equivalence.spec.ts (they need a fresh page per zoom; sequential zooms in one page give different cameras).
- The first render after a camera jump can differ from later renders irrespective of culling (lazy sprite decode); the helper renders once to settle and retries a mismatch once (a range bug is deterministic).
- Full suite: 177 passed, 1 skipped. perf-equivalence hashes (render_25/60/100/200, minimap, fill_scene, fill_uniform, generator_seed42, satellite_synth) unchanged; baseline not regenerated.

## Timing (median ms, 25 runs, same session; before = full scan flag, after = ranged)
| zoom | before | after |
|---|---|---|
| 25 | 46.9 | 46.0 |
| 60 | 19.9 | 18.7 |
| 100 | 15.2 | 14.2 |
| 200 | 11.4 | 10.6 |
(original pre-T1.2 baseline: 96.6 @25, 20.9 @100)

## Concerns
- Gain is only ~1 ms: after T1.2 the per-tile scan was already cheap; render time is dominated by actually drawing visible tiles (clip + drawImage + stroke per hex), not culling. Further wins need reducing per-tile draw cost (T-later). The visited-tile reduction (202,500 -> ~5,300 at zoom 25, ~1,000 at 100) is real.
- `Canvas._test` is a small test-only surface in production code.
- Road/object overlays still iterate Object.entries over all entries (out of scope).
