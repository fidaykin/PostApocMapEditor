# MapEditorPro — Design Spec
**Date:** 2026-04-17  
**Status:** Approved  
**Output file:** `MapEditorPro.html` (single self-contained HTML file)

---

## Overview

A ground-up rewrite of the Post-Apocalyptic map editor, inspired by StarCraft's StarEdit. Replaces `MapEditorHex.html` as the primary editing tool while keeping the old file as fallback. Uses hex sprites exclusively. 100% JSON format compatibility with existing tools and Unity's `MapImporter.cs`.

**Core features:** StarEdit-style chrome, brush engine, undo/redo history, procedural generator, satellite import.

---

## Architecture

Single HTML file with embedded CSS and JS. JS organized into named namespace objects acting as logical modules, separated by comment banners:

```
const Terrain  — terrain data, sprite loading, color mapping
const Canvas   — hex renderer, viewport, culling, minimap render
const Tools    — tool system: paint, fill, rectangle, eyedropper, settlement
const Brush    — brush size/shape engine, hex neighbor lookup
const History  — undo/redo stack (50-step, Int8Array snapshots)
const UI       — toolbar, palette, panels, modals, toasts, status bar
const Generator — procedural generation (Perlin noise, presets)
const Satellite — image import, color→terrain classification
const IO       — load/save JSON, export CSV, settlements
```

No build step. No external dependencies. Opens with double-click in any modern browser.

---

## Layout

Full-viewport fixed layout:

```
┌─────────────────────────────────────────────────────┐
│  MENU BAR   File | Edit | Layer | View | Generate   │  28px
├──────────┬──────────────────────────┬───────────────┤
│          │                          │   MINIMAP     │
│ TERRAIN  │                          │   220×220px   │
│ PALETTE  │      HEX CANVAS          ├───────────────┤
│          │                          │ BRUSH PALETTE │
│ 220px    │   (flex, fills rest)     │ size + shape  │
│          │                          │ active tile   │
│          │                          │   220px       │
├──────────┴──────────────────────────┴───────────────┤
│  STATUS BAR: tool | terrain name | x,y | zoom | W×H │  24px
└─────────────────────────────────────────────────────┘
```

### Theme
- Background: `#1e1e1e`
- Panels: `#2a2a2a`
- Borders: `#3a3a3a`
- Accent / active: `#4fc3f7` (light blue/teal)
- Text: `#ffffff` primary, `#888888` muted
- Danger: `#ef5350` (used for destructive confirmations)

---

## Menu Bar

| Menu | Items |
|---|---|
| **File** | New Map (`Ctrl+N`), Open (`Ctrl+O`), Save (`Ctrl+S`), Export CSV |
| **Edit** | Undo `Ctrl+Z` (shows step count), Redo `Ctrl+Y`, ─, Clear Map, Fill Map |
| **Layer** | Toggle Settlement Visibility |
| **View** | Zoom In, Zoom Out, Fit Map |
| **Generate** | Procedural Generator…, Satellite Import… |

Menus open on click and close on click-outside or Escape.

---

## Toolbar

Icon strip below the menu bar. 6 tools:

| Icon | Tool | Key | Notes |
|---|---|---|---|
| ✏️ | Paint | `P` | Paints with active brush size/shape |
| 🪣 | Fill | `F` | Flood-fill contiguous same-terrain region |
| ▭ | Rectangle | `R` | Click-drag to paint rect of tiles |
| 💧 | Eyedropper | `E` | Sample terrain under cursor |
| 📍 | Place Settlement | `S` | Mark settlement tile |
| ✕ | Erase Settlement | `D` | Remove settlement marker |

Active tool highlighted with `#4fc3f7` border. Tooltip on hover shows tool name and shortcut.

**Right-click** on canvas always samples terrain (eyedropper), regardless of active tool.

---

## Terrain Palette (Left Panel, 220px)

### Category tree (scrollable)
Collapsible groups with toggle headers. Default: all collapsed except Plains.

Categories and terrain IDs:
| Category | IDs |
|---|---|
| 💧 WATER / RIVER | 0–8 |
| 🏚️ RUBBLE / WASTELAND | 9–11 |
| 🌾 PLAINS | 12–14 |
| 🌲 FOREST | 15–17 |
| ⛰️ ROCKY / MOUNTAIN | 18–19 |
| 💎 RESOURCES | 20–21 |
| 🏜️ BARREN / DESERT | 22–23 |
| 🟫 SWAMP | 24–25 |
| 🌋 VOLCANIC / RIFT | 26–28 |

Each tile: 48×48px hex sprite on a dark button. Selected tile: `#4fc3f7` border. Hover: `#3a3a3a` background. Tooltip: terrain name.

Terrains without a dedicated hex sprite use a fallback sprite with a `⚠` badge:
- Missing: BrokenPlain (14), Oil (21), Barren (22), Desert (23), Swamp (24), RockySwamp (25), LavaPlain (26), LavaRift (27)
- Note: Rift (28) has `Rift.png` — no fallback needed

### Selected terrain display (fixed bottom of palette)
80×80px hex sprite preview + terrain name + ID. Always visible. Stays in sync with right panel active terrain display.

---

## Right Panel (220px)

### Minimap (top, 220×220px)
- Live scaled preview of entire map rendered as colored pixels using `Terrain.color(id)`
- Updates after each completed stroke (not on every mouse move)
- **Viewport rect**: teal outline showing currently visible canvas region
- **City dot**: white 3px dot at map center (225, 225)
- Click/drag on minimap → pans canvas to that position
- Redraws fully on: stroke complete, generator apply, satellite apply, load, clear, fill

### Brush palette (below minimap)
Four brush sizes, selectable with a click:

| Button | Label | Shape | Tiles affected |
|---|---|---|---|
| `•` | 1 | Single | 1 |
| `···` | 3×3 | Hex radius 1 | ~7 |
| `·····` | 5×5 | Hex radius 2 | ~19 |
| `○` | Circle-7 | Hex radius 3 | ~37 |

Applies to Paint tool only. Fill and Rectangle ignore brush size.

### Active terrain display
Mirrors left palette selected terrain: 64×64px sprite + name + ID.

### Settlement counter
`Settlements: N` shown at bottom of right panel.

---

## Brush Engine (`Brush` module)

- `Brush.size` — current radius (0=single, 1=r1, 2=r2, 3=r3)
- `Brush.getAffectedTiles(col, row)` — returns array of `{col, row}` for all hex tiles within the brush radius using hex neighbor ring expansion
- Uses axial hex coordinate math for neighbor lookup (same geometry as existing hex editor)
- Paint tool calls `Brush.getAffectedTiles()` on each mouse-move-while-held event, paints all returned tiles

---

## Undo/Redo History (`History` module)

- Stack of `Int8Array` snapshots of `mapData` (one byte per tile, 450×450 = 202,500 bytes each)
- Max depth: **50 entries** (~10MB max)
- `History.push()` — called on mouse-up after paint/fill/rect, and on clear/fill/generator/satellite apply
- `History.undo()` — pops current state, restores previous; moves current to redo stack
- `History.redo()` — restores next state from redo stack
- Any new `push()` while redo stack is non-empty clears redo stack
- `Ctrl+Z` → undo, `Ctrl+Y` / `Ctrl+Shift+Z` → redo
- Edit menu shows: `Undo (N)` / `Redo (N)` with step count; grayed out when unavailable

---

## Procedural Generator (`Generator` module)

Modal opened via `Generate → Procedural Generator`.

**Parameters** (same as SmartMapGeneratorWindow.cs in PostApocCityBuilder):
- Seed (int, random button)
- Presets: Wasteland, Jungle, Desert, Arctic, Volcanic
- Elevation / Moisture / Biome noise scales (sliders)
- Mountain / Hills / Water thresholds (sliders)
- River count (0–14)
- Gold Veins toggle + count (1–40)
- Oil Deposits toggle + count (1–30)

**Preview:** 270×270px canvas showing map colors, updates live on slider change (debounced 150ms).

**Apply:** writes result to `mapData`, pushes history entry, closes modal, triggers minimap redraw. Undoable.

**Generation algorithm:** identical to `SmartMapGeneratorWindow.cs` — multi-octave Perlin, city influence smoothstep, downhill river carving, resource scatter with center exclusion.

---

## Satellite Import (`Satellite` module)

Modal opened via `Generate → Satellite Import`.

- Drag-drop or click-to-upload image
- Downscales to max 1024px for performance
- RGB→HSL color classification against `terrainColors` table (ported from `MapEditorHex.html`)
- Live preview (270×270px map colors)
- Color Sensitivity slider (1–100, default 50)
- Sample Radius slider (1–10px, default 3)
- "Color Guide ↗" link opens `SatelliteColorGuide.html` in new tab
- **Apply:** writes to `mapData`, pushes history entry, closes modal. Undoable.

---

## IO (`IO` module)

### JSON format (unchanged — fully compatible)
```json
{
  "width": 450,
  "height": 450,
  "data": [[0, 12, 12, ...], ...],
  "settlements": [
    { "x": 225, "y": 225, "type": "city" },
    { "x": 100, "y": 50,  "type": "settlement" }
  ]
}
```

### Operations
- **New Map** (`Ctrl+N`): confirm dialog → fill Plain_1 (ID 12), clear settlements (preserve city at 225,225), push history
- **Open** (`Ctrl+O`): load JSON, validate, resize editor to map dimensions, push history
- **Save** (`Ctrl+S`): download `map_export.json`
- **Export CSV**: download terrain grid, comma-separated rows

### Toast notifications
2-second fade, bottom-center, non-blocking. Shown for: map loaded, map saved, generator applied, satellite applied, undo/redo, new map created.

---

## Settlements

- City center (225, 225): permanent, cannot be erased, rendered as white `City.png` hex overlay
- Settlements: teal hex outline overlay
- `S` tool: click to place (no duplicate at same tile)
- `D` tool: click to remove (city immune)
- `Layer → Toggle Settlement Visibility`: shows/hides all settlement markers (does not affect data)

---

## Status Bar (24px, bottom)

Left to right:
```
[Tool: Paint]   [Terrain: Plain_1]   [Tile: 225, 225]   [Zoom: 100%]   [Map: 450 × 450]
```

Updates in real time on hover (tile + terrain), tool change, zoom change.

---

## Canvas & Rendering (`Canvas` module)

Ported from `MapEditorHex.html` hex renderer:
- Hexagonal tile geometry (`hexCenterWorld`, `hexScreenPos`, `screenToHex`, `hexClipPath`)
- Visible tile culling (only renders tiles within viewport)
- Default zoom: 100%, initial viewport centered on city tile (225, 225)
- Zoom: 25%–200% (extended from current 25%–100%), centered on cursor
- Pan: right-click drag, or Space+drag
- Touch: pinch zoom, single-finger pan
- Settlement/city overlays rendered on top of terrain layer

---

## Out of Scope

- Square grid editor (MapEditor.html stays as-is)
- Multiple map layers / z-ordering
- Triggers or scripting (StarEdit-specific, not applicable)
- Unit placement (no units in PostApocCityBuilder)
- Multiplayer / collaborative editing
- Localization
- Keyboard shortcut customization
