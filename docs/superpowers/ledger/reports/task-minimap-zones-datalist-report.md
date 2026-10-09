# Task report: minimap fallback colours, zone fills without edge logic, tile data fix list

Branch `feature/editor-roadmap`, started at f027b30. All numbers below were measured in this session.

## Item 1: minimap / overview colours

- `Terrain.color(id)`: an explicit `COLORS` entry is returned exactly as before. Otherwise (flag on): the sprite's dominant colour if known, else a colour for the HexDB `type` (substring map: river/lake/water blue, mountain/hill grey-brown, forest green, plain old green, desert/barren sand, rubble dark brown, lava/volcanic red-orange, rift dark red, swamp olive, resources/special gold), else the old green.
- The sprite colour is the mean of the fully opaque pixels of the sprite drawn on a 16x16 canvas (smoothing quality high), computed once per sprite when it loads (`applyHexDbOverrides` onload), memoised per lower-case id (the sprite dict is keyed the same way) and per source URL (a second load of the same file costs nothing). Only terrain tiles (ids in HexDB) without an explicit entry are computed; building sprites that share the loader are skipped. Cross-origin package sprites taint the canvas, so their pixels are read from a second CORS request (`crossOrigin = anonymous`) of the same URL, one probe per file; if that fails the type colour stays.
- Repaint: newly known colours that differ from the colour in use are collected and announced ONCE per `applyHexDbOverrides` call (or after the last probe). The Canvas listener clears its colour memo, bumps an epoch (every cached colour layer, minimap and overview, marks all its pixels dirty at its next update), then renders and redraws the minimap. The stamp thumbnail cache is cleared too. No per-frame work.
- Counters: `Terrain.spriteColorStats()` = `{computed, probes, flushes}`.
- Fallback sample (editor, Chrome): Water_1 (17,110,168), Water_Dirty_1 (6,91,130), Lake_1 (34,131,159), River_L_1 (84,163,111, the river sprite includes its green banks).

### Perf-hash question (measured, not assumed)

The perf scene (`tests/perf-scene.ts`) uses Water_1 and Water_Dirty_1, which have no explicit entry. With the fallback on and no opt-out, `perf-minimap` ("minimap pixels identical to baseline") and `perf-equivalence` ("minimap hash") failed: expected `220x220:8bd164eb`, received `220x220:d969f4ae`. Everything else in those four perf specs passed. So the opt-out WAS needed: `Terrain.SPRITE_FALLBACK_COLORS` (default true; localStorage `spriteFallbackColors` = `off` sets it false at startup). `tests/helpers.ts` `openEditor` seeds `spriteFallbackColors: 'off'` for spec files named `perf-*.spec.ts`, next to `rightPanelMode: 'classic'`. With it off, `color()` is exactly the old function. `tests/perf-baseline.json` was not touched; all perf specs pass unchanged. Real users and every other spec run with the fallback on.

### Tests (tests/minimap-colors.spec.ts, 8 tests)

RED first: 5 of 7 failed before the code (the explicit-table test passed as a regression guard). Final: 8 passed. They cover: base Water_1, Water_Dirty_1, Lake_1, Lake_4, Lake_7 blue-ish on the drawn minimap and in the overview layer and within 24 per channel of an independent full-resolution mean of the sprite's opaque pixels (computed in the test from the PNG; the downscaled mean excludes edge-blended pixels, so lakes differ by up to about 19); river pieces take their sprite colour and are not the old green; a lake in the real LOD 2 canvas frame is blue-ish and a Plain_1 tile in the same frame keeps (120,155,85); Decameroon-shaped package (FakeGitHub, cross-origin Pages sprites, `probes >= 3`) water and lake blue-ish, and a water-typed tile whose generated sprite has an orange opaque interior and an alpha-100 green rim shows exactly the interior orange (rim excluded); explicit table entries unchanged and unknown ids green, and the flag off restores green; work counter: `computed` equals the independently counted number of loaded terrain sprites without explicit entry, and 5 redraws, 150 colour reads and a second `applyHexDbOverrides` of all tiles add no computation and no flush; a sprite that loads later repaints the minimap pixel by itself (type blue before, orange after), exactly 1 computation and 1 flush, `minimapOverlayRebuilds` and layer visibility unchanged; toggling another layer leaves the colours unchanged.

