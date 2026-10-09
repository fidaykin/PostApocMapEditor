# T5.0 report: Phase 5 test helpers

Changed: `tests/helpers.ts` (extended, nothing replaced), new `tests/phase5-helpers.spec.ts`. No `tests/helpers-github.ts`, no second mock: the brief's duplicates were never created (nothing to delete). `jszip` already a devDependency.

Added to `FakeGitHub`: Contents API DELETE (sha required: 409 stale, 404 missing; tombstone hides disk-backed repo files, also in `list`, Pages lag snapshot respected), `deletes`, `failDelete`, `remove()`, ordered `writeLog` ({op: PUT|DELETE, path}) of accepted writes, `requests` (every Contents API request with status). Existing `puts`/`putPaths()`/`failPut`/`failGet`/`pagesLag` unchanged.
New exports: `readZip`, `packageZip(id,name,{hexes,buildings,sprites,version,description})` (export layout), `dataUrl`, `hexRec`, `bldRec`, `seedServerPackage(gh,id,...)`, `seedHexes`/`seedBuildings` (real `addEntries`), `seedSprites` (SpriteStore + `Terrain.registerUploadedUrls`), `waitForLastWrite(gh, lastPath)` (expect.poll on the write log; pass the path the operation writes LAST: publish = package.json, import = registry.json).
Tests use `openEditor(page, { gh, pat: true })` + `__startupSyncDone`; the self-test proves the fake registry and `gh.puts` work through openEditor's own routes (no shadowing).

RED: first run 4/4 failed (missing exports). GREEN: 4/4. Sanity mutation: removing the DELETE sha check fails the DELETE test; restored with cmp.
Focused run: phase5-helpers + package-*.spec + registry-fresh-read + startup-sync + sync-merge + dialogs + modal = 99 passed.
Note: the registry is read via the Pages URL, not the Contents API, so `gh.requests` does not list it.
