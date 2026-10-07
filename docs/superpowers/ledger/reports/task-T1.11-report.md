# T1.11 report: dynamic zoom floor
Implemented per brief: `_fitZoomPct()`, `Canvas.minZoom()` = max(1,min(25,floor(fit))), setZoom/fitToScreen use it, proportional steps (`_step`) for zoomIn/zoomOut/wheel at <=30%, resize handler re-clamps zoom (also updates status label and clampCamera), `minZoom` exported. Additions beyond brief: `_fitZoomPct` returns 0 if non-finite (0x0 canvas -> floor 1); `setZoom` ignores non-finite pct (pinch with zero distance would otherwise set zoom NaN).
Verified: zoom is not persisted (no autosave concern); minimap divides by scale>=0.01 (fine); status label is `zoom + '%'` (integer).
Tests: tests/perf-zoom-floor.spec.ts (9 tests; RED first: "Canvas.minZoom is not a function", 8 failed), GREEN 18/18 with perf-equivalence (render_25/60/100/200 hashes unchanged, baseline not regenerated).
Measured render at floor (450x450 scene, 1400x900 canvas, floor = 3%): ~1.4-1.6 s (median of 5). By zoom: 25%:14ms, 15%:36, 10%:132, 8%:224, 6%:383, 5%:529, 4%:640, 3%:903 (machine loaded, load avg ~6-12). Exceeds 250 ms; clamping the floor to >=8% would defeat the task (map would not fit, brief tests would fail), so the brief's guidance was followed: T1.12 is REQUIRED before shipping. Editor is usable but slow below ~8% until T1.12.
Full suite: 230 passed, 4 skipped, 15 failed under load. Re-run in isolation: dialogs, no-native-dialogs, perf-workers all pass. perf-culling "ranged render" and "multi-tile anchors" time out (240s) in this environment; verified they ALSO fail on the pre-change HEAD file (environmental slowness of full-scan reference renders), not a regression.
Files: MapEditorPro.html, tests/perf-zoom-floor.spec.ts.

## Fix: suite failures
Method: scratch worktree at 9e5c1c0 (port 4174, removed afterwards), full suite with `--workers=4`, machine load average 6-12 from other sessions. Runs: HEAD (6449d12) x2, base x2, then HEAD with the fix x2.

| run | failed | which |
|---|---|---|
| base 1 (9e5c1c0) | 9 | perf-culling x3, perf-fill x2, storage-errors x4 |
| base 2 | 9 | dialogs, no-native-dialogs x3, perf-culling x3, perf-terrain-memo x2 |
| HEAD 1 (6449d12) | 13 | no-native-dialogs x4, perf-culling x3, perf-terrain-memo x2, storage-errors x4 |
| HEAD 2 | 7 | perf-culling x2, perf-fill x2, perf-zoom-floor x3 (mine) |
| fixed HEAD 3 | 9 | dialogs, map-load-warnings x3, perf-culling x3, perf-terrain-memo x2 |
| fixed HEAD 4 | 13 | autosave-recovery x4, perf-culling x3, perf-overlays x2, storage-errors, sync-merge x3 |

