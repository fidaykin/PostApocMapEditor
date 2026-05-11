# HexDB Build Section Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **NO COMMITS** — leave changes local; await user approval before any git operations.

**Goal:** Redesign the BUILD section of HexDB: add Can Build/Need Road gate, Available Tiles tags, dynamic Price block, Premium Price field; remove MaxPerMap; move Placement Rule to bottom.

**Architecture:** All changes in the HexDB IIFE in `MapEditorPro.html`. Reuses `_sourceTagsHTML` and `_resourceBlockHTML` helpers from the Destroy section (already in the file). The `canBuild` toggle re-renders via the same pattern as `canDestroy`. No new CSS or helper functions needed.

**Tech Stack:** Vanilla JS, HTML — single file. No build step. No automated tests — manual Chrome verification.

---

## Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `MapEditorPro.html:3195–3197` | `_blank()` — replace build fields |
| Modify | `MapEditorPro.html:~3734` | Add `_migrateBuildFields()` after `_migrateDestroyFields` |
| Modify | `MapEditorPro.html:3632–3633` + `3763–3764` | Call `_migrateBuildFields` at both migration sites |
| Modify | `MapEditorPro.html:3428–3436` | Replace `buildBody` array |
| Modify | `MapEditorPro.html:~3500` | Add `canBuild` toggle wiring after `canDestroy` wiring |

---

## Task 1 — Update `_blank()` and add `_migrateBuildFields`

**File:** `MapEditorPro.html`

### 1a — `_blank()` at lines 3195–3197

- [ ] **Read** the current build lines in `_blank()` to confirm they match:
  ```js
        buildCostGold:0, buildCostGems:0, buildCostEvent:0,
        buildRequiresRoad:false, buildPlacementRule:'',
        buildMinLevel:0, buildMaxPerMap:0,
  ```

- [ ] **Replace** those three lines with:
  ```js
        canBuild:false, buildRequiresRoad:false,
        buildAvailableTiles:[], buildMinLevel:1,
        buildPrice:[], buildPremiumPrice:0,
        buildPlacementRule:'',
  ```

  The surrounding `_blank()` context must remain intact. Verify the full `_blank()` now reads:
  ```js
  function _blank() {
    return {
      id:'', textId:'', type:'Special', biome:'Summer',
      filterCategory:'FilterTerrain', spriteName:'',
      descriptionIdleId:'', descriptionBuildId:'', baseCostTaps:0,
      canDestroy:false, destroyTransformTo:'Plains_1',
      destroySource:[], canStored:false,
      destroyIncomeEnabled:false, destroyIncome:[],
      canBuild:false, buildRequiresRoad:false,
      buildAvailableTiles:[], buildMinLevel:1,
      buildPrice:[], buildPremiumPrice:0,
      buildPlacementRule:'',
      incomeOnCapture:0, incomePerTurn:0, incomeOccupiedPerTurn:0,
      humanResourcesPerHex:0, damageModifier:0,
      bonusDrop:'', booster:'',
      storageCapacity:0, energyConsumption:0, pollutionConstant:0,
    };
  }
  ```

### 1b — Add `_migrateBuildFields` function

- [ ] **Locate** `function _migrateDestroyFields(hexes)` (around line 3734). Insert the following function **immediately after** the closing `}` of `_migrateDestroyFields`:

  ```js
  function _migrateBuildFields(hexes) {
    hexes.forEach(h => {
      if (!Array.isArray(h.buildPrice)) {
        h.buildPrice = [];
        if ((h.buildCostGold ?? 0) > 0) {
          h.buildPrice.push({ type: 'Gold', amount: h.buildCostGold });
          h.canBuild = true;
        }
        if ((h.buildCostGems ?? 0) > 0) {
          h.buildPrice.push({ type: 'Gems', amount: h.buildCostGems });
          h.canBuild = true;
        }
        if ((h.buildCostEvent ?? 0) > 0) {
          h.buildPrice.push({ type: 'Event', amount: h.buildCostEvent });
          h.canBuild = true;
        }
        delete h.buildCostGold;
        delete h.buildCostGems;
        delete h.buildCostEvent;
      }
      if (h.canBuild === undefined)                 h.canBuild = false;
      if (!Array.isArray(h.buildAvailableTiles))    h.buildAvailableTiles = [];
      if (h.buildMinLevel === undefined)            h.buildMinLevel = 1;
      if (h.buildPremiumPrice === undefined)        h.buildPremiumPrice = 0;
      if (h.buildMaxPerMap !== undefined)           delete h.buildMaxPerMap;
    });
  }
  ```

### 1c — Call migration at both sites

- [ ] **Find** the two occurrences of `_migrateDestroyFields(_data.hexes)` (lines ~3633 and ~3764). Add `_migrateBuildFields(_data.hexes);` on the line immediately after each:

  Site 1 (init autosave restore, ~line 3633):
  ```js
          _migrateHexTypes(_data.hexes);
          _migrateDestroyFields(_data.hexes);
          _migrateBuildFields(_data.hexes);   // ← add this
  ```

  Site 2 (load function, ~line 3764):
  ```js
      _migrateHexTypes(_data.hexes);
      _migrateDestroyFields(_data.hexes);
      _migrateBuildFields(_data.hexes);   // ← add this
  ```

- [ ] **Verify**: search for `_migrateBuildFields` — must appear exactly 3 times (1 definition + 2 calls). Search for `buildCostGold` in `_blank()` — must not exist.

---

## Task 2 — Replace `buildBody`

**File:** `MapEditorPro.html:3428–3436`

