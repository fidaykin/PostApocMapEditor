# HexDB Special Section Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **NO COMMITS** — leave changes local; await user approval before any git operations.

**Goal:** Restructure the SPECIAL section — Bonus Drop checkbox gates Triggers dropdown + Bonuses resource block; remove 3 stale fields; add Effects locked placeholder.

**Architecture:** All changes in HexDB IIFE. Three tasks: data model + migration, specialBody replacement, bonusDrop toggle wiring. Reuses existing `_resourceBlockHTML` helper (no new helpers needed).

**Tech Stack:** Vanilla JS, HTML — single file. No build step. Manual Chrome verification.

---

## Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `MapEditorPro.html:3204–3205` | `_blank()` — replace special fields |
| Modify | `MapEditorPro.html:~3927` | Add `_migrateSpecialFields()` after `_migrateIncomeFields`; call at both sites |
| Modify | `MapEditorPro.html:3515–3521` | Replace `specialBody` array |
| Modify | `MapEditorPro.html:~3630` | Add `bonusDrop` toggle wiring after `tapIncEl` block |

---

## Task 1 — Update `_blank()` and add `_migrateSpecialFields`

### 1a — `_blank()` at lines 3204–3205

- [ ] **Read** to confirm current lines:
  ```js
        bonusDrop:'', booster:'',
        storageCapacity:0, energyConsumption:0, pollutionConstant:0,
  ```

- [ ] **Replace** those two lines with:
  ```js
        bonusDrop:false, bonusTrigger:'Destroy', bonuses:[],
        booster:'', effects:'',
  ```

  The full updated context must be:
  ```js
      bonusDrop:false, bonusTrigger:'Destroy', bonuses:[],
      booster:'', effects:'',
    };
  }
  ```
  (`storageCapacity`, `energyConsumption`, `pollutionConstant` must be gone.)

### 1b — Add `_migrateSpecialFields` after `_migrateIncomeFields` (~line 3927)

Find the closing `}` of `function _migrateIncomeFields(hexes)`. Insert immediately after:

```js
  function _migrateSpecialFields(hexes) {
    hexes.forEach(h => {
      // bonusDrop was a text field — convert to boolean
      if (typeof h.bonusDrop !== 'boolean') {
        h.bonusDrop = !!h.bonusDrop;
      }
      if (!h.bonusTrigger)              h.bonusTrigger = 'Destroy';
      if (!Array.isArray(h.bonuses))    h.bonuses = [];
      if (h.effects === undefined)      h.effects = '';
      // Remove stale fields
      delete h.storageCapacity;
      delete h.energyConsumption;
      delete h.pollutionConstant;
    });
  }
```

### 1c — Call migration at both sites

Find the two occurrences of `_migrateIncomeFields(_data.hexes)` (lines ~3738 and ~3927 call site). Add `_migrateSpecialFields(_data.hexes);` on the line immediately after each.

- [ ] **Verify**: `_migrateSpecialFields` appears exactly 3 times. `storageCapacity`, `energyConsumption`, `pollutionConstant` absent from `_blank()`. `bonusDrop:false` present.

---

## Task 2 — Replace `specialBody`

**File:** `MapEditorPro.html:3515–3521`

- [ ] **Confirm** current `specialBody`:
  ```js
      const specialBody = [
        _row('BonusDrop',          _textInput('bonusDrop',          hex.bonusDrop)),
        _row('Booster',            _textInput('booster',            hex.booster)),
        _row('StorageCapacity',    _numInput('storageCapacity',     hex.storageCapacity)),
        _row('EnergyConsumption',  _numInput('energyConsumption',   hex.energyConsumption)),
        _row('PollutionConstant',  _numInput('pollutionConstant',   hex.pollutionConstant)),
      ].join('');
  ```

- [ ] **Replace** the entire block with:
  ```js
      const bdOn = hex.bonusDrop ?? false;
      const bdDis = bdOn ? '' : ' disabled';
      const specialBody = [
        _checkRow('bonusDrop', bdOn, 'has bonus drop on trigger'),
        _row('Triggers',
          `<select class="hexdb-select" style="width:120px"
             data-field="bonusTrigger"${bdDis}>
             <option${(hex.bonusTrigger ?? 'Destroy') === 'Destroy' ? ' selected' : ''}>Destroy</option>
             <option${(hex.bonusTrigger ?? '') === 'Reveal' ? ' selected' : ''}>Reveal</option>
             <option${(hex.bonusTrigger ?? '') === 'Build'  ? ' selected' : ''}>Build</option>
           </select>`),
        _row('Bonuses',
          _resourceBlockHTML('bonuses', hex.bonuses ?? [], !bdOn)),
        _row('Boosters',
          `<input class="hexdb-input" style="width:200px;opacity:0.5"
             value="${_esc(hex.booster ?? '')}" disabled>`),
        _row('Effects',
          `<input class="hexdb-input" style="width:200px;opacity:0.5"
             value="${_esc(hex.effects ?? '')}" disabled>`),
      ].join('');
  ```

- [ ] **Verify**: `storageCapacity`, `energyConsumption`, `pollutionConstant` absent. `DESTROY_RES_TYPES` used (no 4th arg to `_resourceBlockHTML` — bonuses uses standard resource types). Boosters and Effects have `disabled` with no `data-field`.

---

## Task 3 — Add `bonusDrop` toggle wiring

Find the `tapIncEl` block inside `_renderRecord` wiring section. Insert immediately after its closing `}`:

```js

    // ── Wire Bonus Drop toggle → re-render ────────────────────
    const bonusDropEl = document.querySelector('#hexdb-right [data-field="bonusDrop"]');
    if (bonusDropEl) {
      bonusDropEl.addEventListener('change', () => {
        if (_selFilt < 0) return;
        _renderRecord(_data.hexes[_filtered[_selFilt]]);
      });
    }
```

- [ ] **Verify**: `bonusDropEl` appears exactly once. Inserted after `tapIncEl` block, before `_validateId()`.

---

## Task 4 — In-browser verification

Open `MapEditorPro.html` in Chrome.

- [ ] Switch to **HEX DB**, click **+ Add Hex**, expand **SPECIAL**. Confirm:
  - `Bonus Drop` checkbox (unchecked by default)
  - `Triggers` select (disabled, shows Destroy)
  - `Bonuses` resource block (disabled)
  - `Boosters` disabled text input (gray, empty)
  - `Effects` disabled text input (gray, empty)
  - No StorageCapacity / EnergyConsumption / PollutionConstant

- [ ] Check `Bonus Drop = Yes`: Triggers + Bonuses enable; click `+ Add Resource` → row appears; change type and amount

- [ ] Save + verify JSON: `bonusDrop:true`, `bonusTrigger:"Destroy"`, `bonuses:[...]`, `booster:""`, `effects:""`. No stale fields.

---

## ⚠️ No commits — await user approval before any git operations
