# HexDB Income Section Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **NO COMMITS** — leave changes local; await user approval before any git operations.

**Goal:** Redesign the INCOME section: add Tap Income/Destroyable gate, Transform to datalist, Capacity field, Get per Tap block, extend Per Turn to resource block, add Income Idle/Constant/Spend Constant resource blocks.

**Architecture:** All changes in HexDB IIFE in `MapEditorPro.html`. Extends `_resourceBlockHTML` with an optional `resTypes` param for Spend Constant (Pollution/Energy). Adds `_migrateIncomeFields` following the established migration pattern. Custom wiring for Tap Income toggle and Transform to mode select.

**Tech Stack:** Vanilla JS, HTML — single file. No build step. Manual Chrome verification.

---

## Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `MapEditorPro.html:3357–3384` | Add `SPEND_RES_TYPES` constant; extend `_resourceBlockHTML` with optional 4th param |
| Modify | `MapEditorPro.html:3199–3200` | `_blank()` — replace income fields |
| Modify | `MapEditorPro.html:~3820` | Add `_migrateIncomeFields()` after `_migrateBuildFields`; call at both sites |
| Modify | `MapEditorPro.html:3455–3461` | Replace `incomeBody` array |
| Modify | `MapEditorPro.html:~3560` | Add `tapIncomeEnabled` toggle + Transform to mode wiring |

---

## Task 1 — Extend `_resourceBlockHTML` and add `SPEND_RES_TYPES`

**File:** `MapEditorPro.html:3357–3384`

- [ ] **Read** lines 3357–3384 to confirm current state:
  ```js
  const DESTROY_RES_TYPES = ['Gold','Gems','Food','Lumber','Stone',
    'Steel','Oil','Chips','Clay'];

  function _resourceBlockHTML(fieldName, rows, disabled) {
    const dis = disabled ? ' disabled' : '';
    const rowsHTML = (rows || []).map((r, i) => {
      const stdOpts = DESTROY_RES_TYPES.map(t =>
        `<option${t === r.type ? ' selected' : ''}>${t}</option>`
      ).join('');
      const customOpt = DESTROY_RES_TYPES.includes(r.type) ? '' :
        `<option selected>${_esc(r.type)}</option>`;
      ...
  ```

- [ ] **Replace** the `DESTROY_RES_TYPES` constant and entire `_resourceBlockHTML` function with:

  ```js
  const DESTROY_RES_TYPES = ['Gold','Gems','Food','Lumber','Stone',
    'Steel','Oil','Chips','Clay'];
  const SPEND_RES_TYPES = ['Pollution','Energy','Gold','Gems','Food',
    'Lumber','Stone','Steel','Oil','Chips','Clay'];

  function _resourceBlockHTML(fieldName, rows, disabled, resTypes) {
    const types = resTypes || DESTROY_RES_TYPES;
    const dis = disabled ? ' disabled' : '';
    const rowsHTML = (rows || []).map((r, i) => {
      const stdOpts = types.map(t =>
        `<option${t === r.type ? ' selected' : ''}>${t}</option>`
      ).join('');
      const customOpt = types.includes(r.type) ? '' :
        `<option selected>${_esc(r.type)}</option>`;
      return `<div class="hexdb-res-row">
        <select class="hexdb-select" style="width:110px"
          data-res-field="${fieldName}" data-res-index="${i}"${dis}>
          ${stdOpts}${customOpt}
        </select>
        <input class="hexdb-input" type="number" step="1" min="0" style="width:90px"
          data-res-field="${fieldName}" data-res-index="${i}"
          data-res-key="amount" value="${r.amount ?? 0}"${dis}>
        <button class="hexdb-res-remove"
          data-res-field="${fieldName}" data-res-index="${i}"${dis}>✕</button>
      </div>`;
    }).join('');
    return `<div>
      ${rowsHTML}
      <button class="hexdb-res-add" data-res-field="${fieldName}"${dis}>+ Add Resource</button>
    </div>`;
  }
  ```

- [ ] **Verify**: `SPEND_RES_TYPES` appears once. `_resourceBlockHTML` now accepts 4 params. Existing calls with 3 args still work (4th param defaults to `DESTROY_RES_TYPES` via `resTypes || DESTROY_RES_TYPES`).

---

## Task 2 — Update `_blank()` and add `_migrateIncomeFields`

### 2a — `_blank()` at lines 3199–3200

- [ ] **Read** the current lines to confirm:
  ```js
        incomeOnCapture:0, incomePerTurn:0, incomeOccupiedPerTurn:0,
        humanResourcesPerHex:0, damageModifier:0,
  ```

- [ ] **Replace** those two lines with:
  ```js
        tapIncomeEnabled:false, destroyable:false,
        incomeTransformTo:'Plains_1', incomeCapacity:3,
        incomeGetPerTap:[], incomePerTurn:[],
        incomeIdle:[], incomeConstant:[],
        spendConstant:[{type:'Pollution',amount:1}],
  ```

  Verify the full surrounding context remains intact (`bonusDrop`, `booster`, etc. unchanged).

