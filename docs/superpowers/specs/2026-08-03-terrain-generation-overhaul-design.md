# Logical Terrain Generation — Design Spec

**Date:** 2026-08-03
**Project:** Post Apo Map Editor (MapEditorPro.html)
**Problem:** The existing global procedural `Generator` (5 noise presets, `_makeNoise2D`) produces maps that look like a noised array of tiles rather than a logical landscape — both small-scale (salt-and-pepper speckling, no clustering) and large-scale (biome placement, mountains, rivers, and coastlines don't relate to each other geographically).

---

## Relationship to existing tools

This is **not** a replacement for the Zone Painter (`2026-06-04-zone-biome-map-filling-design.md`). Zone Painter is a semi-manual workflow — the designer paints zone boundaries by hand, then each zone auto-fills from a chosen biome preset. This spec fixes the *other* existing tool that Zone Painter's own problem statement names as existing-but-limited: the **global** procedural `Generator`, used to produce a full 450×450 landscape with a single click and no manual zone painting. After this generator runs, Zone Painter (and the existing paint/fill/rectangle tools) remain available for manual touch-ups on top, unchanged.

**Scope:** terrain generation only — biome layout, elevation, rivers, coastlines, resource veins. Settlement placement and road networks are explicitly out of scope; they're a candidate follow-up spec once this lands.

---

## Where this lives

This replaces the internals of the existing `Generator` module in `MapEditorPro.html`. The modal, the 5 preset buttons, and the live-preview canvas are unchanged. Only the core algorithm — `_makeNoise2D` and the direct noise-value-to-terrain bucketing — is replaced with the pipeline below. The output contract is unchanged: the pipeline still produces a plain `width×height` terrain-id array, so the "New Map" flow, JSON export format, and Unity's `RuntimeMapLoader` diffing need zero changes.

---

## Pipeline

Six pure functions (grid in → grid out), run in this order:

### 1. Continent mask
A low-frequency radial/blob field centered roughly on the map, giving a rough coastline instead of land filling the whole square. Cells far outside the blob are pinned toward ocean regardless of what elevation noise says.

### 2. Elevation field
Multi-octave smooth noise (real fBm — several octaves of smooth value/Simplex noise summed at increasing frequency, decreasing amplitude), blended with the continent mask so elevation tapers down near the coast instead of stopping abruptly at a hard threshold.

### 3. Moisture field
A second independent smooth noise field, offset from elevation's so the two aren't correlated, nudged upward at low elevation (a proxy for "lowlands/coast are wetter") without needing a true water-distance lookup.

### 4. Biome classification
A lookup table keyed by (elevation band × moisture band) → terrain id, e.g.:

| Elevation | Dry moisture | Wet moisture |
|---|---|---|
| Low | Desert / Barren | Swamp |
| Mid | Plains / Rubble | Forest |
| High | Hills | Hills / Mountain |
| Extreme | Rift | Volcanic |

The 5 existing presets (wasteland/jungle/desert/arctic/volcanic) become parameter sets for this table — each preset biases the band cutoffs and LUT weighting rather than defining a different noise formula. "Desert" biases toward the dry bands; "arctic" biases toward barren/rocky bands. Same preset buttons and names as today; they now steer this table instead of a raw threshold.

Because elevation and moisture are themselves smooth continuous fields, the biomes that fall out of this table form geographically sensible regions on their own — this is what directly fixes the "arbitrary placement" half of the original complaint.

### 5. River carving
Pick N high-elevation seed points, where N comes from the existing "river count" slider already in the modal (no new UI). Walk each downhill via steepest descent (move to the lowest-elevation neighbor each step) until the path reaches existing water (ocean or a lake) or the map edge, marking every cell along the way as river. A seed that reaches a local pit with no lower neighbor simply stops there — no looping, no forced connection.

### 6. Resource clustering
A handful of deposit centers per resource type (gold, oil, etc.), sized from the existing per-resource count controls already in the modal (no new UI), each with a small noise-blob radius, restricted to biome-eligible tiles. Reads as "a deposit" rather than a scatter of random single tiles.

### 7. Smoothing pass
One or two majority-filter passes over the classified grid (each tile becomes whatever biome is most common among its neighbors), erasing any single-tile speckling left over from steps 2–4. This is what directly fixes the "salt and pepper" half of the original complaint.

**Determinism:** the whole pipeline is seeded from the same seed value the modal already exposes today. Same seed + same parameters always produces the same map — this doesn't change from current behavior, and remains important since a human reviews and iterates on the result (regenerate-with-tweaks is a normal part of the workflow, not an edge case).

---

## Performance & live preview

At 450×450 (202,500 cells), this pipeline costs more per cell than the current single-noise-value approach (multiple elevation octaves, a second moisture field, plus the river/resource/smoothing passes).

- The modal's existing debounced live preview renders at a **downsampled resolution** (e.g. every 2nd–4th cell) — enough to judge overall shape and biome layout while dragging sliders, without paying full-resolution cost on every slider tick.
- Rivers and the smoothing pass run only on **final Apply**, at full resolution — they're the most expensive steps and the least useful to see mid-drag.
- Full-resolution generation on Apply should complete well under a second in-browser. If it doesn't once built, that's the first thing to profile before optimizing anything else.

---

## Testing / validation

The web editor has no automated test harness (it's a hand-tested single-file app) — this isn't the place to introduce one. Validation is visual/manual:

- A **debug view toggle** in the generator modal renders the raw elevation and moisture fields as heatmaps, separate from the final biome output. This makes it possible to tell "the noise itself is wrong" apart from "the classification table is wrong" when something looks off, without guessing.
- Manually generate maps across a spread of seeds and all 5 presets, checking specifically for the two original complaints: no single-tile speckling, and biome regions/rivers/coastlines reading as geographically sensible (rivers actually reach water; mountains form contiguous ranges rather than scattered peaks; deserts don't border swamps at random).

---

## Out of scope

- Settlement placement and road networks (candidate follow-up spec)
- Any change to Zone Painter, the manual paint/fill/rectangle tools, or the map JSON format
- Automated/browser-based test coverage for the generator (validation is manual, as it is for the rest of the editor)
- Per-player runtime procedural generation — this generator is a content-authoring tool for producing a single hand-reviewed canonical map; Unity's separate in-game `MapGenerator.cs` (used for actual runtime seed-based generation, if ever needed per-player) is untouched by this spec

---

## Success criteria

- A single-click generate (per existing preset) produces a 450×450 map with no single-tile biome speckling
- Biome regions read as geographically coherent: elevation bands, moisture-driven biome placement, and a real coastline against ocean
- Rivers visibly originate near high elevation and flow to an actual body of water, not scattered water tiles
- Resource deposits read as clusters, not uniform random scatter
- Full-resolution generation completes in well under a second in-browser
- Existing "New Map" flow, JSON export format, and Unity import remain unaffected
