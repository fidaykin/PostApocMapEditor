# T0.9 report
Implemented pkg_trash, Packages.listTrash/restoreDeleted, deletePackage restore copy, "Recently deleted" panel table with Restore.
Deviations (fail closed vs brief):
- restore: registry read non-OK / malformed => error toast, no write (brief fell back to local registry guess). Id already in server registry => refuse. Registry entry id forced to the item id.
- restore never overwrites local entries that exist under the same package::id key (brief used addEntries replace semantics).
- trash copy removed only after registry PUT + local entries succeeded; if registry PUT succeeded but local step threw, message says so and trash is kept.
- delete: if registry read/PUT fails, the pre-delete trash is restored (no stale restore copy for a live package); trash write wrapped in try/catch; post-PUT local failure message mentions Restore.
- listTrash filters malformed items and normalizes hexes/buildings to arrays.
Tests: tests/package-delete.spec.ts 16 pass; full suite 59 passed. Added tests: quota abort toast, failed delete no trash, restore read-500, already in server registry, already in local registry, PUT failure, no-overwrite.
RED: not captured separately (tests written alongside implementation); concern.
Concern: if restore's registry PUT succeeded but entries failed, retry is refused (id now exists); trash copy kept for manual recovery.

## Fix round 1
Changes: (1) deletePackage rolls trash back only if failure was before the PUT or the PUT returned explicit 4xx; otherwise keeps the copy and toasts "may or may not have been removed". (2) restoreDeleted is resumable: always reads server registry (fail closed); PUTs only if the id is absent there; re-adds only missing entries; trash removed only on completion; no trash item => "Nothing to restore". (3) Discard button (UI.confirm) + discardDeleted; _storeTrash evicts oldest copies on quota failure and reports them in toast detail; aborts if even the newest alone cannot be stored. Hardening: listTrash drops non-object/non-string-id items, deletedAt via String(), Restore/Discard use data-id + delegated click handler.
Tests: package-delete.spec.ts now 22 (delete rollback a/b/c, resumable restore, restore with server id present, no-trash, Discard, eviction, malformed trash). RED against old HTML: 6 failed; GREEN: 22 passed. Full suite (npx playwright test): 65 passed.
