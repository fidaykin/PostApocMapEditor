# HexDB — SPECIAL Section Redesign

**Date:** 2026-05-11
**Scope:** One section of the Hex Editor (`_renderRecord` → `specialBody`)
**Source:** Feedback doc — Hex Editor.Special (DEV block, 06.05.2026)

---

## Overview

Restructure the SPECIAL section. Converts `BonusDrop` from a text field to a checkbox gate. Adds `Triggers` dropdown and `Bonuses` dynamic resource block (both gated by Bonus Drop). Removes three stale fields. Keeps `Boosters` and adds `Effects` as always-disabled locked placeholder fields (second-to-last and last).

---

## Field Order (approved layout)

| # | Label | Type | Data key | Default | Gate |
|---|-------|------|----------|---------|------|
| 1 | **Bonus Drop** | checkbox | `bonusDrop` | `false` | — |
| 2 | **Triggers** | select (Destroy/Reveal/Build) | `bonusTrigger` | `'Destroy'` | Bonus Drop=Yes |
| 3 | **Bonuses** | dynamic resource block | `bonuses` | `[]` | Bonus Drop=Yes |
| 4 | ~~StorageCapacity / EnergyConsumption / PollutionConstant~~ | — | — | — | **Removed** |
| 5 | **Boosters** | disabled text input | `booster` | `''` | always disabled (placeholder) |
| 6 | **Effects** | disabled text input | `effects` | `''` | always disabled (placeholder) |

---

## Data Model Changes (`_blank()`)

### Add / change
```js
bonusDrop: false,       // was: bonusDrop: '' (text) → now boolean
bonusTrigger: 'Destroy', // new
bonuses: [],            // new, {type,amount}[]
effects: '',            // new placeholder
```

### Keep
```js
booster: '',            // unchanged, still a locked placeholder
```

### Remove
```js
storageCapacity: 0,
energyConsumption: 0,
pollutionConstant: 0,
```

### Migration (`_migrateSpecialFields`)
- If `bonusDrop` is a string: set `bonusDrop = !!h.bonusDrop` (truthy string → true, empty → false)
- Default `bonusTrigger = 'Destroy'` if absent
- Default `bonuses = []` if absent or not array
- Default `effects = ''` if absent
- Delete `storageCapacity`, `energyConsumption`, `pollutionConstant`

---

## `specialBody` HTML Structure

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

### `bonusDrop` toggle wiring
```js
const bonusDropEl = document.querySelector('#hexdb-right [data-field="bonusDrop"]');
if (bonusDropEl) {
  bonusDropEl.addEventListener('change', () => {
    if (_selFilt < 0) return;
    _renderRecord(_data.hexes[_filtered[_selFilt]]);
  });
}
```

---

## What Is Not In Scope

- Boosters and Effects are display-only locked fields — no editing or wiring needed
- Resource icons next to Bonuses (polish item, deferred)
