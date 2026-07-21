# Remove Drive → GitHub API Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Google Drive calls in `MapEditorPro.html` with direct GitHub Contents API writes to the `gh-pages` branch, so the editor publishes content without Drive or OAuth.

**Architecture:** A new `GitHubSync` IIFE replaces `DriveSync`. Instead of OAuth → Drive API folder traversal → file upload, every publish is a two-step HTTP call: GET the file's current SHA, then PUT the new content. The editor already compresses PNGs via oxipng WASM at upload time; those compressed files go straight to gh-pages via the same API. No `sync_data.sh`, no `deploy.sh` sprite steps, no Drive credentials required at runtime.

**Tech Stack:** GitHub Contents API v3 (`https://api.github.com/repos/{owner}/{repo}/contents/{path}`), browser `fetch`, fine-grained Personal Access Token (PAT) stored in `localStorage`, `@jsquash/oxipng` 2.3.0 (already wired — unchanged).

## Global Constraints

- GitHub owner/repo: `fidaykin/PostApocMapEditor` — never changes
- Target branch for all writes: `gh-pages`
- Public read URL base: `https://fidaykin.github.io/PostApocMapEditor` (called `BASE_URL`)
- GitHub API base: `https://api.github.com/repos/fidaykin/PostApocMapEditor/contents` (called `GH_API`)
- PAT localStorage key: `gh_sync_pat`
- Data sources (unchanged — same as in DriveSync):
  - hex_database.json ← `HexDB.getData()`
  - building_database.json ← `BldDB.getJson()`
  - upgrade_database.json ← `UpgDB.getJson()`
  - common_settings.json ← `CommonDB.export()`
  - localization.json ← `LocalizationKeys.getExportData()`
  - map JSON ← `IO.getMapJson()`
- File paths on gh-pages:
  - `hex_database.json`, `building_database.json`, `upgrade_database.json`, `common_settings.json`, `localization.json` — repo root
  - `maps/{name}.json` — maps folder
  - `maps/map_list.json` — maps index (auto-updated on publishMap)
  - `sprites/hex/{name}.png`, `sprites/buildings/{name}.png`
