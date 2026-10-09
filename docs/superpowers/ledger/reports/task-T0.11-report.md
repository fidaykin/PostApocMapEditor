# T0.11 report
Implemented StorageGuard (setItem, _warn) above SYNC MERGE; routed map/hex/bld/stt/upg autosaves through it.
Hardening beyond brief: _warn wrapped in try/catch (broken UI.toast never throws into caller); throttle tolerates clock going backwards; successful save for a label removes the stale toast and resets throttle (so the next failure warns immediately); non-quota errors get a generic title.
Tests (tests/storage-errors.spec.ts, 5): brief's test; never-throws + returns false; non-quota title + broken toast UI; 60s window re-warn (Date.now override) + recovery clearing; map autosave via IO.scheduleAutoSave. IO._autoSave is not exported, so the test uses scheduleAutoSave.
RED: with MapEditorPro.html reverted, 5 failed. GREEN: 5 passed; storage-errors+startup-sync 9 passed; full suite 77 passed.
Note: used a uniquely tagged `git stash push` for the RED check and popped it immediately (no entry left).
Files: MapEditorPro.html, tests/storage-errors.spec.ts.

## Fix round 1
Change: _warn removes the previous connected toast for the label before showing a new one (no orphaned/stacked warnings).
Test: the throttle/recovery test now expects exactly 1 toast after re-warn past 60 s and 0 after a successful save. RED: Expected 1, Received 2. GREEN after fix.
Command: npx playwright test -> 77 passed.
