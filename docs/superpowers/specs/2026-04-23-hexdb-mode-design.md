# HEX DB Mode — MapEditorPro Design Spec

**Date:** 2026-04-23
**File:** `MapEditorPro.html`
**Branch:** `feature/hex-grid`
**Status:** Approved

---

## Overview

Add a **HEX DB** editor mode to `MapEditorPro.html` alongside the existing **MAP** editor mode. The HEX DB mode lets designers create and edit a database of named hex tile definitions (HexRecord), following the Miro DEv frame spec (РЕДАКТОР ГЕКСОВ). Switching between modes is instantaneous — `MAP | HEX DB` tabs sit in the toolbar row.

---

## Out of Scope

- Unity runtime integration of `hex_database.json`
- Hex visual preview (golden hexagon shape renderer)
- Undo/redo within HEX DB mode
- Multi-select / bulk edit of hex records

---

## Architecture: Mode Switch

### Existing grid (unchanged)
```
grid-template-rows: 28px 40px 1fr 24px
  28px → #menubar
  40px → #toolbar
  1fr  → #main  (palette | canvas | right-panel)
  24px → #statusbar
```

### Change
`#hexdb-main` is added to the same `1fr` grid slot as `#main`. Only one is visible at a time:

```css
body.mode-map   #main        { display: grid; }
body.mode-map   #hexdb-main  { display: none; }
body.mode-hexdb #main        { display: none; }
body.mode-hexdb #hexdb-main  { display: grid; }
```

Default body class: `mode-map` — existing behaviour is fully preserved.

### App.setMode(mode)
Single new function added to the existing inline script:

```js
App.setMode = function(mode) {
  document.body.classList.toggle('mode-map',   mode === 'map');
  document.body.classList.toggle('mode-hexdb', mode === 'hexdb');
  // swap toolbar sections, update statusbar
};
```

No changes to `Canvas`, `Brush`, `Tools`, `History`, `IO`, `Generator`, `Satellite`.

---

## Toolbar Changes

### Mode tabs (left side of toolbar)
```
[ MAP ] [ HEX DB ]  ║  <existing tool buttons>
```
- Active tab styled with `--accent` border-bottom
- Clicking a tab calls `App.setMode()`

### HEX DB toolbar section (visible only in `mode-hexdb`)
```
[ MAP ] [ HEX DB ]  ║  [+ Add Hex]        [📂 Load DB]  [💾 Save DB]
```
Map tool buttons hidden; HEX DB actions shown on the right.

### Keyboard
- `Tab` — toggle MAP ↔ HEX DB (when no input is focused)
- `Ctrl+Shift+S` — Save DB (HEX DB mode only)
- `Delete` — delete selected hex (HEX DB mode only, when no input/textarea is focused)

---

## Menubar Changes

New **Data** menu added between existing menus:

```
File | Edit | Layer | View | Generate | Data
```

Data menu items:
- `Load Hex DB…`   (same as 📂 Load DB button)
- `Save Hex DB`    (same as 💾 Save DB button)

---

## HEX DB Panel Layout

`#hexdb-main` uses a 2-column grid: `260px 1fr`

```
┌────────────────────┬────────────────────────────────────────────┐
│ 🔍 Search...       │  ▼ MAIN (0–9)                              │
│ Biome  [All    ▼]  │  Id *      [Beach              ]           │
│ Type   [All    ▼]  │  TextId    [beach_title         ]           │
│ ─────────────────  │  Type      [DirtyWater_1 ▼]               │
│  Airport           │  Biome     [Summer       ▼]                │
│ ▶Beach             │  Filter    [FilterTerrain ▼]               │
│  Bocage            │  SpriteName[beach_tile         ]           │
│  Bocage2           │  BaseCost  Gold[0] Gems[0] Event[0]        │
│  Bocage3           │                                            │
│  City              │  ▶ DESTROY (10–17)                         │
│  Coast1            │  ▶ BUILD   (18–24)                         │
│  Coast10           │                                            │
│  ...               │  ▼ INCOME                                  │
│                    │  OnCapture[0]  PerTurn[0]                  │
│                    │  Occupied [0]  HumanRes[0]                 │
│                    │  DamageMod[0]                              │
│                    │                                            │
│                    │  ▶ SPECIAL                                 │
│ ─────────────────  │                                            │
│ 12 shown / 678     │                       [Copy]  [Paste]      │
│ [🗑 Delete]        │                                            │
└────────────────────┴────────────────────────────────────────────┘
```

### Left panel (260px)
- **Search** — real-time filter by `id` (case-insensitive)
- **Biome dropdown** — All / Summer / Winter / Desert / Radioactive
- **Type dropdown** — All + all 29 TerrainType names (from `Terrain.types`)
- **List rows** — show `id` + small biome colour badge. Selected row: `--accent` background
- **Footer** — `N shown / M total` count, Delete button
- Delete: calls `UI.confirm()` before removing