### 2b — Add `_migrateIncomeFields` function

- [ ] **Find** `function _migrateBuildFields(hexes)` (~line 3785). Insert the following **immediately after** its closing `}`:

  ```js
  function _migrateIncomeFields(hexes) {
    hexes.forEach(h => {
      // Migrate incomePerTurn from number to array
      if (!Array.isArray(h.incomePerTurn)) {
        const n = h.incomePerTurn ?? 0;
        h.incomePerTurn = n > 0 ? [{ type: 'Gold', amount: n }] : [];
      }
      // Migrate damageModifier → incomeCapacity
      if (h.damageModifier !== undefined) {
        h.incomeCapacity = Math.max(1, h.damageModifier || 3);
        delete h.damageModifier;
      }
      // Default new fields
      if (h.tapIncomeEnabled === undefined)   h.tapIncomeEnabled = false;
      if (h.destroyable === undefined)        h.destroyable = false;
      if (!h.incomeTransformTo)              h.incomeTransformTo = 'Plains_1';
      if (h.incomeCapacity === undefined)    h.incomeCapacity = 3;
      if (!Array.isArray(h.incomeGetPerTap)) h.incomeGetPerTap = [];
      if (!Array.isArray(h.incomeIdle))      h.incomeIdle = [];
      if (!Array.isArray(h.incomeConstant))  h.incomeConstant = [];
      if (!Array.isArray(h.spendConstant))   h.spendConstant = [{ type: 'Pollution', amount: 1 }];
      // Remove stale fields
      delete h.incomeOnCapture;
      delete h.incomeOccupiedPerTurn;
      delete h.humanResourcesPerHex;
    });
  }
  ```

### 2c — Call migration at both sites

- [ ] **Find** the two occurrences of `_migrateBuildFields(_data.hexes)`. Add `_migrateIncomeFields(_data.hexes);` immediately after each.

- [ ] **Verify**: `_migrateIncomeFields` appears exactly 3 times (1 def + 2 calls). `incomeOnCapture`, `damageModifier`, `humanResourcesPerHex` absent from `_blank()`.

---

## Task 3 — Replace `incomeBody`

**File:** `MapEditorPro.html:3455–3461`

- [ ] **Locate** the `incomeBody` array. Confirm it reads:
  ```js
      const incomeBody = [
        _row('OnCapture',     _numInput('incomeOnCapture',      hex.incomeOnCapture)),
        _row('PerTurn',       _numInput('incomePerTurn',        hex.incomePerTurn)),
        _row('OccupiedPerTurn',_numInput('incomeOccupiedPerTurn',hex.incomeOccupiedPerTurn)),
        _row('HumanResources',_numInput('humanResourcesPerHex',hex.humanResourcesPerHex)),
        _row('DamageMod',     _numInput('damageModifier',       hex.damageModifier)),
      ].join('');
  ```

- [ ] **Replace** the entire block with:
  ```js
      const tapOn = hex.tapIncomeEnabled ?? false;
      const desOn = hex.destroyable ?? false;
      const tapDis = tapOn ? '' : ' disabled';
      const isParent = (hex.incomeTransformTo ?? '') === '__parent__';
      const incomeBody = [
        // Tap Income + Destroyable on same row
        `<div class="hexdb-row hexdb-checkbox-row">
           <span class="hexdb-label"></span>
           <input type="checkbox" data-field="tapIncomeEnabled"${tapOn ? ' checked' : ''}>
           <label>hex earns on tap</label>
           <input type="checkbox" data-field="destroyable"
             ${desOn ? ' checked' : ''}${tapDis}>
           <label style="${tapOn ? '' : 'color:var(--muted)'}">Destroyable</label>
         </div>`,
        // Transform to — active when tapOn AND desOn
        _row('Transform to', (() => {
          const active = tapOn && desOn;
          const d = active ? '' : ' disabled';
          return `<div style="display:flex;gap:6px;align-items:center">
            <input class="hexdb-input" list="hexdb-id-list"
              data-field="incomeTransformTo" style="width:160px"
              value="${isParent ? '' : _esc(hex.incomeTransformTo ?? 'Plains_1')}"
              ${isParent ? ' disabled' : ''}${d}>
            <select class="hexdb-select" id="income-transform-mode"
              style="width:100px"${d}>
              <option${isParent ? '' : ' selected'}>Hex ID</option>
              <option${isParent ? ' selected' : ''}>Parent Hex</option>
            </select>
          </div>`;
        })()),
        // Capacity
        _row('Capacity',
          `<input class="hexdb-input" type="number" step="1" min="1"
             style="width:110px" data-field="incomeCapacity"
             value="${hex.incomeCapacity ?? 3}"${tapDis}>`),
        // Get per Tap
        _row('Get per Tap',
          _resourceBlockHTML('incomeGetPerTap', hex.incomeGetPerTap ?? [], !tapOn)),
        // Per Turn
        _row('Per Turn',
          _resourceBlockHTML('incomePerTurn', hex.incomePerTurn ?? [], false)),
        // Income Idle
        _row('Income Idle',
          _resourceBlockHTML('incomeIdle', hex.incomeIdle ?? [], false)),
        // Income Constant
        _row('Income Constant',
          _resourceBlockHTML('incomeConstant', hex.incomeConstant ?? [], false)),
        // Spend Constant
        _row('Spend Constant',
          _resourceBlockHTML('spendConstant',
            hex.spendConstant ?? [{ type: 'Pollution', amount: 1 }],
            false, SPEND_RES_TYPES)),
      ].join('');
  ```

