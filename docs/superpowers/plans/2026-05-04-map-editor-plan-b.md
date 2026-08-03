# Map Editor Pro — Plan B (Data Model & UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent UX/data-model improvements: (1) change the hex `type` field to store group names instead of specific tile IDs, migrating existing data on load; (2) add Save/Open map buttons to the Map toolbar; (3) add a sprite-browse picker thumbnail modal to the Hex editor SpriteName field.

**Architecture:** Single-file vanilla JS app (`MapEditorPro.html`, ~4061 lines). All logic lives in named IIFE modules (`HexDB`, `UI`, `IO`, `Terrain`, etc.). No build step — open in browser to test. The three tasks are fully independent; commit each one separately.

**Tech Stack:** Vanilla JS ES2020, HTML5, CSS3. No test runner — verification is done by opening the file in a browser.

---

## File Map

| File | Tasks | What changes |
|------|-------|--------------|
| `MapEditorPro.html` | 1, 2, 3 | All CSS, HTML, and JS is in this single file |

---

### Task 1: Type field stores group name, not specific tile ID

**Problem:** Currently `hex.type` stores a specific tile ID like `"Forest_1"`. The game uses `type` for rule categories (can you build here? movement cost?), so it should store the group name (`"Forests"`) not the variant. The `TYPE_GROUPS` constant already has the correct mapping.

**What changes in `MapEditorPro.html`:**
- `_typeGroupOptions()` (line 2916) — render flat group-name `<option>` list instead of optgroups with specific types
- `_blank()` (line 2925) — default `type` changes from `'New'` to `'Special'`
- New `_migrateHexTypes(hexes)` function — maps old specific-type values to group names
- `load()` (line 3308) — call migration after parsing JSON
- `init()` (line 3198) — call migration after restoring from localStorage
- Type filter `init()` block (line 3219) — populate with group names only

---

- [ ] **Step 1: Rewrite `_typeGroupOptions()` to render group names**

Find this block at line 2916 in `MapEditorPro.html`:
```javascript
  function _typeGroupOptions(selectedVal) {
    return Object.entries(TYPE_GROUPS).map(([group, types]) =>
      `<optgroup label="${group}">${types.map(t =>
        `<option value="${t}"${t === selectedVal ? ' selected' : ''}>${t}</option>`
      ).join('')}</optgroup>`
    ).join('');
  }
```

Replace with:
```javascript
  function _typeGroupOptions(selectedVal) {
    return Object.keys(TYPE_GROUPS).map(group =>
      `<option value="${group}"${group === selectedVal ? ' selected' : ''}>${group}</option>`
    ).join('');
  }
```

---

- [ ] **Step 2: Add `_migrateHexTypes()` after `_autoSave()`**

Find this line at line 2961 in `MapEditorPro.html`:
```javascript
  function _autoSave() {
    try { localStorage.setItem('hexdb_autosave', JSON.stringify(_data)); } catch(e) {}
  }
```

After it, insert:
```javascript
  function _migrateHexTypes(hexes) {
    const toGroup = {};
    Object.entries(TYPE_GROUPS).forEach(([group, types]) =>
      types.forEach(t => { toGroup[t] = group; })
    );
    const groupNames = new Set(Object.keys(TYPE_GROUPS));
    hexes.forEach(h => {
      if (!groupNames.has(h.type)) h.type = toGroup[h.type] || 'Special';
    });
  }
```

---

- [ ] **Step 3: Change `_blank()` default type from `'New'` to `'Special'`**

Find in `_blank()` at line 2927:
```javascript
      id:'', textId:'', type:'New', biome:'Summer',
```

Replace with:
```javascript
      id:'', textId:'', type:'Special', biome:'Summer',
```

---

- [ ] **Step 4: Call migration in `load()` after parsing**

Find in `load()` at line 3311:
```javascript
      _data = parsed;
      _autoSave();
      _selFilt = -1;
```

