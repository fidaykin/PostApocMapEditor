# T0.7 report
Implemented the brief's publishPackage/_fetchPackageJson (write order: hex, bld, sprites, registry, package.json last; version from server package.json; description/preview preserved; missing-sprites toast with names).
Deviations (fail closed): the brief's _fetchPackageJson returned null on network error/non-404, which would drop description/preview and bump from the stale registry. Now only 404 => null; other failures throw and abort before any write. Same for registry.json fetch: only 404 falls back to local cache; other failure throws (before package.json is written, so a retry stays safe).
Tests: 4 new in tests/package-publish.spec.ts (2 from brief, 2 fail-closed). RED against old code: 4 failed (description undefined, version 1.0.1 vs 1.2.4, writes happened). GREEN: package-publish 8 passed; full suite 41 passed.
Files: MapEditorPro.html, tests/package-publish.spec.ts.

## Fix round 1
Changes: base version validated (/^\d+\.\d+\.\d+$/; two-part padded to x.y.0; else throws 'Server version "abc" is not a valid x.y.z version' before any write). registry.json read moved to right after _fetchPackageJson, before first write.
Tests (RED first: 3 failed, then 10 passed): '1.0' -> '1.0.1'; 'abc' -> zero PUTs + toast naming "abc"; registry 500 -> zero PUTs + error toast.
Command: npx playwright test (full suite) -> see below.
