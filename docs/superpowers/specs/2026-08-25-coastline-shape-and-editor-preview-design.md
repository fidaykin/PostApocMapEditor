# Coastline Shape Controls & Editor Preview — Design Spec

**Date:** 2026-08-25
**Project:** Post Apo Map Editor (MapEditorPro.html)
**Problem:** Two related gaps in map authoring. First, the `Generator`'s continent/coastline mask (landmass radius, coastline wobble, land→ocean blend band) is hardcoded — a designer can only reroll the seed, not shape the coastline. Second, Unity renders a directional coastline decoration (`CoastlineManager`/`CoastlineEdgeDetector`, 6 edge sprites) live at runtime wherever a Water tile borders Ground, but the web editor shows none of this — a designer tuning a map has no visual parity with how the coastline will actually look in-game until they import and play the map in Unity.

---

## Relationship to prior work

This builds on `2026-08-03-terrain-generation-overhaul-design.md` (added the continent mask, elevation/moisture fields, river carving) and `2026-08-03-river-tile-autotiling-design.md` (added the `EdgeTiling` resolver that turns carved river cells into correct directional `River_*`/`Lake_*` tiles). Both are already implemented and shipped on `dev` (commits `fdb466f`, `fdb174d`, `51b3e29`, `34c87a6`, among others) — river tile generation itself is **not** touched by this spec.

The river-tile-autotiling spec explicitly marked ocean/land coastline edges **out of scope**, reasoning that Unity already renders them automatically at runtime from correctly-typed water tiles, so the web editor needs no coastline logic of its own. That reasoning still holds for the *game* — Unity needs nothing new. This spec revisits it for the *editor*: a designer tuning coastline shape and river mouths wants to see the same decoration Unity will show, without switching to Unity to check. Part B below is a deliberate reversal of that one "out of scope" line, not an oversight.

---

## A. Coastline shape controls (Generator)

Three constants inside `Generator._generateInto`, currently hardcoded, become sliders in the existing "🎲 Procedural Generator" modal, in a new "Coastline" section alongside the existing Thresholds/Features sections:

| Slider | Backs | Range | Default (= current hardcoded value) |
|---|---|---|---|
| Coast Radius | `COAST_BASE_R` (as a fraction of `maxR`) | 0.50 – 0.95 | 0.72 |
| Coast Wobble | `COAST_WOBBLE` | 0.00 – 0.60 | 0.28 |
| Coast Band | `COAST_BAND` (as a fraction of `maxR`) | 0.05 – 0.35 | 0.20 |

Wiring follows the exact pattern already used by every other slider in this modal: `oninput="Generator.schedule()"`, read in `_getParams()`, passed through to `_generateInto`, and reflected live in the existing debounced preview canvas — no new preview machinery needed. Defaults match today's hardcoded values so no existing generated map's expected shape changes until a slider is actually moved.

Not included (kept out to stay minimal): multiple islands, off-center landmass, or non-radial coastline shapes. The model stays "one radial blob with wobble," just tunable now instead of fixed.

---

## B. Coastline visual overlay in the web editor

**Assets:** Copy the 6 existing Unity sprites (`Assets/_Project/Sprites/Coastline/Coastline_0_UpperRight.png` … `Coastline_5_Top.png`) into `sprites/terrain/coastline/` in the web editor, matching the existing `sprites/terrain/roads/` convention for a directional-overlay sprite family living under `terrain/`.

**Edge detection (JS port of `CoastlineEdgeDetector.ComputeCoastlineEdges`):**
For every rendered cell whose `HexDB` type is `'Water'` (not `'Rivers'`), check each of its 6 neighbors via the existing `_DIRS_EVEN`/`_DIRS_ODD` offset tables:
- Neighbor is `Rivers`-type → suppress the edge unless the river's water-channel side (its `edgeFaces`, née `waterFaces`) faces back toward this water cell — port of `RiverFacesWater`, reusing the same face-name → direction convention already established in `EdgeTiling` (`SE=0, NE=1, N=2, NW=3, SW=4, S=5`), so no new direction convention is invented for this feature.
- Neighbor is `Water`-type → no edge (open water doesn't get a coastline against itself).
- Neighbor is anything else (Ground, buildings, etc.) → edge visible in that direction.

**Rendering:** In the hex canvas draw path, after the base tile sprite is drawn, draw the matching `Coastline_N_*` sprite(s) on top for every visible edge, positioned identically to the base tile — mirroring `CoastlineManager`'s per-edge multi-sprite placement (a peninsula tip can show 2+ edges on one cell). Only computed/drawn for cells inside the current viewport, consistent with the editor's existing culling — no new performance concern at 450×450.

**Toggle:** New "🌊 Coastline" button in the same toolbar family as Zone Painter's "👁 Overlay", default **on** (the point of this feature is WYSIWYG parity by default; a designer who wants a clean look at raw terrain IDs can turn it off). Purely a rendering flag — never touches `mapData` or the exported JSON.

**Recompute:** Edges are derived live from `mapData` on every draw, the same way Unity computes them live from `TileData` — no separate persisted layer, no invalidation logic needed. Existing re-render triggers (paint, fill, generate, resize, load) all naturally pick it up.

---

## Data flow summary

```
Generator (procedural):
  Coast Radius/Wobble/Band sliders → _getParams() → _generateInto()
  → replaces hardcoded COAST_BASE_R/COAST_WOBBLE/COAST_BAND
  (river carving + EdgeTiling resolution: unchanged, already shipped)

Web editor render loop (every frame, visible cells only):
  for each Water-type cell on screen:
    compute 6-edge mask (JS port of CoastlineEdgeDetector)
    draw base tile sprite, then draw Coastline_N sprite per set edge bit
  gated by "🌊 Coastline" toggle (default on)
```

---

## Testing / validation

Matches this project's existing convention — no automated test harness; manual/visual verification via the local dev server:

- Move each new Coastline slider and confirm the generator's live preview canvas shape changes accordingly (bigger/smaller radius, more/less irregular wobble, wider/narrower land→ocean blend).
- Generate a map whose rivers reach the coast; confirm the new overlay renders correctly along the ocean/land boundary and correctly suppresses edges at river mouths, matching the suppression logic Unity already uses.
- Side-by-side comparison: load the same map in the web editor (overlay on) and in Unity Play mode, spot-check a handful of coastal cells to catch any direction-index mismatch between the 6 sprite names and the `edgeFaces` compass labels.
- Toggle "🌊 Coastline" off/on; confirm `mapData`/JSON export is byte-identical either way.
- Confirm Zone Painter, manual paint/fill, and the (already-shipped) river auto-tiling are unaffected.

---

## Out of scope

- River tile generation — already implemented, untouched by this spec.
- Any Unity-side change — `CoastlineManager`/`CoastlineEdgeDetector` are the reference behavior being mirrored, not modified.
- Multi-island or non-radial continent topology.
- New coastline sprite art — reuses the 6 existing Unity sprites as-is.

---

## Success criteria

- Coast Radius/Wobble/Band sliders visibly and predictably change the generated landmass shape, live in the preview.
- The web editor shows the same directional coastline decoration Unity renders, for every Water cell bordering Ground, live while editing or after generating — without needing to open Unity to check.
- No change to the JSON export format, Unity import, or any already-shipped generator/river/zone behavior.
