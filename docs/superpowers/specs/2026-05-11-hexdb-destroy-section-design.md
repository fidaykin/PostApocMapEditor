# HexDB — DESTROY Section Redesign

**Date:** 2026-05-11
**Scope:** One section of the Hex Editor (`_renderRecord` → `destroyBody`)
**Source:** Feedback doc items — Hex Editor.Destroy (DEV block, 04.05.2026)

---

## Overview

Full restructure of the DESTROY (10–17) section. Adds `Can Destroy` checkbox gate, replaces the plain `TransformTo` text field with a datalist picker, adds `Source` tags input and `Can Stored` checkbox, removes 5 stale fields, replaces the fixed Gold/Gems income row with a dynamic multi-resource block guarded by a `Destroy Income` checkbox.

Introduces two reusable UI helper functions (`_sourceTagsHTML`, `_resourceBlockHTML`) that will also be used in the Income and Special section redesigns.

---

## Field Order (approved layout)

| # | Label | Type | Data key(s) | Default | Notes |
|---|-------|------|-------------|---------|-------|
| 1 | **Can Destroy** | checkbox | `canDestroy` | `false` | Gates all fields below |
| 2 | **Transform to** | text + datalist | `destroyTransformTo` | `'Plains_1'` | Shows "Unbreakable" (disabled) when `canDestroy=false`; datalist populated from current hex IDs |
| 3 | **Source** | tags input | `destroySource` | `[]` | Free-text IDs (Actions/Boosters/Specials); add on Enter, remove with ✕ |
| 4 | **Can Stored** | checkbox | `canStored` | `false` | Disabled when `canDestroy=false` |
| 5 | ~~Condition~~ | — | — | — | **Removed** |
| 6 | ~~Bonus / Effect / Delay / Requires Road~~ | — | — | — | **Removed** |
| 7 | **Destroy Income** | checkbox | `destroyIncomeEnabled` | `false` | Gates resource block below; disabled when `canDestroy=false` |
| 8 | **Resources** | dynamic list | `destroyIncome` | `[]` | `{type:string, amount:number}` rows; `+ Add Resource` button; disabled when `destroyIncomeEnabled=false` |

---

## Data Model Changes (`_blank()`)

### Add
```js
canDestroy: false,
destroySource: [],          // string[]
canStored: false,
destroyIncomeEnabled: false,
destroyIncome: [],          // {type:string, amount:number}[]
```

### Keep (with updated default)
```js
destroyTransformTo: 'Plains_1',  // was ''
```

### Remove
```js
destroyIncomeGold: 0,
destroyIncomeGems: 0,
destroyCondition: '',
destroyBonus: 0,
destroyEffect: '',
destroyDelay: 0,
destroyRequiresRoad: false,
```

### Migration (on JSON load)
When loading an old hex_database.json:
- If `destroyIncomeGold > 0`: push `{type:'Gold', amount:destroyIncomeGold}` into `destroyIncome`; set `destroyIncomeEnabled=true`
- If `destroyIncomeGems > 0`: push `{type:'Gems', amount:destroyIncomeGems}` into `destroyIncome`; set `destroyIncomeEnabled=true`
- If `destroyTransformTo` is `''`: set to `'Plains_1'`
- Old removed fields (`destroyCondition` etc.) are silently ignored

---

## New Helper Functions

Two reusable functions added inside the HexDB IIFE, used here and in future Income/Special redesigns.

### `_sourceTagsHTML(fieldName, values)`
Renders a tags-style input for a string array.

```js
function _sourceTagsHTML(fieldName, values) {
  const tags = (values || []).map(v =>
    `<span class="hexdb-tag" data-value="${_esc(v)}">${_esc(v)}<button class="hexdb-tag-remove" data-tags-field="${fieldName}" data-value="${_esc(v)}">✕</button></span>`
  ).join('');
  // Use data-tags-field (not data-field) on the container so the generic
  // _readRecord [data-field] scan doesn't pick up this div.
  return `<div class="hexdb-tags" data-tags-field="${fieldName}">
    ${tags}
    <input class="hexdb-tag-input" data-tags-field="${fieldName}" placeholder="type ID + Enter">
  </div>`;
}
```

CSS needed (`.hexdb-tag`, `.hexdb-tag-remove`, `.hexdb-tags`, `.hexdb-tag-input`) — dark theme, inline flex, tag chip style.

Event wiring (added in `_renderRecord` after HTML injection):
- `keydown Enter` on `.hexdb-tag-input[data-field=X]` → push value to `hex.destroySource`, re-render tags
- `click` on `.hexdb-tag-remove[data-field=X]` → splice from array, re-render tags

### `_resourceBlockHTML(fieldName, rows, disabled)`
Renders a dynamic list of `{type, amount}` resource rows.

