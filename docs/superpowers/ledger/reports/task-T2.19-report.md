# Task T2.19 report: Clear Map clears every layer

## Implementation (5b6010b, previous implementer; verified here)
`IO.clearMap` builds a plan (`_clearPlan`) from live locks and content. Terrain -> DEFAULT_TILE_ID with `tileExtras` (extras follow the TERRAIN lock); bridges only when terrain AND objects are free; buildings, roads, zones (`ZonePainter.clearZoneLayer`) and non-city settlements follow their own locks. City marker, zone definitions and settlement slots untouched. Dialog text is built from the plan (cleared list, "Kept (locked)" list). Guards: fill/stroke refused at entry and re-checked in the confirm callback; all locked -> lock toast, no dialog; nothing to change -> "Nothing to clear" toast, no dialog, no step (plan re-read in callback). `Tools.cancelFloat()` (selection kept), ONE History.push before the first write, satellite cache invalidated, autosave after.

## Tests (tests/layers.spec.ts, describe "Clear Map clears every layer (T2.19)", 20 tests)
unlocked clear = blank snapshot + pixels equal blank, one step, undo exact, redo; one test per locked layer (5, positive controls); extras follow terrain not objects; all locked refused (lock toast, no "Nothing to clear"); clearing twice no-op; only locked layers hold content; dialog text; callback re-reads locks; map replaced while dialog open; stroke refused at entry; lifted float cancelled, selection kept; slots and zone definitions untouched. Added by me (06da0c7): fill refused at entry; fill started while dialog open; stroke started while dialog open; satellite cache invalidated; toast distinction in the all-locked test.

## RED evidence
Previous run recorded 14 failed / 7 passed on the `T2.19|Clear Map` subset against the base (not re-run; the base clearMap never touched buildings/roads/extras/zones, so the clear/lock/dialog/no-op tests necessarily fail). My 5 added tests are RED against the survivor mutations below (each failed with the mutation, pass on the product).

## Mutation check (32 mutations, one at a time, `--workers=2 --max-failures=1 --timeout=15000`, 150 s cap, restored + cmp after each)
Caught: wrong clear tile, extras not cleared, bridges/buildings/roads/zones/settlements not cleared, terrain/objects/roads/zones/settlements lock ignored, bridges ignore terrain lock (extras-on-objects-lock covered by 2 and the extras test), no-change check removed (confirm and entry), float not cancelled, stale plan in callback, no History step, dialog omits kept layers, stroke guard removed at entry, zone content ignored in change check, city marker cleared, slots cleared, History push before nothing-check (empty step), two pushes, zones cleared before the step (undo does not restore), kept list ignoring terrain lock.
First pass SURVIVED: satellite cache not invalidated (17), all-locked refusal removed (21; fell through to "Nothing to clear" whose text contains "locked"), fill guard at entry (26), fill guard in callback (27), stroke guard in callback (28). Strengthened in 06da0c7; all five re-run: caught. Result: 32/32 caught.
Harness notes: an earlier run (driver python script busy-looped; a concurrent second run orphaned the `serve` on port 4476 and gave false NOFAIL rows) was discarded; final table is from a clean sequential run. Tree verified identical to HEAD (cmp) after the loop.

## Full suite
Run 1 (on 5b6010b): 957 passed, 5 skipped, 0 failed, 5.7 min, `startup retries: 0`, load average 7.70. No other spec depended on the old Clear Map behaviour; no existing test was changed.
Run 2 (on 06da0c7, after fixes): 961 passed, 5 skipped, 0 failed, 5.7 min, `startup retries: 0`, load averages 7.39 6.69 6.05.

## Not done / honesty
No product defects found. RED for the base was not re-run (reasoned from the diff). tests/perf-baseline.json untouched. progress.md not edited by me; the controller ledger line for T2.19 was missing, see the progress.md line appended.