- DriveSync IIFE must remain in place until Task 8; tasks 1–7 only ADD GitHubSync and SWAP call sites
- Zero Drive API calls and zero Google OAuth calls after Task 8
- YAGNI: no pagination (< 100 sprites per folder, well under GitHub's 1 000-item default)
- `deploy.sh`: after Task 8, remove `bash compress_sprites.sh`, remove `git add sprites/ maps/`; keep the merge+stamp+push for `MapEditorPro.html`
- Delete `sync_data.sh` in Task 8

---

## File Map

**Only one file changes across tasks 1–7:**
- Modify: `MapEditorPro.html` — add GitHubSync IIFE, swap DriveSync call sites one group at a time

**Task 8 also touches:**
- Modify: `MapEditorPro.html` — delete DriveSync IIFE and all remaining DriveSync references
- Modify: `deploy.sh` — strip sprite/map git-add lines and compress_sprites.sh call
- Delete: `sync_data.sh`

---

## Task 1: GitHubSync Core Module

Add the `GitHubSync` IIFE to `MapEditorPro.html` immediately **before** the existing `DriveSync` IIFE (find the line `const DriveSync = (() => {` and insert before it). DriveSync stays untouched for now.

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Produces (used by Tasks 2–7):
  - `GitHubSync.isPATConfigured()` → `boolean`
  - `GitHubSync.getPAT()` → `string`
  - `GitHubSync.setPAT(pat: string)` → `void`
  - `GitHubSync.validatePAT(pat: string)` → `Promise<boolean>`
  - `GitHubSync._putText(path, text, message)` → `Promise<void>` (internal — used by publish fns)
  - `GitHubSync._putBinary(path, blob, message)` → `Promise<void>` (internal)
  - `GitHubSync._listFolder(path)` → `Promise<Array<{name, download_url}>>` (internal)

- [ ] **Step 1: Find insertion point**

  Search for the line `const DriveSync = (() => {` in `MapEditorPro.html`. Note its line number. Insert the block below on the line immediately before it.

- [ ] **Step 2: Insert GitHubSync IIFE**

```javascript
const GitHubSync = (() => {
  const OWNER    = 'fidaykin';
  const REPO     = 'PostApocMapEditor';
  const BRANCH   = 'gh-pages';
  const GH_API   = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;
  const BASE_URL = 'https://fidaykin.github.io/PostApocMapEditor';
  const PAT_KEY  = 'gh_sync_pat';

  // ── PAT ───────────────────────────────────────────────────────
  function getPAT()           { return localStorage.getItem(PAT_KEY) || ''; }
  function setPAT(pat)        { localStorage.setItem(PAT_KEY, pat.trim()); }
  function isPATConfigured()  { return !!getPAT(); }

  function _headers() {
    return {
      'Authorization': `Bearer ${getPAT()}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
  }

  // ── Core file API ─────────────────────────────────────────────
  async function _getFile(path) {
    const res = await fetch(`${GH_API}/${path}?ref=${BRANCH}`, { headers: _headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
    const data = await res.json();
    // data.content is base64 with embedded newlines — strip them before atob
    return { sha: data.sha, content: atob(data.content.replace(/\n/g, '')) };
  }

  async function _putFile(path, base64Content, message, sha) {
    const body = { message, content: base64Content, branch: BRANCH };
    if (sha) body.sha = sha;
    const res = await fetch(`${GH_API}/${path}`, {
      method: 'PUT',
      headers: _headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitHub PUT ${path}: ${res.status} — ${err.message || 'unknown'}`);
    }
  }

  async function _listFolder(path) {
    const res = await fetch(`${GH_API}/${path}?ref=${BRANCH}`, { headers: _headers() });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub LIST ${path}: ${res.status}`);
    return await res.json(); // [{name, sha, size, download_url, ...}]
  }

  // ── Encode helpers ────────────────────────────────────────────
  function _encodeText(text) {
    // UTF-8 safe base64
    return btoa(unescape(encodeURIComponent(text)));
  }

  async function _encodeBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]); // strip data:…;base64,
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── High-level put helpers ────────────────────────────────────
  async function _putText(path, text, message) {
    const existing = await _getFile(path);
    await _putFile(path, _encodeText(text), message, existing?.sha);
  }

  async function _putBinary(path, blob, message) {
    const existing = await _getFile(path);
    const base64   = await _encodeBlob(blob);
    await _putFile(path, base64, message, existing?.sha);
  }

  // ── PAT validation ────────────────────────────────────────────
  async function validatePAT(pat) {
    try {
      const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, {
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
        },
      });
      return res.ok;
    } catch(e) { return false; }
  }

  let _lastMapName = localStorage.getItem('ghLastMapName') || '';

  return {
    isPATConfigured, getPAT, setPAT, validatePAT,
    _putText, _putBinary, _listFolder, BASE_URL,
    get lastMapName() { return _lastMapName; },
    set lastMapName(v) { _lastMapName = v; localStorage.setItem('ghLastMapName', v); },
  };
})();
```

- [ ] **Step 3: Verify in browser console**

  Open `MapEditorPro.html` in a browser. In DevTools console run:
  ```js
  GitHubSync.isPATConfigured()
  // Expected: false
  GitHubSync.getPAT()
  // Expected: ""
  ```

- [ ] **Step 4: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(github-sync): add GitHubSync core IIFE (PAT, GET, PUT, LIST)"
```

---

## Task 2: PAT Settings UI

Replace the "Sign in to Google" + "☁ Sync" + "Auto-sync" buttons (lines ~1340–1343 in `MapEditorPro.html`) with a single "⚙ GitHub" button that opens a PAT settings modal. Add the modal HTML and the `openPATSettings()` function to GitHubSync.

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `GitHubSync.isPATConfigured()`, `GitHubSync.getPAT()`, `GitHubSync.setPAT()`, `GitHubSync.validatePAT()`
- Produces: `GitHubSync.openPATSettings()` (referenced by toolbar button)

- [ ] **Step 1: Replace toolbar buttons**

  Find these three lines (around line 1340):
  ```html
  <button class="publish-btn" id="btn-google-login" onclick="DriveSync.signIn()" title="Sign in to Google to enable Drive sync">Sign in to Google</button>
  <button class="publish-btn" id="btn-sync-drive"  onclick="DriveSync.syncFromDrive()" title="Force re-download HexDB + all custom sprites from Drive">☁ Sync</button>
  ...
  <input type="checkbox" id="chk-auto-sync" onchange="DriveSync.setAutoSync(this.checked)">Auto-sync
  ```
  Replace all three with:
  ```html
  <button class="publish-btn" id="btn-gh-settings" onclick="GitHubSync.openPATSettings()" title="Configure GitHub sync (Personal Access Token)">⚙ GitHub</button>
  ```

