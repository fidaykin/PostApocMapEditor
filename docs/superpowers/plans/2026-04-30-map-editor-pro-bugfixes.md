# Map Editor Pro Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all known bugs and UX issues in MapEditorPro.html, ordered by severity (Critical → Bug → Polish → Important).

**Architecture:** Single-file HTML editor (`MapEditorPro.html`, ~3978 lines). All JS is IIFE modules (HexDB, BldDB, SttDB, UI, Canvas, IO, etc.) inline in the file. No build step — edit the file directly and refresh the browser.

**Tech Stack:** Vanilla JS, HTML5, CSS3, localStorage for persistence. No frameworks, no bundler.

---

## File Map

| File | What changes |
|------|-------------|
| `MapEditorPro.html` | All tasks — this is the only file |

---

### Task 1 (Critical): Fix delete buttons in all three DB editors

All three `deleteSelected()` functions (HexDB line 3235, BldDB line 3523, SttDB line 3834) call `UI.confirm(msg, callback)` which does not exist. The correct method is `UI.showConfirm(title, msg, onOk)` — three arguments: title string, message string, OK callback.

**Files:**
- Modify: `MapEditorPro.html:3239` (HexDB)
- Modify: `MapEditorPro.html:3526` (BldDB)
- Modify: `MapEditorPro.html:3837` (SttDB)

- [ ] **Step 1: Reproduce the bug**

Open `MapEditorPro.html` in Chrome. Switch to Hex editor. Add a hex, select it, click the trash icon. Nothing happens (no confirm dialog, no deletion). Open DevTools console — you will see `TypeError: UI.confirm is not a function`.

- [ ] **Step 2: Fix HexDB.deleteSelected (line 3239)**

Find this block (lines 3235-3244):
```javascript
function deleteSelected() {
  if (_selFilt < 0 || _selFilt >= _filtered.length) return;
  const realIdx = _filtered[_selFilt];
  const label = _data.hexes[realIdx].id || '(unnamed)';
  UI.confirm(`Delete "${label}"?`, () => {
    _data.hexes.splice(realIdx, 1);
    _selFilt = -1;
    _applyFilter(); _buildList();
  });
}
```

Replace with:
```javascript
function deleteSelected() {
  if (_selFilt < 0 || _selFilt >= _filtered.length) return;
  const realIdx = _filtered[_selFilt];
  const label = _data.hexes[realIdx].id || '(unnamed)';
  UI.showConfirm('Delete Hex', `Delete "${label}"?`, () => {
    _data.hexes.splice(realIdx, 1);
    _selFilt = -1;
    _applyFilter(); _buildList();
  });
}
```

- [ ] **Step 3: Fix BldDB.deleteSelected (line 3526)**

Find this block (lines 3523-3532):
```javascript
function deleteSelected() {
  if (_selFilt < 0) return;
  const dataIdx = _filtered[_selFilt];
  UI.confirm(`Delete "${_data.buildings[dataIdx].id || '(no id)'}"?`, () => {
    _data.buildings.splice(dataIdx, 1);
    _selFilt = -1;
    _applyFilter();
    _buildList();
    document.getElementById('bld-right').innerHTML =
```

Replace the `UI.confirm(` call only:
```javascript
function deleteSelected() {
  if (_selFilt < 0) return;
  const dataIdx = _filtered[_selFilt];
  UI.showConfirm('Delete Building', `Delete "${_data.buildings[dataIdx].id || '(no id)'}"?`, () => {
    _data.buildings.splice(dataIdx, 1);
    _selFilt = -1;
    _applyFilter();
    _buildList();
    document.getElementById('bld-right').innerHTML =
```

- [ ] **Step 4: Fix SttDB.deleteSelected (line 3837)**

Find this block (lines 3834-3844):
```javascript
function deleteSelected() {
  if (_selFilt < 0) return;
  const dataIdx = _filtered[_selFilt];
  UI.confirm(`Delete "${_data.settlements[dataIdx].id || '(no id)'}"?`, () => {
    _data.settlements.splice(dataIdx, 1);
    _selFilt = -1;
    _applyFilter();
    _buildList();
    document.getElementById('stt-right').innerHTML =
```

Replace the `UI.confirm(` call only:
```javascript
function deleteSelected() {
  if (_selFilt < 0) return;
  const dataIdx = _filtered[_selFilt];
  UI.showConfirm('Delete Settlement', `Delete "${_data.settlements[dataIdx].id || '(no id)'}"?`, () => {
    _data.settlements.splice(dataIdx, 1);
    _selFilt = -1;
    _applyFilter();
    _buildList();
    document.getElementById('stt-right').innerHTML =
```

