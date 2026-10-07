# T1.12 report: low-zoom level of detail

Commit c7bc597. Files: MapEditorPro.html, tests/perf-lod.spec.ts.

## Implemented
- LOD is a pure function of hex radius (no hysteresis needed, no per-frame toggling): level 0 radius >= 10 (zoom >= 25%, the original path, unchanged); level 1 4 <= radius < 10 (zoom 10-24%); level 2 radius < 4 (zoom < 10%). The brief's threshold is exactly 25%, which is level 0, so there is no conflict with the baseline hashes.
- Level 1: `_drawHexTileSimple` (drawImage, no save/clip/outline/coastline/anchor pass). Anchors and bridges show their base terrain sprite, layered tiles base + top, missing sprites fall back to the colour table.
- Level 2: `_overviewLayer = _makeColorLayer('overviewRecolored')`, the T1.5 layer machinery reused at 450x450 (one pixel per tile) with the same compare-based invalidation. `_drawOverview` draws one source column per pixel column (about 450 drawImage calls, nearest neighbour), shifted by the odd/even stagger exactly as hexCenterWorld, so the overview registers with the hexes (tests sample the pixel at floor(hexScreenPos) for every visible tile).
- `_makeColorLayer(statKey)` now uploads only the bounding box of changed pixels (a painted tile is a 1x1 upload). Minimap behaviour unchanged (hash and tests pass).
- Real bug found by the tests and fixed: at full resolution the layer's sample index `floor(px/pw*H)` is off by one for some columns in floating point (10 of 450 columns picked the neighbouring tile). At pw == MAP_HEIGHT / ph == MAP_WIDTH the index is now exact; downsampled layers (minimap) keep the old formula so the minimap baseline hash is untouched. (The minimap itself has the same float quirk; left as is on purpose.)
- Test hooks: `Canvas._test.setLod(false|0|1|2|null)`, `Canvas._test.overviewLayer()`; `getStats()` gained `lod` and `overviewRecolored`.

## Overlays at level 2 (flat overview)
- Kept as before: settlements/city, slot labels, zone-distance rings and labels, rulers, block grid, selection, hover brush ring (all cheap).
- Roads: 2x2 px mark; objects: 3x3 px yellow mark (both still range-culled).
- Bridges: skipped (tile colour already shows them).
- Zone painter overlay (user data): kept, as pitch-sized fillRect instead of hex path.
- Zone tint (`_showZones`): per-tile tint skipped, rings remain. Slot rings: band drawn as outlines of min/max distance instead of per-tile tint.
- Rectangle tool preview (levels 1 and 2): one outline rectangle instead of stroking every hex (a big rectangle would take seconds).
- At level 1 all overlays are unchanged except the rect preview.

## Measurements (450x450 scene from setupScene, 1491x808 canvas, rulers on, median of runs incl. getImageData flush; load average ~4)
| zoom | before (full path, forced) | after |
|---|---|---|
| 2% (floor) | 892 ms | 4.7 ms |
| 5% | 491 ms | 3.5 ms |
| 10% (level 1) | 168 ms | 43.5 ms |
| 20% (level 1) | 56 ms | 14.8 ms |
Paint-then-render at the floor (one edited tile per frame, median of 15): about 5 ms (overviewRecolored == 1). Target < 60 ms at the floor: met by a wide margin. 10% is the level-1 worst case (30k tiles).

## Tests (tests/perf-lod.spec.ts, 17 tests)
RED first: against the HEAD file 16 of 17 failed (setLod/stats missing, whole-map render ~1 s, no overview). GREEN: 17/17.
Covered: four render hashes per fresh page with lod == 0; LOD levels across 30,25,24,10,9,floor,9,10,24,25,30 (toggles off when zooming back in); overview pixel equals colour table for ~all visible tiles of a 5-colour pattern at zoom 9 (odd and even columns); block of known tiles at the floor (inside/outside/edge); incremental counters (first 202500, unchanged 0, one edit 1, tilesDrawn 0); mutation paths: in-place writes and bulk fills, a real mouse click painting one tile at the floor (hit-test works at 2%), Rectangle drag and Fill (via Tools.fill), undo/redo, reassigned mapData, Load (loadFromJSON), autosave restore (tryRestoreAutosave), New Map (size change), Expand, Generator.apply; ratio tests (floor overview >= 5x faster than forced full path, edit+render >= 5x faster, deterministic tilesDrawn 0 vs 202500; level 1 >= 1.5x faster than level 0 with identical tilesDrawn).
Not separately tested: Satellite.apply (same in-place mapData write mechanism as Generator, covered by the compare-based invalidation).
Tests that sample colours turn rulers off (the block grid lines would draw over tiles); the click test derives the expected tile from the whole-pixel click position.

