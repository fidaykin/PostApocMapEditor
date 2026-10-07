# T2.17 report: Layers panel (visibility)

Commits: 1f47869 (RED tests), 9af4d10 (feat), fe432dc (more tests + CHANGELOG), 052ea04 (focus test strengthened). Base 666a4e7.

## API (global `Layers`, defined immediately before the CANVAS MODULE banner)
`NAMES = ['terrain','objects','roads','settlements','zones']`, `isVisible(n)`, `isLocked(n)`, `setVisible(n,b)`, `setLocked(n,b)`, `initPanel()`, plus `sync()` (re-reads the zone overlay switch, stores, refreshes rows; called by zone-painter.js). Persistence `localStorage['layer_state_v1']` = `{layer:{visible,locked}}`. Unknown names are ignored by every call (isVisible true, isLocked false). Panel: `#layers-panel .layer-row[data-layer]` with real `<button type="button">` `.layer-eye` / `.layer-lock`, `aria-pressed`, `title`, `aria-label`. Lock buttons and state exist and persist; NO enforcement (T2.18).

## Decisions
- Panel is in the LEFT palette, after the Stamps panel (palette scrolls; every control reachable at 1400x900 and 1100x700, tested; canvas 1491x808 at 1400x900, tested).
- Terrain hidden: lod 0/1 flat `#1b1b1b` hex per visible cell (no sprite, no multi-tile cluster pass, no coastline); lod 2 a flat `#1b1b1b` rectangle over the overview extent instead of the overview texture (`_drawFlatMap`; the rectangle is the map's bounding rect, so it is slightly larger than the hex outline). Hidden terrain does not speed rendering (brief's review focus; same as brief).
- Objects = `objectsData` overlays + `bridgesData` overlays. Roads = road overlays. Hidden layers skip their loop entirely (`_EMPTY_KEYS` stands in for the key cache; cache sync is revalidated on use, so no stale cache).
- Settlements = all markers INCLUDING the city marker (brief) and the slot distance rings. The View menu "Toggle Settlement Visibility" (`settlementsVisible`) stays independent and is ANDed with the layer.
- Zones = Zone Painter overlay only. `Layers.isVisible('zones')` reads `ZonePainter.isOverlayVisible()` (single source of truth); `setVisible('zones')` calls `toggleOverlay()` when it differs; `ZonePainter._toggleOverlayUI` and the random-fill path call `Layers.sync()` (zone-painter.js edited, `?v=8` to `?v=9`); a persisted "hidden" is applied to the painter in `initPanel`; the `#btn-zone-overlay` opacity follows. The distance-ring toggle (`Canvas.toggleZones`, `_showZones`, `_drawZoneOverlays`) is a separate tool and NOT gated by the zones layer.
- Hover/picking: the status bar shows only coordinates and distance, never layer content, so nothing leaks from hidden layers; no change needed (tested). Highlights/selection/ghost are not layers and stay drawn.
- Minimap: terrain-only colour overview; unchanged by visibility (tested: identical pixels with all layers hidden). Exports/map JSON/autosave: no code touched; toggling is not a map edit (no History step, no `scheduleAutoSave`, tested; state is never in map data).
- LOD 1 and 2 follow the same visibility (tested at lod 0/1/2 for every layer).
- Perf: `Layers.isVisible` is called 4 times per frame (hoisted into locals), identical count at zoom 100 and 30 (tested via call counting while 3x more cells are drawn). `perf-*` specs, golden hashes (`perf-baseline.json` untouched) pass.
- Keyboard: no new shortcuts. Buttons stop Enter/Space keydown propagation (so Space-pan and Enter-lift do not fire from a focused panel button, same pattern as Stamps); a pointer click (`detail > 0`) blurs the button so Space pans again.
- Storage: load and save in try/catch; corrupt JSON, `null`, arrays, numbers, non-object entries, unknown layers all fall back to defaults; blocked storage keeps session-only state, page errors: none.
- Known gap (not done): selecting the Settlement/Erase tool still forces `settlementsVisible = true` (existing code) but does not unhide the Settlements layer; painting on a hidden layer is not prevented (T2.18 locks are the intended control).

## RED evidence
`tests/layers.spec.ts` (written first; the brief's 3 tests were replaced by a larger set) run on the base: `33 failed` (24 x `ReferenceError: Layers is not defined`, the rest panel/click timeouts). Final file: 35 tests, all green (`35 passed` with the focus split).

## Mutation table (tests/layers.spec.ts; each restored from a saved copy and `cmp`-verified)
| # | Mutation | Failing tests |
|---|---|---|
| 1 | roads gate removed | 2 |
| 2 | objects gate removed | 2 |
| 3 | bridges gate removed | 1 |
| 4 | settlement markers gate removed | 1 |
| 5 | slot rings gate removed | 1 |
| 6 | terrain flat fill removed | 1 |
| 7 | lod 2 always draws the overview | 1 |
| 8 | zones isVisible ignores ZonePainter | 2 |
| 9 | setVisible('zones') does not toggle the painter | 3 |
| 10 | `_toggleOverlayUI` no longer calls `Layers.sync` | 1 |
| 11 | `_save` disabled | 4 |
| 12 | `visible` parsed as `!!s.visible` | 1 |
| 13 | eye `aria-pressed` not set | 3 |
| 14 | eye blur after click removed | SURVIVED first (test clicked the lock last); test split per button, then 1 |
| 15 | Space/Enter stopPropagation removed | 1 |
| 16 | terrain visibility not hoisted | 1 |
| 17 | `setVisible` schedules autosave | 1 |
| 18 | persisted hidden zones not applied | 1 |
| 19 | objects visibility not hoisted | 2 |
| 20 | eye title emptied | 1 |
| 21 | lock blur removed | 1 (after the split) |
Equivalent/not distinguishable: validity guards on entry types (`typeof`/`Array.isArray`) cannot change results for the tested inputs (reading `.visible` of a number/array yields undefined, same as a defaulted entry); not mutation-tested.

## Suite evidence
Full default suite once, HEAD 052ea04: 860 passed, 5 skipped, 0 failed, 5.2 min (320 s wall), `startup retries: 0`, `uptime` after: load averages 6.76 8.66 8.08. A subset (`perf-*`, `stamps`) was also run earlier on 9af4d10: 215 passed, 4 skipped. Nothing else in the tree touched; `tests/perf-baseline.json` untouched; no `git checkout -- <file>`, no stash, no subagents.