- [ ] **Step 5: Verify**

Reload the page. In each of Hex, Buildings, Settlements editors:
1. Add an item.
2. Select it.
3. Click the trash icon.
4. Confirm dialog appears with title "Delete Hex" / "Delete Building" / "Delete Settlement".
5. Click OK → item is removed from the list.
6. No errors in DevTools console.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "fix: replace UI.confirm with UI.showConfirm in all three deleteSelected functions"
```

---

### Task 2 (Critical): Auto-save active file to localStorage on every change

Page refresh wipes all unsaved data (map, hexes, buildings, settlements). Each DB editor should auto-save its JSON to localStorage whenever data changes, and restore it on load.

**Files:**
- Modify: `MapEditorPro.html` — HexDB module (around line 2870), BldDB module (around line 3300), SttDB module (around line 3620)

- [ ] **Step 1: Understand current data shapes**

HexDB: `_data = { hexes: [...] }` — saved to localStorage key `hexdb_autosave`
BldDB: `_data = { buildings: [...] }` — saved to localStorage key `blddb_autosave`
SttDB: `_data = { settlements: [...] }` — saved to localStorage key `sttdb_autosave`

Each module already uses localStorage for section collapse state (`hexdb_sections`, `blddb-sec`, `sttdb-sec`), so the pattern is established.

- [ ] **Step 2: Add _autoSave helper to HexDB**

In the HexDB IIFE, find the `_saveSecState` function (around line 2931) and add `_autoSave` immediately after it:

```javascript
function _saveSecState() {
  try { localStorage.setItem('hexdb_sections', JSON.stringify(_secState)); } catch(e) {}
}

function _autoSave() {
  try { localStorage.setItem('hexdb_autosave', JSON.stringify(_data)); } catch(e) {}
}
```

- [ ] **Step 3: Call _autoSave from every HexDB write operation**

The write operations are: `addHex`, `deleteSelected`, `paste`, and the field-change handler (the `change` / `input` event listener on `#hexdb-right`).

Search for `_applyFilter(); _buildList();` calls within HexDB (the module ends before BldDB starts). Add `_autoSave();` after each pair:

In `addHex` (around line 3233):
```javascript
// before:
_applyFilter(); _buildList();
// after:
_applyFilter(); _buildList(); _autoSave();
```

In `deleteSelected` (around line 3242, inside the confirm callback):
```javascript
// before:
_applyFilter(); _buildList();
// after:
_applyFilter(); _buildList(); _autoSave();
```

In `paste` (around line 3257):
```javascript
// before:
_applyFilter(); _buildList();
// after:
_applyFilter(); _buildList(); _autoSave();
```

For field changes, find the input/change event listener on `#hexdb-right` (the form area). It calls `_renderForm()` or sets fields. Add `_autoSave()` at the end of the handler that writes back to `_data`.

- [ ] **Step 4: Restore HexDB data on init**

