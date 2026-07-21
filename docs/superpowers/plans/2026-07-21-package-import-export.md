# Package Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Export (download ZIP) and Import (upload ZIP as a new package) to the Packages panel in `MapEditorPro.html`.

**Architecture:** All code lives inside the existing `Packages` IIFE in `MapEditorPro.html`. Task 1 fixes a pre-existing bug where the Packages IIFE calls private `GitHubSync` functions (`_putText`, `_withPublishBtn`, `BASE_URL`) that are out of scope. Tasks 2–4 add the export and import feature using JSZip loaded lazily from jsdelivr CDN.

**Tech Stack:** JSZip 3.10.1 (jsdelivr CDN, lazy ES module import), `GitHubSync._putText`, `GitHubSync._putBinary`, `GitHubSync._listFolder`, `UI.progress`, `UI.progressDone`, `UI.toast`.

## Global Constraints

- Single-file HTML app — all changes inline in `MapEditorPro.html`, no new files
- JSZip loaded lazily: `const m = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm'); _jszip = m.default;`
- `GitHubSync._putText(path, text, msg)`, `GitHubSync._putBinary(path, blob, msg)`, `GitHubSync._listFolder(path)` — always qualify with `GitHubSync.`
- `BASE_URL` inside Packages IIFE comes from `const BASE_URL = GitHubSync.BASE_URL;` (declared at top of IIFE in Task 1)
- Import modal uses same dark-theme inline styles as `#pkg-new-modal`: `background:#1e1e2e`, `border:1px solid #45475a`, inputs `background:#313244;color:#cdd6f4`
- All new Packages functions declared inside the IIFE and exported via `return {}`
- Working directory: `/Users/sergii.tyshchenko/Post Apo Map Editor`, branch: `dev`

## File Structure

One file modified: `MapEditorPro.html`

| Section | What changes |
|---------|-------------|
| GitHubSync `return {}` (~line 5038) | Add `_withPublishBtn` to exports |
| Packages IIFE top (~line 7045) | Add `const BASE_URL = GitHubSync.BASE_URL;` and `let _jszip = null;` |
| `createPackage` / `publishPackage` / `deletePackage` | Fix bare `_putText` / `_withPublishBtn` calls → `GitHubSync.*` |
| `renderPanel()` | Add "Import Package" button + "Export" button per row |
| Packages IIFE body (before `return {}`) | Add `_loadJSZip`, `exportPackage`, `openImportModal`, `_onImportFilePicked`, `_importZip`, `_showImportModal`, `closeImportModal`, `_rewriteEntries`, `confirmImport` |
| Packages `return {}` | Export all new functions |
| Near `</body>` | Add `#pkg-import-modal` + `#pkg-import-input` |

---

### Task 1: Fix bare GitHubSync references in existing Packages functions

**Files:**
- Modify: `MapEditorPro.html`

**Context:** The `Packages` IIFE (const at ~line 7040) calls `_putText`, `_withPublishBtn`, and `BASE_URL` as bare names. These are private to the `GitHubSync` IIFE and not in scope. `_withPublishBtn` is not currently exported by `GitHubSync`. This task fixes the scoping bug.

**Interfaces:**
- Consumes: `GitHubSync._putText`, `GitHubSync._putBinary`, `GitHubSync._listFolder`, `GitHubSync.BASE_URL`, `GitHubSync._withPublishBtn` (added here)
- Produces: working `createPackage`, `publishPackage`, `deletePackage` in the Packages IIFE

- [ ] **Step 1: Add `_withPublishBtn` to GitHubSync exports**

Find the `return {` block of the `GitHubSync` IIFE. Locate this line:
```javascript
    _putText, _putBinary, _listFolder, BASE_URL,
```
Add `_withPublishBtn` to that same line:
```javascript
    _putText, _putBinary, _listFolder, _withPublishBtn, BASE_URL,
```

- [ ] **Step 2: Add `BASE_URL` and `_jszip` at the top of the Packages IIFE**

Find these two lines at the top of the `Packages` IIFE:
```javascript
  let _registry = [{ id: 'postapoc', name: 'Post-Apocalypse', isDefault: true, version: '1.0.0' }];
  let _active   = 'postapoc';
```

Add two lines immediately after `let _active   = 'postapoc';`:
```javascript
  const BASE_URL = GitHubSync.BASE_URL;
  let _jszip = null;  // cached JSZip module (lazy-loaded)
```

- [ ] **Step 3: Fix `createPackage` — replace bare `_putText` calls**

