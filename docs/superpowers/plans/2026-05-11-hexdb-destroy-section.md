# HexDB Destroy Section Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **NO COMMITS** — user must approve all changes before committing. Skip all git steps; leave changes local only.

**Goal:** Redesign the DESTROY section of HexDB: add Can Destroy gate, replace fixed Income row with dynamic multi-resource block, add Source tags input and Can Stored checkbox, remove 5 stale fields.

**Architecture:** All changes in the single `HexDB` IIFE inside `MapEditorPro.html`. Two new reusable helper functions (`_sourceTagsHTML`, `_resourceBlockHTML`) are added before `_renderRecord`. The `Can Destroy` checkbox triggers a full re-render of the section. Dynamic resource/tag lists use custom `data-res-field` / `data-tags-field` attributes to avoid the generic `_readRecord` listener.

**Tech Stack:** Vanilla JS, HTML, CSS — single file. No build step. No automated tests — verification is manual in Chrome.

---

## Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `MapEditorPro.html:644–645` | Add CSS for tags and resource block |
| Modify | `MapEditorPro.html:3153–3168` | `_blank()` — new keys, remove stale keys |
| Modify | `MapEditorPro.html:3555–3561` | `load()` — migration for old destroyIncome fields |
| Modify | `MapEditorPro.html:3302–3306` | Add `_sourceTagsHTML` + `_resourceBlockHTML` helpers |
| Modify | `MapEditorPro.html:3332–3342` | Replace `destroyBody` array |
| Modify | `MapEditorPro.html:3375–3381` | Add datalist to `innerHTML` |
| Modify | `MapEditorPro.html:3395–3407` | Add custom event wiring after generic wiring block |

---

## Task 1 — CSS for tags and resource block

**File:** `MapEditorPro.html:644–645`

After the line `#hexdb-main.dragover { outline: 2px dashed var(--accent); outline-offset: -4px; }` (line 645) and before the `/* ── Buildings & Settlements panels */` comment (line 647), insert:

- [ ] **Add CSS block:**

```css
/* ── Tags input (Source field) ────────────────────────── */
.hexdb-tags {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  background: var(--bg); border: 1px solid var(--border);
  padding: 4px; border-radius: 3px; min-height: 28px;
}
.hexdb-tag {
  background: var(--panel); border: 1px solid var(--border);
  color: var(--text); padding: 2px 6px; border-radius: 3px;
  font-size: 11px; display: flex; align-items: center; gap: 4px;
}
.hexdb-tag-remove {
  background: none; border: none; color: var(--muted);
  cursor: pointer; padding: 0; font-size: 11px; line-height: 1;
}
.hexdb-tag-remove:hover { color: var(--danger); }
.hexdb-tag-input {
  background: none; border: none; color: var(--text);
  outline: none; min-width: 80px; font-size: 12px;
}
/* ── Dynamic resource block (Destroy/Income/Special) ─── */
.hexdb-res-row { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.hexdb-res-remove {
  background: none; border: 1px solid var(--border); color: var(--muted);
  cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 11px;
}
.hexdb-res-remove:hover { border-color: var(--danger); color: var(--danger); }
.hexdb-res-add {
  background: none; border: 1px solid var(--border); color: var(--accent);
  cursor: pointer; padding: 3px 10px; border-radius: 3px;
  font-size: 11px; margin-top: 2px;
}
.hexdb-res-add:hover { background: var(--hover); }
```

- [ ] **Verify** by opening the file and searching for `.hexdb-tags` — should now exist in the CSS section (around line 646).

---

## Task 2 — Update `_blank()` and add migration in `load()`

### 2a — `_blank()` at line 3153

- [ ] **Locate** the `destroyIncomeGold/Gems/Condition/Bonus/Effect/Delay/RequiresRoad` block. Current lines 3158–3160:
  ```js
  destroyIncomeGold:0, destroyIncomeGems:0, destroyTransformTo:'',
  destroyCondition:'', destroyBonus:0, destroyEffect:'',
  destroyDelay:0, destroyRequiresRoad:false,
  ```