- [ ] **Step 2: Add PAT modal HTML**

  Find the closing `</body>` tag. Insert the modal before it:
  ```html
  <!-- GitHub PAT settings modal -->
  <div id="gh-pat-modal" class="modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center;">
    <div style="background:#1e1e2e;color:#cdd6f4;border-radius:8px;padding:24px;width:420px;max-width:90vw;display:flex;flex-direction:column;gap:12px;">
      <h3 style="margin:0;font-size:16px;">⚙ GitHub Sync Settings</h3>
      <p style="margin:0;font-size:12px;color:#a6adc8;">
        Create a fine-grained PAT at github.com/settings/tokens with<br>
        <strong>Contents: Read &amp; Write</strong> for <code>fidaykin/PostApocMapEditor</code>.
      </p>
      <input id="gh-pat-input" type="password" placeholder="github_pat_..." autocomplete="off"
        style="padding:8px;border-radius:4px;border:1px solid #45475a;background:#313244;color:#cdd6f4;font-family:monospace;font-size:13px;">
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="gh-pat-validate-btn" onclick="GitHubSync._onValidateClick()"
          style="padding:6px 16px;border-radius:4px;border:none;background:#89b4fa;color:#1e1e2e;cursor:pointer;font-weight:600;">Validate</button>
        <button onclick="document.getElementById('gh-pat-modal').style.display='none'"
          style="padding:6px 16px;border-radius:4px;border:1px solid #45475a;background:transparent;color:#cdd6f4;cursor:pointer;">Cancel</button>
        <span id="gh-pat-status" style="font-size:12px;"></span>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 3: Add openPATSettings and _onValidateClick to GitHubSync**

  Inside the GitHubSync IIFE (before the `return` statement), add:
  ```javascript
  function openPATSettings() {
    const modal = document.getElementById('gh-pat-modal');
    document.getElementById('gh-pat-input').value = getPAT();
    document.getElementById('gh-pat-status').textContent = isPATConfigured() ? '✓ Configured' : '';
    modal.style.display = 'flex';
  }

  async function _onValidateClick() {
    const pat = document.getElementById('gh-pat-input').value.trim();
    const status = document.getElementById('gh-pat-status');
    const btn = document.getElementById('gh-pat-validate-btn');
    if (!pat) { status.textContent = '⚠ Enter a PAT first'; return; }
    btn.disabled = true;
    status.textContent = 'Checking…';
    const ok = await validatePAT(pat);
    if (ok) {
      setPAT(pat);
      status.textContent = '✅ Connected — saved';
      setTimeout(() => { document.getElementById('gh-pat-modal').style.display = 'none'; }, 1000);
    } else {
      status.textContent = '❌ Invalid PAT or no repo access';
    }
    btn.disabled = false;
  }
  ```

  Add `openPATSettings, _onValidateClick` to the return object:
  ```javascript
  return {
    isPATConfigured, getPAT, setPAT, validatePAT,
    openPATSettings, _onValidateClick,
    _putText, _putBinary, _listFolder, BASE_URL,
    get lastMapName() { return _lastMapName; },
    set lastMapName(v) { _lastMapName = v; localStorage.setItem('ghLastMapName', v); },
  };
  ```

- [ ] **Step 4: Test in browser**

  Open editor. Click "⚙ GitHub". Modal opens. Enter a bad token → "❌ Invalid PAT". Enter a valid PAT → "✅ Connected — saved". Modal closes. Click "⚙ GitHub" again → input is pre-filled with saved PAT.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(github-sync): PAT settings UI (replaces Sign in to Google button)"
```

---

## Task 3: JSON Publish Functions

Add publish functions to GitHubSync and update the five `onclick` handlers on the Publish dropdown buttons to call `GitHubSync.*` instead of `DriveSync.*`. DriveSync functions remain in place.

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `GitHubSync._putText()`, data sources: `HexDB.getData()`, `BldDB.getJson()`, `UpgDB.getJson()`, `CommonDB.export()`, `LocalizationKeys.getExportData()`
- Produces: `GitHubSync.publishDb()`, `GitHubSync.publishHexDbOnly()`, `GitHubSync.publishBuildingsDb()`, `GitHubSync.publishUpgradeDb()`, `GitHubSync.publishCommonDb()`, `GitHubSync.publishLoc()`, `GitHubSync.togglePublishDropdown()`

