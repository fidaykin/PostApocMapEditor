# T0.3 report
Implemented per brief verbatim: HexDB._migrateAll + mergeFromServer, BldDB.mergeFromServer, GitHubSync._fetchPublishedJson/syncContentFromServer (exported), startup wiring (window.__startupSyncDone, __lastSyncSummary, toasts), waitForEditor awaits sync.
RED: 3 of 4 startup-sync tests failed before the implementation (reload lost NewHex_; local edit reverted; __lastSyncSummary undefined). Test 3 (server update applied) passed already via old replace semantics.
GREEN: startup-sync + harness + dialogs = 10 passed. Full suite: 22 passed.
Deviation: tests/sync-merge.spec.ts "saveBase/loadBase keep packages side by side" (T0.2) failed because startup sync now stores a 'postapoc' base; added `localStorage.removeItem('sync_base_hex')` at the start of that test.
Note: impl was applied before the RED run, then reverted (git checkout) and re-applied from a saved patch to obtain genuine RED evidence.
Files: MapEditorPro.html, tests/helpers.ts, tests/startup-sync.spec.ts, tests/sync-merge.spec.ts.
