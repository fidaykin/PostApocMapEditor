# T2.15 report: road tools (Draw Road W, Connect Road C, Erase Road Q) + T2.14 review findings N1/N3
Commits: 58dbcc2 (Part 1: N1 + N3), 296863a (Part 2: road tools + CHANGELOG).

## Part 1 (58dbcc2)
- N1: the building card's inline `onkeydown` now also calls `stopPropagation()`; new helper `_ownsOwnKeys(e)` (activeElement or target inside `[role=button], .bld-card, [tabindex]`) plus `!e.defaultPrevented` guard both the Enter-to-lift branch and the transform-key branch.
- N3: the picker's Escape branch requires `!e.defaultPrevented && !_isTypingOrModal(e)`.
- Tests (4, describe "building picker keyboard hygiene"): card Enter selects and does not lift (selection kept at 3 cells, not pasting, tool 'object'); Enter on the bare map still lifts (control); defaultPrevented / role=button target does not lift; Escape that closes a real open menu, with a modal div, and in a text field leaves the picker open, a bare Escape closes it.
- RED (against the pre-fix HTML): 3 failed, 1 passed (the control). GREEN: 4 passed. Mutations: Enter guards removed -> 1 failed; picker Escape guard removed -> 1 failed; `_ownsOwnKeys` removed alone -> 1 failed; `defaultPrevented` removed alone -> 1 failed. Survivor by design: removing only `stopPropagation` from the card handler is covered by the window-level guards (defence in depth), so the card test cannot fail on it alone.
- Regression: object-tools, selection, (move/clipboard globs matched nothing extra) 253 passed in the targeted run.

## Part 2 (296863a): API and decisions
- Buttons `data-tool="road" | "road-connect" | "erase-road"` in the LEFT palette row `#shape-tools` (after Erase Building; icons 🛣 🔗 🚫 with titles "Draw Road (W)", "Connect Road (C) ...", "Erase Road (Q)"). Top toolbar untouched; canvas stays 1491 px at 1400x900 (tested).
- Keys: `CODE_TOOLS` gets KeyW/KeyC/KeyQ (e.code, no Shift/Alt/Ctrl/repeat, `_isTypingOrModal(e)`). Collision audit: no other handler binds W/C/Q; Ctrl+C is handled earlier (ctrl branch) and the tool-key handler returns on ctrl/meta. `[`/`]` untouched. TOOL_NAMES: Draw Road, Connect Road, Erase Road.
- Lazy-stroke pattern: the three tools are in `_LAZY_STROKE_TOOLS`; each `_onDown` case calls `_beginLazyStroke()` before the writer; `_paintRoad` / `_connectRoad` / `_eraseRoad` return boolean and call `_pushOnce()` only immediately before their first write (road gate refusal, existing tile, missing destination: no step). A road tool's stroke is one event (press..release); there is no drag drawing (as before: "roads are placed one tap at a time"; a drag acts on the pressed tile only).
- Stale-map: the toast mapping now says "Road tool stopped — the map changed" for the road tools (scatter/eraser/building unchanged); the stale branch also resets `_lastRoadPainted` and clears a pending connect start. Blur handler resets `_lastRoadPainted` too (the variable is write-only today, so this is not observable in a test).
- Escape: the existing stroke rollback (History token) also clears the connect start; a new no-stroke branch (after the picker/paste branches, honouring `defaultPrevented`, map mode and `_isTypingOrModal(e)`) cancels a pending start without any History step.
- Connect Road flow (DECISION, amends the old behaviour): click 1 only sets the start: a `road-start` highlight (cyan hex outline via `Canvas.setHighlight`, auto-dropped by Canvas when the map is replaced) and a toast; nothing is written and no step is made. (The old code wrote the start tile on the first click, which made a cancel impossible without a leftover tile and could leave a floating road tile.) Click 2 writes the BFS path (start and destination included) in ONE step; the destination becomes the next start (chaining, as before). Same cell as start: nothing. Path already fully built: no step, start still moves. Unreachable destination ("too far", search cap 4000 nodes): toast, start KEPT, nothing written. The connect tool has no network gate (as before; the brief and "do not invent gates"); Draw Road keeps `_isRoadNetworkNeighbor`.
- Start lifetime: cleared by Escape, by Escape rollback of the second click, by a tool switch (`setActive`, except re-selecting road-connect), and by a replaced map (checked on mouse move and again on the next click; it remembers the map object and size it was set on). Test hook `Tools.getRoadConnectStart()` (copy of the start or null) added to the public object.
- Erase Road deletes only `roadsData[key]` (terrain, objects, zones stay: tested). Undo/redo restore `roadsData` in one step; overlay cache revalidates by key order, so draw/undo/redo repaint (tested with full-canvas pixel diffs: the undo changes only the hex box, redo reproduces the road pixels exactly).
- CHANGELOG: two bullets under Unreleased > Behaviour changes (road tools; N1/N3).

