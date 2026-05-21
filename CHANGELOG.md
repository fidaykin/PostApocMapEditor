# Changelog — Map Editor Pro

All notable changes to this project are documented here.
Format: `## v[version] — [date]`

---

## v0.6.6 — 2026-05-21

### Fixes — Settlement Placement (Critical feedback 18.05)
- **Undo/redo covers settlements**: History snapshots now include the `settlements` array, so placing or erasing a settlement is fully undoable with Ctrl+Z.
- **Settlements autosave on change**: `_placeSettlement` and `_eraseSettlement` now call `scheduleAutoSave()`, so settlement positions survive page reload.
- **Settlements auto-show on tool activation**: switching to the 📍 Place Settlement or ✕ Erase Settlement tool automatically enables settlement visibility if it was hidden.

### Tools reminder
- **S** — Place Settlement tool
- **D** — Erase Settlement tool
- **Ctrl+S** — Save/Export map (unchanged)

---

## v0.6.5 — 2026-05-21

### Fixes
- **Save now includes custom terrain**: `saveMap()` was duplicating JSON-build logic without `customTerrainOverlay`, so exported files never contained the `custom_terrain` section. Fixed by delegating to `_buildJson()` which already handles it correctly. Also fixes settlement keys (`col`/`row` instead of `x`/`y`) in saved files.

---

## v0.6.4 — 2026-05-20

### Fixes
- **Custom tile visible on map immediately**: `_readRecord` now calls `Terrain.applyHexDbOverrides([h])` after saving a custom-type entry, loading the sprite into `customSprites` without needing a page reload. Palette and canvas refresh automatically.

---

## v0.6.3 — 2026-05-20

### Fixes
- **Custom tiles now render on canvas**: `_drawHexTile` accepts an optional sprite override; the render loop looks up `customTerrainOverlay` and passes the custom sprite so painted tiles show their HexDB sprite instead of the base terrain.
- **Custom tile size in palette fixed**: buttons now use the standard `tile-btn` class (52×52 px, hex-clipped image, tooltip) instead of the unstyled `terrain-btn`.
- **Custom tiles in correct section**: grouped under a collapsible **☢ CUSTOM** category at the bottom of the palette, matching the style of built-in categories.
- **Custom tile selection highlight**: clicking a custom tile highlights it in the palette and updates the info bar; selecting a built-in tile clears the custom highlight.
- **Eyedropper picks custom terrain**: right-click now reads `customTerrainOverlay` so picking a custom tile re-selects it (not just the underlying base terrain).

---

## v0.6.2 — 2026-05-20

### Fixes
- **Stagger direction corrected**: odd worldX columns now render higher (smaller canvas y) to match Unity's visual layout. The previous fix swapped axes but left the stagger sign inverted, causing NE tiles to appear as SE in the editor. Fix: stagger is now applied as `STAGGER − stg` (baseline + STAGGER, subtract for odd worldX) using the centered worldX value, making the formula correct for any map size.

---

## v0.6.1 — 2026-05-19

### Fixes
- **Hex render axis swap**: `hexCenterWorld` now correctly maps `row` (worldX) to the horizontal axis and `col` (worldY) to the vertical axis, matching Unity's YXZ swizzle. Previously, tiles placed as NORTH of center appeared as NE in the app (and vice versa). `screenToHex`, `clampCamera`, `fitToScreen`, `drawMinimap`, and `_minimapPan` updated to match the new coordinate formula.

---

## v0.6.0 — 2026-05-19

### Features
- **App coords in status bar**: hovering any tile now shows its Unity world coordinate (x, y) — city center = (0,0), matching the app. Eliminates guesswork when painting tiles for specific app positions.
- **HexDB overrides built-in terrain sprites**: add a HexDB entry with an Id matching a built-in terrain name (e.g. `plain_1`) — the map canvas immediately uses that entry's sprite. QA can replace default tile visuals without editing HTML.
- **Undo/Redo covers custom terrain**: History snapshots now include `customTerrainOverlay` — undoing a custom terrain stroke correctly removes it from the export.
- **New sprites**: `Barren.png`, `Desert.png`, `Swamp.png` added to `sprites/hex/`.

