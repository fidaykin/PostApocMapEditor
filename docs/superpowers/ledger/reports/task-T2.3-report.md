# T2.3 report: larger brush sizes and shortcuts

Implemented: Brush is a true hex disc, radius 0..12 (`Brush.MAX_SIZE`), `setSize` clamps (NaN -> 0), `grow`/`shrink`, `patternBuilds()` (work counter). K3 fixed: offset patterns are built from HexUtils per (radius, parity of cube q); q parity folds in row parity and H parity. Panel gets a 0..12 slider + "Radius n (N tiles)" label; presets 1/3/5/7 buttons kept (slider/buttons sync).
hex-utils.js: discCells/ringCells use a no-dedup, no-Set, no-intermediate-cube fast path (fromCube is a bijection); API unchanged. discCells radius 450 on 450x450 (202,500 cells) = ~6 ms (was ~200 ms).
Hover preview: all brush hexes in ONE path (single fill + stroke instead of 2 clip-paths per tile); same tiles as paint (same Brush.getAffectedTiles); LOD overview path draws overlays after the same code, radius scales with zoom, so low-zoom is cheap (max 469 hexes).

## Shortcuts (all by e.code, layout independent)
- `[` (BracketLeft) shrink, `]` (BracketRight) grow. Ignored with Ctrl/Meta/Alt, when an INPUT/TEXTAREA/SELECT/contenteditable has focus, when any `.modal-overlay` or `*-modal` element is displayed (incl. dialog-modal, gen/sat/gh/loc/pkg modals), and outside `body.mode-map`.
- No collisions: existing P F R E S T D Z (still by e.key), Ctrl+N/O/S/Z/Y, Ctrl+Shift+Z, Tab, Space-drag untouched. docs/guide_en.html is stale and was not edited.
- Not persisted: the brief specifies no persistence, size resets to 0 on load (freshEditor also sets 0).

## Tests (tests/paint-tools.spec.ts "brush sizes and shortcuts (T2.3)", tests/hex-utils.spec.ts)
RED first (before implementation): 7 of 15 new brush tests failed (451x451 and 450x451 K3 parity vs pixel-BFS reference, clamp, shortcut, slider, input/modal guards, work counter); 13x9, 9x13, 450x450, 451x450 happened to coincide with the old parity.
GREEN: reference = BFS over Canvas.hexCenterWorld pixel adjacency, 6 map sizes x radii 1/2/5 x 4 centre parities; clamping; edge clipping; keys via dispatched KeyboardEvent with Ukrainian characters (code-only dependence, KeyA with '[' does nothing); input/select/modal/ctrl/mode guards; slider; preview calls getAffectedTiles once; radius-3 click paints exactly 37 tiles, one undo; work counter: 400 moves at radius 12 build <=2 patterns and add 0 Set entries; discCells/ringCells radius 150 add 0 Set entries (ring = 900); fast path equals the dedup reference on 4 map sizes in/out of bounds.
Full default suite: `npx playwright test`: 309 passed, 5 skipped, 0 failed (2.0 m). perf-baseline.json untouched.

## Cost of a huge brush (not reachable via UI, MAX 12)
Measured in Chrome: radius-450 on 450x450: discCells 6 ms; Tools.applyTerrainCells of 202,500 cells ~65 ms (< 100 ms), so no time-slicing needed.

## Files
MapEditorPro.html, hex-utils.js, tests/paint-tools.spec.ts, tests/hex-utils.spec.ts, CHANGELOG.md.

## Concerns
- Pre-existing tool-letter shortcuts still use e.key (not layout independent) and have no modal guard; out of scope.
- Preview strokes overlap shared edges (as before).

## Fix round 1
- Important 1 (focus trap): the Tools keydown handler now handles `[`/`]` before the INPUT/TEXTAREA guard, and `_isTypingOrModal` treats range/checkbox/radio/button inputs and BUTTON as non-typing (text inputs, textarea, select, contenteditable still block). Slider also blurs on `change`. Tests: fill('7') then real BracketRight -> 8; focused slider + BracketLeft -> 7; a real text input still blocks. (These were written after the fix, so no separate RED run was captured.)
- Important 2: K3 reference rewritten: pixel-adjacency vectors measured from Canvas.hexCenterWorld, BFS over an UNCLIPPED virtual lattice, then filtered by radius and map bounds, compared cell by cell for radii 0..12 at 4 corners, 4 edge midpoints and centre parities on 451x451, 450x451, 451x450, 12x10, 13x9 (all pass, about 1 s per map).
- Minors: ringCells restored to the original cubeRing walk order (no Set, clipped in walk order; order assertion added in hex-utils.spec.ts; discCells fast path unchanged and still dq-major as before); `e.repeat` ignored and no render when the size did not change; label singular "1 tile" in HTML and setSize, and `Brush.setSize(Brush.getSize())` is called after Tools.init; hover test now spies fill/stroke/getAffectedTiles during Canvas.render (cursor off vs on: exactly +1 fill, +1 stroke, 1 getAffectedTiles call) and uses a real `Canvas.setZoom(100)`. CHANGELOG notes 3x3/5x5/○7 = radius 1/2/3.
- Results: paint-tools + hex-utils 31 passed, 1 skipped; full default suite `npx playwright test`: 311 passed, 5 skipped, 0 failed (2.0 m), which includes perf-equivalence and edge-drift. perf-baseline.json untouched.
