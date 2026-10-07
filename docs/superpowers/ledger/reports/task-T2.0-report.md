# T2.0 report: edge-resolver drift test
Implemented tests/edge-drift.spec.ts: 8 sizes (odd/even/non-square, incl 1x1) x 5 water biases x 3 reps; every cell compared between EdgeTiling.resolveEdgeTile and MapJobs._resolveEdgeTile (edge context from Generator._buildJob, so _DIRS_EVEN/_ODD passed as-is, K1 untouched). Same-seeded RNG per call; result id and draw count compared. Grids include map-edge cells, empty/unknown ids, case variants.
No disagreement found.
Adaptation: _resolveEdgeTile was private to the IIFE; added a one-line test hook `MapJobs._resolveEdgeTile = _resolveEdgeTile` (no behavior change). Added 'keep in sync' comments in both files.
RED: swapping even/odd selection in the port -> test fails (52+ mismatches); restored.
GREEN: new spec + perf-equivalence 10/10 (hashes unchanged); full suite 279 passed, 4 skipped. tests/perf-baseline.json and test-results untouched.
