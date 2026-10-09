# T0.6 report
Implemented per brief: SyncMerge.diff, HexDB/BldDB.migrateCopy, Packages._fetchPublished/diffAgainstServer/_formatDiff, async openPublishConfirm (UI.confirm 'Publish Package'), exports.
Tests: full suite 34 passed. (RED step not separately recorded; first run of the new dialog tests failed before the test fix below.)
Deviations:
- Fail closed: _fetchPublished treats only HTTP 404 as "not published"; any other non-ok status throws, and openPublishConfirm then toasts and does NOT offer to publish (brief's version treated every non-ok as empty server, i.e. a 500 would show a false "first publish").
- Test setup: startup sync (T0.3) pulls Difpkg_Gone into local, so the brief's test never showed "- hex Difpkg_Gone". Setup now awaits window.__startupSyncDone and removes Difpkg_Gone locally.
- Test: Publish button locator uses exact:true (toolbar "Publish" button also matched).
Concern: SyncMerge.diff ignores id-less/duplicate local entries (not shown in dialog); not changed.
Files: MapEditorPro.html, tests/sync-merge.spec.ts, tests/package-publish.spec.ts

## Fix round 1
- SyncMerge.diff now collects id-less/duplicate entries on both sides (unkeyedLocal, unkeyedServer; existing fields unchanged). _formatDiff lists `+ unkeyed hex|bld <json>` (local) and `- unkeyed ...` (server); the "nothing differs" check counts them.
- Moved the "Appends entries..." comment back above HexDB.addEntries.
- Tests added: sync-merge unit test (id-less + duplicates both sides; RED then GREEN), publish dialog lists a server id-less hex as `- unkeyed hex` (RED then GREEN), 500 on hex_database.json -> toast "Could not compare", no dialog, zero PUTs (passed already: fail-closed code existed). Existing diff test changed from toEqual to toMatchObject for the new fields.
- Command: `npx playwright test` -> 37 passed.