## Item 2: zone fills

`ZonePainter._finishTerrainWrite` (used by Fill Zones, Fill This Zone, Randomize & Fill, and so by terrain and settlement writes of `fillZoneSettlements`) now calls `Tools.manualEdgesAround` instead of `Tools.autoResolveEdgesAround`; the former is a no-op while `Tools.AUTO_WATER_EDGES` is false. The generator and generate-into-selection are unchanged. `zone-painter.js` `?v=21` became `?v=22` (the deploy-dev greps and the perf-workers lint hold: `perf-workers` and `docs-lint` passed). Comments in `MapEditorPro.html` and `zone-painter.js` updated.

Tests, new `tests/zone-fill-no-water-logic.spec.ts` (6 tests): RED first, 3 failed (the two fill writers' whole-map diff showed rewritten cells outside the zone, and the locks test the same; the work-counter tests for the three writers and the Randomize content test did not fail before, see below). GREEN: 6 passed. Whole-map diff against a snapshot shows only zone cells, holding only the Coastal Waters preset tiles, neighbouring directional river pieces untouched; one History step; one undo restores the whole map; settlements unchanged; terrain+settlements locked writes nothing and takes no step; objects locked keeps the bridge; a work counter on `Tools.autoResolveEdgesAround` records 0 calls for `_fillAllZones`, `_uiFillThisZone`, `_randomizeFillUI`.

Honest note on the RED run: the per-writer call-counter tests and the Randomize content test were added in the same edit as the fix, so only the three diff based tests have a recorded RED. The Randomize content test cannot detect the old behaviour (the fill overwrites every river piece anyway); the counter test is what proves it.

Existing tests: `tests/fixwave1.spec.ts` "Fill Zones: bridges ... edges are re-resolved" spied on `Tools.autoResolveEdgesAround`; it now spies on `Tools.manualEdgesAround` (still asserts it is asked once with the written cells) with an explanatory comment and a renamed title. layers/final-wave/edge-drift specs needed no change.

Docs: EN/UK guide sentence added after the hand-tools sentence in section 5, HTML regenerated with `node scripts/build-guides.js`; CHANGELOG bullets for items 1 and 2.

## Item 3: data fix list

`docs/data-fixes/tile-data-fixes.md` (no data file changed). Facts re-read: the live `packages/decameroon/hex_database.json` (1.0.10, 60 tiles) is byte-identical to the audited copy; none of its 60 entries has an `isLayered` key. Important finding written at the top of the document: the HEX DB record form has NO control for `isLayered` and none for `category`, so the owner cannot set them in the form; the route is Save DB, edit the JSON text, Load DB (the whole list). Also: Publish HexDB / Publish Buildings DB write only base entries, so the Decameroon fixes reach the live site only through the package Publish (the owner's step order is kept, with this clarification). Proposals for category/type are marked "proposal, owner decides".

## Commits

- 62d1fb2 feat(minimap): fallback tile colours from the HexDB type and the sprite's dominant opaque colour; perf specs run with the fallback off
- 0dee4b1 feat(zones): zone fills place exactly the preset tiles and no longer re-pick river, lake or shore pieces
- 94cc846 docs(data-fixes): ready-to-use tile data fix list for the content owner (no data changed)
- (this report: docs commit)

## Full default suite

`npx playwright test` once, after the three commits: 1687 passed, 5 skipped, 0 failed, 0 flaky, 11.5 min (692 s wall). `[harness] startup retry` lines: 0. No spec re-run was needed. `uptime` after: load averages 7.41 8.67 7.82. Skipped tests are the opt-in live audit and similar skips already in the suite.

## Not done / owner decisions

- The data fixes themselves (item 3 is a list only).
- Sprite colours are the mean of the opaque interior of a 16x16 downscale, so shore-blended lake edges are excluded (lake colour is about 19 per channel from the full-resolution opaque mean); rivers come out greenish because their sprites include the banks. If a purer water colour for river pieces is wanted, add a type override or an explicit table entry.
- Rename of `Decameroon_SettementsBig_1`: not proposed as a palette fix (see the document).
