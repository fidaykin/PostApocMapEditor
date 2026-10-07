# T0.8 report
Implemented per brief: HexDB/BldDB.removeByPackage (+exports), Packages.usage, async confirmDelete (Delete Package dialog, 3 buttons), deletePackage(id, {removeEntries}).
Interfaces exactly as specified.

Deviations (fail closed):
- deletePackage: the brief fell back to the LOCAL registry when the server registry fetch failed or was non-ok, then PUT it back (could erase server packages). Now a non-ok fetch or a body without a packages array throws; error toast, no PUT, nothing removed locally.
- Local entries are removed only after the registry PUT succeeds (already ordering in brief; now tested).
- usage: a non-ok map_list.json or missing maps array counts as unreadable (brief treated it as an empty list); hex/bld matching uses (package||'postapoc') consistent with removeByPackage (brief used raw h.package).

Tests (tests/package-delete.spec.ts, 8): brief's 3 plus Escape (no PUTs), unreadable map counted + shown in dialog, unreadable map list, registry read failure (no PUT, entries kept, error toast), registry PUT failure (entries kept, error toast).
RED: with HEAD's MapEditorPro.html all 8 fail. GREEN: 8 passed; full suite `npx playwright test` 51 passed.
Files: MapEditorPro.html, tests/package-delete.spec.ts.