Replace with:
```javascript
      _data = parsed;
      _migrateHexTypes(_data.hexes);
      _autoSave();
      _selFilt = -1;
```

---

- [ ] **Step 5: Call migration in `init()` after restoring from localStorage**

Find in `init()` at line 3200:
```javascript
    try {
      const saved = localStorage.getItem('hexdb_autosave');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.hexes)) _data = parsed;
      }
    } catch(e) {}
```

Replace with:
```javascript
    try {
      const saved = localStorage.getItem('hexdb_autosave');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.hexes)) {
          _data = parsed;
          _migrateHexTypes(_data.hexes);
        }
      }
    } catch(e) {}
```

---

- [ ] **Step 6: Update type filter dropdown to list group names only**

Find in `init()` at line 3218:
```javascript
    // Type filter — populate grouped by TYPE_GROUPS
    const typeFilter = document.getElementById('hexdb-type-filter');
    Object.entries(TYPE_GROUPS).forEach(([group, types]) => {
      const grp = document.createElement('optgroup');
      grp.label = group;
      types.forEach(name => {
        const o = document.createElement('option');
        o.value = name; o.textContent = name;
        grp.appendChild(o);
      });
      typeFilter.appendChild(grp);
    });
```

Replace with:
```javascript
    // Type filter — group names only (hex.type now stores group, not specific tile)
    const typeFilter = document.getElementById('hexdb-type-filter');
    Object.keys(TYPE_GROUPS).forEach(group => {
      const o = document.createElement('option');
      o.value = group; o.textContent = group;
      typeFilter.appendChild(o);
    });
```

---

- [ ] **Step 7: Verify in browser**

Open `MapEditorPro.html` in Chrome.

1. Switch to HEX DB tab. Click any hex in the list (or load `hex_database.json`).
2. In MAIN section, check the **Type** dropdown — it must show flat group names: `Special`, `Plains`, `Forests`, `Hills/Mountains`, `Rivers`, `Water`, `Rubble`, `Resources`, `Barren/Desert`, `Swamp`, `Volcanic/Rift`. No specific tile names.
3. Check the **Type filter** in the left sidebar — same flat group names.
4. Load a `hex_database.json` that has old-format types (`"Forest_1"`, `"Plain_2"`, etc.). After load, open each hex — its Type dropdown must show the mapped group name (`"Forests"`, `"Plains"`).
5. Add a new hex with "+ Add Hex" — its default Type must be `Special`.
6. Filter by `Forests` — only hexes with `type: "Forests"` (or migrated from Forest_1/2/3) appear.
7. Save the DB. Open the downloaded JSON — all `"type"` values must be group names.

---

- [ ] **Step 8: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: type field stores group name, migrate specific-type IDs on load"
```

---

### Task 2: Save/Open map buttons in Map toolbar

**Problem:** Save Map (`Ctrl+S`) and Open Map (`Ctrl+O`) are only in the File dropdown menu — not discoverable at a glance. The other editor modes (HexDB, Buildings, Settlements) already have `💾 Save DB` and `📂 Load DB` buttons directly in the toolbar. Map mode should match.

**What changes in `MapEditorPro.html`:**
- New CSS block for `#map-io` (display-gated by mode class, same pattern as `#hexdb-tools`)
- New `<div id="map-io">` HTML inside `#toolbar`, between the mode-tabs and `#map-tools`

---

- [ ] **Step 1: Add CSS for `#map-io`**

Find this CSS block at line 484:
```css
#map-tools   { display: flex; align-items: center; gap: 4px; }
#hexdb-tools { display: none; align-items: center; gap: 6px; }
#bld-tools   { display: none; align-items: center; gap: 6px; }
#stt-tools   { display: none; align-items: center; gap: 6px; }
body.mode-hexdb       #map-tools   { display: none; }
body.mode-hexdb       #hexdb-tools { display: flex; }
body.mode-buildings   #map-tools   { display: none; }
body.mode-buildings   #bld-tools   { display: flex; }
body.mode-settlements #map-tools   { display: none; }
body.mode-settlements #stt-tools   { display: flex; }
```