- [ ] **Replace** those three lines with:
  ```js
  canDestroy:false, destroyTransformTo:'Plains_1',
  destroySource:[], canStored:false,
  destroyIncomeEnabled:false, destroyIncome:[],
  ```

  The full updated `_blank()` must now read:
  ```js
  function _blank() {
    return {
      id:'', textId:'', type:'Special', biome:'Summer',
      filterCategory:'FilterTerrain', spriteName:'',
      descriptionIdleId:'', descriptionBuildId:'', baseCostTaps:0,
      canDestroy:false, destroyTransformTo:'Plains_1',
      destroySource:[], canStored:false,
      destroyIncomeEnabled:false, destroyIncome:[],
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

### 2b — Migration in `load()` at line 3555

- [ ] **Locate** `function load(text)` at line 3555. Find the line:
  ```js
  _migrateHexTypes(_data.hexes);
  ```
  **After** that line, insert:
  ```js
  _migrateDestroyFields(_data.hexes);
  ```

- [ ] **Add** the `_migrateDestroyFields` function immediately before `function load(text)` (i.e. around line 3554):
  ```js
  function _migrateDestroyFields(hexes) {
    hexes.forEach(h => {
      // Migrate flat Gold/Gems income to dynamic array
      if (!Array.isArray(h.destroyIncome)) {
        h.destroyIncome = [];
        if (h.destroyIncomeGold > 0) {
          h.destroyIncome.push({ type: 'Gold', amount: h.destroyIncomeGold });
          h.destroyIncomeEnabled = true;
        }
        if (h.destroyIncomeGems > 0) {
          h.destroyIncome.push({ type: 'Gems', amount: h.destroyIncomeGems });
          h.destroyIncomeEnabled = true;
        }
        delete h.destroyIncomeGold;
        delete h.destroyIncomeGems;
      }
      // Default new fields if missing
      if (h.canDestroy === undefined)        h.canDestroy = false;
      if (!h.destroyTransformTo)             h.destroyTransformTo = 'Plains_1';
      if (!Array.isArray(h.destroySource))   h.destroySource = [];
      if (h.canStored === undefined)         h.canStored = false;
      if (h.destroyIncomeEnabled === undefined) h.destroyIncomeEnabled = false;
    });
  }
  ```

Also call migration on autosave restore. Locate `_migrateHexTypes(_data.hexes)` in the `init()` function (around line 3454) — it appears twice (once in init autosave restore, once in load). Add `_migrateDestroyFields(_data.hexes)` after each `_migrateHexTypes` call:

- [ ] **Find** both occurrences of `_migrateHexTypes(_data.hexes)` in the HexDB IIFE (lines ~3454 and ~3560) and add `_migrateDestroyFields(_data.hexes);` on the line immediately after each.

---

## Task 3 — Add `_sourceTagsHTML` and `_resourceBlockHTML` helpers

**File:** `MapEditorPro.html` — insert both functions just before `function _renderRecord(hex)` at line 3307.

- [ ] **Insert** before `function _renderRecord(hex)`:

```js
  // ── Tags input helper (Source field) ─────────────────────
  function _sourceTagsHTML(fieldName, values, disabled) {
    const dis = disabled ? ' disabled' : '';
    const tags = (values || []).map(v =>
      `<span class="hexdb-tag">${_esc(v)}<button class="hexdb-tag-remove"
         data-tags-field="${fieldName}" data-value="${_esc(v)}"${dis}>✕</button></span>`
    ).join('');
    return `<div class="hexdb-tags" data-tags-field="${fieldName}">
      ${tags}
      <input class="hexdb-tag-input" data-tags-field="${fieldName}"
        placeholder="type ID + Enter"${dis}>
    </div>`;
  }

  // ── Dynamic resource block helper ────────────────────────
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

- [ ] **Verify** both functions appear just above `function _renderRecord(hex)` in the file and that `DESTROY_RES_TYPES` is defined inside the HexDB IIFE (not at global scope).

---

## Task 4 — Replace `destroyBody`

**File:** `MapEditorPro.html:3332–3342`

- [ ] **Locate** the `destroyBody` array (currently lines 3332–3342):
  ```js
  const destroyBody = [
    _row('Income', _costRow(
      [{label:'Gold',field:'destroyIncomeGold'},{label:'Gems',field:'destroyIncomeGems'}],
      [hex.destroyIncomeGold, hex.destroyIncomeGems])),
    _row('TransformTo',   _textInput('destroyTransformTo', hex.destroyTransformTo)),
    _row('Condition',     _textInput('destroyCondition',   hex.destroyCondition)),
    _row('Bonus',         _numInput('destroyBonus',        hex.destroyBonus)),
    _row('Effect',        _textInput('destroyEffect',      hex.destroyEffect)),
    _row('Delay',         _numInput('destroyDelay',        hex.destroyDelay)),
    _checkRow('destroyRequiresRoad', hex.destroyRequiresRoad, 'Requires road to destroy'),
  ].join('');
  ```

