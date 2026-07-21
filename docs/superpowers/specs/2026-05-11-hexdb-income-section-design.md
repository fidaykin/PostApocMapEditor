# HexDB — INCOME Section Redesign

**Date:** 2026-05-11
**Scope:** One section of the Hex Editor (`_renderRecord` → `incomeBody`)
**Source:** Feedback doc — Hex Editor.Income (DEV block, 05.05.2026)

---

## Overview

Full restructure of the INCOME section. Adds `Tap Income` / `Destroyable` checkbox gate, `Transform to` datalist picker with Parent Hex option, `Capacity` (renamed from `DamageMod`), `Get per Tap` resource block. Extends `Per Turn` from a single number to a resource block. Adds three new always-on resource blocks: `Income Idle`, `Income Constant`, `Spend Constant`. Removes three stale fields. Extends `_resourceBlockHTML` with an optional `resTypes` parameter so `Spend Constant` can include `Pollution` and `Energy`.

---

## Field Order (approved layout)

| # | Label | Type | Data key(s) | Default | Gate |
|---|-------|------|-------------|---------|------|
| 1 | **Tap Income** + **Destroyable** | two checkboxes, same row | `tapIncomeEnabled`, `destroyable` | `false`, `false` | — |
| 2 | **Transform to** | text + datalist + Parent Hex option | `incomeTransformTo` | `'Plains_1'` | Tap Income=Yes AND Destroyable=Yes |
| 3 | **Capacity** | number (110px, min 1) | `incomeCapacity` | `3` | Tap Income=Yes |
| 4 | **Get per Tap** | dynamic resource block | `incomeGetPerTap` | `[]` | Tap Income=Yes |
| 5 | ~~OnCapture / OccupiedPerTurn / HumanResources~~ | — | — | — | **Removed** |
| 6 | **Per Turn** | dynamic resource block | `incomePerTurn` | `[]` | always on |
| 7 | **Income Idle** | dynamic resource block | `incomeIdle` | `[]` | always on |
| 8 | **Income Constant** | dynamic resource block | `incomeConstant` | `[]` | always on |
| 9 | **Spend Constant** | dynamic resource block (Pollution+Energy+standard) | `spendConstant` | `[{type:'Pollution',amount:1}]` | always on |

### `Transform to` field detail
Two inputs on one row:
- Text input with `list="hexdb-id-list"` for hex ID entry
- `<select>` with options `["Hex ID", "Parent Hex"]` that switches the mode
- When mode = "Parent Hex": `incomeTransformTo` stores the special value `"__parent__"` and the text input is disabled
- When mode = "Hex ID": `incomeTransformTo` stores the typed hex ID

### `Destroyable` default behaviour
- When `tapIncomeEnabled` changes to `true`: if `destroyable` was `false`, auto-set it to `true`
- User can then manually uncheck `Destroyable` — this is preserved

---

## Data Model Changes (`_blank()`)

### Add
```js
tapIncomeEnabled: false,
destroyable: false,
incomeTransformTo: 'Plains_1',
incomeCapacity: 3,
incomeGetPerTap: [],
incomeIdle: [],
incomeConstant: [],
spendConstant: [{ type: 'Pollution', amount: 1 }],
```

### Replace (array replaces number)
```js
incomePerTurn: [],    // was: incomePerTurn: 0
```

### Remove
```js
incomeOnCapture: 0,
incomeOccupiedPerTurn: 0,
humanResourcesPerHex: 0,
damageModifier: 0,
```

### Migration (`_migrateIncomeFields`)
- If `incomePerTurn` is a number (not array) and > 0: set `incomePerTurn = [{type:'Gold', amount:incomePerTurn}]`
- If `incomePerTurn` is a number 0: set `incomePerTurn = []`
- If `damageModifier !== undefined`: set `incomeCapacity = Math.max(1, damageModifier || 3)`, delete `damageModifier`
- Default `tapIncomeEnabled=false`, `destroyable=false`, `incomeTransformTo='Plains_1'`, `incomeCapacity=3`, `incomeGetPerTap=[]`, `incomeIdle=[]`, `incomeConstant=[]` if absent
- Default `spendConstant=[{type:'Pollution',amount:1}]` if absent (matches `_blank()` default)

---

## `_resourceBlockHTML` Extension

Add optional 4th parameter `resTypes` (defaults to `DESTROY_RES_TYPES`):

```js
function _resourceBlockHTML(fieldName, rows, disabled, resTypes) {
  const types = resTypes || DESTROY_RES_TYPES;
  // ... use `types` instead of `DESTROY_RES_TYPES` ...
}
```

