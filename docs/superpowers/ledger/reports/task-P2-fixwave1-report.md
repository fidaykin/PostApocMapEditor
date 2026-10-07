# Phase 2 final review - FIX WAVE 1 report

Branch feature/editor-roadmap, base d10f4c3. Five commits, one per item. New tests: tests/fixwave1.spec.ts (34 tests). Tree clean, tests/perf-baseline.json untouched, no new top-toolbar controls (canvas 1491x808 test still green).

| Item | Commit | Subject |
|---|---|---|
| W1-1 | 78a1b88 | fix(footprints): self-validating footprint map keyed on map identity, size and a write counter; single-tile writes no longer rebuild it |
| W1-2 | 4580717 | fix(zones): Fill Zones, Fill This Zone and Randomize & Fill follow the bulk-writer contract; Generator apply cancels a lifted region |
| W1-3 | c0acf91 | fix(security): build the building picker, Replace datalist, zone list and package/localisation handlers with DOM APIs; untrusted ids are data |
| W1-4 | 07fdd4d | fix(clipboard): zone ids are map-local; stamps store no zones and a buffer pastes its zones only onto the map it was copied from |
| W1-5 | 2b590a5 | fix(tools): Place Building revalidates its selection on press, the stamp warning counts missing buildings, ending a paste never leaves the paste tool active |

## W1-1 footprint map staleness

Files: MapEditorPro.html (shared-state block near `_satelliteMap`, `_writeTerrain`, the listed writers), zone-painter.js (`fillZoneTerrain`).

Design: `getSatelliteAnchor` trusts the cache only while `_satKey = {md, w, h, seq}` equals (mapData identity, MAP_WIDTH, MAP_HEIGHT, `_mapWriteSeq`); otherwise it rebuilds. `bumpMapWrite()` (seq++ and cache dropped) is the one helper every in-place writer calls; `invalidateSatelliteMap()` is now an alias of it (so every pre-existing call bumps too). Belt and braces: explicit `bumpMapWrite()` added at `_restoreMapState`, autosave/side-copy restore and load custom_terrain migration, `IO.newMap` (silent), `applyNewMap`, `_loadFromJSON`, `applyExpandMap`, Fill Map, Generator apply, Satellite apply (both writes), QA placer, zone `fillZoneTerrain`. `_writeTerrain` now invalidates only when a multi-tile id was written or overwritten (`_isMultiTileId`, the `_resetCells` pattern). Work counter `_satBuilds` (page global) counts builds.

RED evidence (all 7 original tests, run against d10f4c3 sources): New/Place Building/paste/Replace on old footprint failed (`Expected "Artefact_Test_1", Received undefined`); Open (load) failed at deleteSelection; QA placer failed (overlap 37 vs 28 expected); Expand failed; Generator/Satellite apply truth diff != 0; Fill Map truth diff != 0; stroke counter `ReferenceError: _satBuilds` (real RED from mutation M3 below). Tests never call `invalidateSatelliteMap()`; an independent `truthDiff` scans mapData with `footprintCells` and compares to `getSatelliteAnchor` for all 202,500 cells. An 8th test (cache key alone) replaces the array, bumps only `_mapWriteSeq`, resizes the map, with no invalidate call.

Mutations (each restored from a saved copy + cmp): M1 `bumpMapWrite` no-op -> 3 tests fail (Open, QA placer, stroke counter); M2 drop identity/size key -> cache-key test fails (the other tests still pass because of the belt-and-braces bumps, by design); M1b drop `seq` from key -> cache-key test fails; M3 `_writeTerrain` always invalidates -> stroke work-counter test fails (200-cell single-tile stroke: <= 1 build; multi-tile write: >= 1; overwriting the anchor: exactly 1).

Existing tests that touch this: paint-tools "plain-terrain strokes never rebuild the footprint map" (counts `invalidateSatelliteMap` calls) still passes unchanged.

## W1-2 zone painter bulk writers

Files: zone-painter.js (`_guardBulk`, `_beginBulkWrite`, `_finishTerrainWrite`, `fillZoneTerrain(zoneId, mapData, touched)`), MapEditorPro.html (Generator apply `Tools.cancelFloat()`; `?v=` 13 -> 14 -> 15 -> 16 over W1-1..W1-3).

Fill Zones, Fill This Zone, Randomize & Fill now: refuse while `Tools.isFillBusy()` (toast 'A fill is still running') or `Tools.isStrokeActive()` (toast 'Finish the current stroke first (Esc)'); call `Tools.cancelFloat()` and `Tools.clearRoadStart(false)` right before History.push; collect written cells and finish like the Fill tool: `bumpMapWrite()`, drop bridges on written cells (kept while the objects layer is locked), `Tools.autoResolveEdgesAround(touched)`; cells under a multi-tile footprint are skipped (as `_writeTerrain` does). Output is unchanged when no anchors/edges/bridges are involved (all existing zone tests pass unmodified).

