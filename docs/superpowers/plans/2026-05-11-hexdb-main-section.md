# HexDB Main Section Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the MAIN section of the HexDB hex record editor: add two description ID fields, replace the three-resource BaseCost row with a single Base Cost Taps field.

**Architecture:** Single vanilla-JS HTML file (`MapEditorPro.html`). All changes are in the `HexDB` IIFE — two locations: `_blank()` (data model defaults) and `mainBody` inside `_renderRecord` (HTML generation). No test framework; verification is manual in-browser.

**Tech Stack:** Vanilla JS, HTML, CSS — all in one file. No build step.

---

## Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `MapEditorPro.html:3153–3168` | `_blank()` — add new keys, remove old baseCost keys |
| Modify | `MapEditorPro.html:3308–3327` | `mainBody` in `_renderRecord` — add 2 rows, replace 1 row |
| Modify | `MapEditorPro.html` | VERSION, `<title>`, statusbar label → `0.4.0` |
| Modify | `CHANGELOG.md` | Add `v0.4.0` entry |

---

## Task 1 — Update `_blank()` data model

**File:** `MapEditorPro.html:3153–3168`

The current `_blank()` function (line 3153) returns the default object for a new hex. We add three keys and remove three.

- [ ] **Open** `MapEditorPro.html` and locate line 3157. The current line reads:
  ```
  baseCostGold:0, baseCostGems:0, baseCostEvent:0, mainField9:0,
  ```

- [ ] **Replace** lines 3155–3157 (the first three lines of the returned object) with:
  ```js
      id:'', textId:'', type:'Special', biome:'Summer',
      filterCategory:'FilterTerrain', spriteName:'',
      descriptionIdleId:'', descriptionBuildId:'', baseCostTaps:0,
  ```
  The full updated `_blank()` should now read:
  ```js
  function _blank() {
    return {
      id:'', textId:'', type:'Special', biome:'Summer',
      filterCategory:'FilterTerrain', spriteName:'',
      descriptionIdleId:'', descriptionBuildId:'', baseCostTaps:0,
      destroyIncomeGold:0, destroyIncomeGems:0, destroyTransformTo:'',
      destroyCondition:'', destroyBonus:0, destroyEffect:'',
      destroyDelay:0, destroyRequiresRoad:false,
      buildCostGold:0, buildCostGems:0, buildCostEvent:0,
      buildRequiresRoad:false, buildPlacementRule:'',
      buildMinLevel:0, buildMaxPerMap:0,
      incomeOnCapture:0, incomePerTurn:0, incomeOccupiedPerTurn:0,
      humanResourcesPerHex:0, damageModifier:0,
      bonusDrop:'', booster:'',
      storageCapacity:0, energyConsumption:0, pollutionConstant:0,
    };
  }
  ```

- [ ] **Verify** by searching for `baseCostGold` in the HexDB IIFE (lines 3100–3440). It should only appear in `mainBody` (Task 2 target) and nowhere else in `_blank`.

- [ ] **Commit** (do not commit yet — continue to Task 2, commit after both tasks together).

---

## Task 2 — Update `mainBody` in `_renderRecord`

**File:** `MapEditorPro.html:3308–3327`

The `mainBody` array (line 3308) builds the HTML for the MAIN section. We insert two rows after TextId and replace the BaseCost row.

- [ ] **Locate** line 3312:
  ```js
        _row('TextId',          _textInput('textId', hex.textId)),
  ```

- [ ] **After** the TextId row (line 3312), **insert** two new rows:
  ```js
        _row('Desc Idle',  _textInput('descriptionIdleId',  hex.descriptionIdleId  ?? '')),
        _row('Desc Build', _textInput('descriptionBuildId', hex.descriptionBuildId ?? '')),
  ```
  The `?? ''` guard ensures no `undefined` appears for hexes loaded from old JSON files that predate these fields.

