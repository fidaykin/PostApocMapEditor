# T4.9 report

What: `docs/superpowers/decisions/2026-10-02-game-map-format.md` (Status OPEN; evidence from `IO._buildJson`, editor-only keys incl. `distance_bands`, unknowns, 5 owner questions, option B/C follow-up `IO.exportGameJson()` behind `gateExport()`/`MapValidator.gate`) and `tests/map-json-contract.spec.ts` (3 tests, uses `freshEditor`).
Pinned: minimal key set of a fresh map; all 9 optional keys with exact shapes (city moved, bands, objects, roads, extras, bridges, slots with defaults, zones); load -> save round trip stable (16 keys compared, positive control).
Finding while writing: bridge `axis` must be a number (loader drops others); pinned in a comment. Brief's "settlement_priorities" key is `settlement_priorities` (brief text said priorities; matches code).
Sanity mutation (PASS-first test): renamed `result.settlement_priorities` to `settlement_priorities_X` in `_buildJson`: 2 of 3 specs failed (minimal and optional key set); file restored, `git status` clean.
Specs: map-json-contract 3 passed.
Owner: see the five questions in the decision doc.