Find the HexDB `init` function (it's called from the DOMContentLoaded handler or similar). Add restore logic at the start of init:

```javascript
function init() {
  _loadSecState();
  try {
    const saved = localStorage.getItem('hexdb_autosave');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.hexes)) _data = parsed;
    }
  } catch(e) {}
  _applyFilter(); _buildList();
  // ... rest of existing init ...
}
```

- [ ] **Step 5: Add _autoSave to BldDB**

Repeat the same pattern for BldDB:
- Add `_autoSave` helper after `_saveSecState` (around line 3340):
```javascript
function _autoSave() {
  try { localStorage.setItem('blddb_autosave', JSON.stringify(_data)); } catch(e) {}
}
```
- Call `_autoSave()` after every `_applyFilter(); _buildList();` pair within BldDB.
- In BldDB `init`, restore from `blddb_autosave`:
```javascript
try {
  const saved = localStorage.getItem('blddb_autosave');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && Array.isArray(parsed.buildings)) _data = parsed;
  }
} catch(e) {}
```

- [ ] **Step 6: Add _autoSave to SttDB**

Repeat for SttDB:
- Add `_autoSave` helper after `_saveSecState` (around line 3662):
```javascript
function _autoSave() {
  try { localStorage.setItem('sttdb_autosave', JSON.stringify(_data)); } catch(e) {}
}
```
- Call `_autoSave()` after every `_applyFilter(); _buildList();` pair within SttDB.
- In SttDB `init`, restore from `sttdb_autosave`:
```javascript
try {
  const saved = localStorage.getItem('sttdb_autosave');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && Array.isArray(parsed.settlements)) _data = parsed;
  }
} catch(e) {}
```

- [ ] **Step 7: Also call _autoSave when field values change**

Each DB editor has a right panel where editing a selected item's fields updates `_data`. Find the `change` / `input` listeners that write back to `_data.hexes[realIdx]` (or equivalent). Add `_autoSave()` at the end of each such listener.

Search for the pattern `_data.hexes[realIdx].` in HexDB — these are inside the change handler. Add `_autoSave()` once at the END of that handler, not on every field.

- [ ] **Step 8: Verify**

1. Open editor. Add several hexes with IDs. Close tab.
2. Reopen `MapEditorPro.html`. Switch to Hex editor — hexes are still there.
3. Load a JSON file (via Load button) — this replaces in-memory data and triggers auto-save.
4. Reload page — the loaded data is still present.
5. Check DevTools → Application → Local Storage: `hexdb_autosave`, `blddb_autosave`, `sttdb_autosave` keys exist.

- [ ] **Step 9: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat: auto-save DB editor data to localStorage on every change, restore on load"
```

---

### Task 3 (Bug): Fix black screen in Map editor when tab is inactive

When the Map editor tab is left inactive for some time, returning to it shows a black rectangle where the canvas should be. This is caused by the browser pausing the WebGL/canvas render loop for invisible tabs.

**Files:**
- Modify: `MapEditorPro.html` — Canvas/Map module

- [ ] **Step 1: Find the canvas render / visibility code**

Search for `visibilitychange` in `MapEditorPro.html`:
```bash
grep -n "visibilitychange\|requestAnimationFrame\|canvas.*render\|redraw\|repaint" MapEditorPro.html | head -40
```

If `visibilitychange` is not handled, the fix is to add a listener that forces a redraw when the tab becomes visible again.

- [ ] **Step 2: Find the canvas redraw function**

Search for the function that redraws the map canvas (likely named `render`, `draw`, `redraw`, or similar):
```bash
grep -n "function render\|function draw\|function redraw\|function repaint\|_render\b\|_draw\b" MapEditorPro.html | head -20
```

Note the exact function name (e.g., `Canvas.redraw()` or `_render()` inside the Canvas IIFE).

- [ ] **Step 3: Add visibilitychange listener**

In the DOMContentLoaded handler (near the bottom of the file, around line 3900+), add:

```javascript
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // Force canvas redraw when tab becomes visible again
    Canvas.redraw();   // replace Canvas.redraw() with the actual redraw call found in Step 2
  }
});
```

- [ ] **Step 4: Verify**

1. Open editor in Chrome. Switch to Map editor mode — map renders correctly.
2. Switch to a different Chrome tab and leave it for 30+ seconds.
3. Return to the Map editor tab.
4. Map canvas should render correctly (no black screen).

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html
git commit -m "fix: force canvas redraw on visibilitychange to prevent black screen after tab inactive"
```

---

### Task 4 (Polish): Hide map-specific status bar info in non-map editor modes

The status bar (`#statusbar`) shows map tile info (Tool, Coordinates, Terrain type) in all editor modes including Hex, Buildings, and Settlements editors. This is confusing — these fields are only meaningful in Map mode.

**Files:**
- Modify: `MapEditorPro.html` — CSS section (around line 1-200) or inline `<style>`

- [ ] **Step 1: Inspect status bar HTML**

The status bar is at lines 910-916:
```html
<div id="statusbar">
  <div class="status-item"><span>Tool: </span><span id="st-tool">Paint</span></div>
  ...
</div>
```

The body has class `mode-map`, `mode-hexdb`, `mode-buildings`, or `mode-settlements` depending on the active editor.

- [ ] **Step 2: Add CSS to hide status bar outside map mode**

Find the `<style>` block in MapEditorPro.html. Add these rules:

```css
/* Hide map-specific statusbar in non-map editor modes */
body:not(.mode-map) #statusbar {
  display: none;
}
```

This hides the entire status bar in Hex/Buildings/Settlements modes without touching any JS.

- [ ] **Step 3: Verify**

1. Open editor. Default mode (Map) — status bar is visible at the bottom.
2. Switch to Hex editor — status bar is gone.
3. Switch to Buildings editor — status bar is gone.
4. Switch to Settlements editor — status bar is gone.
5. Switch back to Map editor — status bar reappears.

- [ ] **Step 4: Commit**

```bash
git add MapEditorPro.html
git commit -m "fix: hide map statusbar in non-map editor modes using CSS body-class gating"
```