- [ ] **Locate** the `buildBody` array. Confirm it currently reads:
  ```js
      const buildBody = [
        _row('Cost', _costRow(
          [{label:'Gold',field:'buildCostGold'},{label:'Gems',field:'buildCostGems'},{label:'Event',field:'buildCostEvent'}],
          [hex.buildCostGold, hex.buildCostGems, hex.buildCostEvent])),
        _checkRow('buildRequiresRoad', hex.buildRequiresRoad, 'Requires road to build'),
        _row('PlacementRule', _textInput('buildPlacementRule', hex.buildPlacementRule)),
        _row('MinLevel',      _numInput('buildMinLevel',       hex.buildMinLevel)),
        _row('MaxPerMap',     _numInput('buildMaxPerMap',      hex.buildMaxPerMap)),
      ].join('');
  ```

- [ ] **Replace** the entire block with:
  ```js
      const canBld = hex.canBuild ?? false;
      const bdis = canBld ? '' : ' disabled';
      const buildBody = [
        // Can Build + Need Road on same row
        `<div class="hexdb-row hexdb-checkbox-row">
           <span class="hexdb-label"></span>
           <input type="checkbox" data-field="canBuild"${canBld ? ' checked' : ''}>
           <label>hex can be built</label>
           <input type="checkbox" data-field="buildRequiresRoad"
             ${(hex.buildRequiresRoad ?? false) ? ' checked' : ''}${bdis}>
           <label style="${canBld ? '' : 'color:var(--muted)'}">Need Road</label>
         </div>`,
        _row('Available Tiles',
          _sourceTagsHTML('buildAvailableTiles', hex.buildAvailableTiles ?? [], !canBld)),
        _row('MinLevel',
          `<input class="hexdb-input" type="number" step="1" min="0"
             style="width:110px" data-field="buildMinLevel"
             value="${hex.buildMinLevel ?? 1}"${bdis}>`),
        _row('Price', _resourceBlockHTML('buildPrice', hex.buildPrice ?? [], !canBld)),
        _row('Premium Price',
          `<input class="hexdb-input" type="number" step="1" min="0"
             style="width:110px" data-field="buildPremiumPrice"
             value="${hex.buildPremiumPrice ?? 0}"${bdis}>`),
        _row('Placement Rule', _textInput('buildPlacementRule', hex.buildPlacementRule ?? '')),
      ].join('');
  ```

- [ ] **Verify**: `buildCostGold`, `buildCostGems`, `buildCostEvent`, `buildMaxPerMap` do not appear in the new `buildBody`.

---

## Task 3 — Add `canBuild` toggle wiring

**File:** `MapEditorPro.html` — inside `_renderRecord`, after the `canDestroy` listener block (~line 3502).

- [ ] **Locate** this block:
  ```js
      // ── Wire Can Destroy toggle → re-render ──────────────────
      const canDesEl = document.querySelector('#hexdb-right [data-field="canDestroy"]');
      if (canDesEl) {
        canDesEl.addEventListener('change', () => {
          if (_selFilt < 0) return;
          _renderRecord(_data.hexes[_filtered[_selFilt]]);
        });
      }
  ```

- [ ] **Insert** immediately after the closing `}` of that block:
  ```js
      // ── Wire Can Build toggle → re-render ─────────────────────
      const canBldEl = document.querySelector('#hexdb-right [data-field="canBuild"]');
      if (canBldEl) {
        canBldEl.addEventListener('change', () => {
          if (_selFilt < 0) return;
          _renderRecord(_data.hexes[_filtered[_selFilt]]);
        });
      }
  ```

- [ ] **Verify**: `canBldEl` appears exactly once in the file. The `Available Tiles` tags and `Price` resource block do NOT need additional wiring — the existing generic `hexdb-tag-input`, `hexdb-tag-remove`, `[data-res-field]`, and `hexdb-res-add` selectors already cover them.

---

## Task 4 — In-browser verification

Open `MapEditorPro.html` directly in Chrome.

- [ ] Switch to **HEX DB**, click **+ Add Hex**, select the new hex, expand **BUILD** section. Confirm:
  - `Can Build` checkbox + `Need Road` checkbox on the same row (both unchecked by default)
  - `Available Tiles` tags input — disabled
  - `MinLevel` field — shows `1`, disabled
  - `Price` resource block — `+ Add Resource` button disabled
  - `Premium Price` — shows `0`, disabled
  - `Placement Rule` — enabled (always), at bottom
  - No `MaxPerMap` field

- [ ] **Check Can Build = Yes:**
  - Check `Can Build` → all fields enable
  - Type `Plain_1` in `Available Tiles`, press Enter → tag appears; click ✕ → tag removed
  - Click `+ Add Resource` in Price → Gold row appears, set amount to 50
  - Set `Premium Price` to 100
  - Check `Need Road` → stays checked after re-render

- [ ] **Save and verify JSON:**
  - Click 💾 **Save DB** → open downloaded `hex_database.json`
  - Confirm: `canBuild:true`, `buildAvailableTiles:["Plain_1"]`, `buildPrice:[{type:"Gold",amount:50}]`, `buildPremiumPrice:100`, `buildRequiresRoad:true`
  - Confirm absent: `buildCostGold`, `buildCostGems`, `buildCostEvent`, `buildMaxPerMap`

- [ ] **Migration test:**
  - Load an old `hex_database.json` containing `buildCostGold:200`
  - Confirm: `Can Build` is checked, Price shows one Gold row with amount 200

---

## ⚠️ No commits — await user approval before any git operations
