# T2.5 report: Symmetric painting
Status: DONE

Implemented
- hex-utils.js: SYMMETRY_MODES, symmetryCubes (cube-based, brief version), symmetryCells (numeric q/r arithmetic, numeric Set dedup, no cube objects; clips to the map; 'none' returns the same array). Centre = map-centre CELL (cube origin for every W,H), per the brief; no user-set centre (not in brief).
- Tools: setSymmetry/getSymmetry/cycleSymmetry/expandSymmetry; _applyTerrainCells(cells, hexId, opts) expands unless opts.noSymmetry or the terrain is multi-tile (footprint cannot be mirrored). Covers Paint, Rectangle, Line, Circle, Polygon (all go through it): one History step, one edge re-resolution over the union. Fill and bridge mode are not mirrored (documented in tooltip/CHANGELOG).
- Previews: hover brush shows all copies in the same single path; line/circle/polygon preview highlight and rect-drag highlight use the expanded cells (rect preview copies skipped above 4000 cells; the real rect outline is always drawn). Guide overlay (Canvas.setSymmetryGuide): dashed vertical/horizontal line(s) for mirrors, spokes+ring for rotations, centre ring; nothing drawn when off (other output unchanged).
- UI: select in the LEFT palette (#symmetry-select under the shape buttons), blurs after change; top toolbar untouched. Key Y by e.code (map mode, not typing/modal, no Shift/Alt/Ctrl/repeat); Ctrl+Y redo unchanged.
- State is session-only (not persisted); a mode is not a gesture, so Escape/tool switch leave it; the centre is derived from live MAP_WIDTH/HEIGHT so map replacement needs no reset (tested). Stale rect highlight cleared on commit and by setActive.
- CHANGELOG bullet added. perf-baseline.json untouched.

Tests (tests/paint-tools.spec.ts, 20 new, 'symmetry (T2.5)')
- both brief tests; independent pixel-geometry reference (reflection/clockwise rotation of Canvas.hexCenterWorld centres about the centre cell, exact set incl. clipping) for all modes on 12x10, 13x9, 9x13, 10x12, 451x451, 450x451, 451x450, 450x450; agreement with symmetryCubes for a radius-12 brush (469 cells); centre/axis not doubled; one undo step; clipping at the corner; noSymmetry and multi-tile bypass; rect writes 18 cells in one step and preview layer exists mid-drag/dropped after; guide dash/stroke counts; hover cursor draws +3 hexes +2 guide lines (moveTo count); expansion size for radius 12 x rot6 (work, not time); palette placement, canvas width unchanged, Y/typing/Ctrl+Y; map replacement.
- RED/GREEN: code was written before the tests (no initial RED). Mutation check: disabling the expansion in _applyTerrainCells and the preview made 7 of the new tests fail; restored, all 19 (then 20) pass.
- Fixes during test writing were test-side only (cells off-screen at first; water edge ids).

Full default suite (once): 368 passed, 5 skipped, 0 failed, wall 2.3 min (140 s); no "startup retries" line in output; uptime: load averages 9.29 6.78 5.88.

Concerns
- Rect preview copies not drawn for rectangles above 4000 cells.
- Fill is not symmetric (not part of applyTerrainCells); bridges single-tile.

## Fix round 1
Code
- Rect drag: `setSymmetry` refreshes the rect copies; turning symmetry off clears the `shape` layer (`_previewRectSymmetry`). Rect drag records map identity (`_beginShape`), `_onMove`/`_onUp` cancel with `_cancelStale()` (also resets `_rectStart`/`_toolsRectPreview`) and a toast instead of rebuilding from the old start.
- Hover cursor expansion cached by (cursor cell, mode, brush radius, map size); at LOD 2 the symmetric cursor draws 3px marks (non-symmetric output unchanged).
- `#symmetry-select` no longer counts as typing (Y cycles with it focused); tooltip and CHANGELOG disclose the even-height centre-cell edge loss.
- `Canvas.getHighlightPoints(name)` read-only snapshot for tests.
Tests (28 symmetric tests now)
- Fixed vacuous ones: canvas width compared to the fixed 1491 at 1400x900 with the mode active; Ctrl+Y now runs after the input is removed with a real undone step (redo ran, mode unchanged); map replacement now assigns a 12x11 map and checks against the pixel reference; rect mid-drag preview asserts 18 points at the exact pixel-mirror positions.
- Added: 12x11 and 11x12 in the per-cell pixel test; unconditional multi-tile bypass; symmetry off mid-rect; map replaced mid-rect (toast, no write, no step); line/circle/polygon commits and previews mirror-closed, one step each; hv axis cell = 2, centre = 1; far copy neighbour re-resolved (EdgeTiling calls include mirrored neighbour); cursor expansion counted (1 for 6 renders, +1 after radius change); Y with select focused, text input, Shift/Alt.
Mutation checks (each restored from a saved copy; at least one test fails each)
| Mutation | Failing tests |
|---|---|
| Y handler disabled | 2 (h-mirror/Y cycles, Y cycles/typing/Ctrl+Y) |
| guide draws nothing | 2 (guide dash counts, hover moveTo count) |
| centre cached from first map | 1 (map replaced by different size) |
| cursor preview expansion disabled | 2 (moveTo count, expansion count) |
| line/circle preview unexpanded | 1 |
| polygon preview unexpanded | 1 |
| rect preview unexpanded | 2 |
| noSymmetry ignored | 1 |
| multi-tile bypass removed | 1 |
| rect symmetry-off clear removed | 1 |
| rect stale: both guards removed | 1 (each guard alone is covered by the other, so only the combined mutation fails) |
| cursor cache key ignores radius | 1 |
| select not exempt from typing guard | 1 |
(An earlier first attempt of "centre cached" had a syntax error and broke all tests; redone correctly above.)
Runs: covering specs (paint-tools, hex-utils, perf-equivalence) 105 passed, 1 skipped. Full default suite once: 376 passed, 5 skipped, 0 failed, 2.4 min (144 s), no `startup retries` line, uptime load 8.20 7.38 5.75. perf-baseline.json untouched.