Replace with:
```css
#map-tools   { display: flex; align-items: center; gap: 4px; }
#map-io      { display: flex; align-items: center; gap: 6px; margin-right: 4px; }
#hexdb-tools { display: none; align-items: center; gap: 6px; }
#bld-tools   { display: none; align-items: center; gap: 6px; }
#stt-tools   { display: none; align-items: center; gap: 6px; }
body.mode-hexdb       #map-tools   { display: none; }
body.mode-hexdb       #map-io      { display: none; }
body.mode-hexdb       #hexdb-tools { display: flex; }
body.mode-buildings   #map-tools   { display: none; }
body.mode-buildings   #map-io      { display: none; }
body.mode-buildings   #bld-tools   { display: flex; }
body.mode-settlements #map-tools   { display: none; }
body.mode-settlements #map-io      { display: none; }
body.mode-settlements #stt-tools   { display: flex; }
```

---

- [ ] **Step 2: Add `#map-io` HTML inside the toolbar**

Find at line 744 (the closing `</div>` of `.mode-tabs` followed by `#map-tools`):
```html
      <button class="mode-tab"        id="tab-settlements" onclick="App.setMode('settlements')">SETTLEMENTS</button>
    </div>
    <div id="map-tools">
```

Replace with:
```html
      <button class="mode-tab"        id="tab-settlements" onclick="App.setMode('settlements')">SETTLEMENTS</button>
    </div>
    <div id="map-io">
      <button class="hexdb-tool-btn" onclick="IO.openMap()">📂 Open</button>
      <button class="hexdb-tool-btn" onclick="IO.saveMap()">💾 Save</button>
    </div>
    <div id="map-tools">
```

---

- [ ] **Step 3: Verify in browser**

Open `MapEditorPro.html` in Chrome.

1. **MAP mode** — toolbar shows `📂 Open` and `💾 Save` buttons to the left of the drawing tools. Clicking `💾 Save` downloads `map_export.json`. Clicking `📂 Open` opens the file picker.
2. **HEX DB mode** — `📂 Open` and `💾 Save` map buttons are NOT visible. HexDB's own `📂 Load DB` and `💾 Save DB` buttons are visible.
3. **BUILDINGS mode** — map IO buttons NOT visible. Buildings toolbar visible.
4. **SETTLEMENTS mode** — map IO buttons NOT visible. Settlements toolbar visible.
5. Keyboard shortcuts `Ctrl+S` and `Ctrl+O` still work in MAP mode.

---

- [ ] **Step 4: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: add Save/Open map buttons to Map toolbar"
```

---

### Task 3: Sprite browse picker in Hex editor

**Problem:** The `SpriteName` field in the Hex editor is a plain text input. Users must type the filename from memory. `sprites/hex/` contains 16 known PNG files. A thumbnail grid picker lets users click to select a sprite visually.

**Scope:** HexDB only. BldDB and SttDB have different sprite folders (not in scope for this task).

**What changes in `MapEditorPro.html`:**
- `SPRITE_LIST` constant added to HexDB IIFE (after `TYPE_GROUPS`)
- New `HexDB.pickSprite()` public method + `getSpriteList()` public method
- New `#sprite-picker-modal` HTML (after `#confirm-modal`)
- New `.sprite-picker-*` CSS (after modal CSS)
- `UI.showSpritePicker(onSelect)` and `UI.closeSpritePicker()` methods
- `UI.init()` Escape handler extended to also close the sprite picker
- `UI` `return` statement updated to export new methods
- `_renderRecord()` SpriteName row updated with `🖼` browse button

---

- [ ] **Step 1: Add `SPRITE_LIST` constant to HexDB IIFE**

Find the end of `TYPE_GROUPS` at line 2914:
```javascript
    'Volcanic/Rift':   ['LavaPlain', 'LavaRift', 'Rift'],
  };
```

