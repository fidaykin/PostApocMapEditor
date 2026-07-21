# Zone Painter with Biome Presets — Design Spec

**Date:** 2026-06-04  
**Project:** Post Apo Map Editor (MapEditorPro.html)  
**Problem:** Filling a 450×450 hex tile map with varied, natural-looking terrain and believable settlement distribution is too slow and difficult using existing tile-by-tile tools.

---

## Problem Statement

The editor has paint, fill, rectangle, and a global procedural generator (5 noise presets). The workflow is: generate a rough base, then manually rework large regions. The bottleneck is filling reworked regions with:
- **Mixed organic terrain** — forests that cluster naturally, transitions that blend rather than hard-cut
- **Believable settlement placement** — distributed across a region without clumping or unnatural regularity

---

## Solution: Zone Painter with Biome Presets

A 3-step workflow layered on top of the existing editor:

1. **Paint zones** — user paints broad region masks on a separate zone layer
2. **Assign biomes** — each zone gets a biome preset defining terrain mix, patch style, transition rules, and settlement density
3. **Fill zones** — one click fills all zones with organic terrain and distributed settlements

The existing tools (paint, fill, rectangle, procedural generator, settlement placement) remain unchanged. Zone mode is additive.

---

## Components

### 1. Zone Layer

A separate `Uint8Array` (450×450, 1 byte per tile) storing zone IDs. `0` = no zone assigned. Painted using the same brush system as terrain painting.

**UI additions:**
- `🗺️ Zone` tool in the toolbar (keyboard shortcut: `Z`)
- Zone palette in the left panel — list of named, colored zones with `+ Add zone` button
- Zones have a name, color (for visual identification on map), and assigned biome preset
- Zone layer rendered as semi-transparent color overlay on top of terrain (togglable)

### 2. Biome Preset

A named recipe stored in the map JSON. Contains three layers:

**Terrain layer:**
- `terrainWeights` — map of terrain type ID → weight (0.0–1.0, must sum to 1.0)
- `patchScale` — noise frequency: 1–20 (low = fine scatter, high = large blobs)
- `patchContrast` — sharpness of patch edges: 0.5–3.0

**Transition layer:**
- `blendWidth` — number of tiles to blend at zone borders: 2–20
- `blendMode` — `"smooth"` | `"noisy"` | `"hard"`

**Settlement layer:**
- `settlementDensity` — `"none"` | `"sparse"` | `"medium"` | `"dense"`
- `settlementMinSpacing` — minimum tile distance between settlements: 5–50
- `forbiddenTerrain` — terrain type IDs where settlements cannot be placed (e.g. water, mountains)

**Built-in presets (8):**

| Name | Terrain | Patches | Settlements |
|---|---|---|---|
| Forest Edge | Forest 40%, Forest2 20%, Plain 30%, Plain2 10% | Scale 8, noisy | Medium, spacing 15 |
| Deep Wasteland | Rubble 40%, Barren 40%, Plain 20% | Scale 12, hard | Sparse, spacing 25 |
| River Valley | Plain 50%, Water 30%, Swamp 20% | Scale 6, smooth | Dense, spacing 10 |
| Mountain Rim | Mountain 50%, Hills 30%, Rubble 20% | Scale 10, hard | None |
| Ash Plains | Barren 50%, Volcanic 30%, Rubble 20% | Scale 5, noisy | None |
| Marshland | Swamp 50%, Water 30%, Plain 20% | Scale 9, smooth | Sparse, spacing 20 |
| Ruined District | Rubble 50%, Plain 30%, Barren 20% | Scale 4, noisy | Dense, spacing 8 |
| Custom | User-defined | User-defined | User-defined |

Users can tune any preset and save as a new named preset.

### 3. Fill Engine

Executed per zone when **Fill Zones** is pressed (or **Fill This Zone** for a single zone).

**Algorithm per tile in zone:**
1. Sample 2D Perlin noise at `(tileX / patchScale, tileY / patchScale)` with a per-zone seed offset
2. Map noise value [0, 1] to a terrain type using `terrainWeights` cumulative thresholds
3. If tile is within `blendWidth` tiles of another zone's border: compute blend factor `t` (0 = center of zone, 1 = border); probabilistically choose terrain from neighboring zone's biome weighted by `t`; add noise to `t` if `blendMode = "noisy"`
4. Write terrain to map grid

**Settlement distribution (Poisson disk sampling):**
1. Compute target count from zone area × density factor (`sparse=0.002`, `medium=0.005`, `dense=0.010` settlements/tile)
2. Run Poisson disk sampling within zone bounds using `settlementMinSpacing` as minimum radius
3. For each candidate point: skip if terrain is in `forbiddenTerrain`; skip if an existing manually-placed settlement is within `settlementMinSpacing`; otherwise place settlement
4. Settlement type selection: use zone biome's preferred types if specified, else use existing settlement slot rules

**Performance:** 450×450 = 202,500 tiles. Simple noise + threshold per tile runs in <100ms in JS. Poisson disk is O(n) in the number of placed settlements. Total fill expected <500ms.

### 4. Right Panel — Zone Config

When a zone is selected in the zone palette, the right panel shows:
- Biome preset picker (dropdown)
- Inline preset editor: terrain mix bar (clickable), patch size slider, blend width slider, blend mode toggle, settlement density selector, min spacing input
- **Fill This Zone** button
- **Save as Preset** button (saves current config as a new named preset)

A small 20×20 tile live preview renders the terrain mix + patch style in real time as sliders change.

### 5. Global Actions

- **Fill All Zones** button in the toolbar — fills all zones in zone-ID order
- **Clear Zone Layer** — removes all zone assignments without touching terrain
- **Toggle Zone Overlay** — show/hide the colored zone overlay on the map

---

## Data Format Extension

Zones and presets are stored in the existing map JSON as new optional keys. The game (Unity) ignores these keys — no Unity-side changes required.

```json
{
  "width": 450,
  "height": 450,
  "terrain": [...],
  "settlements": [...],
  "zones": [
    { "id": 1, "name": "Northern Forest", "color": "#4a8a4a", "preset": "forest_edge" },
    { "id": 2, "name": "Central Wasteland", "color": "#8a6a2a", "preset": "deep_wasteland" }
  ],
  "zoneMap": "<base64-encoded Uint8Array 450×450>",
  "biomePresets": [
    {
      "id": "forest_edge",
      "terrainWeights": { "3": 0.4, "4": 0.2, "6": 0.3, "7": 0.1 },
      "patchScale": 8,
      "patchContrast": 1.5,
      "blendWidth": 8,
      "blendMode": "noisy",
      "settlementDensity": "medium",
      "settlementMinSpacing": 15,
      "forbiddenTerrain": [0, 1, 2, 17, 18]
    }
  ]
}
```

`zoneMap` uses the same base64 bitmask encoding pattern already used for `revealedBitmask` in the Unity game — consistent with existing project conventions.

---

## Out of Scope

- Undo/redo for zone fills (absent for other operations in the editor)
- Zone dependency rules (e.g. "river must border forest") — user defines zones manually
- Export of zone data to the Unity game — terrain + settlements remain the game's only input
- Automatic zone detection from existing terrain (no "infer zones from what I painted")

---

## Success Criteria

- User can fill a 200,000+ tile region with mixed organic terrain in under 3 clicks
- Zone borders look natural (no straight-line hard cuts between biomes)
- Settlement distribution within a zone looks geographically plausible (no clumping, no uniform grid)
- Existing editor tools and workflows are unaffected
- Map JSON remains valid and loadable by the Unity game after zone operations
