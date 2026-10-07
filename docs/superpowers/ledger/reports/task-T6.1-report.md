# T6.1 report: unit tests for existing pure logic

File: tests/unit/pure-logic.spec.ts (7 tests, all PASS first run: characterization).
Coverage check first (grep of existing specs): History cap/undo/redo/row sharing = perf-history.spec.ts; HexUtils.neighbors/disc/ring/line = hex-utils.spec.ts; EdgeTiling vs MapJobs port = edge-drift.spec.ts. NOT repeated. Uncovered and added: Packages.idPrefix, Packages._rewriteEntries, EdgeTiling.getMaskTable/resolveEdgeTile (own semantics), legacy integer-map migration (`_migrateTid`, custom_terrain), lenient string-map load.
Decisions / deviations from the brief:
- No Roads.getNeighbors symmetry test (A71: K1 breaks it, HexUtils.neighbors already tested). The single-face edge test pins today's K1 legacy offsets with LITERAL table values and says so in a comment; update with K1.
- Edge tests use real type groups 'Swamp'/'Volcanic/Rift' (HexDB.loadFromObject normalises unknown types to 'Special'), after filtering real entries of those types out of the page-local DB.
- History tests skipped (duplicate). Uses openEditor (pure logic, no 450 map needed).
Sanity mutations (one batch each, restored with cmp, tree clean):
- FACE_NAMES order swap, idPrefix without upper-casing -> 3 tests failed (idPrefix, _rewriteEntries, getMaskTable).
- custom_terrain index `y*W+x` -> `x*W+y` -> migration test failed.
- Note: mutating the fallback table `12:'Plain_1'` was NOT caught: ints resolve through HexDB `terrainTypeId` first, so that table is only reached for ints absent from the DB (999 -> Plain_1 default is asserted).
Run: `npx playwright test tests/unit/pure-logic.spec.ts` -> 7 passed.