After it, insert:
```javascript
  const SPRITE_LIST = [
    'Farm', 'FarmGrain',
    'Forest_1', 'Forest_2', 'Forest_3',
    'GoldVein', 'Hills', 'Mountain',
    'Plain_1', 'Plain_2',
    'Rift', 'Rubble_1', 'Rubble_2', 'Rubble_3',
    'Settlements_1', 'Water',
  ];
```

---

- [ ] **Step 2: Add `HexDB.pickSprite()` and `HexDB.getSpriteList()` public methods**

Find the HexDB `return` statement at line 3339:
```javascript
  return { init, add, deleteSelected, copy, paste, load, save, triggerLoad };
```

Replace with:
```javascript
  function getSpriteList() { return SPRITE_LIST; }

  function pickSprite() {
    UI.showSpritePicker(name => {
      const el = document.querySelector('#hexdb-right [data-field="spriteName"]');
      if (el) { el.value = name; el.dispatchEvent(new Event('input')); }
    });
  }

  return { init, add, deleteSelected, copy, paste, load, save, triggerLoad, getSpriteList, pickSprite };
```

---

- [ ] **Step 3: Add sprite picker modal HTML**

Find after the confirm-modal closing tag at line 936:
```html
</div>

<input type="file" id="file-input"
```

Replace with:
```html
</div>

<!-- Sprite picker modal -->
<div class="modal-overlay" id="sprite-picker-modal">
  <div class="modal-box sprite-picker-box">
    <h3>Pick Sprite</h3>
    <div id="sprite-picker-grid"></div>
    <div class="modal-actions">
      <button class="btn btn-cancel" onclick="UI.closeSpritePicker()">Cancel</button>
    </div>
  </div>
</div>

<input type="file" id="file-input"
```

---

- [ ] **Step 4: Add sprite picker CSS**

Find the end of the modal CSS block at line 291:
```css
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
```

After it, insert:
```css
.sprite-picker-box { max-width: 500px; width: 100%; }
#sprite-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px; max-height: 320px; overflow-y: auto;
  margin-bottom: 16px; padding: 4px;
}
.sprite-picker-thumb {
  display: flex; flex-direction: column; align-items: center;
  gap: 4px; padding: 6px; border-radius: 4px;
  cursor: pointer; border: 2px solid transparent;
  background: var(--panel);
}
.sprite-picker-thumb:hover { border-color: var(--accent); background: var(--hover); }
.sprite-picker-thumb img {
  width: 48px; height: 48px; object-fit: contain; image-rendering: pixelated;
}
.sprite-picker-thumb span { font-size: 9px; color: var(--muted); word-break: break-all; text-align: center; }
```

---

- [ ] **Step 5: Add `showSpritePicker` and `closeSpritePicker` to UI module**

Find in the UI module at line 2008:
```javascript
  let _selectedId = 12;
  let _confirmCallback = null;
```

Replace with:
```javascript
  let _selectedId = 12;
  let _confirmCallback = null;
  let _spritePickerCallback = null;
```

Then find the `closeConfirm` function at line 2148:
```javascript
  function closeConfirm() {
    document.getElementById('confirm-modal').classList.remove('open');
  }
```

After it, insert:
```javascript
  function showSpritePicker(onSelect) {
    _spritePickerCallback = onSelect;
    const grid = document.getElementById('sprite-picker-grid');
    grid.innerHTML = '';
    HexDB.getSpriteList().forEach(name => {
      const thumb = document.createElement('div');
      thumb.className = 'sprite-picker-thumb';
      const img = document.createElement('img');
      img.src = `sprites/hex/${name}.png`;
      img.alt = name;
      img.onerror = () => { img.style.opacity = '0.3'; };
      const lbl = document.createElement('span');
      lbl.textContent = name;
      thumb.appendChild(img);
      thumb.appendChild(lbl);
      thumb.addEventListener('click', () => {
        closeSpritePicker();
        if (_spritePickerCallback) _spritePickerCallback(name);
      });
      grid.appendChild(thumb);
    });
    document.getElementById('sprite-picker-modal').classList.add('open');
  }

  function closeSpritePicker() {
    document.getElementById('sprite-picker-modal').classList.remove('open');
    _spritePickerCallback = null;
  }
```

