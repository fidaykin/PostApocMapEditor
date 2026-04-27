# MapEditorPro — QA Testing Guide

**Date:** 2026-04-27  
**File under test:** `MapEditorPro.html`  
**Branch:** `feature/hex-grid`  
**What changed:** HEX DB, BUILDINGS, and SETTLEMENTS editor modes added as tabs

---

## How to Open the Editor

1. Navigate to `/Users/sergii.tyshchenko/Post Apo Map Editor/`
2. Double-click `MapEditorPro.html` — opens in your default browser
3. No server needed. Works fully offline.

---

## Scope of This Test Session

| Area | Scope |
|---|---|
| MAP mode | **Regression only** — no changes made, verify it still works |
| HEX DB mode | **Regression only** — previously shipped |
| BUILDINGS mode | **Full test** — newly implemented |
| SETTLEMENTS mode | **Full test** — newly implemented |
| Mode switching | **Full test** — Tab key + toolbar tabs |

---

## 1. Mode Switching

### 1.1 Toolbar tabs
- [ ] Click **MAP** tab → map canvas and palette are visible, toolbar shows paint/fill/rect tools
- [ ] Click **HEX DB** tab → hex list panel appears, map canvas hidden
- [ ] Click **BUILDINGS** tab → buildings list panel appears, HEX DB hidden
- [ ] Click **SETTLEMENTS** tab → settlements list panel appears, BUILDINGS hidden
- [ ] Active tab has a highlighted border (accent colour), others do not

### 1.2 Tab key cycling
- [ ] Press `Tab` (with no input focused) → cycles MAP → HEX DB → BUILDINGS → SETTLEMENTS → MAP
- [ ] Pressing `Tab` while an input field is focused does NOT switch modes (normal browser tab behaviour)

### 1.3 Regression — MAP mode unaffected
- [ ] After switching to BUILDINGS and back to MAP, the canvas renders correctly
- [ ] Paint tool still works after mode round-trip

---

## 2. BUILDINGS Mode — Full Test

### 2.1 Empty state
- [ ] Click **BUILDINGS** tab with no data loaded → right panel shows:
  > Drop building_database.json here  
  > or use 📂 Load DB
- [ ] Left panel shows `0 shown / 0`

### 2.2 Add a building
- [ ] Click `+ Add Building` in the toolbar
- [ ] A new row appears in the left list labelled `(no id)`
- [ ] Right panel shows a form with sections: **MAIN**, **BUILD**, **LEVELS**
- [ ] Count updates to `1 shown / 1`

### 2.3 MAIN section fields
Fill in the following and verify each saves immediately (no Save button needed for live edits):
- [ ] **Id** — type `Barracks` → list row label updates to `Barracks`
- [ ] **Id** left empty → Id field shows a red outline
- [ ] **TextId** — type `barracks_title`
- [ ] **SpriteName** — type `barracks_sprite`
- [ ] **BuildingType** — type `Military`
- [ ] **Biome** dropdown — select `Winter` → saves correctly
- [ ] **Filter** — type `FilterBuilding`
- [ ] **Start Level** — set to `1`
- [ ] **Max Level** — set to `3` → verify 3 level cards appear in the LEVELS section

### 2.4 BUILD section
- [ ] Click **BUILD** section header → collapses (▶)
- [ ] Click again → expands (▼)
- [ ] Fill `Cost Gold: 200`, `Cost Gems: 5`, `Cost Event: 0`
- [ ] Check `Requires Road` → unchecked by default
- [ ] Type `AdjacentToRoad` in Placement Rule
- [ ] Set `Max Per Map: 10`

### 2.5 LEVELS section
- [ ] Set Max Level to `3` → verify exactly 3 level cards appear (Level 1, Level 2, Level 3)
- [ ] Set Max Level to `1` → verify only Level 1 remains (levels 2 and 3 removed)
- [ ] Set Max Level back to `3`
- [ ] In Level 1: set `Upgrade Gold: 0`, `Upgrade Gems: 0`
- [ ] In Level 2: set `Upgrade Gold: 300`, `Upgrade Gems: 10`, `Upgrade Condition: PlayerLevel5`
- [ ] In Level 3: set `Upgrade Gold: 600`, `Transform To: Barracks_Elite`

### 2.6 Add more buildings
- [ ] Add `Farm` — fill id, set `Max Level: 1`
- [ ] Add `PowerPlant` — fill id, set `Max Level: 2`
- [ ] Left list shows 3 rows in alphabetical-ish order (insertion order)

### 2.7 Search / filter
- [ ] Type `bar` in the search box → only `Barracks` shown, count updates
- [ ] Clear search → all 3 shown

### 2.8 Duplicate id validation
- [ ] Add a 4th building, set its id to `Barracks` → Id field shows red outline on both records
- [ ] Rename the duplicate to something unique → red outline clears

### 2.9 Copy / Paste
- [ ] Select `Barracks` → click **Copy** → toast says "Copied Barracks"
- [ ] Click **Paste** → new row `Barracks_copy` appears, is selected
- [ ] Rename to `Barracks_Elite`
- [ ] Verify level data from `Barracks` was copied into `Barracks_Elite`

### 2.10 Delete
- [ ] Select a building → click **🗑 Delete** in list footer → confirmation dialog appears
- [ ] Click Cancel → building is NOT deleted
- [ ] Click Delete again → confirm OK → building removed, count decreases

