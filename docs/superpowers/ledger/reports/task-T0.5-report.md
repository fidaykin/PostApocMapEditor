# T0.5 report

Implemented `Packages._serverHasPackage(id)` (registry.json lookup, then packages/<id>/package.json probe; network errors = not found), and guards in `createPackage` and `confirmImport` that show `Package "<id>" already exists on the server. Pick another id.` with no PUT.

Tests: appended 3 tests to tests/package-import.spec.ts (import of FakeGitHub added to the existing helpers import).
RED: `-g server` -> 2 failed (new-package refuse, import refuse); free-id test passed.
GREEN: tests/package-import.spec.ts -> 5 passed (brief said 4; file already had 2 tests + 3 new = 5). Full suite: 27 passed.

Files: MapEditorPro.html, tests/package-import.spec.ts.
Self-review: diff matches the brief verbatim; no deviations.
Concerns: none.

## Fix round 1
Changes: `_serverHasPackage` is now tri-state ('taken'|'free'|'unknown'; free only on healthy registry without the id AND a clean 404 probe; all errors/non-ok/non-404 -> 'unknown', console.warn logged). New `_serverIdProblem` helper returns the error text; both createPackage and confirmImport refuse on taken or unknown ('Could not verify that the id is free — check your connection and try again.'), before the _importInProgress latch, so nothing is written and the latch is not stuck. Important 3 untouched.
Tests: 4 new (probe aborted / HTTP 500, for create and import; import retries with healthy routes and succeeds).
RED (old impl): 4 failed. GREEN: `npx playwright test tests/package-import.spec.ts` -> 9 passed. Full suite: see commit run (all passed).
