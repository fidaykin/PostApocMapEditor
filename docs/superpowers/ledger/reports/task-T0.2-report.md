# T0.2 report
Implemented SyncMerge (same, keyOf, merge3, loadBase, saveBase) verbatim from the brief, inserted above the GITHUB SYNC banner in MapEditorPro.html; created tests/sync-merge.spec.ts (8 tests).
RED: 8 failed (SyncMerge is not defined). GREEN: 8 passed. Full suite: 15 passed.
No deviations from the brief. Concern: none (stale-unedited-entry-without-base tradeoff is per brief).

## Fix round 1
Changes: _index collects id-less and duplicate-key entries into `extras`; merge3 appends local extras to `merged` last (first duplicate stays keyed). _canon ignores undefined-valued keys. Added 3 tests (id-less, duplicates, undefined).
RED (old code): 3 new tests failed. GREEN: `npx playwright test tests/sync-merge.spec.ts` 11 passed; full suite 18 passed.
