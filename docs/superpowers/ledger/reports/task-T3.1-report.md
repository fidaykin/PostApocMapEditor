# T3.1 report
Added `HexUtils.edgeDistances(sel, W, H)` and `HexUtils.blendWeight(d, width)` (hex-utils.js).
- `sel` is a Set of "col,row" keys (returns Map) or a W*H Uint8Array mask (returns Uint16Array, 0 outside).
- Boundary = in-map neighbour outside the selection (via `HexUtils.neighbors`, not legacy tables); map-edge cells are not boundary.
- Whole-map / no-boundary selection: every cell gets NO_EDGE (65535) so weight is 1 (ruling T3.1; the brief's code gave 1/(width+1)).
- Tests (tests/hex-utils.spec.ts, 2 new): radius-5 disc histogram {1:30,...6:1}, Set and mask agree, nothing outside the mask, weights [1,0.25,1,1]; 12x10 whole map weight 1 for Set and mask, positive control (partial disc gives 1/5), corner-disc cell distance > 1.
- Evidence: tests were written after the implementation (no RED run captured). Sanity mutation NO_EDGE=1 made 1 test fail; restored (cmp).
- Focused run: `npx playwright test tests/hex-utils.spec.ts`: 21 passed, 1 skipped (pre-existing fixme).
- hex-utils.js `?v=1` not bumped (previous hex-utils changes did not bump; flagging for the controller).