- [ ] **Step 1: Add publish functions to GitHubSync IIFE**

  Add inside the IIFE (before the `return`):
  ```javascript
  function _closeDropdown() {
    document.getElementById('pub-drop-wrap')?.classList.remove('open');
  }

  function togglePublishDropdown(e) {
    e.stopPropagation();
    document.getElementById('pub-drop-wrap').classList.toggle('open');
  }

  async function _withPublishBtn(label, fn) {
    if (!isPATConfigured()) {
      UI.toast('⚠ Configure GitHub PAT first (⚙ GitHub button)');
      return;
    }
    _closeDropdown();
    const btn = document.getElementById('btn-publish-all');
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch(e) {
      UI.progressDone('❌ Failed');
      UI.toast(`❌ ${label} failed: ${e.message}`);
      console.error(`[GitHubSync] ${label}:`, e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function publishHexDbOnly() {
    await _withPublishBtn('Publish HexDB', async () => {
      UI.progress(20, 'Uploading hex_database.json…');
      const json = JSON.stringify(HexDB.getData(), null, 2);
      await _putText('hex_database.json', json, 'publish: hex_database.json');
      UI.progressDone('✅ HexDB published');
      UI.toast('✅ hex_database.json → gh-pages');
    });
  }

  async function publishDb() {
    // In the GitHub flow sprites are pushed individually at upload time.
    // publishDb = publishHexDbOnly (no separate sprite batch upload needed).
    await publishHexDbOnly();
  }

  async function publishBuildingsDb() {
    await _withPublishBtn('Publish Buildings DB', async () => {
      UI.progress(30, 'Uploading building_database.json…');
      await _putText('building_database.json', BldDB.getJson(), 'publish: building_database.json');
      UI.progressDone('✅ Buildings DB published');
      UI.toast('✅ building_database.json → gh-pages');
    });
  }

  async function publishUpgradeDb() {
    await _withPublishBtn('Publish Upgrade DB', async () => {
      UI.progress(30, 'Uploading upgrade_database.json…');
      await _putText('upgrade_database.json', UpgDB.getJson(), 'publish: upgrade_database.json');
      UI.progressDone('✅ Upgrade DB published');
      UI.toast('✅ upgrade_database.json → gh-pages');
    });
  }

  async function publishCommonDb() {
    if (!isPATConfigured()) return;
    try {
      UI.progress(30, 'Uploading common_settings.json…');
      await _putText('common_settings.json', CommonDB.export(), 'publish: common_settings.json');
      UI.progressDone('✅ Common settings published');
      UI.toast('✅ common_settings.json → gh-pages');
    } catch(e) {
      UI.progressDone('❌ Failed');
      console.error('[GitHubSync] publishCommonDb:', e);
    }
  }

  async function publishLoc() {
    if (!isPATConfigured()) { UI.toast('⚠ Configure GitHub PAT first'); return; }
    try {
      UI.progress(20, 'Uploading localization.json…');
      const json = JSON.stringify(LocalizationKeys.getExportData(), null, 2);
      await _putText('localization.json', json, 'publish: localization.json');
      UI.progressDone('✅ localization.json published');
    } catch(e) {
      UI.progressDone('❌ Failed');
      throw e;
    }
  }
  ```

  Add all to the return object.

- [ ] **Step 2: Swap Publish dropdown button onclick handlers**

  Find (around line 1346–1356):
  ```html
  <button onclick="DriveSync.togglePublishDropdown(event)" ...>☁ Publish ▾</button>
  ...
  <button onclick="DriveSync.publishDb()">☁ Publish DB...
  <button onclick="DriveSync.publishHexDbOnly()">☁ Publish HexDB only...
  <button onclick="DriveSync.publishBuildingsDb()">☁ Publish Buildings DB</button>
  <button onclick="DriveSync.publishUpgradeDb()">☁ Publish Upgrade DB</button>
  ```
  Replace each `DriveSync.` with `GitHubSync.` for these five buttons only. Leave `DriveSync.publishMap()` and the other buttons unchanged (handled in later tasks).

- [ ] **Step 3: Swap publishLoc call sites**

  Find all three occurrences of `DriveSync.publishLoc()` (lines ~7242) and replace with `GitHubSync.publishLoc()`.

  Find the auto-publish init block (around line 11125):
  ```javascript
  if (typeof DriveSync !== 'undefined' && DriveSync.isAuthenticated()) {
    DriveSync.publishCommonDb();
  ```
  Replace with:
  ```javascript
  if (GitHubSync.isPATConfigured()) {
    GitHubSync.publishCommonDb();
  ```

- [ ] **Step 4: Test in browser**

  Click "⚙ GitHub", validate PAT. Click "☁ Publish ▾" → "☁ Publish HexDB only". Watch progress bar → "✅ HexDB published". Open `https://fidaykin.github.io/PostApocMapEditor/hex_database.json` (~30 s later) and verify the content is current.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(github-sync): wire JSON publish functions to GitHub API"