Findings
- Startup zoom is unchanged: nothing calls fitToScreen at startup (only the Fit Map button), so the editor still opens at 100%. Only Fit Map and explicit zoom-out reach the new floor. No spec depends on the floor except perf-zoom-floor (other specs set explicit zooms 25-200).
- Pre-existing, deterministic at base: perf-culling "ranged render" and "multi-tile anchors" time out at 240 s, and "render time at 25%" misses its 0.7x baseline under parallel load (69 ms vs a 67.6 ms limit). Cause: the full-scan reference tests do ~600 pairs of full renders plus 1400x900 getImageData hashes; they take 33 s and 9.4 min alone on this machine. Fix applied: timeout 240 s -> 900 s; with it all 4 perf-culling tests pass alone (9.5 min). The 25% timing test still fails when run in parallel under heavy load.
- Everything else is a rotating set of load flakes (different specs fail each run, at base too, with multi-minute stalls): dialogs, no-native-dialogs, perf-terrain-memo, storage-errors, perf-fill, autosave-recovery, map-load-warnings, perf-overlays, sync-merge. Each passed when re-run alone. Not attributable to T1.11.
- Attributable to T1.11: my perf-zoom-floor specs failed in HEAD 2 (stalls; they rendered the full scene at the 3% floor, about 1 s per render). Fix: bare 450x450 map via IO.newMap(true), fewer floor renders (zoomOut test starts at 6%), the informational render-time test removed. perf-zoom-floor: 8/8 pass in 8.7 s alone and 0 failures in both fixed full runs.
- Net: a fully green full suite was not reproducible here for any commit, base included. Smallest durable fix for the flakes is to run with fewer workers or on an idle machine; I did not change other specs.

## Fix round 2
Commits: 3ac5b26 (code + tests), plus a follow-up test-timeout commit.
- IMPORTANT 1: new tests load a 20x20 map (asserts fit > 25, `minZoom() === 25`, `setZoom(1)` lands on 25) and a 100x100 map (floor equals min(25, floor(fit)) computed independently in the test). RED check: with `Math.min(50, ...)` the 20x20 test fails (Expected 25, Received 50); the 100x100 case is below 25% so it cannot distinguish the cap, which is why both exist.
- IMPORTANT 2: `_viewArea()` = canvas minus the ruler strips (RULER_LEFT 28, RULER_TOP 20 when rulers are on, zero when hidden). `_fitZoomPct` fits tile centres plus one hex radius on every side (the existing mapPixelW/H already include 2*HEX_SIZE) into that area. `fitToScreen` centres inside the area with the half-hex offset (centres start one radius inside the box). `clampCamera` lets the camera go below -2r only on an axis with centring slack (room for the strip and half the slack); other axes are unchanged. My first version loosened the bound everywhere and changed the intermediate camera in `setZoom`, which flipped the render_25 hash (pixel diff ~2k px, max 27, at the top edge); restricting it to slack axes restored the hash.
- True floor at the test viewport (canvas 1491x808, rulers on, 450x450 map): fit = 2.5% so the floor is 2% (was reported as 3% in round 1; that was computed against the full canvas height). Fit-to-screen lands on 2%.
- Corner test now asserts each corner hex's full box (centre +/- radius) inside the free area (inside the canvas and not under the strips), rulers on and off.
- MINOR 1: resize test asserts floor and zoom strictly increase, and zoom equals the floor. MINOR 2: real `page.mouse.wheel` events at the floor never go below `minZoom()` and end on it. MINOR 3: `Canvas.reclampZoom()` (clamp zoom to the floor, update the status label, clampCamera) is called on resize, ruler toggle, New Map, Load, Expand and autosave-recovery restore; test loads 100x100 from a 450x450 map at its floor and checks zoom, floor and label. Also tests the ruler toggle.
- Cheapness: tests use bare maps; most floor renders use a 100x100 map (floor ~11%).
- perf-equivalence: 9/9 pass; render_25/60/100/200 hashes identical, baseline not regenerated. No spec calls fitToScreen apart from perf-zoom-floor.
- Tests: perf-zoom-floor 13/13 and perf-equivalence 9/9 pass. Full suite `--workers=2`: 246 passed, 4 skipped, 3 failed: perf-minimap "colour layer is cheaper than the old full rebuild" (page.evaluate timeout in setupScene, unrelated load flake), perf-zoom-floor "setZoom clamps..." (30 s timeout, rendering the 450x450 map at the floor under load; now given a 90 s timeout and passing alone) and perf-zoom-floor "wheel zoom out steps proportionally" (stalled in openEditor's waitForFunction, load; passes alone). The full suite was not re-run after the timeout bump.