- [ ] **Verify**: `incomeOnCapture`, `incomeOccupiedPerTurn`, `humanResourcesPerHex`, `damageModifier` absent from `incomeBody`. `SPEND_RES_TYPES` used for `spendConstant`. `tapDis` and `tapOn && desOn` used consistently.

---

## Task 4 — Add `tapIncomeEnabled` toggle + Transform to mode wiring

**File:** `MapEditorPro.html` — inside `_renderRecord`, after existing toggle listeners (~line 3535).

- [ ] **Find** the `canBuild` toggle block:
  ```js
      // ── Wire Can Build toggle → re-render ─────────────────────
      const canBldEl = document.querySelector('#hexdb-right [data-field="canBuild"]');
      if (canBldEl) { ... }
  ```

- [ ] **Insert** immediately after its closing `}`:

  ```js
      // ── Wire Tap Income toggle → re-render + auto-set Destroyable ─
      const tapIncEl = document.querySelector('#hexdb-right [data-field="tapIncomeEnabled"]');
      if (tapIncEl) {
        tapIncEl.addEventListener('change', () => {
          if (_selFilt < 0) return;
          const h = _data.hexes[_filtered[_selFilt]];
          if (h.tapIncomeEnabled && !h.destroyable) {
            h.destroyable = true;
          }
          _renderRecord(h);
        });
      }

      // ── Wire Transform to mode select ─────────────────────────────
      const modeEl = document.getElementById('income-transform-mode');
      if (modeEl) {
        modeEl.addEventListener('change', () => {
          if (_selFilt < 0) return;
          const h = _data.hexes[_filtered[_selFilt]];
          h.incomeTransformTo = modeEl.value === 'Parent Hex' ? '__parent__' : 'Plains_1';
          _autoSave();
          _renderRecord(h);
        });
      }
  ```

- [ ] **Verify**: `tapIncEl` appears once. `modeEl` (via `getElementById('income-transform-mode')`) appears once in wiring. Both inserted after `canBldEl` block.

---

## Task 5 — In-browser verification

Open `MapEditorPro.html` directly in Chrome.

- [ ] Switch to **HEX DB**, click **+ Add Hex**, expand **INCOME** section. Confirm:
  - `Tap Income` checkbox + `Destroyable` checkbox on same row (both unchecked)
  - `Transform to`, `Capacity`, `Get per Tap` — all disabled
  - `Per Turn`, `Income Idle`, `Income Constant`, `Spend Constant` — all enabled
  - `Spend Constant` has one row: Pollution=1
  - No `OnCapture`, `OccupiedPerTurn`, `HumanResources`, `DamageMod` fields

- [ ] **Check Tap Income = Yes:**
  - `Destroyable` auto-checks (becomes Yes)
  - `Transform to` + `Capacity` + `Get per Tap` — all enable
  - Uncheck `Destroyable` → `Transform to` goes back to disabled

- [ ] **Check Transform to mode:**
  - Select `Parent Hex` → text input disables, value clears
  - Select `Hex ID` → text input enables with `Plains_1`
  - Type `Forest_1` → confirmed in `Transform to` on re-render

- [ ] **Check Spend Constant type list** includes `Pollution` and `Energy` (not in other resource blocks)

- [ ] **Save + verify JSON:** click 💾 Save DB. Open JSON and confirm:
  - `tapIncomeEnabled`, `destroyable`, `incomeTransformTo`, `incomeCapacity:3`, `incomeGetPerTap`, `incomePerTurn`, `incomeIdle`, `incomeConstant`, `spendConstant:[{type:"Pollution",amount:1}]`
  - Absent: `incomeOnCapture`, `incomeOccupiedPerTurn`, `humanResourcesPerHex`, `damageModifier`

- [ ] **Migration test:** load old JSON containing `incomePerTurn:5` and `damageModifier:4`. Confirm `Per Turn` shows Gold=5 row, `Capacity` shows 4.

---

## ⚠️ No commits — await user approval before any git operations