---

### Task 5 (Polish): Change default Hex type from 'Plain_1' to 'New'

When a new hex is added via the "+Add Hex" button, its `type` defaults to `'Plain_1'`. QA requests `'New'` so unassigned hexes can be found easily via the type filter.

**Files:**
- Modify: `MapEditorPro.html:2902`

- [ ] **Step 1: Find _blank()**

Line 2900-2916:
```javascript
function _blank() {
  return {
    id:'', textId:'', type:'Plain_1', biome:'Summer',
    ...
  };
}
```

- [ ] **Step 2: Change the default type**

```javascript
function _blank() {
  return {
    id:'', textId:'', type:'New', biome:'Summer',
    ...
  };
}
```

- [ ] **Step 3: Verify**

1. Switch to Hex editor.
2. Click "+Add Hex".
3. In the right panel, the Type field shows `New`.
4. The type filter dropdown — if it lists all types, `New` should appear as a filter option after a hex of that type exists.

- [ ] **Step 4: Commit**

```bash
git add MapEditorPro.html
git commit -m "fix: default new Hex type to 'New' instead of 'Plain_1' for easier discovery"
```

---

### Task 6 (Polish): Add A-Z alphabetical sort to Hex list

The HexDB list is sorted by insertion order. QA requests alphabetical A-Z sort by `id`.

**Files:**
- Modify: `MapEditorPro.html` — HexDB `_applyFilter` (line 2941)

- [ ] **Step 1: Current _applyFilter (lines 2941-2956)**

```javascript
function _applyFilter() {
  const s = _filter.search.toLowerCase();
  const b = _filter.biome;
  const t = _filter.type;
  _filtered = _data.hexes
    .map((h, i) => i)
    .filter(i => {
      const h = _data.hexes[i];
      if (s && !h.id.toLowerCase().includes(s)) return false;
      if (b && h.biome !== b) return false;
      if (t && h.type !== t) return false;
      return true;
    });
  document.getElementById('hexdb-count').textContent =
    `${_filtered.length} shown / ${_data.hexes.length}`;
}
```

- [ ] **Step 2: Add sort after filter**

Replace the function with:
```javascript
function _applyFilter() {
  const s = _filter.search.toLowerCase();
  const b = _filter.biome;
  const t = _filter.type;
  _filtered = _data.hexes
    .map((h, i) => i)
    .filter(i => {
      const h = _data.hexes[i];
      if (s && !h.id.toLowerCase().includes(s)) return false;
      if (b && h.biome !== b) return false;
      if (t && h.type !== t) return false;
      return true;
    })
    .sort((a, b) => _data.hexes[a].id.toLowerCase().localeCompare(_data.hexes[b].id.toLowerCase()));
  document.getElementById('hexdb-count').textContent =
    `${_filtered.length} shown / ${_data.hexes.length}`;
}
```

- [ ] **Step 3: Verify**

1. Add hexes with ids: `Zebra`, `Apple`, `Mango`.
2. The list should display them as: `Apple`, `Mango`, `Zebra`.
3. Unnamed hexes (id `''`) sort before all named ones (empty string sorts first with localeCompare).

- [ ] **Step 4: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat: sort Hex list alphabetically A-Z by id"
```

---

### Task 7 (Important): Document sprite path convention

Map editor loads sprites from `sprites/hex/` (web-relative), while the Unity DB importer uses `Resources/Hex/`. These are different systems serving different purposes. The fix is to make this convention visible in the editor UI so designers always know which path to enter.

**Files:**
- Modify: `MapEditorPro.html` — the spriteName field label/tooltip in the HexDB form

- [ ] **Step 1: Find the spriteName input in the HexDB form**

Search for `spriteName` in the HTML form generation inside `_renderForm`:
```bash
grep -n "spriteName\|sprite.*name\|sprite-name" MapEditorPro.html | head -20
```

- [ ] **Step 2: Add placeholder and hint to spriteName input**

Find the `spriteName` field rendering in `_renderForm`. It generates an `<input>` for `spriteName`. Change it to include:
- `placeholder="e.g. Plain_1"` on the input
- A `<small>` hint beneath it:

```javascript
// In the _renderForm function, where spriteName field is generated:
// Change from something like:
_field('spriteName', 'Sprite Name', h.spriteName)
// To a custom block with a hint:
`<label>Sprite Name
  <input type="text" data-field="spriteName" value="${_esc(h.spriteName)}" placeholder="e.g. Plain_1">
  <small style="color:#888;font-size:0.8em">
    Web editor: sprites/hex/&lt;name&gt;.png &nbsp;|&nbsp; Unity: Resources/Hex/&lt;name&gt;
  </small>
</label>`
```

Adapt the exact code to match how other fields are generated in `_renderForm`.

- [ ] **Step 3: Verify**

1. Select any hex in the Hex editor.
2. The Sprite Name field shows the hint text below it.
3. Hint reads: "Web editor: sprites/hex/<name>.png | Unity: Resources/Hex/<name>"

- [ ] **Step 4: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat: add sprite path convention hint to Hex spriteName field"
```

