# Task report: no water-body logic in the hand tools; "Decameroon_Rift_1_copy paints water"

Branch feature/editor-roadmap, base a0e83fa (= origin/dev). Commits:

- c6c95ae feat(tools): hand-painting tools no longer re-resolve river/lake pieces, shores or rock water
- 02685ef docs: hand tools place the exact tile, only the generator fits river pieces (EN/UK guides, changelog)
- ff81090 fix(hexdb): a pasted or reskinned tile is paintable at once; biome kept on edit; scatter families skip the package prefix
- 4a50b4f docs(changelog): HEX DB copy / Reskin+ and package scatter fixes
- (this report)

## Request 1: water-body logic removed from every manual tool

### The single switch

`Tools` (MapEditorPro.html, next to `_autoResolveEdgesAround`):

```js
const AUTO_WATER_EDGES = false;
function _manualEdgesAround(cellsPainted) { if (AUTO_WATER_EDGES) _autoResolveEdgesAround(cellsPainted); }
```

Exported as `Tools.AUTO_WATER_EDGES` and `Tools.manualEdgesAround`. `Tools.autoResolveEdgesAround` stays exported for the
generator paths. Nothing was deleted (EdgeTiling, `_autoResolveEdgesAround`, `_packageWaterFallback` are still used).

### Call sites switched (each skipped in one place)

| Site | Tools covered |
|---|---|
| `_writeTerrain` (end) | Paint click/drag incl. brush radius and symmetry, Rectangle, Line, Circle, Polygon (all via `_applyTerrainCells`), Scatter (`_scatterStamp` -> `_writeTerrain(picks, null)`) |
| time-sliced Fill (after the flood loop) | Fill (the old "edge pass" of the chunked fill) |
| `replaceTerrain` | Replace dialog and the H tool |
| `_resetCells` | Eraser (reset to Plain_1 no longer re-resolves neighbours), the source cells of a Move |
| `Clipboard.write` (border / transformed re-resolution block) | paste, move drop, stamp placement (`Tools.AUTO_WATER_EDGES` early return; the remaining old block ends in `Tools.manualEdgesAround`) |

Kept on the resolver (unchanged): `Generator.apply` (worker, map-jobs.js, untouched), `Generator.applyToRegion`
(generate into selection, calls `Tools.autoResolveEdgesAround`), and ZonePainter's `_finishTerrainWrite` (Fill Zones /
Randomize & Fill: procedural terrain from zone presets, not a hand tool; zone-painter.js untouched, so no `?v=` bump).
The Coastline overlay is view-only and untouched. Loading never rewrote tiles and still does not. History / undo / lock /
footprint / satellite code is untouched. No served script changed (map-jobs.js, gen-utils.js, zone-painter.js), so no
`?v=` or deploy tie changes.

Scatter (T2.7): its variant randomisation is not edge logic and is kept. It excludes directional pieces from the variant
list; the comment said "edge re-resolution overrides the pick" and now says directional pieces are never scattered at
random (the behaviour is the same).

### Tests (RED then GREEN)