### 2.11 Save
- [ ] With 3 buildings present, click **💾 Save DB**
- [ ] Browser downloads `building_database.json`
- [ ] Toast shows "Saved building_database.json"
- [ ] Open the file in a text editor and verify:
  - Root keys: `version`, `buildings`
  - Each building has: `id`, `textId`, `spriteName`, `buildingType`, `biome`, `filterCategory`, `startLevel`, `maxLevel`, `buildCostGold`, `buildCostGems`, `buildCostEvent`, `buildRequiresRoad`, `buildPlacementRule`, `buildMaxPerMap`, `levels`
  - Each level in `levels[]` has: `level`, `upgradePriceGold`, `upgradePriceGems`, `upgradeCondition`, `transformTo`, `unlockList`

### 2.12 Load
- [ ] Reload the page (all data cleared)
- [ ] Click **📂 Load DB** → select the saved `building_database.json`
- [ ] All 3 buildings appear in the list
- [ ] Click each → verify all fields and level cards are populated correctly
- [ ] Toast shows "Loaded 3 buildings"

### 2.13 Drag-drop load
- [ ] Drag `building_database.json` from Finder and drop it onto the BUILDINGS panel
- [ ] Same result as 📂 Load DB

### 2.14 Delete key shortcut
- [ ] Select a building → press `Delete` key (while no input is focused) → confirmation dialog appears
- [ ] Press `Delete` while an input is focused → does NOT trigger delete (types in the input)

### 2.15 Data menu
- [ ] Menu bar → **Data** → `Load Building DB…` → same as 📂 Load DB
- [ ] Menu bar → **Data** → `Save Building DB` → same as 💾 Save DB

---

## 3. SETTLEMENTS Mode — Full Test

### 3.1 Empty state
- [ ] Click **SETTLEMENTS** tab → right panel shows empty state with `📂 Load DB`
- [ ] `0 shown / 0`

### 3.2 Add and fill a settlement
- [ ] Click `+ Add Settlement`
- [ ] Set `id: Village`, `textId: village_title`, `settlementType: Rural`
- [ ] Set `Biome: Summer`, `Start Level: 1`, `Max Level: 3`
- [ ] In BUILD: `Cost Gold: 50`, `Cost Gems: 0`
- [ ] Expand **LEVELS** → 3 level cards appear

### 3.3 Level cards include Unlock Buildings
- [ ] Each level card has 6 fields: Upgrade Gold, Upgrade Gems, Upgrade Condition, Transform To, Unlock List, **Unlock Buildings**
- [ ] In Level 1: `Unlock Buildings: Barracks,Farm`
- [ ] In Level 2: `Unlock Buildings: PowerPlant`
- [ ] Verify these values persist when switching to another settlement and back

### 3.4 Add more settlements
- [ ] Add `Town` (maxLevel=5) and `City` (maxLevel=8)
- [ ] Verify City shows 8 level cards

### 3.5 Save and reload round-trip
- [ ] Save → open `settlement_database.json` → verify:
  - Root keys: `version`, `settlements`
  - Each settlement's `levels[]` entries include `unlockBuildings`
- [ ] Reload page → Load DB → verify all data survives

### 3.6 Data menu
- [ ] **Data** → `Load Settlement DB…` and `Save Settlement DB` both work

---

## 4. Cross-Mode Consistency

- [ ] Load `building_database.json` in BUILDINGS tab → switch to SETTLEMENTS tab → buildings data is still loaded when switching back
- [ ] Load `settlement_database.json` in SETTLEMENTS tab → switch to MAP tab → draw on canvas → switch back to SETTLEMENTS → data still intact
- [ ] HEX DB data is unaffected by BUILDINGS/SETTLEMENTS operations

---

## 5. Regression — MAP Mode

- [ ] Paint tool: click/drag on canvas paints terrain
- [ ] Fill tool: flood-fills a region
- [ ] Rectangle tool: drag to fill a rectangle
- [ ] Eyedropper: click a tile to select its terrain
- [ ] Settlement placement: place and erase settlement markers
- [ ] Zoom in/out via View menu and mouse wheel
- [ ] Save map → `map.json` downloads correctly
- [ ] Load map → previously saved map loads correctly

---

## 6. Regression — HEX DB Mode

- [ ] Click HEX DB tab → empty state shown
- [ ] `+ Add Hex` → blank hex record appears
- [ ] Fill id, biome, type → list updates
- [ ] Search and biome/type filters work
- [ ] Save → `hex_database.json` downloads
- [ ] Load → data reloads correctly

---

## Reporting Issues

For each bug found, note:
1. **Which mode** (MAP / HEX DB / BUILDINGS / SETTLEMENTS)
2. **Steps to reproduce** — exact click sequence
3. **Expected result** vs **actual result**
4. **Browser + OS** (e.g., Chrome 124 / macOS 15)

Report to: `colonel.tutor@gmail.com` or create a GitHub issue on `PostApocCityBuilder`.

---

## Sign-Off Checklist

All items below must pass before Phase 1 is marked complete:

- [ ] BUILDINGS: add / edit / copy / paste / delete / save / load all work
- [ ] SETTLEMENTS: same, plus `unlockBuildings` field present per level
- [ ] Mode switching: all 4 tabs switch correctly, Tab key cycles
- [ ] MAP mode: unaffected (regression)
- [ ] HEX DB mode: unaffected (regression)
- [ ] Round-trip: save JSON → reload page → load JSON → data identical
