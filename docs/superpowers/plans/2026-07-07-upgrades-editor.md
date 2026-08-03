# Upgrades Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Upgrades Editor tab in MapEditorPro.html — a full CRUD editor for upgrade_database.json, following the "All Editors (WEB)" spec (pages 79–84).

**Architecture:** Single IIFE module `UpgDB` inserted after `SttDB` in MapEditorPro.html (~line 8022). Mirrors the BldDB/SttDB pattern exactly: left panel (search + two filter selects + list with color dots) + right panel (form with Main Block + dynamic Levels Block). No new files — everything stays in the single HTML file.

**Tech Stack:** Vanilla JS, HTML, CSS — no build step, no dependencies. Open `MapEditorPro.html` directly in a browser to test.

## Global Constraints

- Single file: all changes to `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html`
- Follow BldDB/SttDB patterns exactly — same CSS class names (`hexdb-row`, `hexdb-label`, `hexdb-input`, `hexdb-select`, `hexdb-list-row`, `hexdb-section-hdr`, `hexdb-section-body`, `hexdb-empty`, `hexdb-list-footer`), same event-wiring approach
- ID prefix: `upg-` for all HTML element IDs in the Upgrades panel
- localStorage key: `upgdb_autosave` for autosave
- Output filename for Save: `upgrade_database.json`
- Upgrade types: exactly `['Regular', 'Events Temporary', 'Events Permanents']`
- Parameters: exactly `['Online Income', 'Offline Income', 'Storage', 'Daily Rewards', 'Map', 'Tiles', 'Buildings', 'Settlements', 'Action', 'Rules']`
- Price types: exactly `['Resource', 'GEM', 'Combined', 'Conditional']`
- List color dots: `#4caf50` = Regular, `#9c5fd6` = Events Temporary, `#5c9fff` = Events Permanents
- Data root key: `upgrades` (parallel to BldDB's `buildings`)
- `upgradeLevels` min=1, max=999, integer only
- No copy/paste in MVP (keep return object minimal)
- Branch: `feature/text-keys-localization` (current working branch)

---

### Task 1: UpgDB Module Scaffold + HTML Panel + CSS + Toolbar

Replace the `#upgrades-main` stub with a live two-panel layout and plant the `UpgDB` module with its data schema, filter/list logic, and stub render.

**Files:**
- Modify: `MapEditorPro.html` — many sections, described precisely below

**Interfaces:**
- Produces: `UpgDB` global with `{ init, add, deleteSelected, load, save, triggerLoad, getJson }`
- Produces: `#upgrades-main` two-panel DOM (upg-left + upg-right)
- Produces: `#upg-tools` toolbar div, data-menu entries, publish button

---

#### Step 1a: CSS — mode-upgrades display change

- [ ] Find line ~557:
  ```
  body.mode-upgrades    #main { display: none; } body.mode-upgrades    #upgrades-main { display: flex; }
  ```
  Change `display: flex` → `display: grid`:
  ```css
  body.mode-upgrades    #main { display: none; } body.mode-upgrades    #upgrades-main { display: grid; }
  ```

#### Step 1b: CSS — add upgrades-main to the grid block

- [ ] Find the block starting at ~line 844:
  ```css
  #buildings-main,
  #settlements-main {
  ```
  Change it to include `#upgrades-main`:
  ```css
  #buildings-main,
  #settlements-main,
  #upgrades-main {
  ```

#### Step 1c: CSS — add upg-* selectors (after the bld-left / bld-filters block, ~line 875)

- [ ] After line `#bld-right, #stt-right {` block closing `}` (~line 874), add:
  ```css
  #upg-left {
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--panel);
    min-height: 0;
  }
  #upg-filters {
    padding: 8px; border-bottom: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;
  }
  #upg-search {
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text); padding: 5px 8px; border-radius: 4px;
    font-size: 13px; width: 100%; box-sizing: border-box;
  }
  #upg-search:focus { outline: none; border-color: var(--accent); }
  #upg-list { flex: 1; overflow-y: auto; }
  #upg-right {
    overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 0;
    min-height: 0;
  }
  #upgrades-main { display: none; }
  #upgrades-main.dragover { outline: 2px dashed var(--accent); outline-offset: -4px; }
  ```

#### Step 1d: CSS — #upg-tools toolbar entry (after the bld-tools line ~601)

- [ ] Find:
  ```css
  #bld-tools   { display: none; align-items: center; gap: 6px; }
  ```
  After it add:
  ```css
  #upg-tools   { display: none; align-items: center; gap: 6px; }
  ```

- [ ] Find:
  ```css
  body.mode-buildings   #bld-tools   { display: flex; }
  ```
  After it add:
  ```css
  body.mode-upgrades    #upg-tools   { display: flex; }
  ```

#### Step 1e: HTML — Replace the stub div for upgrades-main (~line 1449)

- [ ] Find:
  ```html
  <div id="upgrades-main" class="stub-editor"><div class="stub-msg">UPGRADES Editor — coming soon</div></div>
  ```
  Replace with:
  ```html
  <div id="upgrades-main">

    <!-- Left panel: list + filters -->
    <div id="upg-left">
      <div id="upg-filters">
        <input id="upg-search" type="text" placeholder="🔍 Search by id…" autocomplete="off">
        <div class="hexdb-filter-row">
          <span style="width:38px;flex-shrink:0">Type</span>
          <select id="upg-filter-type">
            <option value="">All</option>
            <option>Regular</option>
            <option>Events Temporary</option>
            <option>Events Permanents</option>
          </select>
        </div>
        <div class="hexdb-filter-row">
          <span style="width:38px;flex-shrink:0">Param</span>
          <select id="upg-filter-params">
            <option value="">All</option>
            <option>Online Income</option>
            <option>Offline Income</option>
            <option>Storage</option>
            <option>Daily Rewards</option>
            <option>Map</option>
            <option>Tiles</option>
            <option>Buildings</option>
            <option>Settlements</option>
            <option>Action</option>
            <option>Rules</option>
          </select>
        </div>
      </div>
      <div id="upg-list"></div>
      <div class="hexdb-list-footer">
        <span id="upg-count">0 shown / 0</span>
        <button onclick="UpgDB.deleteSelected()">🗑 Delete</button>
      </div>
    </div>

    <!-- Right panel: record editor -->
    <div id="upg-right">
      <div class="hexdb-empty">
        <div>Drop upgrade_database.json here</div>
        <div>or use <button class="hexdb-empty-btn" onclick="UpgDB.triggerLoad()">📂 Load DB</button></div>
      </div>
    </div>

    <input id="upg-file-input" type="file" accept=".json" style="display:none">
  </div>
  ```

#### Step 1f: HTML — Add #upg-tools in toolbar (after #stt-tools div ~line 1238)

- [ ] Find:
  ```html
    <div id="keys-tools">
  ```
  Before it insert:
  ```html
    <div id="upg-tools">
      <button class="hexdb-tool-btn" onclick="UpgDB.add()">+ Add Upgrade</button>
      <button class="hexdb-tool-btn" onclick="UpgDB.triggerLoad()">📂 Load DB</button>
      <button class="hexdb-tool-btn" onclick="UpgDB.save()">💾 Save DB</button>
    </div>
  ```

#### Step 1g: HTML — Add Load/Save Upgrade DB to data menu (~line 1148)

- [ ] Find:
  ```html
        <button onclick="SttDB.triggerLoad()">Load Settlement DB…</button>
        <button onclick="SttDB.save()">Save Settlement DB</button>
      </div>
  ```
  After the SttDB save button (before `</div>`), add:
  ```html
        <div class="separator"></div>
        <button onclick="UpgDB.triggerLoad()">Load Upgrade DB…</button>
        <button onclick="UpgDB.save()">Save Upgrade DB</button>
  ```

#### Step 1h: HTML — Add Publish Upgrade DB button (~line 1158)

- [ ] Find:
  ```html
    <button class="publish-btn" id="btn-publish-bld" onclick="DriveSync.publishBuildingsDb()" title="Upload building_database.json to Google Drive">☁ Publish Buildings DB</button>
  ```
  After it add:
  ```html
    <button class="publish-btn" id="btn-publish-upg" onclick="DriveSync.publishUpgradeDb()" title="Upload upgrade_database.json to Google Drive">☁ Publish Upgrade DB</button>
  ```

#### Step 1i: JS — Insert UpgDB module after SttDB (~line 8357)

- [ ] Find:
  ```js
  // ── Dev / QA utilities ─────────────────────────────────────
  ```
  Before it insert the full UpgDB module:

  ```js
  // ── UpgDB Module ───────────────────────────────────────────
  const UpgDB = (() => {
    const UPG_TYPES       = ['Regular', 'Events Temporary', 'Events Permanents'];
    const UPG_PARAMS      = ['Online Income', 'Offline Income', 'Storage',
                             'Daily Rewards', 'Map', 'Tiles', 'Buildings',
                             'Settlements', 'Action', 'Rules'];
    const UPG_PRICE_TYPES = ['Resource', 'GEM', 'Combined', 'Conditional'];
    const UPG_RES_TYPES   = ['Gold','Gems','Food','Lumber','Stone','Steel',
                             'Oil','Chips','Clay','Ore','Pollution','Energy'];
    const UPG_RES_ICONS   = {
      Gold:'🪙', Gems:'💎', Food:'🌾', Lumber:'🪵', Stone:'🪨',
      Steel:'⚙️', Oil:'🛢️', Chips:'💻', Clay:'🏺', Ore:'⛏️',
      Pollution:'☣️', Energy:'⚡'
    };

    let _data     = { version: 1, upgrades: [] };
    let _selFilt  = -1;
    let _filter   = { search: '', type: '', params: '' };
    let _filtered = [];

    function _blank() {
      const n = _data.upgrades.length + 1;
      return {
        id: `NewUpgrade_${n}`,
        upgradeType: 'Regular',
        eventId: '',
        isRepeatable: false,
        descriptionId: '',
        parameters: 'Online Income',
        isGroup: false,
        trigger: '',
        typeIco: '',
        upgradeIco: '',
        upgradeLevels: 1,
        priceType: 'Resource',
        levels: [{ target: '', price: [{ type: 'Gold', amount: 100 }] }],
      };
    }

    function _migrate(u) {
      if (!u.upgradeType)                u.upgradeType    = 'Regular';
      if (u.eventId === undefined)       u.eventId        = '';
      if (u.isRepeatable === undefined)  u.isRepeatable   = false;
      if (!u.descriptionId)              u.descriptionId  = '';
      if (!u.parameters)                 u.parameters     = 'Online Income';
      if (u.isGroup === undefined)       u.isGroup        = false;
      if (u.trigger === undefined)       u.trigger        = '';
      if (u.typeIco === undefined)       u.typeIco        = '';
      if (u.upgradeIco === undefined)    u.upgradeIco     = '';
      if (!u.upgradeLevels || u.upgradeLevels < 1) u.upgradeLevels = 1;
      if (!u.priceType)                  u.priceType      = 'Resource';
      if (!Array.isArray(u.levels) || !u.levels.length)
        u.levels = [{ target: '', price: [{ type: 'Gold', amount: 100 }] }];
      while (u.levels.length < u.upgradeLevels)
        u.levels.push({ target: '', price: [{ type: 'Gold', amount: 100 }] });
      u.levels.length = u.upgradeLevels;
      u.levels.forEach(lv => {
        if (lv.target === undefined) lv.target = '';
        if (!Array.isArray(lv.price)) lv.price = [{ type: 'Gold', amount: 100 }];
      });
      return u;
    }

    function _esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
                            .replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function _resIcon(type) { return UPG_RES_ICONS[type] || '◆'; }

    function _typeColor(type) {
      if (type === 'Events Permanents') return '#5c9fff';
      if (type === 'Events Temporary')  return '#9c5fd6';
      return '#4caf50';
    }

    function _autoSave() {
      try { localStorage.setItem('upgdb_autosave', JSON.stringify(_data)); } catch(e) {}
    }

    function _applyFilter() {
      const s = _filter.search.toLowerCase();
      const t = _filter.type;
      const p = _filter.params;
      _filtered = _data.upgrades.map((_, i) => i).filter(i => {
        const u = _data.upgrades[i];
        return (!s || u.id.toLowerCase().includes(s)) &&
               (!t || u.upgradeType === t) &&
               (!p || u.parameters === p);
      });
      _filtered.sort((a, b) =>
        (_data.upgrades[a].id || '').localeCompare(_data.upgrades[b].id || ''));
    }

    function _buildList() {
      const list  = document.getElementById('upg-list');
      const count = document.getElementById('upg-count');
      if (!list) return;
      list.innerHTML = '';
      _filtered.forEach((dataIdx, filtIdx) => {
        const u     = _data.upgrades[dataIdx];
        const color = _typeColor(u.upgradeType);
        const row   = document.createElement('div');
        row.className = 'hexdb-list-row' + (_selFilt === filtIdx ? ' selected' : '');
        row.dataset.filtIdx = filtIdx;
        row.innerHTML =
          `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
          `background:${color};flex-shrink:0;margin-right:5px;vertical-align:middle"></span>` +
          `<span class="hexdb-list-id">${_esc(u.id) || '(no id)'}</span>`;
        row.addEventListener('click', () => _selectIdx(filtIdx));
        list.appendChild(row);
      });
      if (count) count.textContent =
        `${_filtered.length} shown / ${_data.upgrades.length}`;
    }

    function _selectIdx(filtIdx) {
      _selFilt = filtIdx;
      document.querySelectorAll('#upg-list .hexdb-list-row').forEach(r => {
        r.classList.toggle('selected', +r.dataset.filtIdx === filtIdx);
      });
      if (filtIdx >= 0 && filtIdx < _filtered.length)
        _renderRecord(_data.upgrades[_filtered[filtIdx]]);
    }

    function _resBlockHTML(fieldKey, rows) {
      const rowsHTML = (rows || []).map((r, i) => {
        const opts = UPG_RES_TYPES.map(t =>
          `<option${t === r.type ? ' selected' : ''}>${t}</option>`).join('');
        return `<div class="hexdb-res-row">
          <span class="res-icon" style="font-size:16px;width:20px;text-align:center;flex-shrink:0">${_resIcon(r.type)}</span>
          <select class="hexdb-select" style="width:110px"
            data-upg-res="${fieldKey}" data-upg-res-idx="${i}">${opts}</select>
          <input class="hexdb-input" type="number" step="1" min="0" style="width:90px"
            data-upg-res="${fieldKey}" data-upg-res-idx="${i}" data-upg-res-amt
            value="${r.amount ?? 0}">
          <button class="hexdb-res-remove"
            data-upg-res="${fieldKey}" data-upg-res-idx="${i}">✕</button>
        </div>`;
      }).join('');
      return `<div>${rowsHTML}
        <button class="hexdb-res-add" data-upg-res="${fieldKey}">+ Add Resource</button></div>`;
    }

    function _renderRecord(upg) {
      const right = document.getElementById('upg-right');
      if (!right) return;

      const isEvents  = upg.upgradeType !== 'Regular';
      const isPerm    = upg.upgradeType === 'Events Permanents';
      const isDupe    = id => _data.upgrades.some(
        (u, i) => u.id === id && i !== _filtered[_selFilt]);

      const idOpts = _data.upgrades.map(u => `<option value="${_esc(u.id)}">`).join('');

      const levelsHTML = Array.from({ length: upg.upgradeLevels }, (_, i) => {
        const lv = upg.levels[i] || { target: '', price: [{ type: 'Gold', amount: 100 }] };
        return `<div class="level-card">
          <div class="level-hdr">Level ${i + 1}</div>
          <div class="level-body">
            <div class="level-row">
              <label>Target</label>
              <input type="text" data-upg-lv="${i}" data-upg-lv-field="target"
                value="${_esc(lv.target)}" placeholder="e.g. GoldIncome, OfflineTimeLimit" style="flex:1">
            </div>
            <div class="level-row" style="align-items:flex-start">
              <label style="padding-top:4px">Price</label>
              <div style="flex:1">${_resBlockHTML('lv_' + i, lv.price)}</div>
            </div>
          </div>
        </div>`;
      }).join('');

      right.innerHTML = `
        <div style="padding:8px 10px;border-bottom:1px solid var(--border);background:var(--panel);
          flex-shrink:0;margin:-12px -12px 0;display:flex;align-items:center;gap:10px">
          <div style="font-size:13px;font-weight:bold;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            >${_esc(upg.id) || '(unnamed)'}</div>
          <div style="font-size:11px;color:${_typeColor(upg.upgradeType)};white-space:nowrap"
            >${_esc(upg.upgradeType)}</div>
        </div>
        <div class="hexdb-form">
          <div class="hexdb-section">
            <div class="hexdb-section-hdr" data-sec="main">▼ MAIN</div>
            <div class="hexdb-section-body" data-sec="main">
              <div class="hexdb-row"><span class="hexdb-label">ID *</span>
                <input class="hexdb-input" id="upg-f-id" value="${_esc(upg.id)}"
                  style="border-color:${!upg.id || isDupe(upg.id) ? '#e57373' : ''}">
              </div>
              <div class="hexdb-row"><span class="hexdb-label">Description ID</span>
                <input class="hexdb-input" id="upg-f-descriptionId"
                  value="${_esc(upg.descriptionId)}" list="loc-keys-datalist"
                  placeholder="localization key">
              </div>
              <div class="hexdb-row"><span class="hexdb-label">Upgrade Type</span>
                <select class="hexdb-select" id="upg-f-upgradeType">
                  ${UPG_TYPES.map(t =>
                    `<option${upg.upgradeType === t ? ' selected' : ''}>${t}</option>`).join('')}
                </select>
              </div>
              <div class="hexdb-row" id="upg-row-eventId"${isEvents ? '' : ' style="display:none"'}>
                <span class="hexdb-label">ID Event</span>
                <input class="hexdb-input" id="upg-f-eventId"
                  value="${_esc(upg.eventId)}" placeholder="event ID">
              </div>
              <div class="hexdb-row hexdb-checkbox-row" id="upg-row-isRepeatable"${isPerm ? '' : ' style="display:none"'}>
                <span class="hexdb-label"></span>
                <label><input type="checkbox" id="upg-f-isRepeatable"${upg.isRepeatable ? ' checked' : ''}> Is Repeatable</label>
              </div>
              <div class="hexdb-row"><span class="hexdb-label">Parameters</span>
                <select class="hexdb-select" id="upg-f-parameters">
                  ${UPG_PARAMS.map(p =>
                    `<option${upg.parameters === p ? ' selected' : ''}>${p}</option>`).join('')}
                </select>
              </div>
              <div class="hexdb-row hexdb-checkbox-row">
                <span class="hexdb-label"></span>
                <label><input type="checkbox" id="upg-f-isGroup"${upg.isGroup ? ' checked' : ''}> Is Group (unlock chain)</label>
              </div>
              <div class="hexdb-row" id="upg-row-trigger"${upg.isGroup ? '' : ' style="display:none"'}>
                <span class="hexdb-label">Trigger</span>
                <input class="hexdb-input" id="upg-f-trigger"
                  value="${_esc(upg.trigger)}" list="upg-id-list"
                  placeholder="upstream upgrade ID">
              </div>
              <div class="hexdb-row"><span class="hexdb-label">Type Ico</span>
                <input class="hexdb-input" id="upg-f-typeIco"
                  value="${_esc(upg.typeIco)}" placeholder="icon path (auto from type)" style="flex:1">
              </div>
              <div class="hexdb-row"><span class="hexdb-label">Upgrade Ico</span>
                <input class="hexdb-input" id="upg-f-upgradeIco"
                  value="${_esc(upg.upgradeIco)}" placeholder="icon path" style="flex:1">
              </div>
              <div class="hexdb-row"><span class="hexdb-label">Levels</span>
                <input class="hexdb-input" id="upg-f-upgradeLevels"
                  type="number" min="1" max="999" step="1"
                  value="${upg.upgradeLevels}" style="width:80px">
              </div>
              <div class="hexdb-row"><span class="hexdb-label">Price Type</span>
                <select class="hexdb-select" id="upg-f-priceType">
                  ${UPG_PRICE_TYPES.map(t =>
                    `<option${upg.priceType === t ? ' selected' : ''}>${t}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>
          <div class="hexdb-section">
            <div class="hexdb-section-hdr" data-sec="levels">▼ LEVELS (${upg.upgradeLevels})</div>
            <div class="hexdb-section-body" data-sec="levels">
              <div class="level-cards">${levelsHTML}</div>
            </div>
          </div>
          <div class="hexdb-actions">
            <button onclick="UpgDB.deleteSelected()">🗑 Delete</button>
          </div>
        </div>
        <datalist id="upg-id-list">${idOpts}</datalist>
      `;

      _wireRecord(upg);
    }

    function _wireRecord(upg) {
      const right = document.getElementById('upg-right');
      if (!right) return;

      // Section collapse
      right.querySelectorAll('.hexdb-section-hdr').forEach(hdr => {
        hdr.addEventListener('click', () => {
          const body = right.querySelector(`.hexdb-section-body[data-sec="${hdr.dataset.sec}"]`);
          const collapsed = body.style.display === 'none';
          body.style.display = collapsed ? '' : 'none';
          hdr.textContent = (collapsed ? '▼ ' : '▶ ') + hdr.textContent.slice(2);
        });
      });

      // Simple inputs → readRecord (re-renders on structural changes)
      right.querySelectorAll('input:not([data-upg-lv]):not([data-upg-res]),select:not([data-upg-res])').forEach(el => {
        el.addEventListener('input',  _readRecord);
        el.addEventListener('change', _readRecord);
      });

      // Level target inputs
      right.querySelectorAll('[data-upg-lv]').forEach(el => {
        el.addEventListener('input', () => {
          if (_selFilt < 0) return;
          const lvIdx = parseInt(el.dataset.upgLv, 10);
          const u = _data.upgrades[_filtered[_selFilt]];
          if (u && u.levels[lvIdx]) {
            u.levels[lvIdx].target = el.value;
            _autoSave();
          }
        });
      });

      // Resource selects
      right.querySelectorAll('select[data-upg-res]').forEach(el => {
        el.addEventListener('change', () => {
          const { idx, lv } = _resRef(el);
          if (!lv) return;
          lv.price[idx].type = el.value;
          const icon = el.parentElement.querySelector('.res-icon');
          if (icon) icon.textContent = _resIcon(el.value);
          _autoSave();
        });
      });

      // Resource amount inputs
      right.querySelectorAll('input[data-upg-res][data-upg-res-amt]').forEach(el => {
        el.addEventListener('input', () => {
          const { idx, lv } = _resRef(el);
          if (!lv) return;
          lv.price[idx].amount = Math.round(parseFloat(el.value) || 0);
          _autoSave();
        });
      });

      // Resource remove buttons
      right.querySelectorAll('button[data-upg-res].hexdb-res-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const { lvIdx, idx, u } = _resRef(btn, true);
          if (!u) return;
          u.levels[lvIdx].price.splice(idx, 1);
          _autoSave();
          _renderRecord(u);
        });
      });

      // Resource add buttons
      right.querySelectorAll('button[data-upg-res].hexdb-res-add').forEach(btn => {
        btn.addEventListener('click', () => {
          const lvIdx = _lvFromKey(btn.dataset.upgRes);
          if (lvIdx < 0 || _selFilt < 0) return;
          const u = _data.upgrades[_filtered[_selFilt]];
          if (!u || !u.levels[lvIdx]) return;
          u.levels[lvIdx].price.push({ type: 'Gold', amount: 100 });
          _autoSave();
          _renderRecord(u);
        });
      });
    }

    // Parse data-upg-res="lv_N" → level index N
    function _lvFromKey(key) {
      const m = (key || '').match(/^lv_(\d+)$/);
      return m ? parseInt(m[1], 10) : -1;
    }

    // Return { lvIdx, idx, lv, u } for a resource element
    function _resRef(el, wantU) {
      const lvIdx = _lvFromKey(el.dataset.upgRes);
      const idx   = parseInt(el.dataset.upgResIdx, 10);
      if (_selFilt < 0) return {};
      const u  = _data.upgrades[_filtered[_selFilt]];
      const lv = u?.levels[lvIdx];
      return wantU ? { lvIdx, idx, lv, u } : { idx, lv };
    }

    function _readRecord() {
      if (_selFilt < 0) return;
      const upg = _data.upgrades[_filtered[_selFilt]];
      const g   = id => document.getElementById(id);

      const prevType   = upg.upgradeType;
      const prevLevels = upg.upgradeLevels;

      upg.id            = (g('upg-f-id')?.value ?? '').trim();
      upg.descriptionId = g('upg-f-descriptionId')?.value ?? '';
      upg.upgradeType   = g('upg-f-upgradeType')?.value   ?? upg.upgradeType;
      upg.eventId       = g('upg-f-eventId')?.value       ?? '';
      upg.isRepeatable  = g('upg-f-isRepeatable')?.checked ?? false;
      upg.parameters    = g('upg-f-parameters')?.value    ?? upg.parameters;
      upg.isGroup       = g('upg-f-isGroup')?.checked     ?? false;
      upg.trigger       = g('upg-f-trigger')?.value       ?? '';
      upg.typeIco       = g('upg-f-typeIco')?.value       ?? '';
      upg.upgradeIco    = g('upg-f-upgradeIco')?.value    ?? '';
      upg.priceType     = g('upg-f-priceType')?.value     ?? upg.priceType;

      const rawLevels  = parseInt(g('upg-f-upgradeLevels')?.value) || 1;
      upg.upgradeLevels = Math.min(999, Math.max(1, rawLevels));

      // Sync levels array length
      while (upg.levels.length < upg.upgradeLevels)
        upg.levels.push({ target: '', price: [{ type: 'Gold', amount: 100 }] });
      upg.levels.length = upg.upgradeLevels;

      _autoSave();

      // Full re-render if structural change (levels count or type changed)
      if (upg.upgradeLevels !== prevLevels || upg.upgradeType !== prevType) {
        _buildList();
        _renderRecord(upg);
        return;
      }

      // Lightweight update: show/hide conditional rows
      const isEvents = upg.upgradeType !== 'Regular';
      const isPerm   = upg.upgradeType === 'Events Permanents';
      const s = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };
      s('upg-row-eventId',     isEvents);
      s('upg-row-isRepeatable', isPerm);
      s('upg-row-trigger',     upg.isGroup);

      // Update ID uniqueness border
      const idEl = g('upg-f-id');
      if (idEl) {
        const isDupe = _data.upgrades.some((u, i) => u.id === upg.id && i !== _filtered[_selFilt]);
        idEl.style.borderColor = (!upg.id || isDupe) ? '#e57373' : '';
      }

      // Refresh list row label
      const listRow = document.querySelector(`#upg-list .hexdb-list-row[data-filt-idx="${_selFilt}"]`);
      if (listRow) {
        listRow.querySelector('.hexdb-list-id').textContent = upg.id || '(no id)';
      }
    }

    function add() {
      _data.upgrades.push(_blank());
      _autoSave();
      _applyFilter();
      _buildList();
      const newFiltIdx = _filtered.indexOf(_data.upgrades.length - 1);
      _selectIdx(newFiltIdx >= 0 ? newFiltIdx : _filtered.length - 1);
    }

    function deleteSelected() {
      if (_selFilt < 0) return;
      const dataIdx = _filtered[_selFilt];
      UI.showConfirm('Delete Upgrade',
        `Delete "${_data.upgrades[dataIdx].id || '(no id)'}"?`, () => {
          _data.upgrades.splice(dataIdx, 1);
          _autoSave();
          _selFilt = -1;
          _applyFilter();
          _buildList();
          const right = document.getElementById('upg-right');
          if (right) right.innerHTML =
            '<div class="hexdb-empty"><div>Drop upgrade_database.json here</div>' +
            '<div>or use <button class="hexdb-empty-btn" onclick="UpgDB.triggerLoad()">📂 Load DB</button></div></div>';
        });
    }

    function load(json) {
      try {
        const parsed = JSON.parse(json);
        if (!parsed.upgrades || !Array.isArray(parsed.upgrades))
          throw new Error('No "upgrades" array');
        parsed.upgrades.forEach(_migrate);
        _data    = parsed;
        _selFilt = -1;
        _autoSave();
        _applyFilter();
        _buildList();
        const right = document.getElementById('upg-right');
        if (right) right.innerHTML =
          '<div class="hexdb-empty"><div>Drop upgrade_database.json here</div>' +
          '<div>or use <button class="hexdb-empty-btn" onclick="UpgDB.triggerLoad()">📂 Load DB</button></div></div>';
        if (_filtered.length) _selectIdx(0);
        UI.toast(`Loaded ${_data.upgrades.length} upgrades`);
      } catch(e) { UI.toast('Error loading Upgrade DB: ' + e.message); }
    }

    function save() {
      const blob = new Blob([JSON.stringify(_data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'upgrade_database.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      UI.toast('Saved upgrade_database.json');
    }

    function triggerLoad() {
      document.getElementById('upg-file-input').click();
    }

    function getJson() { return JSON.stringify(_data, null, 2); }

    function init() {
      try {
        const saved = localStorage.getItem('upgdb_autosave');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && Array.isArray(parsed.upgrades)) {
            parsed.upgrades.forEach(_migrate);
            _data = parsed;
          }
        }
      } catch(e) {}
      _applyFilter();
      _buildList();

      const fi = document.getElementById('upg-file-input');
      if (fi) fi.addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = ev => load(ev.target.result);
        r.readAsText(f); fi.value = '';
      });

      const search = document.getElementById('upg-search');
      if (search) search.addEventListener('input', e => {
        _filter.search = e.target.value;
        _applyFilter(); _buildList();
        if (_selFilt >= _filtered.length) _selFilt = _filtered.length - 1;
      });

      const filterType = document.getElementById('upg-filter-type');
      if (filterType) filterType.addEventListener('change', e => {
        _filter.type = e.target.value;
        _applyFilter(); _buildList();
        if (_selFilt >= _filtered.length) _selFilt = _filtered.length - 1;
      });

      const filterParams = document.getElementById('upg-filter-params');
      if (filterParams) filterParams.addEventListener('change', e => {
        _filter.params = e.target.value;
        _applyFilter(); _buildList();
        if (_selFilt >= _filtered.length) _selFilt = _filtered.length - 1;
      });

      const main = document.getElementById('upgrades-main');
      if (main) {
        main.addEventListener('dragover', e => { e.preventDefault(); main.classList.add('dragover'); });
        main.addEventListener('dragleave', () => main.classList.remove('dragover'));
        main.addEventListener('drop', e => {
          e.preventDefault(); main.classList.remove('dragover');
          const f = e.dataTransfer.files[0]; if (!f) return;
          const r = new FileReader();
          r.onload = ev => load(ev.target.result);
          r.readAsText(f);
        });
      }

      document.addEventListener('keydown', e => {
        if (e.key === 'Delete' && document.body.classList.contains('mode-upgrades') &&
            !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))
          UpgDB.deleteSelected();
      });
    }

    return { init, add, deleteSelected, load, save, triggerLoad, getJson };
  })();

  ```

#### Step 1j: JS — Add UpgDB.init() call to startup (~line 8514)

- [ ] Find:
  ```js
    BldDB.init();
    SttDB.init();
  ```
  Change to:
  ```js
    BldDB.init();
    SttDB.init();
    UpgDB.init();
  ```

#### Step 1k: JS — Add publishUpgradeDb to DriveSync module (~line 4168)

- [ ] Find:
  ```js
    return { init, authenticate, signIn, isAuthenticated, loadHexDb, loadHexDbIntoEditor,
             pushSprite, publishDb, publishLoc, loadLocFromDrive, publishMap, setDbSource,
             syncCustomSprites, syncFromDrive, openMapsPopover, loadMapFromDrive,
             loadStoredSpriteUrls, publishBuildingsDb };
  ```
  Before the `return` line, insert the new function:
  ```js
    async function publishUpgradeDb() {
      const btn = document.getElementById('btn-publish-upg');
      if (btn) btn.disabled = true;
      try {
        UI.toast('Authenticating…');
        await authenticate();
        UI.progress(30, 'Uploading upgrade_database.json…');
        const rootFiles = await _listFiles(ROOT_FOLDER);
        const byName    = Object.fromEntries(rootFiles.map(f => [f.name, f.id]));
        const content   = UpgDB.getJson();
        await _uploadFile(ROOT_FOLDER, 'upgrade_database.json', content,
          'application/json', byName['upgrade_database.json']);
        UI.progressDone('✅ Upgrade DB published');
        UI.toast('✅ upgrade_database.json published to Drive');
      } catch(e) {
        UI.progressDone('❌ Failed');
        UI.toast('❌ Publish Upgrade DB failed: ' + e.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }
  ```
  Then add `publishUpgradeDb` to the return:
  ```js
    return { init, authenticate, signIn, isAuthenticated, loadHexDb, loadHexDbIntoEditor,
             pushSprite, publishDb, publishLoc, loadLocFromDrive, publishMap, setDbSource,
             syncCustomSprites, syncFromDrive, openMapsPopover, loadMapFromDrive,
             loadStoredSpriteUrls, publishBuildingsDb, publishUpgradeDb };
  ```

#### Step 1l: Verify in browser

- [ ] Open `MapEditorPro.html` in a browser (or refresh)
- [ ] Click MORE ▾ → UPGRADES
- [ ] Verify: two-panel layout appears (not "coming soon")
- [ ] Verify: left panel has Search, Type filter, Param filter, empty list, "0 shown / 0"
- [ ] Verify: right panel shows "Drop upgrade_database.json here" empty state
- [ ] Click "+ Add Upgrade" button in toolbar
- [ ] Verify: one item appears in the list (green dot, "NewUpgrade_1")
- [ ] Click the item → verify the full form appears with all 10 Main Block fields + 1 Level card
- [ ] Edit the ID field → verify the list row label updates
- [ ] Change Upgrade Type to "Events Temporary" → verify "ID Event" row appears
- [ ] Change Upgrade Type to "Events Permanents" → verify "Is Repeatable" row appears
- [ ] Change Levels to 3 → verify 3 level cards appear
- [ ] Click "+ Add Resource" on a level → verify resource row appears

- [ ] Commit:
  ```bash
  git add "MapEditorPro.html"
  git commit -m "feat(upgrades): implement UpgDB editor — left panel, filters, list, form, load/save"
  ```

---

### Task 2: Self-review checklist

After Task 1 is committed, verify these spec requirements are met:

- [ ] Color dots: green=Regular, violet=Events Temporary, blue=Events Permanents
- [ ] Filter by Upgrade Type works (All / Regular / Events Temporary / Events Permanents)
- [ ] Filter by Parameters works (All / each of 10 params)
- [ ] ID field turns red when empty or duplicate
- [ ] "ID Event" row hidden for Regular, visible for Events types
- [ ] "Is Repeatable" row only visible for Events Permanents
- [ ] "Trigger" row hidden unless Is Group is checked
- [ ] Levels count change adds/removes level cards correctly (re-renders)
- [ ] Each level card has Target text input + Price resource block
- [ ] Resource + Add/Remove works per level
- [ ] Drag-drop of upgrade_database.json loads correctly
- [ ] Save produces valid upgrade_database.json with correct structure
- [ ] localStorage autosave persists data across page reload
- [ ] Delete opens confirm modal (reuses existing UI.showConfirm)
- [ ] Publish Upgrade DB button present in top bar

If any item fails, fix inline before marking complete.

- [ ] Commit any fixes:
  ```bash
  git add "MapEditorPro.html"
  git commit -m "fix(upgrades): address self-review findings"
  ```