### Right panel (flex: 1, scrollable)
- **5 collapsible sections** — click header toggles ▼/▶
- **MAIN** and **INCOME** expanded by default
- **DESTROY**, **BUILD**, **SPECIAL** collapsed by default
- Collapse state persisted per-section in `localStorage`
- All inputs write to `HexDB.data` immediately on `input`/`change` events
- `id` field: red outline if empty or duplicate
- Numeric inputs: `type="number" step="1"`, clamped to integer on `blur`
- **Copy**: deep-clones selected record into `HexDB.clipboard`
- **Paste**: appends clipboard clone (id += `_copy`), selects new record

### Empty state
When `HexDB.data.hexes` is empty, right panel shows:
```
  Drop hex_database.json here
  or use  [📂 Load DB]
```
Drag-drop on `#hexdb-main` calls `HexDB.load()`.

---

## HexDB Module

New module object following existing conventions:

```js
const HexDB = {
  data:        { version: 1, hexes: [] },
  clipboard:   null,
  selectedIdx: -1,
  _filter:     { search: '', biome: '', type: '' },
  _filtered:   [],   // indices into data.hexes after filtering

  init(),            // wire toolbar, menu, inputs, drag-drop, localStorage
  _applyFilter(),    // rebuild _filtered array
  _buildList(),      // render left panel rows
  _selectIdx(i),     // highlight row + call _renderRecord
  _renderRecord(hex),// populate right-panel inputs from HexRecord
  _readRecord(),     // read right-panel inputs → write to data.hexes[selectedIdx]
  add(),             // append blank HexRecord, select it
  delete(),          // UI.confirm → splice _filtered[selectedIdx], rebuild
  copy(),            // clipboard = structuredClone(selected)
  paste(),           // append copy (id += '_copy'), select
  load(json),        // JSON.parse → data, _applyFilter, _buildList
  save(),            // JSON.stringify → Blob download hex_database.json
};
```

---

## HexRecord Schema

All fields match the approved data model. Stored as plain JSON objects in `HexDB.data.hexes`.

### MAIN (0–9)
| Field | Type | Default |
|---|---|---|
| `id` | string | `""` |
| `textId` | string | `""` |
| `type` | string (TerrainType) | `"Plain_1"` |
| `biome` | string (BiomeType) | `"Summer"` |
| `filterCategory` | string | `"FilterTerrain"` |
| `spriteName` | string | `""` |
| `baseCostGold` | int | `0` |
| `baseCostGems` | int | `0` |
| `baseCostEvent` | int | `0` |
| `mainField9` | int | `0` |

### DESTROY (10–17)
| Field | Type | Default |
|---|---|---|
| `destroyIncomeGold` | int | `0` |
| `destroyIncomeGems` | int | `0` |
| `destroyTransformTo` | string | `""` |
| `destroyCondition` | string | `""` |
| `destroyBonus` | int | `0` |
| `destroyEffect` | string | `""` |
| `destroyDelay` | int | `0` |
| `destroyRequiresRoad` | bool | `false` |

### BUILD (18–24)
| Field | Type | Default |
|---|---|---|
| `buildCostGold` | int | `0` |
| `buildCostGems` | int | `0` |
| `buildCostEvent` | int | `0` |
| `buildRequiresRoad` | bool | `false` |
| `buildPlacementRule` | string | `""` |
| `buildMinLevel` | int | `0` |
| `buildMaxPerMap` | int | `0` |

### INCOME
| Field | Type | Default |
|---|---|---|
| `incomeOnCapture` | int | `0` |
| `incomePerTurn` | int | `0` |
| `incomeOccupiedPerTurn` | int | `0` |
| `humanResourcesPerHex` | int | `0` |
| `damageModifier` | int | `0` |

### SPECIAL
| Field | Type | Default |
|---|---|---|
| `bonusDrop` | string | `""` |
| `booster` | string | `""` |
| `storageCapacity` | int | `0` |
| `energyConsumption` | int | `0` |
| `pollutionConstant` | int | `0` |

---

## File Flow

```
📂 Load DB
  → <input type=file accept=".json">
  → FileReader.readAsText()
  → HexDB.load(text)
  → UI.toast("Loaded N hexes")

💾 Save DB  (also Ctrl+Shift+S)
  → JSON.stringify(HexDB.data, null, 2)
  → Blob → <a download="hex_database.json">
  → UI.toast("Saved hex_database.json")

Drag-drop JSON onto #hexdb-main
  → same as Load DB
```

---

## Integration Points (read-only, no changes to existing modules)

| Existing | Used by HexDB |
|---|---|
| `Terrain.types` array | Type dropdown values |
| `UI.toast(msg)` | Load/Save feedback |
| `UI.confirm(msg, cb)` | Delete confirmation |
| `--accent`, `--panel`, `--border` CSS vars | Consistent styling |

---

## Implementation Files

Only one file changes:

```
/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html
```

No new files. No new dependencies.
