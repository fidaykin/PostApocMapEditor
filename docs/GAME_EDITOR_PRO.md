# GameEditorPro — Architecture & Roadmap

**Branch:** `feature/game-editor-pro`
**Base file:** `GameEditorPro.html` (single HTML file, ~5730 lines)
**Derived from:** `MapEditorPro.html` v0.7.1

---

## Purpose

Full game-design editor suite for the Post-Apoc City Builder. Replaces the standalone map tool with a unified workspace covering all content-creation tasks a designer needs — without opening Unity. No enemies or combat systems; city-builder only.

---

## Phase 1 — Shell (DONE)

### What was built

| Element | Description |
|---------|-------------|
| `#gep-shell` | Outer CSS grid: 28px menubar \| 1fr workspace \| 24px statusbar |
| `#gep-menubar` | Shared menu bar. Adds **Project** menu (new/open/save/save-as). Existing File/Edit/View/Generate/Data menus kept for map operations. |
| `#gep-workspace` | Flex row: 44px sidebar + `#gep-panels` (flex:1) |
| `#gep-sidebar` | Vertical icon strip. 9 nav buttons, tooltips on hover. |
| `#gep-panels` | Container; only `.gep-panel.active` is visible (`display:flex/grid`, others `display:none`). |
| `#gep-statusbar` | Shared status bar. Map-specific items hidden when non-map editor is active. Shows editor name + project name + version. |

### Sidebar navigation

| Icon | Editor ID | Panel | Status |
|------|-----------|-------|--------|
| 🗺 | `map` | `#panel-map` | **Working** (full MapEditorPro) |
| 🌍 | `hexdb` | `#panel-map` + mode | **Working** (Terrain DB) |
| 🏗 | `buildings` | `#panel-map` + mode | **Working** (Buildings DB) |
| 🏘 | `settlements` | `#panel-map` + mode | **Working** (Settlements DB) |
| 📋 | `scenario` | `#panel-scenario` | Stub — Phase 2 |
| 🔗 | `campaign` | `#panel-campaign` | Stub — Phase 3 |
| ⚡ | `events` | `#panel-events` | Stub — Phase 4 |
| 🌳 | `upgrades` | `#panel-upgrades` | Stub — Phase 5 |
| ⚙ | `settings` | `#panel-settings` | Basic form (project name/version + file buttons) |

### New JS modules

#### `NAV` module
```js
NAV.setEditor(editorId)  // switches active panel + sidebar highlight
NAV.getActiveEditor()    // returns current editor id string
```
- Map sub-modes (`map`, `hexdb`, `buildings`, `settlements`) all route to `#panel-map` and call `App.setMode()` internally.
- When leaving map panel, map-specific statusbar items are hidden.
- Returns to map: fires `Canvas.forceRedraw()` after 50 ms to recover canvas state.

#### `PROJECT` module
```js
Project.newProject()      // prompt + blank state
Project.openProject()     // File System Access API (Chrome/Edge) or <input> fallback
Project.saveProject()     // writes to remembered file handle, or falls back to saveAs
Project.saveProjectAs()   // showSaveFilePicker → .pacb, or download fallback
Project.setName(str)      // updates project name + statusbar label
Project.init()            // wires settings panel inputs
```

#### New helpers added to existing modules
| Module | New export | Purpose |
|--------|-----------|---------|
| `HexDB` | `getData()` / `loadData(obj)` | Project serialise/restore |
| `BldDB` | `getData()` / `loadData(obj)` | Project serialise/restore |
| `SttDB` | `getData()` / `loadData(obj)` | Project serialise/restore |
| `IO` | `getMapJson()` | Returns current map as plain object |
| `IO` | `loadMapObj(obj)` | Loads map from plain object (calls internal `_loadFromJSON`) |

### Keyboard shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Save project |
| `Ctrl+Shift+O` | Open project |
| `Ctrl+S` | Save current map file (existing) |
| `Ctrl+O` | Open map file (existing) |
| `Ctrl+N` | New map (existing) |
| `Tab` | Cycle map sub-modes MAP → HEX DB → BUILDINGS → SETTLEMENTS |

---

## Project File Format (`.pacb`)

```json
{
  "version": 1,
  "project_name": "My Campaign",
  "project_version": "1.0.0",
  "map": { ...map JSON (width, height, data[][], settlements[], custom_terrain[])... },
  "buildings":   { "version": 1, "buildings": [...] },
  "terrains":    { "version": 1, "hexes": [...] },
  "settlements": { "version": 1, "settlements": [...] },
  "scenarios": [],
  "campaign":  null,
  "events":    [],
  "upgrades":  []
}
```