New `tests/manual-no-water-logic.spec.ts` (19 tests). Scene: a 41x41 field of one directional river piece D with a
radius-3 disc of flat Water_1; `Math.random` pinned. Per tool: written cells hold the selected id, a whole-map diff
against the pre-gesture snapshot equals the intended cell set from an independent reference (pixel-adjacency BFS on
`Canvas.hexCenterWorld`, grid rectangles, the buffer's cube offsets through HexUtils), and one `History.undo()` restores
the map. Tools: Paint click (flat water and a river piece placed as-is), Paint drag radius 1, Paint radius 2 with mirror
symmetry, Fill (water and a piece), Rectangle, Line, Circle, Polygon, Scatter, Replace (water and piece-for-piece),
Eraser, paste, move, stamp placement, plus `Tools.AUTO_WATER_EDGES === false`. Generator: generate-into-selection still
calls `EdgeTiling.resolveEdgeTile` around the region; seed 42 `Generator.apply` hash equals `generator_seed42` of
tests/perf-baseline.json (read only).

RED: with the switch flipped to `true` (= the old behaviour; restored from a saved copy and `cmp`-checked) 17 of 19
failed (every hand-tool test and the switch test); the two generator tests passed. GREEN: 19/19 with the switch off.
(A first run also failed 5 gesture tests for a test bug: cells off screen at 100 %; the scene now zooms to 50 %.)

### Existing tests changed to the new contract (each with an explanatory comment in the file)

- tests/paint-tools.spec.ts
  - "Rectangle re-resolves directional river tiles" -> "Rectangle writes the chosen directional river piece as-is":
    was resolver calls > 0, now 0 and all 15 rectangle cells hold the piece.
  - "painting land over a river re-resolves its directional neighbours" -> "... leaves its directional neighbours
    untouched": was the neighbour in the resolver's call list, now no call and the neighbour keeps the piece.
  - K1 "edge re-resolution reaches every cell whose mask reads the painted cell (H=450/452)" -> same check through
    `Tools.autoResolveEdgesAround` (the generate-into-selection path), keeping the K1 legacy-adjacency coverage of the
    resolver that the generator still uses. Assertions unchanged.
  - symmetry "a far copy has its neighbours re-resolved" -> "neither the far copy nor the near one re-resolves its river
    neighbours": both copies painted, no resolver call, both neighbours keep the piece.
  - eraser "river tiles next to an erased cell match resolveEdgeTile (and do change)" -> "keep their ids and the resolver
    is not called": changed 0, calls 0, the erased cell is Plain_1; `checked > 0` kept.
  - scatter multi-tile test: the last part "edges next to scattered water re-resolve" -> the river next to the scattered
    water keeps its id, no resolver call. All multi-tile / bridge assertions unchanged.
  - unchanged and still passing: "Rectangle over a river equals painting the same cells one by one" (both now write the
    same thing; the band is still built with the resolver).
- tests/selection.spec.ts
  - "edge re-resolution is limited to the pasted region border" -> "a paste writes the copied tiles exactly and hands no
    cell to edge re-resolution (border included)": no `autoResolveEdgesAround` / resolver calls, nothing outside the 49
    placed cells changes, every buffer cell lands at cube(target)+offset with its id (river pieces all around the target).
  - full-map paste of 202,500 cells: `calls: 1` -> `calls: 0` (comment); other counters unchanged.
  - "a transformed paste re-resolves EVERY water / river cell" -> "a transformed paste writes the copied ids as they are
    (no resolver call), whatever the rotation": identity / rot1 / rot2 each place 147 cells with the source id multiset,
    nothing outside changes, 0 resolver calls.
  - replace "water/river edges are re-resolved after a replace ... ARE rewritten" -> "a replace changes only the replaced
    cells: the river pieces next to them keep their ids, no resolver call" (adjacent band cells are still computed with
    true + legacy adjacency; the far band check is unchanged).
  - "replacing land with a directional river tile re-resolves it and its river neighbours" -> "... writes that tile
    as-is and leaves its river neighbours alone".
  - "a big water replace re-resolves only the cells next to the replaced river pieces" -> title only ("does no edge
    work"); assertion (0 resolves) unchanged.
- tests/package-water.spec.ts (c09ebaf's package-aware tests): the describe now asserts NO re-resolution in a package:
  Paint (lake piece placed as-is; flat water next to the authored shore leaves the shore piece), Rectangle / Fill /
  Replace / Scatter each change exactly their own cells (whole-map diff) with 0 resolver calls; Scatter cells are flat
  Decameroon water. New "generator path" test: `Tools.autoResolveEdgesAround` still re-resolves a Decameroon shore with
  Decameroon pieces only (the c09ebaf behaviour, now generator-only). The mixed-package Coastline test and the seed-42
  generator test are unchanged.
- Not changed: edge-drift.spec.ts (generator port vs. EdgeTiling, unchanged), perf baselines (untouched), generation.spec.

### Docs

CHANGELOG (Unreleased, Editing tools): "Hand-painting tools no longer re-pick river/lake pieces, shores or rock water;
place the exact tile you choose. The map generator is unchanged." EN/UK guides: the undo paragraph now says the hand
tools place exactly the chosen tile and only the generator fits river pieces; the Publish paragraph lost the sentence
about package-aware re-resolution of painted water. HTML regenerated with `node scripts/build-guides.js`; docs-lint and
help-menu specs pass.

## Request 2: "Decameroon_Rift_1_copy а малює воду"

### Reproduction

Read-only GET of the live packages/decameroon/hex_database.json and packages/postapoc/hex_database.json and the live
Decameroon sprites into the scratchpad. A probe spec served them through the fake GitHub, selected Decameroon_Rift_1 in
HEX DB, pressed Copy and Paste (the real `HexDB.copy()/paste()`), and painted on a Decameroon map (code at a0e83fa).

Evidence:

- The copy is `{"id":"Decameroon_Rift_1_copy","type":"Volcanic/Rift","biome":"Decameron","spriteName":"Decameroon_Rift_1",
  "package":"decameroon","edgeFaces":[], ...}` (a structuredClone with `_copy` appended). Painting it stores
  `Decameroon_Rift_1_copy`; `Terrain.byHexId` gives type Volcanic/Rift; after a reload its sprite is
  `.../packages/decameroon/sprites/hex/Decameroon_Rift_1.png`, the same file as the original. No code parses `_copy` as
  a variant or derives a family from the id for drawing; `Terrain.color` falls back to the plain colour; nothing maps it
  to water. The data is not water (copied from a rift, type unchanged).
- Painting into a Decameroon lake (water block with a Decameroon_Lake_3 shore row, `Tools.applyTerrainCells` at (15,11)):
  - copy: `14,10 / 15,10 / 16,10: Decameroon_Lake_3 -> Decameroon_Water_1`, `15,11: Decameroon_Water_1 -> Decameroon_Rift_1_copy`
  - original Decameroon_Rift_1 at the same spot: the identical three shore pieces turn into Decameroon_Water_1.

Root cause: the hand-tool edge re-resolution. A painted cell that held lake water hands its directional neighbours to
`_autoResolveEdgesAround`; their new mask has no Decameroon piece, so `_packageWaterFallback` writes flat Decameroon
water: painting a rift "paints water" around itself. It is identical for the original tile; the copy was simply what the
owner tried. Request 1 removes it (test: hexdb-copy-tile.spec.ts "painting the copy into a lake writes only that cell";
it passes since c6c95ae; RED evidence is the probe output above on a0e83fa).

### Independent defects found and fixed (ff81090), RED then GREEN

New `tests/hexdb-copy-tile.spec.ts` (10 tests, live data shape, sprites on the fake server):

1. Paste and Reskin+ never loaded the new entry's sprite nor rebuilt the palette: in the probe the copy had
   `spriteState 'unknown'`, no palette button, and painted as an empty dark (#444) hex until a reload or a field edit.
   Fix: `_loadNewEntrySprite(h)` (applyHexDbOverrides + buildPalette + render) after Paste and Reskin+. RED: both tests
   timed out waiting for the sprite; GREEN.
2. Editing any field of the copy rewrote `biome: 'Decameron'` to `'Summer'`: the biome select has no 'Decameron' option,
   shows the first entry, and `_readRecord` reads every field. Fix: `_selectInput` (and BiomeManager's live refresh of
   that select) keeps a current value that is not in the list as its own option (text escaped). RED: received 'Summer'.
3. The selected-tile preview used `packages/postapoc/sprites/hex/<spriteName>.png` for any tile whose sprite was not
   loaded (a 404 for package tiles). Fix: `Packages.spriteSrc(t, 'hex')`. RED shown by reverting the line (from a saved
   copy, cmp-checked): the preview test failed; GREEN after restore.
4. Scatter took the first `_` segment of the id as the family, which for package tiles is the package prefix: every
   Volcanic/Rift tile of Decameroon (Lava_Plain, Lava_Rift, Rift, the copy) was a variant of the rift. Fix:
   `_scatterFamily` skips `Packages.idPrefix(pkg)` first (Decameroon_Rift_1 -> 'rift'); suffixes such as `_copy`, `_2x`,
   `_Copy_3` never matter. Base families are unchanged (Water_1 still has Water_Dirty_1 etc.). RED: variants had 2 extra
   ids; GREEN. Clones with the three suffixes are stored, typed, drawn with the same sprite file and scattered as the rift.

Changelog bullet added (4a50b4f).

## Self-review

- Diff read: switch in one place, five call sites, comments explain the decision and where the resolver still runs.
- No top-toolbar or layout change; DOM APIs untouched except the HexDB select markup (string template, now escaped).
- tests/perf-baseline.json untouched; no served script touched.
- Concern / owner decision: ZonePainter fills (Fill Zones, Fill This Zone, Randomize & Fill) still re-resolve edges: they
  write procedural terrain from zone presets, closer to the generator than to a hand tool, and the brief did not list them.
  Switching them is one line (`_finishTerrainWrite`) plus a `?v=` bump of zone-painter.js if the owner wants it.
- Old Unreleased CHANGELOG bullets that describe the earlier re-resolution (Rectangle/Fill/shapes/Scatter/Replace) were
  left as history; the new bullet at the top of Editing tools states the current behaviour.

## Full suite

`npx playwright test` once at 4a50b4f (default config, list reporter): **1670 passed, 5 skipped (opt-in measurement
specs), 0 failed, 0 flaky**, wall 9.7 min, `startup retries: 0`, `machine sleeps during the run: 0`, exit 0. Load
averages: start 6.97 / 12.68 / 10.50, end 11.33 / 10.47 / 10.10. No sleeps or re-runs needed.