---

### Task 8 (Important): Implement Type grouping — add group labels to type dropdown

The `type` field in HexDB currently lists individual tile IDs (e.g., `Plain_1`, `Forest_1`). QA wants types grouped by category: Forests, Rivers, Seas, Plains, Mountains, Hills. This task adds `<optgroup>` grouping to the Type filter dropdown and the Type field in the hex form.

**Files:**
- Modify: `MapEditorPro.html` — HexDB type filter dropdown and the `type` field `<select>` in the form

- [ ] **Step 1: Define type groups constant near the top of HexDB IIFE**

Find where `HexDB` IIFE starts (around line 2870). Add a constant after the variable declarations:

```javascript
const TYPE_GROUPS = {
  'Plains':    ['Plain_1', 'Plain_2', 'Plain_3'],
  'Forests':   ['Forest_1', 'Forest_2', 'Forest_3'],
  'Rivers':    ['River_1', 'River_2', 'River_3', 'River_4', 'River_5', 'River_6'],
  'Seas':      ['Sea_1', 'Sea_2', 'Sea_3'],
  'Mountains': ['Mountain_1', 'Mountain_2'],
  'Hills':     ['Hill_1', 'Hill_2'],
  'Special':   ['New'],
};
```

Extend the arrays with actual type IDs from your data as you define them.

- [ ] **Step 2: Generate grouped options helper**

Add a helper that builds `<optgroup>` HTML:

```javascript
function _typeGroupOptions(selectedValue, includeAll) {
  let html = includeAll ? '<option value="">All Types</option>' : '';
  for (const [group, types] of Object.entries(TYPE_GROUPS)) {
    html += `<optgroup label="${group}">`;
    for (const t of types) {
      html += `<option value="${t}"${t === selectedValue ? ' selected' : ''}>${t}</option>`;
    }
    html += '</optgroup>';
  }
  return html;
}
```

- [ ] **Step 3: Use grouped options in the type filter dropdown**

Find where `#hexdb-type-filter` `<select>` is populated (either in `init` or rendered into HTML). Replace the flat `<option>` list with a call to `_typeGroupOptions('', true)`.

- [ ] **Step 4: Use grouped options in the hex form type field**

In `_renderForm`, find where the `type` field `<select>` is built. Replace the flat options with `_typeGroupOptions(h.type, false)`.

- [ ] **Step 5: Verify**

1. Open type filter dropdown — options are grouped under headings (Plains, Forests, Rivers, etc.).
2. Select a hex → Type field in right panel shows grouped `<select>`.
3. Change type to `Forest_2` → hex data updates correctly.
4. Filter by type `Forest_2` → only matching hexes shown.

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat: group Type dropdown by category (Plains, Forests, Rivers, etc.)"
```

---

### Task 9 (Important): Add ID naming convention hint

The ID field in HexDB has inconsistent naming in practice (`Plains1` vs `Plain_1`). Add a placeholder and inline hint showing the expected convention.

**Files:**
- Modify: `MapEditorPro.html` — HexDB `_renderForm`, the `id` field

- [ ] **Step 1: Find id field in _renderForm**

Search for where the `id` field input is generated in the HexDB `_renderForm` function.

- [ ] **Step 2: Add placeholder and pattern hint**

Update the id field to include:
- `placeholder="e.g. Forest_1"` on the input
- A `<small>` hint: `"Format: CategoryName_Number (e.g. Plain_1, Forest_2, River_3)"`

```javascript
// Example generated HTML for the id field:
`<label>ID
  <input type="text" data-field="id" value="${_esc(h.id)}" placeholder="e.g. Plain_1">
  <small style="color:#888;font-size:0.8em">Format: TypeName_Number (e.g. Plain_1, Forest_2)</small>
</label>`
```

- [ ] **Step 3: Verify**

1. Select any hex.
2. The ID field shows placeholder `e.g. Plain_1` when empty.
3. A hint below the field reads the convention text.

- [ ] **Step 4: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat: add ID naming convention hint to Hex ID field"
```
