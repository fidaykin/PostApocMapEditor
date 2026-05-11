# HexDB — BUILD Section Redesign

**Date:** 2026-05-11
**Scope:** One section of the Hex Editor (`_renderRecord` → `buildBody`)
**Source:** Feedback doc items — Hex Editor.Build (DEV block, 04.05.2026)

---

## Overview

Restructure the BUILD (18–24) section. Adds `Can Build` checkbox gate (with `Need Road` inline on the same row), `Available Tiles` tags input, dynamic `Price` resource block, separate `Premium Price` field. Removes `MaxPerMap`. Moves `Placement Rule` to the bottom. Reuses helpers `_sourceTagsHTML` and `_resourceBlockHTML` built for the Destroy section.

---

## Field Order (approved layout)

| # | Label | Type | Data key(s) | Default | Notes |
|---|-------|------|-------------|---------|-------|
| 1 | **Can Build** + **Need Road** | two checkboxes on one row | `canBuild`, `buildRequiresRoad` | `false`, `false` | `canBuild` gates all fields below |
| 2 | **Available Tiles** | tags input | `buildAvailableTiles` | `[]` | hex IDs this tile can be placed on; datalist from `hexdb-id-list`; disabled when `canBuild=false` |
| 3 | **MinLevel** | number (110px) | `buildMinLevel` | `1` | 0 = immediately available; disabled when `canBuild=false` |
| 4 | **Price** | dynamic resource block | `buildPrice` | `[]` | `{type,amount}[]`; disabled when `canBuild=false` |
| 5 | **Premium Price** | number (110px) | `buildPremiumPrice` | `0` | if >0, overrides Price; disabled when `canBuild=false` |
| 6 | ~~MaxPerMap~~ | — | — | — | **Removed** |
| 7 | **Placement Rule** | text input | `buildPlacementRule` | `''` | moved to bottom; not gated by `canBuild` (future use field) |

---

## Data Model Changes (`_blank()`)

### Add
```js
canBuild: false,
buildAvailableTiles: [],   // string[]
buildPrice: [],            // {type:string, amount:number}[]
buildPremiumPrice: 0,
```

### Keep (with updated default)
```js
buildRequiresRoad: false,  // unchanged — now displayed inline with canBuild
buildPlacementRule: '',    // unchanged
buildMinLevel: 1,          // was 0, now defaults to 1
```

### Remove
```js
buildCostGold: 0,
buildCostGems: 0,
buildCostEvent: 0,
buildMaxPerMap: 0,
```

### Migration (on JSON load)
In `_migrateBuildFields(hexes)`:
- If `buildCostGold > 0`: push `{type:'Gold', amount:buildCostGold}` into `buildPrice`
- If `buildCostGems > 0`: push `{type:'Gems', amount:buildCostGems}` into `buildPrice`
- If `buildCostEvent > 0`: push `{type:'Event', amount:buildCostEvent}` into `buildPrice`
- If any of the above pushed, set `canBuild=true`
- Do NOT change existing `buildMinLevel` values — 0 is a valid value meaning "immediately available"
- Default `canBuild=false`, `buildAvailableTiles=[]`, `buildPremiumPrice=0` if missing
- Default `buildMinLevel=1` only if the field is completely absent (undefined)

---

## `buildBody` HTML Structure

```js
const canBld = hex.canBuild ?? false;
const dis = canBld ? '' : ' disabled';
const buildBody = [
  // 1. Can Build + Need Road on same row
  `<div class="hexdb-row hexdb-checkbox-row">
     <span class="hexdb-label"></span>
     <input type="checkbox" data-field="canBuild"${canBld ? ' checked' : ''}>
     <label>hex can be built</label>
     <input type="checkbox" data-field="buildRequiresRoad"
       ${hex.buildRequiresRoad ? ' checked' : ''}${dis}>
     <label style="${canBld ? '' : 'color:var(--muted)'}">Need Road</label>
   </div>`,

  // 2. Available Tiles — tags
  _row('Available Tiles',
    _sourceTagsHTML('buildAvailableTiles', hex.buildAvailableTiles ?? [], !canBld)),

  // 3. MinLevel
  _row('MinLevel',
    `<input class="hexdb-input" type="number" step="1" min="0"
       style="width:110px" data-field="buildMinLevel"
       value="${hex.buildMinLevel ?? 1}"${dis}>`),

  // 4. Price — dynamic resource block
  _row('Price', _resourceBlockHTML('buildPrice', hex.buildPrice ?? [], !canBld)),

  // 5. Premium Price
  _row('Premium Price',
    `<input class="hexdb-input" type="number" step="1" min="0"
       style="width:110px" data-field="buildPremiumPrice"
       value="${hex.buildPremiumPrice ?? 0}"${dis}>`),

  // 6. Placement Rule — bottom, always enabled
  _row('Placement Rule', _textInput('buildPlacementRule', hex.buildPlacementRule ?? '')),

].join('');
```

---

## Event Wiring

### `canBuild` toggle
Wired after generic `[data-field]` block — same pattern as `canDestroy`:
```js
const canBldEl = document.querySelector('#hexdb-right [data-field="canBuild"]');
if (canBldEl) {
  canBldEl.addEventListener('change', () => {
    if (_selFilt < 0) return;
    _renderRecord(_data.hexes[_filtered[_selFilt]]);
  });
}
```

### Available Tiles tags
`_sourceTagsHTML` wiring already present from Destroy section's generic selectors:
- `#hexdb-right .hexdb-tag-input` keydown Enter → adds to `buildAvailableTiles`
- `#hexdb-right .hexdb-tag-remove` click → removes from `buildAvailableTiles`

**No additional wiring needed** — the existing generic tag/resource wiring in `_renderRecord` already handles all `data-tags-field` and `data-res-field` elements regardless of which field they belong to.

### Price resource block
Same — existing generic `[data-res-field]` wiring handles it automatically.

---

## What Is Not In Scope

- Resource icons next to Price/Premium Price (polish item, deferred)
- `buildMinLevel=0` meaning "immediately available" is not enforced in the editor (just documented in label hint)
- `Placement Rule` gating by `canBuild` — kept always-enabled as a future-use placeholder