RED: 11 of 12 new tests fail on the W1-1 sources (the 12th, bridges kept while objects locked, is a positive control). Tests: per writer x3 (busy: no step, nothing written, zones/layer unchanged, toast, works afterwards; stroke: only the stroke's own step, no terrain written; float cancelled), the Fill Zones finish test (bridge dropped, one `autoResolveEdgesAround` call over exactly the written cells, footprint cell inside the zone kept, truth diff 0), locked-objects keeps bridges, Generator apply cancels a lifted region.

Mutations: busy guard off -> 3 fail; stroke guard off -> 3 fail; cancelFloat off in `_beginBulkWrite` -> 3 fail; edge re-resolve off -> 1; bridge drop off -> 1; footprint skip off -> 1; Generator cancelFloat off -> 1.

## W1-3 XSS sinks

Fixed (DOM APIs, `textContent`, `dataset`, `addEventListener`, `img.src` as a property): building/bridge picker cards (`id`, `span`, click and key handlers read `this.dataset.bldId`, sprite path segment through `encodeURIComponent`), Replace datalist, zone list (swatch/name/delete built with DOM; also `fromSaveObject` now drops zones whose id is not an integer 1..255 and ignores a non-integer `_nextZoneId`, because a hostile map file put `z.id` into an inline `onclick`), Packages panel and filter-chip buttons (`data-pkg-id` + `this.dataset.pkgId`), localisation datalist (DOM), localisation inline handlers (`_ej`: JS-escape then HTML-escape; `_ea` alone is NOT safe inside a JS string in an attribute because entities are decoded before the script is parsed), settlement slot rows (numeric fields through the local `esc`), content-manager helpers (`_escHtml` now escapes quotes; `sq()` is `_escHtml(JS-escaped)`; toast calls no longer double-escape).

RED (against c0acf91's parent): picker, bridge picker, Replace datalist, zone list, package panel, localisation rows all fail (the localisation test first passed vacuously, because it clicked another key's button and the native confirm was auto-dismissed; rewritten to find the hostile key's own row and stub `confirm`, then it failed RED as it should). Payloads: `"><img src=x onerror=window.__pwn=1>` and `');window.__pwn=1;//`, injected via `BldDB.addEntries` / `HexDB.addEntries` (the package-import path). Assertions: `window.__pwn` undefined, zero `img[onerror]`, card text and `data-bld-id` equal the raw id, one img per card, no inline handlers on cards, selection id equals the raw id (click and Enter), option values equal the raw ids.

Mutations: card dataset altered -> 2 fail; label via innerHTML -> 2; datalist via innerHTML -> 1; `_ej = _ea` -> 1; zone id filter off -> 1; inline pkg id restored -> 1.

### innerHTML / insertAdjacentHTML / outerHTML / document.write / inline on* audit

No `insertAdjacentHTML`, `outerHTML`, `document.write`, `eval`, `new Function`, `javascript:` or `setAttribute('on...')` exists in MapEditorPro.html, zone-painter.js, hex-utils.js, map-jobs.js or map-worker.js. 59 + 3 `innerHTML` sites:

| Site (approx. line) | Data interpolated | Verdict |
|---|---|---|
| zone-painter.js `_uiRebuildZoneList` (~701) | zone id, name, colour (map file) | FIXED (DOM; ids validated on load) |
| zone-painter.js ~695, ~800 | none (`''`) / options by DOM | static |
| Layers rows (~2995-3000) | static markup, label by textContent | static |
| Building picker (~5843) | building id, sprite name | FIXED |
| Replace datalist (~6319) | hex ids | FIXED |
| Stamp UI (~5518-5562) | stamp names | already DOM/textContent |
| Maps popover (~8390-8407) | map name, size, time, message | escaped (`_escHtml`; quotes now escaped too); `onclick=_loadMap(${i})` integer index |
| Content manager (~8500-8542) | sprite/map/file names, urls, sha | FIXED (quote escaping + `sq` JS-then-HTML escaping); pre-existing, trivial |
| Settlement slot row (~8829) | slot numbers, custom type | FIXED (numbers now through `esc`; type already `esc`) |
| UI.undo/redo labels (~9055) | numbers | static |
| Dialog (~9089), progress, menus (~9125-9218, 9815 `''`) | static / DOM | static |
| Packages panel rows (~11254) | package id, name, version | escaped text; inline `onclick('${_esc(id)}')` FIXED (dataset) |
| Packages trash rows (~11273) | id, date | escaped, `data-` attributes only |
| Packages filter chips (~11912) | package id, name | FIXED (dataset) |
| Dev tools manifest (~12232) | hex/building ids, sprite names | escaped (`_esc`); local dev panel |
| Localisation datalist (~12389) | keys | FIXED |
| Localisation panel / rows (~12463-12680) | keys, en/uk text, groups | text/attrs escaped; inline JS args FIXED (`_ej`) |
| BiomeManager lists (~12808-12854) | biome name/colour from localStorage `biome_defs` | pre-existing, needs its own task (local, user-typed data; names and colours raw, incl. inline `onclick('${b.name}')`) |
| HexDB / BldDB / SttDB / UpgDB / CommonDB editors (~13096-16640, 17230) | ids/sprite names go through `_esc` (escapes quotes); numeric/enum fields (`value="${hex.baseCostTaps ?? 0}"`, `${r.amount ?? 0}`, `_selectInput` options, `_row` tooltips) and the uploaded-sprite URL are raw | pre-existing, needs its own task (dev DB tabs, reachable only by opening a record from an imported package; text fields are already escaped) |
| Hex/Bld footprint summaries (~13707, ~15150) | numbers/direction keys derived from in-app toggles | static |

Not changed on purpose: BiomeManager and the dev DB editors' numeric attributes (listed above).

## W1-4 zone ids are map-local

Files: MapEditorPro.html (`_mapGen`, `_mapToken`, `_mapTokenCurrent`; `Clipboard.capture` records `map` token (mapData identity as a non-enumerable property, generation, size); `plan` sets `items.zonesOk` and `items.carry.zonesOk/quiet`; `write` skips `z` and toasts once; `Stamps._cleanCells` validates `z` but does not store it; `saveSelection` toasts 'Zones are not saved in stamps'). `_mapGen++` at restore, newMap (silent and applyNewMap), both load paths, Expand. Undo/redo/in-place edits do not bump (same map). Stamp buffers have no token, so never paste zones. Record format stays `v:1`.

RED: 6 new tests + the 4 rewritten stamp tests fail on the old code (the same-map test is a control and passes both ways). Mutations: token always current -> 4 fail; stamps store z -> 6 fail; `write` ignores zonesOk -> 4; carry not quiet -> 1 (after adding roads to the test so the carry reaches write(); before that the mutation survived); no save toast -> 1; token ignores identity and generation -> 2.

### Rewritten tests (tests/stamps.spec.ts), before -> after
1. 'importJson ignores unknown fields...': expected stored cell had `z: 4` -> `z` absent (validated, not stored).
2. 'a rich buffer ... round-trips through a reload and places identically': stored cells deep-equal the capture -> equal the capture minus `z`; `placeBoth` compared terrain+objects+roads+bridges+extras+zone layer of capture-placement vs stamp-placement -> compares everything except zones, then asserts the same-map capture DID write zones and the stamp wrote none; placeBoth now captures a fresh buffer inside the page (a buffer passed in from Node lost its map token, correctly a foreign map), and the loop re-seeds because the restore inside placeBoth reassigns mapData (which clears the selection).
3. 'save rejects ... boundary values (z 255, ...)': `okZ: 255` -> 'not stored' (z256 still rejected, so validation is kept).
4. 'import accepts the boundary values (z 255, plain road_hex)': `z: 255` -> 'not stored'.

## W1-5 smaller integrity fixes

(a) `_onDown` for Place Building revalidates the selection against `BldDB` (clears it, refreshes the label, toast 'Pick a building first', no write, no step). The stamp 'not loaded' warning now counts cells by (tile id, building id): terrain-only text unchanged ('2 cells use tiles that are not loaded'), building-only 'N cells use buildings that are not loaded', both 'N cells use tiles or buildings ...' (a cell missing both counts once). (b) `_endPaste` falls back to Paint when `setActive(prevTool)` left the tool on 'paste' (Bridge with no bridge buildings); `setActive('paint')` drops the float. RED: all 3 new tests fail on the old code; mutations: fallback off -> 1; revalidation off -> 1; building count off -> 1.

## Suite evidence

`npx playwright test` (default reporter, run once, to completion): 1045 passed, 5 skipped (the three perf-undo-measure opt-ins and two others, same as before), 0 failed, 6.1 min (365 s wall, user 1064 s), `startup retries: 0`. Before this wave: 1009 tests; +36 (34 new in fixwave1.spec.ts, and stamps/other counts shift by the worker-reported total). Load average: 7.58 7.09 6.77 at start (10:38), 8.47 8.79 7.86 at end (10:44) - the machine was busy with other work; no failure was load-related and nothing was re-run.

## Not done / notes

- BiomeManager and the dev DB editors' numeric attribute interpolations are listed as pre-existing and not changed.
- CHANGELOG not updated (wave 2 owns docs): user-visible changes to mention there are 'stamps no longer store zones', 'pasting zones from another map is skipped with a toast', 'Zone fills refuse during a fill/stroke and respect footprints'.
- Fill Zones skips footprint cells unconditionally (like the Fill tool), even when the owning anchor is itself overwritten in the same pass; conservative, noted.
- Expand Map counts as a different map for clipboard zones (zone ids are preserved by Expand, but the ruling lists Expand).