## Tests (tests/object-tools.spec.ts: 4 new + 23 road tests)
Independent references: adjacency from pixel geometry (`pixelDisc` over `Canvas.hexScreenPos`), a cell that both the pixel ring and `Roads.getNeighbors` (K1) accept for the gate test; pixel diffs for overlays; History step counts.
RED at the pre-Part-2 HTML (58dbcc2 tree): 20 failed, 2 passed of 22 (the 22 at that time; 1 test added later). Note several of those fail first on the missing `Tools.getRoadConnectStart` hook or the missing tool rather than on the finer behaviour; the mutation table below is the evidence that the finer behaviour is covered.
Test-writing notes: columns run vertically on screen (col +1 is one row up), so a "far" cell for Draw Road is 4 rows along the row axis; "too far" for Connect uses zoom 25% with both ends on screen 40 cells apart; the canvas fires `IO.scheduleAutoSave` on every mouse-up, so an autosave count cannot distinguish a no-op click and no autosave assertion was kept.

## Mutation table (restored from a saved copy each time, cmp-verified; failing = tests failing of 23 road tests)
| # | Mutation | Failing |
|---|---|---|
| 1 | road tools removed from `_LAZY_STROKE_TOOLS` | 3 (registry, blur/lost mouse-up, stale toast) |
| 2 | `_beginLazyStroke()` missing in the 'road' case | 6 |
| 3 | `_pushOnce()` after the write in `_paintRoad` | 3 |
| 4 | push before the network gate (step on a refused tile) | 1 |
| 5 | Escape (no stroke) does not clear the connect start | 1 |
| 6 | tool switch does not clear the start | 1 (a first, malformed version of this mutation swallowed a statement and failed 10; redone cleanly) |
| 7a | stale map not checked in `_connectRoad` | 1 (after strengthening: the first version of the test used a real click, whose mouse move already cleared it; now raw press/release) |
| 7b | stale map not checked on move | 1 |
| 8 | Escape rollback keeps the start | 1 |
| 9 | erase-road also deletes the object | 1 |
| 10 | connect pushes even when nothing is missing | 1 |
| 11 | generic (building) stale toast for road tools | 1 |
| 12 | KeyW unmapped | 2 |
| 13 | first click writes the start tile | 6 |
| 14 | erase-road without `_pushOnce` | 2 |
| 15 | no start highlight | 1 |
| 16 | road network gate dropped | 1 |
| 17 | start dropped on "too far" | 1 |
Part 1 added 4 more (above). Unmutated/unobservable: the blur reset of `_lastRoadPainted`.

## Full default suite
Once, after the last commit 296863a: 804 passed, 5 skipped, 0 failed (809 tests = 777 + 32 new), wall 4.8 min (4:50), no retries line / startup retries not reported in the line reporter output. perf-baseline.json untouched; no background runs left. uptime load average ~8 at start of the run.

## Not done / honesty
- No drag drawing/erasing for roads (kept the existing one-tap-per-tile design); erasing many tiles is one click each.
- Connect Road still has no network gate and the path search (`Roads.getNeighbors`, K1 bug) may use "neighbours" that are not pixel-adjacent: tests assert endpoints and step counts, not pixel contiguity of the path.
- The blur reset of `_lastRoadPainted` has no observable effect, so no test.
- Accidentally corrupted tests/object-tools.spec.ts once with a bad scripted replace (empty slice); recovered exactly by reversing the replacement (no git checkout); the committed file was verified by running the whole spec (68 tests green).