```

---

## Task 4: Sprite Functions

Add sprite push and listing to GitHubSync. Update `handleSpriteUpload` and `showSpritePicker`.

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `GitHubSync._putBinary()`, `GitHubSync._listFolder()`, `GitHubSync.isPATConfigured()`
- Produces: `GitHubSync.pushSprite(name, blob, category)`, `GitHubSync.listSpriteFiles(category)`, `GitHubSync.fetchSpriteDataUrl(url)`

- [ ] **Step 1: Add sprite functions to GitHubSync IIFE**

  Add inside the IIFE (before `return`):
  ```javascript
  async function pushSprite(name, blob, category = 'hex') {
    if (!isPATConfigured()) return;
    try {
      const fname = name.endsWith('.png') ? name : `${name}.png`;
      await _putBinary(`sprites/${category}/${fname}`, blob, `sprite: ${fname}`);
    } catch(e) {
      console.warn('[GitHubSync] pushSprite failed:', e.message);
    }
  }

  async function listSpriteFiles(category) {
    try {
      const items = await _listFolder(`sprites/${category}`);
      return items
        .filter(f => f.name.toLowerCase().endsWith('.png'))
        .map(f => ({ name: f.name.replace(/\.png$/i, ''), url: f.download_url }));
    } catch(e) {
      console.warn('[GitHubSync] listSpriteFiles failed:', e.message);
      return [];
    }
  }

  function fetchSpriteDataUrl(url) {
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }));
  }
  ```

  Add `pushSprite, listSpriteFiles, fetchSpriteDataUrl` to the return object.

- [ ] **Step 2: Update handleSpriteUpload**

  Find `handleSpriteUpload` (around line 5650). Find the line:
  ```javascript
  DriveSync.pushSprite(name, optimizedFile, uploadCategory);
  ```
  Replace with:
  ```javascript
  GitHubSync.pushSprite(name, optimizedFile, uploadCategory);
  ```

- [ ] **Step 3: Update showSpritePicker (Drive listing section)**

  In `showSpritePicker` (around line 5563), find:
  ```javascript
  const authed = DriveSync.isAuthenticated();
  ```
  Replace with:
  ```javascript
  const authed = GitHubSync.isPATConfigured();
  ```

  Find the Drive-authenticated block (around line 5595–5612):
  ```javascript
  if (authed) {
    try {
      const driveFiles = await DriveSync.listSpriteFiles(category);
      driveFiles.forEach(({ name, id }) => {
        if (shown.has(name)) return;
        shown.add(name);
        const thumb = _makeThumb(name, `${folder}/${name}.png`, false, null);
        const img   = thumb.querySelector('img');
        DriveSync.fetchSpriteDataUrl(id).then(dataUrl => {
          if (dataUrl) {
            img.src = dataUrl;
            SpriteStore.save(name, dataUrl, category).catch(() => {});
          }
        }).catch(() => {});
        grid.appendChild(thumb);
      });
    } catch(e) { /* Drive unavailable — skip */ }
  } else {
    // Server manifest fallback for unauthenticated users
    try {
      const resp = await fetch(`${folder}/manifest.json`);
      if (resp.ok) {
        const names = await resp.json();
        names.forEach(name => {
          if (shown.has(name)) return;
          shown.add(name);
          grid.appendChild(_makeThumb(name, `${folder}/${name}.png`, false, null));
        });
      }
    } catch(e) { /* manifest unavailable — skip */ }
  }
  ```
  Replace with:
  ```javascript
  if (authed) {
    try {
      const ghFiles = await GitHubSync.listSpriteFiles(category);
      ghFiles.forEach(({ name, url }) => {
        if (shown.has(name)) return;
        shown.add(name);
        const thumb = _makeThumb(name, `${GitHubSync.BASE_URL}/sprites/${category}/${name}.png`, false, null);
        const img   = thumb.querySelector('img');
        GitHubSync.fetchSpriteDataUrl(url).then(dataUrl => {
          if (dataUrl) {
            img.src = dataUrl;
            SpriteStore.save(name, dataUrl, category).catch(() => {});
          }
        }).catch(() => {});
        grid.appendChild(thumb);
      });
    } catch(e) { /* GitHub unavailable — skip */ }
  }
  ```

- [ ] **Step 4: Test in browser**

  Upload a PNG sprite. Check DevTools Network tab — a `PUT api.github.com` request appears. Open sprite picker — the new sprite appears in the grid (from server listing after a brief delay). Verify `https://fidaykin.github.io/PostApocMapEditor/sprites/hex/{name}.png` serves the file.

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(github-sync): sprite push and picker listing via GitHub API"
```

---

## Task 5: Map Publish with Auto map_list.json Update

Add `publishMap()` to GitHubSync. It uploads the map JSON to `maps/` and atomically updates `maps/map_list.json`. Replace the `DriveSync.publishMap()` button handler.

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `GitHubSync._putText()`, `GitHubSync._getFile()`, `IO.getMapJson()`
- Produces: `GitHubSync.publishMap()`

- [ ] **Step 1: Add publishMap to GitHubSync IIFE**

  Add inside the IIFE (before `return`):
  ```javascript
  async function publishMap() {
    if (!isPATConfigured()) { UI.toast('⚠ Configure GitHub PAT first'); return; }
    const mapJson = IO.getMapJson();
    if (!mapJson) { UI.toast('No map to publish'); return; }

    const rawName = prompt('Map filename:', _lastMapName || 'current_map');
    if (rawName === null) return;
    const fname = rawName.trim().replace(/\.json$/i, '') || 'current_map';
    _lastMapName = fname;
    localStorage.setItem('ghLastMapName', _lastMapName);

    const btn = document.getElementById('btn-publish-all');
    if (btn) btn.disabled = true;
    try {
      _closeDropdown();
      UI.progress(20, `Uploading ${fname}.json…`);
      await _putText(`maps/${fname}.json`, mapJson, `publish map: ${fname}`);

      UI.progress(60, 'Updating map_list.json…');
      const existing = await _getFile('maps/map_list.json');
      let list = { maps: [] };
      if (existing) {
        try { list = JSON.parse(existing.content); } catch(e) { list = { maps: [] }; }
      }
      const entry = {
        name: fname,
        fileName: `${fname}.json`,
        size: String(new TextEncoder().encode(mapJson).length),
        uploadedTime: new Date().toISOString().substring(0, 10),
      };
      const idx = list.maps.findIndex(m => m.fileName === entry.fileName);
      if (idx >= 0) list.maps[idx] = entry; else list.maps.push(entry);

      await _putText('maps/map_list.json', JSON.stringify(list, null, 2) + '\n', 'publish: map_list.json');
      UI.progressDone(`✅ Map "${fname}" published`);
      UI.toast(`✅ maps/${fname}.json → gh-pages`);
    } catch(e) {
      UI.progressDone('❌ Failed');
      UI.toast('❌ Publish Map failed: ' + e.message);
      console.error('[GitHubSync] publishMap:', e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  ```

  Add `publishMap` to the return object.

- [ ] **Step 2: Swap publishMap button handler**

  Find (around line 1353):
  ```html
  <button onclick="DriveSync.publishMap()">☁ Publish Map</button>
  ```
  Replace with:
  ```html
  <button onclick="GitHubSync.publishMap()">☁ Publish Map</button>
  ```

  Find the maps-popover publish button (around line 4034):
  ```javascript
  document.getElementById('drive-maps-publish-btn').onclick = () => { _closeMapsPopover(); publishMap(); };
  ```
  Replace with:
  ```javascript
  document.getElementById('drive-maps-publish-btn').onclick = () => { _closeMapsPopover(); GitHubSync.publishMap(); };
  ```

- [ ] **Step 3: Test in browser**

  Edit the hex grid. Click "☁ Publish Map". Enter a map name. Progress bar runs. After ~30 s, verify `https://fidaykin.github.io/PostApocMapEditor/maps/{name}.json` is accessible and `https://fidaykin.github.io/PostApocMapEditor/maps/map_list.json` lists it.

- [ ] **Step 4: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(github-sync): publishMap with auto map_list.json update"
```

---

## Task 6: Load from Server

Add server-read functions to GitHubSync. Replace DriveSync calls in load-from-drive flows.

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `GitHubSync.BASE_URL`
- Produces: `GitHubSync.loadHexDbIntoEditor()`, `GitHubSync.loadLocFromServer()`

- [ ] **Step 1: Add load functions to GitHubSync IIFE**

  Add inside the IIFE (before `return`):
  ```javascript
  async function loadHexDbIntoEditor() {
    const res = await fetch(`${BASE_URL}/hex_database.json?_=${Date.now()}`);
    if (!res.ok) throw new Error(`hex_database.json not found (${res.status})`);
    const data = await res.json();
    HexDB.loadData(data);
    UI.toast('✅ Hex DB loaded from server');
  }

  async function loadLocFromServer() {
    const res = await fetch(`${BASE_URL}/localization.json?_=${Date.now()}`);
    if (!res.ok) throw new Error(`localization.json not found (${res.status})`);
    return await res.json();
  }
  ```

  Add both to the return object.

- [ ] **Step 2: Replace loadHexDbIntoEditor button**

  Find (around line 1323):
  ```html
  <button onclick="DriveSync.loadHexDbIntoEditor()">☁ Load Hex DB from Drive</button>
  ```
  Replace with:
  ```html
  <button onclick="GitHubSync.loadHexDbIntoEditor()">⬇ Load Hex DB from server</button>
  ```

- [ ] **Step 3: Replace loadLocFromDrive call sites**

  Find all three occurrences of `DriveSync.loadLocFromDrive()` (grep for it). Replace each with `GitHubSync.loadLocFromServer()`.

- [ ] **Step 4: Test in browser**

  Click "⬇ Load Hex DB from server". Toast shows "✅ Hex DB loaded from server" and tiles populate. In the localization editor, loading/saving localization data works against the server copy (no Drive prompt).

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(github-sync): load hex DB and localization from server"
```

---

## Task 7: UI Cleanup + migrateToBuilding Fix

Remove Drive-only UI buttons and fix `migrateToBuilding` to push to GitHub instead of Drive.

**Files:**
- Modify: `MapEditorPro.html`

**Interfaces:**
- Consumes: `GitHubSync.pushSprite()`, `SpriteStore.load(name, category)`

- [ ] **Step 1: Remove Drive-only toolbar buttons**

  Find and remove these two buttons (around line 1355–1359):
  ```html
  <button onclick="DriveSync.setupSpriteFolders()" ...>📁 Setup sprite folders</button>
  <button onclick="DriveSync.migrateSpritesToSubfolders()" ...>🗂 Migrate sprites to subfolders</button>
  ...
  <button class="publish-btn" id="btn-drive-maps" onclick="DriveSync.openMapsPopover()" ...>☁ Maps ▾</button>
  ```
  Delete all three elements (including their wrapper elements if any).

- [ ] **Step 2: Update the Publish dropdown button label**

  Find (around line 1346):
  ```html
  <button class="publish-btn" id="btn-publish-all" onclick="GitHubSync.togglePublishDropdown(event)" title="Publish to Google Drive">☁ Publish ▾</button>
  ```
  Change `title` from `"Publish to Google Drive"` to `"Publish to GitHub Pages"`.

- [ ] **Step 3: Fix migrateToBuilding to use GitHubSync**

  Find `migrateToBuilding` (grep for it). Find this block inside it (around line 8696–8705):
  ```javascript
  if (newBld.spriteName && DriveSync.isAuthenticated()) {
    DriveSync.copySpriteToBuildings(newBld.spriteName)
      .catch(e => console.warn('[migrate] copySpriteToBuildings failed:', e.message));
  }
  localStorage.setItem('migration_dirty', '1');
  ```
  Replace with:
  ```javascript
  if (newBld.spriteName && GitHubSync.isPATConfigured()) {
    SpriteStore.load(newBld.spriteName, 'hex').then(async dataUrl => {
      if (!dataUrl) return;
      const res  = await fetch(dataUrl);
      const blob = await res.blob();
      GitHubSync.pushSprite(newBld.spriteName, blob, 'buildings')
        .catch(e => console.warn('[migrate] pushSprite buildings failed:', e.message));
    }).catch(() => {});
  }
  ```
  (The `localStorage.setItem('migration_dirty', '1')` line is deleted — no Drive sync to block.)

- [ ] **Step 4: Remove Auto-sync init code**

  Find (around line 11070–11071):
  ```javascript
  if (_autoSyncChk) _autoSyncChk.checked = DriveSync.getAutoSync();
  if (DriveSync.getAutoSync()) DriveSync.syncFromDrive();
  ```
  Delete both lines. (`_autoSyncChk` references a now-removed checkbox — confirm it's no longer referenced elsewhere after deletion.)

- [ ] **Step 5: Test in browser**

  Open editor — no "Sign in to Google", no "☁ Sync", no "☁ Maps ▾", no "📁 Setup sprite folders" buttons. Toolbar shows "⚙ GitHub" and "☁ Publish ▾" only. Perform a building migration — verify no `migration_dirty` key appears in localStorage and the sprite is pushed to `sprites/buildings/` on gh-pages.

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat(github-sync): remove Drive-only UI, fix migrateToBuilding for GitHub"
```

---

## Task 8: Delete DriveSync IIFE + Cleanup Files

Remove the entire `DriveSync` IIFE, the Google OAuth script tag, all remaining `DriveSync.*` references, the migration dirty flag, `sync_data.sh`, and simplify `deploy.sh`.

**Files:**
- Modify: `MapEditorPro.html`
- Modify: `deploy.sh`
- Delete: `sync_data.sh`

**Interfaces:**
- Consumes: nothing new — this is pure deletion

- [ ] **Step 1: Remove Google OAuth script tag**

  Find (around line 1269):
  ```html
  <script src="https://accounts.google.com/gsi/client" async onload="DriveSync.init()"></script>
  ```
  Delete this entire line.

- [ ] **Step 2: Delete DriveSync IIFE**

  Find `const DriveSync = (() => {` and its closing `})();` — this is a large block (~950 lines). Delete the entire IIFE. Do not delete any code outside the IIFE.

- [ ] **Step 3: Search for and remove remaining DriveSync references**

  Run in the repo root:
  ```bash
  grep -n "DriveSync\." MapEditorPro.html
  ```
  For each remaining occurrence, either delete the line (if it's a standalone call that's now dead) or replace with the GitHubSync equivalent if missed in earlier tasks. Expected remaining occurrences after tasks 1–7:
  - `DriveSync.loadStoredSpriteUrls()` (around line 11016) — delete this line
  - `DriveSync.setDbSource('local')` (around line 8559) — delete this line
  - Any `DriveSync.isAuthenticated()` guards not yet replaced — replace with `GitHubSync.isPATConfigured()`

  After cleanup, the grep should return zero results.

- [ ] **Step 4: Remove migration dirty flag code**

  Search for `migration_dirty` in `MapEditorPro.html`:
  ```bash
  grep -n "migration_dirty\|getMigrationDirty\|clearMigrationDirty\|MIGRATION_DIRTY" MapEditorPro.html
  ```
  Delete every line that appears (these are now dead code — the flag was only read by `syncFromDrive` which is gone). Expected: a few isolated lines in `migrateToBuilding` and possibly a leftover constant declaration.

- [ ] **Step 5: Verify zero Drive references**

  ```bash
  grep -in "drive\|googleapis\|gsi/client\|accounts\.google" MapEditorPro.html | grep -v "//\|<!--"
  ```
  Expected: zero results. If any appear, remove them.

- [ ] **Step 6: Simplify deploy.sh**

  Read `deploy.sh`. Remove the `compress_sprites.sh` call and the lines that stage sprites and maps (sprites/maps are now committed directly by the editor via GitHub API, not via deploy.sh):
  ```bash
  # REMOVE these lines:
  bash compress_sprites.sh
  git add MapEditorPro.html sprites/
  git add building_database.json upgrade_database.json 2>/dev/null || true

  # KEEP (and update git add to only stage the editor file):
  git add MapEditorPro.html
  ```
  The final `deploy.sh` merge+stamp+commit block should only `git add MapEditorPro.html` before the commit.

- [ ] **Step 7: Delete sync_data.sh**

  ```bash
  git rm sync_data.sh
  ```

- [ ] **Step 8: Smoke test in browser**

  Open `MapEditorPro.html`. Open DevTools console — no errors about `DriveSync`, no 401/403 to googleapis. All Publish buttons work. Sprite upload works. Map publish works. No localStorage key `migration_dirty` is ever set.

- [ ] **Step 9: Commit**

```bash
git add MapEditorPro.html deploy.sh
git rm sync_data.sh
git commit -m "feat(github-sync): remove DriveSync IIFE and all Drive dependencies"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ GitHubSync core (PAT, GET, PUT, LIST) — Task 1
- ✅ PAT settings UI — Task 2
- ✅ publishHexDbOnly, publishDb, publishBuildingsDb, publishUpgradeDb, publishCommonDb, publishLoc — Task 3
- ✅ pushSprite, listSpriteFiles, fetchSpriteDataUrl, sprite picker — Task 4
- ✅ publishMap + auto map_list.json — Task 5
- ✅ loadHexDbIntoEditor, loadLocFromServer — Task 6
- ✅ Drive-only UI removed, migrateToBuilding fixed — Task 7
- ✅ DriveSync deleted, sync_data.sh deleted, deploy.sh simplified — Task 8
- ✅ Zero Drive API calls after Task 8
- ✅ YAGNI: no pagination, no retry logic beyond what GitHub API provides, no hash-based skip-if-unchanged (GitHub handles versioning)

**Placeholder scan:** None found.

**Type consistency:**
- `listSpriteFiles(category)` returns `{name, url}[]` — Task 4 consumers use `.name` and `.url` ✅
- `_putText(path, text, message)` / `_putBinary(path, blob, message)` — consistent across tasks 3–6 ✅
- `_lastMapName` — accessed via getter/setter on the return object ✅