---

- [ ] **Step 6: Extend Escape key handler to close sprite picker**

Find in `UI.init()` at line 2018:
```javascript
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAllMenus();
    });
```

Replace with:
```javascript
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeAllMenus(); closeSpritePicker(); }
    });
```

---

- [ ] **Step 7: Update `UI` return statement to export new methods**

Find at line 2169:
```javascript
  return {
    init, buildPalette, selectTerrain, getSelectedTerrain,
    updateSettlementCount, updateMenuHistoryState,
    toggleSettlements, closeAllMenus,
    showConfirm, closeConfirm, toast,
    updateStatusTool, updateStatusSize
  };
```

Replace with:
```javascript
  return {
    init, buildPalette, selectTerrain, getSelectedTerrain,
    updateSettlementCount, updateMenuHistoryState,
    toggleSettlements, closeAllMenus,
    showConfirm, closeConfirm, toast,
    showSpritePicker, closeSpritePicker,
    updateStatusTool, updateStatusSize
  };
```

---

- [ ] **Step 8: Add browse button to the SpriteName row in `_renderRecord()`**

Find in `_renderRecord()` at line 3077:
```javascript
      _row('SpriteName',      _textInput('spriteName', hex.spriteName) +
        '<small style="color:#888;font-size:0.8em;display:block;margin-top:2px">Web editor: sprites/hex/&lt;name&gt;.png &nbsp;|&nbsp; Unity: Resources/Hex/&lt;name&gt;</small>'),
```

Replace with:
```javascript
      _row('SpriteName',
        `<div style="display:flex;gap:6px;align-items:flex-start;width:100%">` +
        `<div style="flex:1;min-width:0">` +
        _textInput('spriteName', hex.spriteName) +
        `<small style="color:#888;font-size:0.8em;display:block;margin-top:2px">Web editor: sprites/hex/&lt;name&gt;.png &nbsp;|&nbsp; Unity: Resources/Hex/&lt;name&gt;</small>` +
        `</div>` +
        `<button class="hexdb-tool-btn" onclick="HexDB.pickSprite()" title="Browse sprites">🖼</button>` +
        `</div>`),
```

---

- [ ] **Step 9: Verify in browser**

Open `MapEditorPro.html` in Chrome.

1. Switch to HEX DB tab. Select any hex.
2. In MAIN section, click the **🖼** button next to SpriteName.
3. A modal appears with a 4-column grid of sprite thumbnails (16 sprites: Farm, FarmGrain, Forest_1…).
4. Each thumbnail shows the hex sprite image and its name below.
5. Click `Forest_2` — modal closes, SpriteName field fills with `"Forest_2"`, data is saved (check that `hex.spriteName` updated by clicking another hex and back — value persists).
6. Click 🖼 again, then press Escape — modal closes, SpriteName unchanged.
7. Click 🖼, then click Cancel — modal closes, SpriteName unchanged.
8. Sprites with missing files (none currently, but if one had an error) render with 30% opacity instead of a broken icon.

---

- [ ] **Step 10: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: sprite browse picker modal in Hex editor SpriteName field"
```

---

### Final review checklist

After all three tasks are committed, open `MapEditorPro.html` and run through these:

- [ ] Hex type dropdown shows 11 group names, not 49 specific tile names
- [ ] Loading old `hex_database.json` with `"type":"Forest_1"` migrates to `"Forests"` transparently
- [ ] Type filter sidebar works correctly with group names
- [ ] Save/Open map buttons visible in MAP toolbar, hidden in all other modes
- [ ] Sprite picker opens on 🖼 click, fills SpriteName on selection, dismisses on Escape/Cancel
- [ ] No console errors across all three features