Inside `createPackage()`, find:
```javascript
      await _putText(`packages/${rawId}/package.json`, pkgJson, `create package: ${rawId}`);
```
Replace with:
```javascript
      await GitHubSync._putText(`packages/${rawId}/package.json`, pkgJson, `create package: ${rawId}`);
```

Then find:
```javascript
      await _putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: add ${rawId}`);
```
Replace with:
```javascript
      await GitHubSync._putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: add ${rawId}`);
```

- [ ] **Step 4: Fix `publishPackage` — replace `_withPublishBtn` and `_putText`**

Inside `publishPackage()`, find:
```javascript
    await _withPublishBtn('Publish Package', async () => {
```
Replace with:
```javascript
    await GitHubSync._withPublishBtn('Publish Package', async () => {
```

Then replace all four bare `_putText` calls inside `publishPackage` with `GitHubSync._putText`. They are:
```javascript
      await _putText(`packages/${id}/hex_database.json`, hexPayload, `publish ${id}: hex_database.json`);
```
→
```javascript
      await GitHubSync._putText(`packages/${id}/hex_database.json`, hexPayload, `publish ${id}: hex_database.json`);
```
Apply the same prefix to the building_database.json, package.json, and registry.json `_putText` calls in that same function.

- [ ] **Step 5: Fix `deletePackage` — replace bare `_putText`**

Inside `deletePackage()`, find:
```javascript
      await _putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: remove ${id}`);
```
Replace with:
```javascript
      await GitHubSync._putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: remove ${id}`);
```

- [ ] **Step 6: Verify by grep — no bare `_putText` or `_withPublishBtn` remain in Packages IIFE**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
# Should return ZERO results inside the Packages IIFE (lines 7040-7360 approx)
awk 'NR>=7040 && NR<=7400' MapEditorPro.html | grep -n "await _putText\|await _withPublishBtn\|await _putBinary\|await _listFolder"
```
Expected: no output (all calls are now `GitHubSync.*`).

- [ ] **Step 7: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "fix(packages): qualify _putText/_withPublishBtn as GitHubSync.*, add BASE_URL"
```

---

### Task 2: Export Package — JSZip loader + `exportPackage` + panel update

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `_jszip` (from Task 1), `BASE_URL` (from Task 1), `GitHubSync._listFolder`, `GitHubSync.BASE_URL`, `getEntry(id)`, `isDefault(id)`, `UI.progress`, `UI.progressDone`, `UI.toast`
- Produces: `_loadJSZip()`, `exportPackage(id)`, updated `renderPanel()` with Export + Import Package buttons

- [ ] **Step 1: Add `_loadJSZip` function inside the Packages IIFE**

Find the `// ── New Package modal` comment inside the Packages IIFE. Insert the following block immediately before it:

```javascript
  // ── JSZip lazy loader ─────────────────────────────────────────
  async function _loadJSZip() {
    if (!_jszip) {
      try {
        const m = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
        _jszip = m.default;
      } catch(e) {
        throw new Error('Could not load ZIP library. Check your connection.');
      }
    }
    return _jszip;
  }

  // ── Export Package ─────────────────────────────────────────────
  async function exportPackage(id) {
    const entry = getEntry(id);
    if (!entry) return UI.toast('⚠ Package not found');
    try {
      UI.progress(0, `Preparing export for "${_esc(entry.name)}"…`);
      const JSZip = await _loadJSZip();

      // Fetch JSON files
      UI.progress(5, 'Fetching package.json…');
      const pkgRes = await fetch(`${BASE_URL}/packages/${id}/package.json?_=${Date.now()}`);
      if (!pkgRes.ok) {
        UI.progressDone('');
        return UI.toast('⚠ Package must be published before exporting');
      }
      const pkgText = await pkgRes.text();

      UI.progress(10, 'Fetching hex_database.json…');
      const hexRes = await fetch(`${BASE_URL}/packages/${id}/hex_database.json?_=${Date.now()}`);
      const hexText = hexRes.ok ? await hexRes.text() : '{"version":1,"hexes":[]}';

      UI.progress(15, 'Fetching building_database.json…');
      const bldRes = await fetch(`${BASE_URL}/packages/${id}/building_database.json?_=${Date.now()}`);
      const bldText = bldRes.ok ? await bldRes.text() : '{"version":1,"buildings":[]}';

      // List sprites
      UI.progress(20, 'Listing sprites…');
      const [hexSprites, bldSprites] = await Promise.all([
        GitHubSync._listFolder(`packages/${id}/sprites/hex`).catch(() => []),
        GitHubSync._listFolder(`packages/${id}/sprites/buildings`).catch(() => []),
      ]);
      const allSprites = [
        ...hexSprites.map(f => ({ category: 'hex',       name: f.name, url: f.download_url })),
        ...bldSprites.map(f => ({ category: 'buildings', name: f.name, url: f.download_url })),
      ];

      // Build ZIP
      const zip = new JSZip();
      zip.file('package.json',          pkgText);
      zip.file('hex_database.json',     hexText);
      zip.file('building_database.json', bldText);
      const hexDir = zip.folder('sprites').folder('hex');
      const bldDir = zip.folder('sprites').folder('buildings');

      // Fetch and add sprites
      let done = 0;
      for (const spr of allSprites) {
        try {
          const res = await fetch(spr.url);
          if (res.ok) {
            const blob = await res.blob();
            (spr.category === 'hex' ? hexDir : bldDir).file(spr.name, blob);
          }
        } catch(e) {
          console.warn(`[Packages] export: skipped ${spr.name}:`, e.message);
        }
        done++;
        const pct = 20 + Math.round((done / Math.max(allSprites.length, 1)) * 70);
        UI.progress(pct, `Sprites: ${done}/${allSprites.length}…`);
      }

      UI.progress(92, 'Generating ZIP…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

      // Trigger download
      const version = JSON.parse(pkgText).version || '1.0.0';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${id}-${version}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);

      UI.progressDone(`✅ Exported ${id}-${version}.zip`);
      UI.toast(`✅ Package "${entry.name}" exported`);
    } catch(e) {
      UI.progressDone('');
      UI.toast(`⚠ Export failed: ${e.message}`);
    }
  }
```

- [ ] **Step 2: Update `renderPanel()` to add Export button and Import Package button**

Find the current `renderPanel()` function. Replace the entire function body with:

