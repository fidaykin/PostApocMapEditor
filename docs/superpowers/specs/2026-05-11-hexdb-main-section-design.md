# HexDB — MAIN Section Redesign

**Date:** 2026-05-11
**Scope:** One section of the Hex Editor (`_renderRecord` → `mainBody`)
**Source:** Feedback doc items — Hex Editor.Main (DEV block, 04.05.2026)

---

## Overview

Three targeted changes to the MAIN (0–9) section of the HexDB hex record editor:

1. Add two new text fields for localisation key references: `Desc Idle` and `Desc Build`
2. Replace the three-field BaseCost resource row (Gold / Gems / Event) with a single `Base Cost Taps` number input
3. Widen the taps input to 110px (fits 9 characters)

No other fields move or change.

---

## Field Order (approved layout — Option A)

| Position | Label | Type | Data key | Notes |
|----------|-------|------|----------|-------|
| 1 | Id * | text input | `id` | unchanged |
| 2 | TextId | text input | `textId` | unchanged |
| 3 | **Desc Idle** | text input | `descriptionIdleId` | NEW — text ID key for idle state description |
| 4 | **Desc Build** | text input | `descriptionBuildId` | NEW — text ID key for build state description |
| 5 | Type | grouped select | `type` | unchanged |
| 6 | Biome | select | `biome` | unchanged |
| 7 | Filter | select | `filterCategory` | unchanged |
| 8 | SpriteName | text + browse button | `spriteName` | unchanged |
| 9 | **Base Cost Taps** | number input (110px) | `baseCostTaps` | REPLACES BaseCost Gold/Gems/Event row |

---

## Data Model Changes (`_blank()`)

### Add
```js
descriptionIdleId: '',
descriptionBuildId: '',
baseCostTaps: 0,
```

### Remove
```js
baseCostGold: 0,   // dropped — concept replaced by taps
baseCostGems: 0,
baseCostEvent: 0,
```

Existing hex_database.json files that contain `baseCostGold/Gems/Event` will have those fields ignored on next load (no migration — the concepts are different: resource cost vs tap-to-unlock cost).

---

## Code Changes

### `_renderRecord` — `mainBody` array

Replace:
```js
_row('BaseCost', _costRow(
  [{label:'Gold',field:'baseCostGold'},{label:'Gems',field:'baseCostGems'},{label:'Event',field:'baseCostEvent'}],
  [hex.baseCostGold, hex.baseCostGems, hex.baseCostEvent])),
```

With (after TextId row, before Type row):
```js
_row('Desc Idle',  _textInput('descriptionIdleId', hex.descriptionIdleId)),
_row('Desc Build', _textInput('descriptionBuildId', hex.descriptionBuildId)),
```

And at the bottom of mainBody (replacing the removed BaseCost row):
```js
_row('Base Cost Taps',
  `<input class="hexdb-input" type="number" step="1" min="0"
     style="width:110px" data-field="baseCostTaps" value="${hex.baseCostTaps}">`),
```

### `_readRecord`
No change needed — the generic `[data-field]` listener already handles any new/renamed fields.

---

## What Is Not In Scope

- The `buildCostGold/Gems/Event` fields in the BUILD section — those are separate and handled in the Build section redesign
- Any changes to how the fields are exported to JSON (format stays the same, just different keys)
- Localisation lookup or preview for the description ID fields — display only