```js
function _resourceBlockHTML(fieldName, rows, disabled) {
  const RESOURCE_TYPES = ['Gold','Gems','Food','Lumber','Stone','Steel','Oil','Chips','Clay'];
  const dis = disabled ? ' disabled' : '';
  const rowsHTML = (rows || []).map((r, i) => {
    const opts = RESOURCE_TYPES.map(t =>
      `<option${t===r.type?' selected':''}>${t}</option>`
    ).join('');
    // If type is not in standard list, add it as selected custom option
    const custom = RESOURCE_TYPES.includes(r.type) ? '' :
      `<option selected>${_esc(r.type)}</option>`;
    return `<div class="hexdb-res-row" data-index="${i}">
      <select class="hexdb-select hexdb-res-type" data-field="${fieldName}" data-index="${i}"${dis}>${opts}${custom}</select>
      <input class="hexdb-input hexdb-res-amount" type="number" step="1" min="0" style="width:90px"
        data-field="${fieldName}" data-index="${i}" value="${r.amount}"${dis}>
      <button class="hexdb-res-remove" data-field="${fieldName}" data-index="${i}"${dis}>✕</button>
    </div>`;
  }).join('');
  // Use data-res-field (not data-field) on container and buttons so the
  // generic _readRecord [data-field] scan doesn't mishandle them.
  return `<div class="hexdb-res-block" data-res-field="${fieldName}">
    ${rowsHTML}
    <button class="hexdb-res-add" data-res-field="${fieldName}"${dis}>+ Add Resource</button>
  </div>`;
}
```

Resource type `<select>` also accepts free-text custom types (stored as-is in the array) — this handles `Events_NameEvent_Currency` entries.

Event wiring:
- `change` on `.hexdb-res-type` → update `rows[i].type`
- `input` on `.hexdb-res-amount` → update `rows[i].amount`
- `click` on `.hexdb-res-remove` → splice row, re-render block
- `click` on `.hexdb-res-add` → push `{type:'Gold',amount:0}`, re-render block

---

## `destroyBody` HTML Structure

```js
const destroyBody = [
  // 1. Can Destroy checkbox
  _checkRow('canDestroy', hex.canDestroy ?? false, 'hex can be destroyed'),

  // 2. Transform to — datalist
  _row('Transform to', hex.canDestroy
    ? `<input class="hexdb-input" list="hexdb-id-list" data-field="destroyTransformTo"
         value="${_esc(hex.destroyTransformTo ?? 'Plains_1')}" style="width:200px">`
    : `<input class="hexdb-input" value="Unbreakable" disabled style="width:200px">`),

  // 3. Source — tags
  _row('Source', _sourceTagsHTML('destroySource', hex.destroySource)),

  // 4. Can Stored checkbox
  _checkRow('canStored', hex.canStored ?? false, 'hex moves to storage on destroy'),

  // 5. Destroy Income checkbox
  _checkRow('destroyIncomeEnabled', hex.destroyIncomeEnabled ?? false, 'resources awarded on destroy'),

  // 6. Resource block (bottom)
  _row('Resources', _resourceBlockHTML('destroyIncome', hex.destroyIncome, !hex.destroyIncomeEnabled)),

].join('');
```

A `<datalist id="hexdb-id-list">` is appended to the `#hexdb-right` innerHTML on every `_renderRecord` call (after all sections), populated from `_data.hexes.map(h => \`<option value="${h.id}">\`).join('')`. Since `_renderRecord` replaces the entire innerHTML, the datalist is always fresh.

### `Can Destroy` toggle behaviour
After `_renderRecord` injects HTML, an **additional** `change` listener is wired to `[data-field=canDestroy]`. This runs *after* the generic `_readRecord` listener (which saves the boolean), and calls `_renderRecord` again for the selected hex — re-rendering the entire destroy section to reflect the new enabled/disabled state. This is simpler and more reliable than toggling individual `disabled` attributes after the fact.

---

## CSS additions (minimal)

```css
.hexdb-tags { display:flex; flex-wrap:wrap; gap:4px; align-items:center;
  background:var(--bg); border:1px solid var(--border); padding:4px;
  border-radius:3px; min-height:28px; }
.hexdb-tag { background:var(--panel); border:1px solid var(--border);
  color:var(--text); padding:2px 6px; border-radius:3px; font-size:11px;
  display:flex; align-items:center; gap:4px; }
.hexdb-tag-remove { background:none; border:none; color:var(--muted);
  cursor:pointer; padding:0; font-size:11px; line-height:1; }
.hexdb-tag-remove:hover { color:var(--danger); }
.hexdb-tag-input { background:none; border:none; color:var(--text);
  outline:none; min-width:80px; font-size:12px; }
.hexdb-res-row { display:flex; gap:6px; align-items:center; margin-bottom:4px; }
.hexdb-res-remove { background:none; border:1px solid var(--border);
  color:var(--muted); cursor:pointer; padding:2px 6px; border-radius:3px; font-size:11px; }
.hexdb-res-remove:hover { border-color:var(--danger); color:var(--danger); }
.hexdb-res-add { background:none; border:1px solid var(--border); color:var(--accent);
  cursor:pointer; padding:3px 10px; border-radius:3px; font-size:11px; margin-top:2px; }
.hexdb-res-add:hover { background:var(--hover); }
```

---

## What Is Not In Scope

- Resource icon display next to type fields (deferred — requires icon assets per resource type)
- 2-column resource layout with 12-char fields (feedback polish item — the dynamic list approach is already clean)
- `Source` field info-view per entry (deferred — requires separate Actions/Boosters/Specials registry)
- `Destroy Income` checkbox being disabled when `canDestroy=false` (handled by the full re-render on `canDestroy` toggle)