### Fixes
- `isCustomType` is now case-insensitive — `plain_1` correctly matches built-in `Plain_1`.

---

## v0.5.0 — 2026-05-16

### Fixes
- BldDB / SttDB: Max Levels field no longer crashes browser when values > 5 chars — capped at 9999 with `Math.min` guard and `max="9999"` on input; also clamped at write-back to prevent uncapped JSON export
- HexDB Income: removed duplicate `Income Idle` field (identical to `Income per Turn`)
- HexDB Income: `Income Constant` now uses full resource list including Energy and Pollution

### Polish
- HexDB Build / Special: disabled inputs (gated by Can Build / Bonus Drop) now rendered with 35% opacity and gray background for clear visual distinction

---

## v0.4.6 — 2026-05-11

### Features
- HexDB editor: restored Visual block at the top of the record form — shows tile sprite preview (hex-shaped), ID, and sprite path on every hex record

---

## v0.4.5 — 2026-05-11

### Fixes
- Buildings and Settlements editors: `Max Level` input widened to 9 chars (110px); removed illogical `max=8` restriction — levels above 8 now supported

---

## v0.4.4 — 2026-05-11

### Features
- HexDB Special section: `Bonus Drop` checkbox gates `Triggers` dropdown (Destroy/Reveal/Build, default Destroy) and `Bonuses` dynamic resource block (default Gold=10); `Boosters` and `Effects` kept as locked placeholder fields; removed StorageCapacity, EnergyConsumption, PollutionConstant
- Migration: old `bonusDrop` text field auto-converted to boolean on load

---

## v0.4.3 — 2026-05-11

### Features
- HexDB Income section: full restructure — `Tap Income` + `Destroyable` checkboxes gate Transform to / Capacity / Get per Tap; `Transform to` datalist picker with Parent Hex option; `Capacity` (renamed from DamageMod, default 3, min 1); `Get per Tap` dynamic resource block; `Per Turn` upgraded from single number to resource block; new `Income Idle`, `Income Constant`, `Spend Constant` resource blocks (Spend Constant includes Pollution + Energy types)
- `_resourceBlockHTML` extended with optional `resTypes` param for custom type lists
- Migration: `incomePerTurn` number auto-converted to Gold array; `damageModifier` migrated to `incomeCapacity`
- Removed: OnCapture, OccupiedPerTurn, HumanResources fields

---

## v0.4.2 — 2026-05-11

### Features
- HexDB Build section: full restructure — `Can Build` + `Need Road` checkboxes on same row gate all fields; `Available Tiles` tags input (hex IDs with datalist autocomplete); dynamic `Price` resource block (add/remove, all resource types); separate `Premium Price` field; `Placement Rule` moved to bottom
- Migration: old `buildCostGold/Gems/Event` flat fields auto-converted to new `buildPrice` array on load
- Removed: `MaxPerMap` field

---

## v0.4.1 — 2026-05-11

### Features
- HexDB Destroy section: full restructure — `Can Destroy` checkbox gates all fields; `Transform to` now uses a datalist picker (shows "Unbreakable" when disabled, defaults to Plains_1); `Source` tags input (free-text IDs with add/remove); `Can Stored` checkbox; dynamic multi-resource `Destroy Income` block (add/remove rows, supports all resource types including custom Events currencies)
- Migration: old `destroyIncomeGold`/`destroyIncomeGems` flat fields auto-converted to the new resource array on load
- Removed stale fields: Condition, Bonus, Effect, Delay, Requires Road to destroy
- New reusable helpers `_sourceTagsHTML` and `_resourceBlockHTML` (will be reused in Income and Special sections)

---

## v0.4.0 — 2026-05-11

### Features
- HexDB Main section: added `Desc Idle` and `Desc Build` text fields for
  localisation key references (position: after TextId, before Type)
- HexDB Main section: replaced BaseCost Gold/Gems/Event inputs with a single
  `Base Cost Taps` number field (9-char wide, min 0)