## Hashes
perf-equivalence 9/9 pass; render_25/60/100/200 identical, tests/perf-baseline.json not touched. Note: these hashes depend on render history in the page (the same camera gave different pixels depending on the earlier intermediate render), so perf-lod uses a fresh page per zoom like perf-equivalence.

## Deferred bug (clamp minimum): NOT applied, reverted per the rule
I changed `clampCamera` so the minimum is -(2r + strip) on every axis (strip = 0 when rulers are hidden). That changed render_25 (d6441769 vs baseline 6f0a7b8d; 2393 pixels differ by a few levels, camera at hash time identical). Cause: `frame()` calls setZoom first, whose intermediate clamp now differs, and the final pixels depend on that earlier render. render_60/100/200 stayed identical. Per the brief I reverted that part: clampCamera is exactly as in T1.11. Consequences: the test covers only the floor (where the T1.11 slack formula already clears the strips: passes); no 30% test. Options for you: accept a baseline update for render_25 (needs your approval), or apply the larger minimum only when zoom < 25 (then zoom >= 25 stays untouched but zooms 25-70% where r < 28 px still hide edge tiles).

## Runs
perf-equivalence + perf-lod + perf-zoom-floor + perf-minimap: 46 passed. perf-culling "only on-screen tiles are visited" and "render time at 25%": pass (the two full-scan reference tests skipped as slow). Full suite `--workers=2`: 266 passed, 4 skipped, 0 failed (4.1 min).

## Concerns
- Level 1 at 10% costs ~44 ms for a full-screen scene (target was met at the floor, not tied to 10%); raising LOD_FLAT_RADIUS to 6 (zoom 15%) would roughly halve it at the cost of earlier loss of sprite detail.
- At level 1 multi-tile anchor sprites and coastlines are not drawn (as the brief specifies).
- Nearest-neighbour overview aliases below about 1 px per tile (zoom < ~2% on larger maps); acceptable at the current floor.

## Fix round 1
- IMPORTANT (slot-band outline colour): the LOD 2 outline used `base + ')'` where SLOT_PALETTE entries are open `rgba(r,g,b,` prefixes, giving invalid CSS that Chrome ignores (stale strokeStyle). Now `base + '1)'`; opacity comes from the existing `globalAlpha = 0.9`. New test "flat overview draws each slot band outline in its own palette colour" (two slots, samples one ring pixel each at zoom 9 / LOD 2, asserts both match palette 0 and 1 mixed 0.9 over the tile colour and differ). RED first: with the old line it failed (channel off by 71); GREEN with the fix. (First attempt with `'0.9)'` was off by 14 because globalAlpha already applies 0.9; the test caught the double alpha.)
- MINOR 2 (rect preview box at LOD >= 1): bounds now come from the world grid (x from the rect's row range plus one radius, y from the column range with the stagger and a half-pitch hex height), using `radius / HEX_SIZE` as the scale instead of `zoom / 100` and a full pitch. LOD 0 path untouched.
- Follow-up for the owner (NOT touched, affects zoom >= 25 pixels): the pre-existing identical bug in the LOD 0/1 slot tint, `ctx.fillStyle = base + ')'` in `_drawSlotRings` (~line 3930), invalid CSS so tint fills use a stale colour.
- Tests: perf-lod + perf-equivalence 27/27 (render hashes identical, baseline untouched). Full suite `--workers=2`: 267 passed, 4 skipped, 0 failed (4.0 min). clampCamera strip fix still deferred.
