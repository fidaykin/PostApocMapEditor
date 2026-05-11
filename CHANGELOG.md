# Changelog — Map Editor Pro

All notable changes to this project are documented here.
Format: `## v[version] — [date]`

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