---

## v0.3.4 — 2026-05-11

### Features
- **File → Set Autosave Folder…** — pick any local folder; a `saved_maps/` subfolder is created inside it automatically. Autosave writes `map_session.json` there on every save event. Folder handle persists across sessions via IndexedDB (Chrome/Edge only — requires File System Access API)
- If folder permission is lost after reload, a toast prompts to re-set via File menu
- localStorage autosave is kept as fallback when no folder is configured

---

## v0.3.3 — 2026-05-11

### Fixes
- Map editor now restores the last session on page reload — autosaves to `localStorage` after every significant change (new map, load, clear, fill) and on a 2-second debounce after each paint stroke; also saves on `beforeunload` and every 30 seconds
- New-map prompt is suppressed on startup when a previous session is successfully restored

---

## v0.3.2 — 2026-05-11

### Fixes
- Hex / Buildings / Settlements editor right panel now scrolls vertically — added `grid-template-rows: 1fr` to constrain the internal grid row, and `min-height: 0` to the panel so `overflow-y: auto` activates
- Section frames (Main, Destroy, Build, Income, Special) no longer clip their content when adjacent frames are expanded — added `flex-shrink: 0` to `.hexdb-section` so sections always render at full natural height

---

## v0.3.1 — 2026-05-11

### Fixes
- Buildings editor and Settlements editor now restore data after page reload (autosave was saved but list was never rebuilt on init)
- Map Editor canvas no longer goes black after tab is inactive — `forceRedraw()` now resets canvas backing store before re-rendering

---

## v0.3.0 — 2026-05-05

### Features
- Sprite browser picker modal in Hex editor SpriteName field — browse and select sprites by thumbnail
- Save / Open map buttons added to Map toolbar
- Hex type field now stores group name instead of specific tile IDs; existing maps migrated automatically on load
- Hex type dropdown grouped by category with optgroup labels

### Fixes
- Sprite picker callback captured before modal closes (prevented missed selections)
- Migrated hex types now persisted to autosave
- Input event dispatched with `bubbles:true` in `HexDB.pickSprite`
- All terrain types included in `TYPE_GROUPS` (prevented missing entries in hex type dropdown)
- Default new Hex type set to `New` instead of `Plain_1`
- `New` added as valid hex type option in type filter dropdown

---

## v0.2.0 — 2026-04-27

### Features
- Buildings and Settlements editor modes added to MapEditorPro
- HexDB editor mode with full CRUD, filter, sort, and per-hex field editing
- Auto-save for HexDB / BldDB / SttDB data to localStorage; restored on page load
- Satellite module — RGB→HSL terrain classification with live preview
- Map size picker on startup and New Map (20×20 min, 450×450 max)
- Hex list sorted alphabetically A–Z by ID
- QA package — sample data + distributable zip (2026-04-27)

### Fixes
- Canvas forced redraw on `visibilitychange` (prevented black screen after tab inactive)
- Map statusbar hidden in non-map editor modes
- Satellite debounce on param change; `Int8Array` for classified data; renamed `waterIds` → `impassableIds`
- Error handlers added to `Satellite._loadImage` for corrupt/unreadable images
- Palette expand/collapse closure bug (block-scoped `const` per category)
- `UI.confirm()` replaced with `UI.showConfirm()` in all delete handlers

---

## v0.1.0 — 2026-04-06

### Features
- Initial Map Editor Pro HTML shell with CSS Grid layout and module stubs
- Terrain module — 29 terrain types, sprite loading, color map
- Canvas module — hex renderer, zoom/pan (25%–400%), minimap, touch support
- Brush module — 4 brush sizes (1 / 3×3 / 5×5 / ○7)
- Tools module — Paint, Erase, Fill, Eyedropper
- History module — undo/redo stack
- IO module — JSON import/export, CSV export
- Generator module — procedural map generation
- Variable map size support (10×10 to 450×450)
- Hex map matching Unity flat-top odd-q grid layout
- Map save/load from localStorage
