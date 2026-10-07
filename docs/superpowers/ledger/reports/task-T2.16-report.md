# T2.16 report: Bridge tool (U)
Commits: 3bc3c56 (RED tests), aaa4339 (feature + CHANGELOG), plus one test commit (footprint refusal test).

## API / decisions
- Tool `'bridge'`, button `data-tool="bridge"` (icon bridge, title "Place Bridge (U)") in the LEFT palette row `#shape-tools` after Erase Road (ruling a); canvas stays 1491 px at 1400x900 (tested). Key U via `CODE_TOOLS` (KeyU; no Shift/Alt/Ctrl/repeat, `_isTypingOrModal(e)`); no collision (audit: no `u` anywhere in the key switch; the all-letters test shows every other letter unchanged). TOOL_NAMES 'Place Bridge'.
- Lazy-stroke pattern: 'bridge' is in `_LAZY_STROKE_TOOLS`; `_onDown` case calls `_beginLazyStroke()` then `_placeBridge`; `_pushOnce()` runs only right before the write (refusals leave no step). Stale-map toast: 'Bridge tool stopped — the map changed'. Blur/stale/Escape/isStroking/`_opBlocked`/fill-busy all come from the shared stroke state. No per-tool "last painted" state (a bridge press acts on the pressed tile only), so nothing to reset.
- `_populateBuildingPicker(mode)`: 'bridge' lists only `buildingCategory === 'Bridge'`; own selection `_selectedBridgeId` (`Tools.getSelectedBridgeId()`), auto-preselects the first, independent of the object selection. `selectBuilding` follows the ACTIVE tool (bridge active: Bridge-category ids only, else toast 'Not a bridge building'; unknown id still 'Unknown building'; with another tool active it is the object selection as before). Picker position/clamp/resize anchor on the bridge button in bridge mode; Escape and outside click close it for both tools; cards unchanged (tabindex, Enter/Space, `_ownsOwnKeys`).
- Empty bridge list: `setActive('bridge')` toasts 'No bridge buildings available' and returns before changing anything (tool, picker, buttons unchanged).
- `_placeBridge`: river tile (`_isRiverTile`, hex type 'Rivers'; K1-family limits not fixed) else refusal 'Bridges can only be built on river tiles' (once per stroke via `_objRefuse`); a river tile under another terrain's multi-tile footprint is refused like the building tool; same bridge again removes it; any other building/bridge there is replaced (old satellites removed); one History step. Bridge buildings have no satellites (checked in the DB data and by test).
- One tap per press: a drag acts on the pressed tile only (like the road tools; a drag-toggle would delete on the way back).
- Bridge already standing on a non-river tile (pasted/stamped/legacy): the bridge tool refuses it (strict rule), Erase Building and the Eraser remove it; copy/paste keeps the id; rendering is fine (tested).
- CHANGELOG bullet under Unreleased > Behaviour changes.

## Test-environment finding
The shipped package has ONE bridge building (`Road_Bridge_NEWS_1`); the brief's `Road_Bridge_NS_1`/`SENW_1` do not exist at runtime (they appear only in building_database.json at the repo root). Tests fabricate two extra Bridge-category entries by wrapping `BldDB.getAll` (same technique as the satellite radius test). Also found: painting an isolated River/Lake tile through the real paint path edge-resolves it to a `Water` tile, so the tests write river ids directly.

## Tests (tests/object-tools.spec.ts, 'bridge tool (T2.16)', 21 tests)
RED against the base HTML (aaa4339's parent): 19 failed, 1 passed (Erase Building / Eraser removing bridge objects: regression guard of existing behaviour). Before the left-button and fill-busy tests got a positive control they also passed vacuously; the controls (a left click does place; after the fill the same click places) make them RED at the base. GREEN: 21 passed. Independent references: hex ids from hex_database.json types, pixel geometry for cells, History counts, canvas pixel hashes (settled by consecutive renders, no wall-clock). Redo canvas == original with-bridge canvas was not asserted (first render after a restore differed in unrelated pixels with directly written river tiles); with/without and undo/redo repeatability are.

## Mutation table (restored from a saved copy, cmp-verified; failing = of the 21 bridge tests)
1 not in lazy set: 3; 2 no `_beginLazyStroke` in the case: 7; 3 `_pushOnce` after the write: 6; 4 land allowed: 4; 5 refusal toast every time: 11; 6 same bridge does not toggle: 1; 7 old satellites kept on replace: 1; 8 KeyU unmapped: 2; 9 bridge picker lists non-bridges: 1; 10 bridge selection shared with the object tool: 1; 11 bridge-mode `selectBuilding` unvalidated: 1; 12 empty list still activates: 1; 13 generic stale toast: 1; 14 outside click ignores bridge: 1; 15 Escape ignores bridge picker: 1; 16 picker anchored on the object button: 1; 17 footprint check removed: 1 (needed a new test, added); 18 button removed: 4. 18 of 18 caught.

## Full default suite (once, after aaa4339, with the footprint test included in the tree)
825 passed, 5 skipped, 0 failed (830 tests = 804+21 new +5 skipped), wall 5.0 min (5:01.7), no retry lines reported (the grep hits are test names), uptime load ~11.7 after. perf-baseline.json untouched; no background runs left; test-results left out of commits.

## Not done / honesty
- Kept to one tap per press; no drag bridge building.
- K1 limits of `_isRiverTile` (type-only) not fixed; edge resolution can turn a lone river tile into Water, after which bridges are refused there.
- Redo-pixel-equality not asserted (above). The footprint test commit was made after the suite run only for the test file that had already been in the tree during the run (no changes after the run).
- Used `git checkout -q test-results/.last-run.json` (implementer-rules form) before commits; no `git checkout --` on source files, no stash.