Define new constant inside HexDB IIFE:
```js
const SPEND_RES_TYPES = ['Pollution','Energy','Gold','Gems','Food',
  'Lumber','Stone','Steel','Oil','Chips','Clay'];
```

Used as: `_resourceBlockHTML('spendConstant', hex.spendConstant ?? [...], false, SPEND_RES_TYPES)`

---

## `incomeBody` HTML Structure

```js
const tapOn = hex.tapIncomeEnabled ?? false;
const desOn = hex.destroyable ?? false;
const tapDis = tapOn ? '' : ' disabled';

const incomeBody = [
  // 1. Tap Income + Destroyable
  `<div class="hexdb-row hexdb-checkbox-row">
     <span class="hexdb-label"></span>
     <input type="checkbox" data-field="tapIncomeEnabled"${tapOn ? ' checked' : ''}>
     <label>hex earns on tap</label>
     <input type="checkbox" data-field="destroyable"
       ${desOn ? ' checked' : ''}${tapDis}>
     <label style="${tapOn ? '' : 'color:var(--muted)'}">Destroyable</label>
   </div>`,

  // 2. Transform to (active only when tapOn AND desOn)
  (() => {
    const active = tapOn && desOn;
    const dis = active ? '' : ' disabled';
    const isParent = (hex.incomeTransformTo ?? '') === '__parent__';
    return _row('Transform to',
      `<div style="display:flex;gap:6px;align-items:center">
         <input class="hexdb-input" list="hexdb-id-list"
           data-field="incomeTransformTo" style="width:160px"
           value="${isParent ? '' : _esc(hex.incomeTransformTo ?? 'Plains_1')}"
           ${isParent ? ' disabled' : ''}${dis}>
         <select class="hexdb-select" id="income-transform-mode"
           style="width:100px"${dis}>
           <option${isParent ? '' : ' selected'}>Hex ID</option>
           <option${isParent ? ' selected' : ''}>Parent Hex</option>
         </select>
       </div>`);
  })(),

  // 3. Capacity
  _row('Capacity',
    `<input class="hexdb-input" type="number" step="1" min="1"
       style="width:110px" data-field="incomeCapacity"
       value="${hex.incomeCapacity ?? 3}"${tapDis}>`),

  // 4. Get per Tap
  _row('Get per Tap', _resourceBlockHTML('incomeGetPerTap', hex.incomeGetPerTap ?? [], !tapOn)),

  // 5. Per Turn — resource block
  _row('Per Turn', _resourceBlockHTML('incomePerTurn', hex.incomePerTurn ?? [], false)),

  // 6. Income Idle
  _row('Income Idle', _resourceBlockHTML('incomeIdle', hex.incomeIdle ?? [], false)),

  // 7. Income Constant
  _row('Income Constant', _resourceBlockHTML('incomeConstant', hex.incomeConstant ?? [], false)),

  // 8. Spend Constant
  _row('Spend Constant', _resourceBlockHTML('spendConstant',
    hex.spendConstant ?? [{ type: 'Pollution', amount: 1 }], false, SPEND_RES_TYPES)),

].join('');
```

### `Transform to` mode select wiring
After rendering, wire the mode select:
```js
const modeEl = document.getElementById('income-transform-mode');
if (modeEl) {
  modeEl.addEventListener('change', () => {
    if (_selFilt < 0) return;
    const h = _data.hexes[_filtered[_selFilt]];
    if (modeEl.value === 'Parent Hex') {
      h.incomeTransformTo = '__parent__';
    } else {
      h.incomeTransformTo = 'Plains_1';
    }
    _autoSave();
    _renderRecord(h);
  });
}
```

### `Tap Income` toggle wiring
Re-renders section AND auto-sets `destroyable=true` when enabling:
```js
const tapEl = document.querySelector('#hexdb-right [data-field="tapIncomeEnabled"]');
if (tapEl) {
  tapEl.addEventListener('change', () => {
    if (_selFilt < 0) return;
    const h = _data.hexes[_filtered[_selFilt]];
    if (h.tapIncomeEnabled && !h.destroyable) {
      h.destroyable = true;
    }
    _renderRecord(h);
  });
}
```

Note: `_readRecord` (generic listener) saves `tapIncomeEnabled` first; the tap-specific listener fires after and re-renders.

---

## What Is Not In Scope

- Capacity validation enforced in the editor (min=1 is set on the input; no JS enforcement beyond that)
- `__parent__` special value display in the hex list (shown as-is in exported JSON)
- Resource icons next to fields (polish item, deferred)