- [ ] **Replace** the entire `destroyBody` block with:
  ```js
  const canDes = hex.canDestroy ?? false;
  const destroyBody = [
    _checkRow('canDestroy', canDes, 'hex can be destroyed'),
    _row('Transform to', canDes
      ? `<input class="hexdb-input" list="hexdb-id-list"
           data-field="destroyTransformTo" style="width:200px"
           value="${_esc(hex.destroyTransformTo ?? 'Plains_1')}">`
      : `<input class="hexdb-input" value="Unbreakable"
           style="width:200px" disabled>`),
    _row('Source', _sourceTagsHTML('destroySource', hex.destroySource ?? [], !canDes)),
    _checkRow('canStored', hex.canStored ?? false, 'hex moves to storage on destroy'),
    _checkRow('destroyIncomeEnabled', hex.destroyIncomeEnabled ?? false,
      'resources awarded on destroy'),
    _row('Resources', _resourceBlockHTML(
      'destroyIncome', hex.destroyIncome ?? [],
      !canDes || !(hex.destroyIncomeEnabled ?? false))),
  ].join('');
  ```

---

## Task 5 — Datalist + event wiring

### 5a — Datalist in `innerHTML`

**File:** `MapEditorPro.html` — the `innerHTML` assignment around line 3375.

- [ ] **Locate** the `actionsHTML` variable and the innerHTML assignment:
  ```js
  document.getElementById('hexdb-right').innerHTML =
    _sectionHTML('main',    'MAIN (0–9)',     mainBody)    +
    _sectionHTML('destroy', 'DESTROY (10–17)',destroyBody) +
    _sectionHTML('build',   'BUILD (18–24)',  buildBody)   +
    _sectionHTML('income',  'INCOME',         incomeBody)  +
    _sectionHTML('special', 'SPECIAL',        specialBody) +
    actionsHTML;
  ```

- [ ] **Replace** the innerHTML assignment with:
  ```js
  const hexIdDatalist = '<datalist id="hexdb-id-list">' +
    _data.hexes.map(h => `<option value="${_esc(h.id)}">`).join('') +
    '</datalist>';

  document.getElementById('hexdb-right').innerHTML =
    _sectionHTML('main',    'MAIN (0–9)',     mainBody)    +
    _sectionHTML('destroy', 'DESTROY (10–17)',destroyBody) +
    _sectionHTML('build',   'BUILD (18–24)',  buildBody)   +
    _sectionHTML('income',  'INCOME',         incomeBody)  +
    _sectionHTML('special', 'SPECIAL',        specialBody) +
    actionsHTML + hexIdDatalist;
  ```

### 5b — Custom event wiring

**File:** `MapEditorPro.html` — after the existing `// Wire inputs` block (currently ends around line 3404), before `_validateId()`.

- [ ] **Insert** the following block after the closing `});` of the Wire inputs block and before `_validateId()`:

```js
    // ── Wire Can Destroy toggle → re-render destroy section ──
    const canDesEl = document.querySelector('#hexdb-right [data-field="canDestroy"]');
    if (canDesEl) {
      canDesEl.addEventListener('change', () => {
        if (_selFilt < 0) return;
        _renderRecord(_data.hexes[_filtered[_selFilt]]);
      });
    }

    // ── Wire Destroy Income toggle → re-render ────────────────
    const desIncEl = document.querySelector('#hexdb-right [data-field="destroyIncomeEnabled"]');
    if (desIncEl) {
      desIncEl.addEventListener('change', () => {
        if (_selFilt < 0) return;
        _renderRecord(_data.hexes[_filtered[_selFilt]]);
      });
    }

    // ── Wire Source tags input ────────────────────────────────
    document.querySelectorAll('#hexdb-right .hexdb-tag-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const val = input.value.trim();
        if (!val || _selFilt < 0) return;
        const h = _data.hexes[_filtered[_selFilt]];
        const field = input.dataset.tagsField;
        if (!Array.isArray(h[field])) h[field] = [];
        if (!h[field].includes(val)) h[field].push(val);
        _autoSave();
        _renderRecord(h);
      });
    });
    document.querySelectorAll('#hexdb-right .hexdb-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_selFilt < 0) return;
        const h = _data.hexes[_filtered[_selFilt]];
        const field = btn.dataset.tagsField;
        const val   = btn.dataset.value;
        if (Array.isArray(h[field])) {
          h[field] = h[field].filter(v => v !== val);
          _autoSave();
          _renderRecord(h);
        }
      });
    });

    // ── Wire resource block ───────────────────────────────────
    document.querySelectorAll('#hexdb-right [data-res-field]').forEach(el => {
      const field = el.dataset.resField;
      const idx   = parseInt(el.dataset.resIndex, 10);
      if (el.classList.contains('hexdb-res-remove')) {
        el.addEventListener('click', () => {
          if (_selFilt < 0) return;
          const h = _data.hexes[_filtered[_selFilt]];
          if (!Array.isArray(h[field])) return;
          h[field].splice(idx, 1);
          _autoSave();
          _renderRecord(h);
        });
      } else if (el.tagName === 'SELECT') {
        el.addEventListener('change', () => {
          if (_selFilt < 0) return;
          const h = _data.hexes[_filtered[_selFilt]];
          if (!Array.isArray(h[field]) || !h[field][idx]) return;
          h[field][idx].type = el.value;
          _autoSave();
        });
      } else if (el.type === 'number') {
        el.addEventListener('input', () => {
          if (_selFilt < 0) return;
          const h = _data.hexes[_filtered[_selFilt]];
          if (!Array.isArray(h[field]) || !h[field][idx]) return;
          h[field][idx].amount = Math.round(parseFloat(el.value) || 0);
          _autoSave();
        });
      }
    });
    document.querySelectorAll('#hexdb-right .hexdb-res-add').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_selFilt < 0) return;
        const h = _data.hexes[_filtered[_selFilt]];
        const field = btn.dataset.resField;
        if (!Array.isArray(h[field])) h[field] = [];
        h[field].push({ type: 'Gold', amount: 0 });
        _autoSave();
        _renderRecord(h);
      });
    });
```

---

## Task 6 — In-browser verification

Open `MapEditorPro.html` directly in Chrome.

- [ ] Switch to **HEX DB** tab. Click **+ Add Hex** to create a test hex.

- [ ] Select the hex, expand **DESTROY** section. Confirm:
  - `Can Destroy` checkbox appears at top (unchecked by default)
  - `Transform to` shows "Unbreakable" and is disabled
  - `Source` tags input is present but disabled
  - `Can Stored` checkbox is present but disabled
  - `Destroy Income` checkbox is present but disabled
  - `Resources` block shows `+ Add Resource` but it is disabled
  - Old fields (Condition, Bonus, Effect, Delay, Requires Road) are **gone**

- [ ] **Check Can Destroy = Yes:**
  - Check `Can Destroy`
  - `Transform to` becomes editable, shows `Plains_1`
  - `Source` tags input is enabled — type `ActionDestroy`, press Enter → tag appears
  - Click ✕ on tag → tag disappears
  - `Can Stored` checkbox becomes enabled
  - `Destroy Income` checkbox becomes enabled

- [ ] **Check Destroy Income = Yes:**
  - Check `Destroy Income`
  - `Resources` block enables — `+ Add Resource` button is clickable
  - Click `+ Add Resource` → new row appears with Gold dropdown + 0 amount + ✕
  - Change type to `Food`, set amount to `50`
  - Click ✕ → row disappears

- [ ] **Save and verify JSON:**
  - Click 💾 **Save DB** in toolbar
  - Open downloaded `hex_database.json`
  - Confirm hex has: `canDestroy:true`, `destroyTransformTo:"Plains_1"`, `destroySource:["ActionDestroy"]` (if added), `destroyIncome:[{type:"Food",amount:50}]`
  - Confirm absent: `destroyIncomeGold`, `destroyIncomeGems`, `destroyCondition`, `destroyBonus`, `destroyEffect`, `destroyDelay`, `destroyRequiresRoad`

- [ ] **Migration test:**
  - Load an old `hex_database.json` containing `destroyIncomeGold:100`
  - Confirm that hex's DESTROY section shows one Gold row with amount 100 in the resource block, and `Destroy Income` checkbox is checked

- [ ] **Datalist test:**
  - With `Can Destroy = Yes`, click in `Transform to` field and start typing `Pl`
  - Confirm browser autocomplete suggests hex IDs from the current list (e.g. `Plains_1`)

---

## ⚠️ No commits — await user approval before any git operations