```javascript
  function renderPanel() {
    const el = document.getElementById('pkg-panel');
    if (!el) return;
    const rows = _registry.map(p => `
      <tr>
        <td><code>${_esc(p.id)}</code>${p.isDefault ? ' <span class="pkg-badge">default</span>' : ''}</td>
        <td>${_esc(p.name)}</td>
        <td>${_esc(p.version || '—')}</td>
        <td>
          <button class="hexdb-tool-btn" onclick="Packages.exportPackage('${p.id}')">↓ Export</button>
          <button class="hexdb-tool-btn" onclick="Packages.openPublishConfirm('${p.id}')">Publish</button>
          ${!p.isDefault ? `<button class="hexdb-tool-btn" style="color:#f38ba8" onclick="Packages.confirmDelete('${p.id}')">Delete</button>` : ''}
        </td>
      </tr>`).join('');
    el.innerHTML = `
      <h3 style="color:#cdd6f4;margin:0 0 16px">Content Packages</h3>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="hexdb-tool-btn" onclick="Packages.openImportModal()">↑ Import Package</button>
        <button class="hexdb-tool-btn" onclick="Packages.openNewModal()">+ New Package</button>
      </div>
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Version</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
```

- [ ] **Step 3: Add `openImportModal` stub and export new functions**

Find the `return {` line at the bottom of the Packages IIFE. Add a stub before it:

```javascript
  function openImportModal() {
    const input = document.getElementById('pkg-import-input');
    if (input) input.click();
    else UI.toast('⚠ Import UI not ready');
  }
```

Update the `return {}` to export new functions — replace the existing return line:
```javascript
  return { init, getActive, setActive, getAll, getEntry, isDefault, idPrefix,
           renderPanel, renderBadges, renderActiveDropdowns, renderFilterChips,
           isPkgVisible, togglePkgFilter,
           openNewModal, closeNewModal, _autoSlugId, createPackage,
           openPublishConfirm, publishPackage, confirmDelete, deletePackage,
           _loadJSZip, exportPackage, openImportModal };
```

- [ ] **Step 4: Verify by grep**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
grep -n "exportPackage\|openImportModal\|_loadJSZip\|↓ Export\|↑ Import" MapEditorPro.html
```
Expected: at least one hit each for `exportPackage`, `openImportModal`, `_loadJSZip` inside the Packages IIFE, and `↓ Export` / `↑ Import` inside `renderPanel`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(packages): add export-package flow and panel buttons"
```

---

### Task 3: Import modal HTML + file picker + ZIP reading

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `_loadJSZip()` (Task 2), `_esc()` (internal to Packages IIFE), `UI.toast`
- Produces: `#pkg-import-modal` HTML, `#pkg-import-input` file input, `_onImportFilePicked(file)`, `_showImportModal(originalId, name, zip)`, `closeImportModal()`, `let _importZip`

- [ ] **Step 1: Add `#pkg-import-modal` and `#pkg-import-input` HTML before `</body>`**

Find `</body>` at the very end of the file. Find the existing `#pkg-new-modal` div just above it. Add the following immediately after the `#pkg-new-modal` closing `</div>`:

```html
<!-- Packages — Import Package modal -->
<div id="pkg-import-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9000;align-items:center;justify-content:center">
  <div style="background:#1e1e2e;border:1px solid #45475a;border-radius:8px;padding:24px;min-width:380px;display:flex;flex-direction:column;gap:12px">
    <h3 style="margin:0;color:#cdd6f4">Import Package</h3>
    <label style="font-size:12px;color:#888">Display Name</label>
    <input id="pkg-import-name" type="text"
           style="padding:8px;border-radius:4px;border:1px solid #45475a;background:#313244;color:#cdd6f4;font-size:13px">
    <label style="font-size:12px;color:#888">Package ID (lowercase, hyphens only)</label>
    <input id="pkg-import-id" type="text"
           style="padding:8px;border-radius:4px;border:1px solid #45475a;background:#313244;color:#cdd6f4;font-size:13px;font-family:monospace">
    <input type="hidden" id="pkg-import-original-id">
    <div id="pkg-import-error" style="color:#f38ba8;font-size:12px;display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="hexdb-tool-btn" onclick="Packages.closeImportModal()">Cancel</button>
      <button class="hexdb-tool-btn" style="background:#89dceb;color:#1e1e2e" onclick="Packages.confirmImport()">Import</button>
    </div>
  </div>
</div>
<input type="file" id="pkg-import-input" accept=".zip" style="display:none"
       onchange="Packages._onImportFilePicked(this.files[0]); this.value=''">
```

- [ ] **Step 2: Add `_importZip` variable and import modal functions inside Packages IIFE**

Find the `openImportModal` stub added in Task 2. Replace just the stub with the full implementation, and add the surrounding functions:

```javascript
  // ── Import Package modal ───────────────────────────────────────
  let _importZip = null;  // holds JSZip instance while import modal is open

  function openImportModal() {
    const input = document.getElementById('pkg-import-input');
    if (input) input.click();
    else UI.toast('⚠ Import UI not ready — try reloading');
  }

  async function _onImportFilePicked(file) {
    if (!file) return;
    try {
      const JSZip = await _loadJSZip();
      const zip   = await JSZip.loadAsync(file);
      const pkgFile = zip.file('package.json');
      if (!pkgFile) return UI.toast('⚠ Invalid package ZIP: missing package.json');
      const pkgData = JSON.parse(await pkgFile.async('text'));
      _showImportModal(pkgData.id || '', pkgData.name || '', zip);
    } catch(e) {
      UI.toast(`⚠ Could not read ZIP: ${e.message}`);
    }
  }

  function _showImportModal(originalId, name, zip) {
    _importZip = zip;
    document.getElementById('pkg-import-original-id').value = originalId;
    document.getElementById('pkg-import-name').value        = name;
    document.getElementById('pkg-import-id').value          = originalId;
    document.getElementById('pkg-import-error').style.display = 'none';
    document.getElementById('pkg-import-modal').style.display = 'flex';
    document.getElementById('pkg-import-id').focus();
  }

  function closeImportModal() {
    document.getElementById('pkg-import-modal').style.display = 'none';
    _importZip = null;
  }
```

- [ ] **Step 3: Export new functions from Packages return statement**

Find the `return {}` line and update it to include `_onImportFilePicked` and `closeImportModal`:

```javascript
  return { init, getActive, setActive, getAll, getEntry, isDefault, idPrefix,
           renderPanel, renderBadges, renderActiveDropdowns, renderFilterChips,
           isPkgVisible, togglePkgFilter,
           openNewModal, closeNewModal, _autoSlugId, createPackage,
           openPublishConfirm, publishPackage, confirmDelete, deletePackage,
           _loadJSZip, exportPackage, openImportModal, _onImportFilePicked,
           closeImportModal };
```

- [ ] **Step 4: Verify by grep**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
grep -n "pkg-import-modal\|pkg-import-input\|pkg-import-name\|_onImportFilePicked\|closeImportModal\|_importZip" MapEditorPro.html | head -20
```
Expected: `#pkg-import-modal` found in HTML near `</body>`, `#pkg-import-input` found, all JS functions found inside Packages IIFE, all exported in `return {}`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(packages): add import modal, file picker, ZIP reading"
```

---

### Task 4: Import confirm — ID rewriting + publish sequence

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `_importZip` (Task 3), `closeImportModal()` (Task 3), `BASE_URL` (Task 1), `GitHubSync._putText`, `GitHubSync._putBinary`, `getEntry(id)`, `idPrefix(id)`, `_registry`, `LS_REGISTRY`, `UI.progress`, `UI.progressDone`, `UI.toast`, `renderPanel()`, `renderActiveDropdowns()`
- Produces: `_rewriteEntries(entries, originalId, newId)`, `confirmImport()`; full import flow

- [ ] **Step 1: Add `_rewriteEntries` and `confirmImport` inside Packages IIFE**

Find the `closeImportModal` function added in Task 3. Add the following immediately after it:

```javascript
  // ── Import confirm + publish ────────────────────────────────────
  function _rewriteEntries(entries, originalId, newId) {
    const oldPrefix = idPrefix(originalId);
    const newPrefix = idPrefix(newId);
    return (entries || []).map(e => ({
      ...e,
      id: e.id.startsWith(oldPrefix)
          ? newPrefix + e.id.slice(oldPrefix.length)
          : newPrefix + e.id,
      package: newId,
    }));
  }

  async function confirmImport() {
    const name   = document.getElementById('pkg-import-name').value.trim();
    const newId  = document.getElementById('pkg-import-id').value.trim();
    const origId = document.getElementById('pkg-import-original-id').value;
    const errEl  = document.getElementById('pkg-import-error');

    if (!name) {
      errEl.textContent = 'Display name is required.';
      errEl.style.display = 'block'; return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(newId)) {
      errEl.textContent = 'ID must be lowercase letters, numbers, and hyphens only.';
      errEl.style.display = 'block'; return;
    }
    if (getEntry(newId)) {
      errEl.textContent = `Package "${newId}" already exists.`;
      errEl.style.display = 'block'; return;
    }

    const zip = _importZip;
    closeImportModal();

    try {
      UI.progress(5, `Importing "${name}"…`);

      // Read databases from ZIP
      const hexFile = zip.file('hex_database.json');
      const bldFile = zip.file('building_database.json');
      const hexData = hexFile ? JSON.parse(await hexFile.async('text')) : { hexes: [] };
      const bldData = bldFile ? JSON.parse(await bldFile.async('text')) : { buildings: [] };

      const hexes     = _rewriteEntries(hexData.hexes,     origId, newId);
      const buildings = _rewriteEntries(bldData.buildings, origId, newId);

      // Write package.json
      UI.progress(10, 'Writing package.json…');
      const pkgJson = JSON.stringify({ id: newId, name, version: '1.0.0', description: '', isDefault: false }, null, 2);
      await GitHubSync._putText(`packages/${newId}/package.json`, pkgJson, `import package: ${newId}`);

      // Write hex_database.json
      UI.progress(20, 'Writing hex_database.json…');
      await GitHubSync._putText(
        `packages/${newId}/hex_database.json`,
        JSON.stringify({ version: 1, package: newId, hexes }, null, 2),
        `import ${newId}: hex_database.json`);

      // Write building_database.json
      UI.progress(30, 'Writing building_database.json…');
      await GitHubSync._putText(
        `packages/${newId}/building_database.json`,
        JSON.stringify({ version: 1, package: newId, buildings }, null, 2),
        `import ${newId}: building_database.json`);

      // Upload sprites from ZIP
      const spriteFiles = Object.entries(zip.files)
        .filter(([path, f]) => path.startsWith('sprites/') && !f.dir)
        .map(([path, file]) => ({ path, file }));

      let done = 0;
      for (const { path, file } of spriteFiles) {
        try {
          // path example: 'sprites/hex/Forest.png' → dest: 'packages/medieval/sprites/hex/Forest.png'
          const destPath = `packages/${newId}/${path}`;
          const blob = await file.async('blob');
          await GitHubSync._putBinary(destPath, blob, `import ${newId}: ${path}`);
        } catch(e) {
          console.warn(`[Packages] import: skipped sprite ${path}:`, e.message);
        }
        done++;
        const pct = 30 + Math.round((done / Math.max(spriteFiles.length, 1)) * 55);
        UI.progress(pct, `Sprites: ${done}/${spriteFiles.length}…`);
      }

      // Update registry
      UI.progress(88, 'Updating registry.json…');
      const newEntry = { id: newId, name, isDefault: false, version: '1.0.0' };
      let regData;
      try {
        const res = await fetch(`${BASE_URL}/packages/registry.json?_=${Date.now()}`);
        regData = res.ok ? await res.json() : { version: 1, packages: [..._registry] };
      } catch(e) { regData = { version: 1, packages: [..._registry] }; }
      if (!regData.packages.find(p => p.id === newId)) regData.packages.push(newEntry);
      await GitHubSync._putText('packages/registry.json', JSON.stringify(regData, null, 2), `registry: add ${newId}`);

      _registry = regData.packages;
      localStorage.setItem(LS_REGISTRY, JSON.stringify(_registry));
      UI.progressDone(`✅ Package "${name}" imported`);
      UI.toast(`✅ Package "${name}" imported successfully`);
      renderPanel();
      renderActiveDropdowns();
    } catch(e) {
      UI.progressDone('');
      UI.toast(`⚠ Import failed: ${e.message}`);
    }
  }
```

- [ ] **Step 2: Export `_rewriteEntries` and `confirmImport` from Packages**

Find the `return {}` line at the bottom of the Packages IIFE and replace it:

```javascript
  return { init, getActive, setActive, getAll, getEntry, isDefault, idPrefix,
           renderPanel, renderBadges, renderActiveDropdowns, renderFilterChips,
           isPkgVisible, togglePkgFilter,
           openNewModal, closeNewModal, _autoSlugId, createPackage,
           openPublishConfirm, publishPackage, confirmDelete, deletePackage,
           _loadJSZip, exportPackage,
           openImportModal, _onImportFilePicked, closeImportModal,
           _rewriteEntries, confirmImport };
```

- [ ] **Step 3: Verify by grep**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
grep -n "_rewriteEntries\|confirmImport" MapEditorPro.html
```
Expected: `_rewriteEntries` defined inside Packages IIFE, `confirmImport` defined inside Packages IIFE, both exported in `return {}`, `confirmImport` called from `#pkg-import-modal` button.

- [ ] **Step 4: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(packages): add import confirm, ID rewriting, publish sequence"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| JSZip loaded lazily from jsdelivr CDN | T2 (`_loadJSZip`) |
| Export requires package published (404 guard) | T2 (`exportPackage` checks pkgRes.ok) |
| Export fetches package.json, hex_database.json, building_database.json | T2 |
| Export lists and fetches sprites via `_listFolder` | T2 |
| Export downloads as `<id>-<version>.zip` | T2 |
| Progress bar during export | T2 |
| Skip failed sprites, log warning | T2 (`console.warn` in catch) |
| ZIP structure: package.json + DBs + sprites/hex/ + sprites/buildings/ | T2 |
| Import modal pre-filled from ZIP's package.json | T3 (`_showImportModal`) |
| Import modal ID field editable (override) | T3 (field is `<input>` not disabled) |
| Import modal — original ID preserved for rewriting | T3 (`#pkg-import-original-id` hidden field) |
| ID validation — slug pattern, no duplicate | T4 (`confirmImport` validation) |
| `_rewriteEntries` — strips old prefix, prepends new prefix | T4 |
| `_rewriteEntries` — sets `package: newId` on each entry | T4 |
| Publish order: package.json → hex DB → building DB → sprites → registry | T4 |
| Registry updated, local state synced | T4 |
| `renderPanel` + `renderActiveDropdowns` called after import | T4 |
| Error toast on any failure | T2, T4 |
| JSZip CDN failure handled | T2 (`_loadJSZip` catch) |
| Fix pre-existing bare `_putText`/`_withPublishBtn` bug | T1 |
| `_withPublishBtn` exported from GitHubSync | T1 |
| `BASE_URL` available in Packages IIFE | T1 |

**No gaps found.**

**Placeholder scan:** No TBD/TODO in any step. All code blocks are complete.

**Type consistency:**
- `_rewriteEntries(entries, originalId, newId)` — called in T4 with `hexData.hexes` and `bldData.buildings` (both arrays), returns array ✅
- `_showImportModal(originalId, name, zip)` — called in T3's `_onImportFilePicked` with those exact args ✅
- `_importZip` used in T4's `confirmImport` as `const zip = _importZip` — set by `_showImportModal` in T3 ✅
- `closeImportModal()` — called in `confirmImport` (T4) and exported (T3) ✅
