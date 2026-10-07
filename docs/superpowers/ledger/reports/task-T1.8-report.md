# T1.8 report: indexed, time-sliced Fill

Status: DONE. Commit 120112e.

## Implemented (MapEditorPro.html)
- `_fill` returns a Promise; `_fillRun` uses Int32Array queue (head/tail) + Uint8Array visited, ~8 ms slices (yield via setTimeout 0, progress bar via UI.progress). Same neighbour table (parity of c, K2 non-adjacent table kept), same BFS order for the cells passed to `_autoResolveEdgesAround`, same multi-tile footprint skip.
- Exports: `Tools.whenIdle()`, `Tools.isFillBusy()`, `Tools.fill(col,row)`; `History.generation()` (bumped in `History.clear`).
- Re-entrancy policy: new tool input (`_onDown`), a second `_fill`, and `History.undo/redo` are IGNORED while a fill runs (History.push for the fill happens before the first write, once; the busy click returns before push).
- Map replaced mid-fill (New Map/load: mapData identity, size, or History generation changed) -> abort after the next yield, no further writes, no edge re-resolution/autosave; progress bar closed with "Fill cancelled".
- Finish: edge re-resolution, Canvas.render, drawMinimap, `IO.scheduleAutoSave()` (new: the old fill never scheduled an autosave), toast, once. Partial result is only rendered if the user pans/zooms mid-fill (progress bar shown); end-only otherwise.
- Adaptation: brief's plan code had `.then` in the fill case; I moved minimap/toast into `_fillRun` end so abort skips them. perf-equivalence.spec.ts already had the whenIdle wait; no change needed.

## Tests (tests/perf-fill.spec.ts, 4 tests)
Reference-sync-copy equivalence (4 random 450x450 maps with Hills_1 as 7-tile footprint, 3 fills each, plus uniform 450x450); responsiveness; busy input/undo ignored + one undo step restores map; abort on New Map mid-fill leaves fresh map untouched, then a new fill works.
RED: pre-change `Tools.fill/whenIdle/isFillBusy` did not exist (tests written against the new API, run only after implementing; not run in RED state separately).
Full suite: 197 passed, 4 skipped, 0 failed. fill_scene / fill_uniform hashes in perf-baseline.json unchanged (not regenerated), perf-equivalence green.

## Timing, 450x450 uniform fill (setTimeout(0) ticker in page)
- Before (sync, Array.shift + Set): total ~135 ms, longest main-thread block ~84 ms.
- After: total ~60-110 ms, longest gap 18-24 ms, 10 ticks during the fill.
(Old Array.shift is not catastrophic in V8 at this size; main gains are the block length and lower total.)

## Concerns
- Autosave timer firing mid-fill could save a half-filled map (final autosave rewrites it); not gated.
- Other writers (menus, generator, keyboard shortcuts besides undo/redo) are not blocked during a fill, only abort-on-replace protects them.

## Fix round 1
- Imp1: responsiveness test captures ticks/gap right after `await p`; asserts ticks>=3, gap<60 (measured 5 ticks, ~10 ms). RED: single-slice fill (threshold 1e9) -> 0 ticks, test fails; restored.
- Imp2: `IO._autoSave` returns false while `Tools.isFillBusy()`; end-of-fill scheduleAutoSave flushes. `saveMap` chose WAIT: `Tools.whenIdle().then(saveMap)`. Test: autoSave, visibilitychange(hidden), pagehide mid-fill write nothing; Save produces no blob until the fill ends, then the blob holds the filled map; stored autosave contains the filled map after.
- Imp3: Generator.apply, Satellite.apply, autoPlaceSettlements refuse with toast when busy (gate placed first). Comment rewritten. `History.generation` REMOVED (unused; mapData identity/size detects replacement). Test covers refusal, no extra history, final map equals fill.
- Minor: progressDone in finally; `_onDown` catches/toasts 'Fill failed'; test stubs Canvas.render to throw once (progress bar closed, unlocked, toast). `Tools.fill` commented as TEST HOOK. Same-id no-op test added.
- RED for new tests against pre-fix source: bulk-writer, autosave and failing-fill tests fail (3 failed), restored afterward.
- Covering run: perf-fill + perf-equivalence 17 passed (fill hashes unchanged). Full suite result below in reply.