- [ ] **Replace** the BaseCost row (lines 3324–3326):
  ```js
        _row('BaseCost',        _costRow(
          [{label:'Gold',field:'baseCostGold'},{label:'Gems',field:'baseCostGems'},{label:'Event',field:'baseCostEvent'}],
          [hex.baseCostGold, hex.baseCostGems, hex.baseCostEvent])),
  ```
  With:
  ```js
        _row('Base Cost Taps',
          `<input class="hexdb-input" type="number" step="1" min="0"
             style="width:110px" data-field="baseCostTaps"
             value="${hex.baseCostTaps ?? 0}">`),
  ```

  The final `mainBody` array should look like:
  ```js
  const mainBody = [
    `<div class="hexdb-row"><span class="hexdb-label">Id *</span>
     <input class="hexdb-input" id="hexdb-id" data-field="id" value="${_esc(hex.id)}" placeholder="e.g. Plain_1">
     <small style="color:#888;font-size:0.8em;display:block;margin-top:2px">Format: TypeName_Number (e.g. Plain_1, Forest_2)</small></div>`,
    _row('TextId',         _textInput('textId', hex.textId)),
    _row('Desc Idle',      _textInput('descriptionIdleId',  hex.descriptionIdleId  ?? '')),
    _row('Desc Build',     _textInput('descriptionBuildId', hex.descriptionBuildId ?? '')),
    _row('Type',           `<select class="hexdb-select" data-field="type">${_typeGroupOptions(hex.type)}</select>`),
    _row('Biome',          _selectInput('biome', BIOMES, hex.biome)),
    _row('Filter',         _selectInput('filterCategory', FILTER_CATS, hex.filterCategory)),
    _row('SpriteName',
      `<div style="display:flex;gap:6px;align-items:flex-start;width:100%">` +
      `<div style="flex:1;min-width:0">` +
      _textInput('spriteName', hex.spriteName) +
      `<small style="color:#888;font-size:0.8em;display:block;margin-top:2px">Web editor: sprites/hex/&lt;name&gt;.png &nbsp;|&nbsp; Unity: Resources/Hex/&lt;name&gt;</small>` +
      `</div>` +
      `<button class="hexdb-tool-btn" onclick="HexDB.pickSprite()" title="Browse sprites">🖼</button>` +
      `</div>`),
    _row('Base Cost Taps',
      `<input class="hexdb-input" type="number" step="1" min="0"
         style="width:110px" data-field="baseCostTaps"
         value="${hex.baseCostTaps ?? 0}">`),
  ].join('');
  ```

- [ ] **Verify** there are no remaining references to `baseCostGold`, `baseCostGems`, or `baseCostEvent` inside the `HexDB` IIFE (search lines 3100–3444). The only acceptable hits would be in comments.

---

## Task 3 — In-browser verification

Open `MapEditorPro.html` directly in Chrome (File → Open, or drag-and-drop).

- [ ] Switch to **HEX DB** tab. Load or create a hex database (click "+ Add Hex" to create one).

- [ ] Select a hex from the list. Confirm the MAIN section shows:
  - `Desc Idle` field (empty, editable)
  - `Desc Build` field (empty, editable)
  - **No** BaseCost Gold/Gems/Event row
  - `Base Cost Taps` number input at the bottom, 110px wide, min=0

- [ ] Type a value into `Desc Idle` (e.g. `hex_forest_idle`). Click another hex, then click back. Confirm the value is preserved.

- [ ] Type a number into `Base Cost Taps` (e.g. `123456789` — 9 digits). Confirm it fits without clipping.

- [ ] Click the 💾 **Save DB** button in the HexDB toolbar. Open the downloaded `hex_database.json`. Confirm:
  - `descriptionIdleId` and `descriptionBuildId` fields are present with correct values
  - `baseCostTaps` is present
  - `baseCostGold`, `baseCostGems`, `baseCostEvent` are **absent**

- [ ] Load a **pre-existing** hex_database.json that has old `baseCostGold/Gems/Event` keys. Confirm:
  - The editor loads without errors
  - `Desc Idle`, `Desc Build` show empty (old files had no such keys — `?? ''` guard handles this)
  - `Base Cost Taps` shows `0` (`?? 0` guard handles this)

---

## Task 4 — Version bump, changelog, commit, publish

- [ ] In `MapEditorPro.html`, update all three version references:
  - `const VERSION = "0.4.0";`
  - `<title>MapEditorPro v0.4.0</title>`
  - statusbar: `v0.4.0`

- [ ] In `CHANGELOG.md`, prepend:
  ```markdown
  ## v0.4.0 — 2026-05-11

  ### Features
  - HexDB Main section: added `Desc Idle` and `Desc Build` text fields for
    localisation key references (position: after TextId, before Type)
  - HexDB Main section: replaced BaseCost Gold/Gems/Event inputs with a single
    `Base Cost Taps` number field (9-char wide, min 0)

  ---
  ```

- [ ] Commit:
  ```bash
  git add MapEditorPro.html CHANGELOG.md
  git commit -m "feat: redesign HexDB Main section — add Desc Idle/Build fields, replace BaseCost with Base Cost Taps (v0.4.0)"
  ```

- [ ] Push and publish:
  ```bash
  git push
  cp MapEditorPro.html /Users/sergii.tyshchenko/MapEditorPublish/MapEditorPro.html
  cp CHANGELOG.md /Users/sergii.tyshchenko/MapEditorPublish/CHANGELOG.md
  ```
