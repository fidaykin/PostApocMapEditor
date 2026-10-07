# T2.1 report
Implemented hex-utils.js exactly per brief (IIFE exporting root.HexUtils, DOM-free), tests/editor-globals.d.ts, tests/hex-utils.spec.ts (brief tests + seeded property test + DOM-free/no-_DIRS source test), script tag before zone-painter.js (?v=1), deploy-dev.yml (paths, sed rewrite + grep, cp, git add for hex-utils.js), lint in perf-workers.spec.ts extended.
RED: 3 failures "HexUtils is not defined". GREEN: brief formulas matched real Canvas.hexCenterWorld pixels first try (450, 451, 12x10, plus 300 random centres of both parities).
Full default suite: 284 passed, 5 skipped, 0 failed (1.9m). K1 untouched (fixme test kept).
Deviation: brief had `const HexUtils`; used map-jobs-style root export (same global).