- `map` is the same JSON format already used by MapEditorPro and Unity's `RuntimeMapApplier`.
- `buildings`, `terrains`, `settlements` are the same formats used by `BldDB.save()`, `HexDB.save()`, `SttDB.save()`.
- `scenarios`, `campaign`, `events`, `upgrades` are empty arrays/null until Phase 2+.
- File extension `.pacb` (Post-Apoc City Builder). JSON content, rename to `.json` if needed.

---

## Phase Roadmap

### Phase 2 — Scenario Editor
**Goal:** designer can define a complete playable level without touching Unity.

Each scenario record:
```json
{
  "id": "valley_01",
  "name": "The Valley",
  "map_ref": "valley_map",
  "starting": { "food": 200, "wood": 100, "stone": 50, "energy": 0, "population": 10 },
  "win_conditions": [
    { "type": "population_gte", "value": 500 },
    { "type": "building_exists", "building_id": "quarry", "count": 2 }
  ],
  "fail_conditions": [
    { "type": "population_eq", "value": 0 },
    { "type": "resource_below_for", "resource": "food", "value": 0, "days": 5 }
  ],
  "unlocks_on_win":  ["mountains_01"],
  "unlocks_on_fail": []
}
```

UI: list of scenario cards on left, form editor on right. Condition blocks are add/remove rows (like a spreadsheet of rules).

Win/fail condition types (no enemies):
- `population_gte / lte / eq`
- `resource_gte / lte` for any resource at any threshold
- `resource_below_for` — resource at zero for N consecutive days
- `building_exists` with optional count
- `settlement_discovered`
- `survive_days`

### Phase 3 — Campaign Editor
Visual DAG of scenarios. Nodes = scenario cards, edges = unlock arrows (win→next, fail→retry/alternate). Drag to position nodes on SVG canvas. Export as `campaign` object with ordered `nodes[]` + `edges[]`.

No cycles allowed. Start scenario must be set. 

### Phase 4 — Events & Triggers
Narrative events that fire during gameplay.

```json
{
  "id": "caravan_arrives",
  "name": "Caravan Arrives",
  "one_shot": true,
  "trigger": { "type": "day_reached", "day": 30 },
  "actions": [
    { "type": "show_popup", "title": "A Caravan Arrives!", "body": "Merchants bring supplies.", "icon": "🚗" },
    { "type": "grant_resources", "food": 100, "wood": 50 }
  ]
}
```

Trigger types (no enemies): `day_reached`, `population_reached`, `building_built`, `settlement_discovered`, `resource_above`, `resource_below`.

Action types: `show_popup`, `grant_resources`, `unlock_building`, `reveal_settlement`, `apply_terrain`.

UI: list of event cards, expandable condition + action row editor. Preview text popup in styled box.

### Phase 5 — Upgrade Tree Editor
Visual node-graph editor on SVG canvas.

```json
{
  "id": "hydroponics",
  "name": "Hydroponics",
  "category": "Production",
  "icon": "🌱",
  "cost": { "food": 0, "wood": 200, "stone": 100 },
  "prerequisite_ids": ["basic_farming"],
  "effect": { "type": "production_multiplier", "building_id": "farm", "multiplier": 1.5 }
}
```

Nodes draggable on canvas. Click two nodes to connect (prerequisite arrow). Right panel: form for selected node. Categories: Production, Infrastructure, Exploration, Technology.

Unity reads exported `upgrades[]` array to build the in-game upgrade screen.

---

## CSS Architecture Notes

- Outer layout: `#gep-shell` (3-row grid) → `#gep-workspace` (flex row) → `#gep-sidebar` + `#gep-panels`.
- `#app` uses `display: contents` so `#toolbar` and the map content panels become direct grid children of `#panel-map` (`grid-template-rows: 40px 1fr`).
- `#hexdb-main`, `#buildings-main`, `#settlements-main` use explicit `grid-row: 2` to always sit in the content row when made visible.
- `display: none` elements are removed from grid flow entirely — this is what lets `body.mode-*` class toggling work (the hidden siblings don't consume grid rows).
- Stub panels use `.stub-editor` flexbox (centered icon + title + description + phase badge).
- Theme variables (`--bg`, `--panel`, `--border`, `--accent`, etc.) unchanged from MapEditorPro — all existing component styles apply unchanged inside the map panel.

---

## Files

| File | Description |
|------|-------------|
| `GameEditorPro.html` | Single-file editor — open directly in Chrome or Edge |
| `docs/GAME_EDITOR_PRO.md` | This document |
| `MapEditorPro.html` | Legacy standalone map editor — keep for reference / fallback |
| `sprites/hex/` | Terrain hex sprites (shared by both editors) |
| `sprites/City.png` | City marker sprite |

---

## Running Locally

Open `GameEditorPro.html` directly in Chrome or Edge (no server needed — all assets are relative paths).

For File System Access API (persistent autosave folder + project save): Chrome 86+ or Edge 86+. Safari falls back to download/open via `<input type="file">`.
