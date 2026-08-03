# Buildings Editor Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Buildings Editor stub (old schema, wrong sections) with the full spec from "Buildings Editors (Review)" — 5 compliant sections, correct data model, biome-color list, type filter, and Publish Buildings DB.

**Architecture:** All work is in one file (`MapEditorPro.html`). The BldDB module (lines 7172–7553) is rewritten in-place: new data schema → new helper functions → new `_renderRecord` (5 sections) → new `_readRecord` + event wiring → left-panel upgrades → nav additions. The DriveSync module gets one new `publishBuildingsDb()` method.

**Tech Stack:** Vanilla JS, HTML, CSS — no build step. Open `MapEditorPro.html` directly in Chrome to test.

## Global Constraints

- All changes confined to `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html`
- No external libraries, no build step — single-file pattern must be preserved
- `_esc()` must be called on all string values interpolated into HTML
- Tag inputs use `data-tags-field` attribute; resource rows use `data-res-field` + `data-res-index` — event delegation wires these after each `_renderRecord()` call
- `_autoSave()` called after every data mutation (persists to `localStorage`)
- Buildings Settings Block: implement UI/data storage for all fields; **do not implement game logic validation** — the "Cases" section in the spec is an unfinished draft
- Default values per spec: `canDestroy=true`, `moveToStorageOnDestroy=true`, `needRoad=true`, `canBuild=true`, `baseCostTaps=1` (min 1), `price=[{Gold,1000}]`, `minLevel=1`, `buildingRadius=0`

---

### Task 1: Data Schema — New `_blank()`, `_migrate()`, `SECTION_DEFAULTS`

**Files:**
- Modify: `MapEditorPro.html` — BldDB module, lines 7172–7210

**Interfaces:**
- Produces: `_blank() → BuildingRecord` (new schema used by `add()` and `_migrate()`)
- Produces: `_migrate(bld) → BuildingRecord` (normalises old records on load)
- Produces: `SECTION_DEFAULTS = { main, destroy, build, income, settings }` (collapse state)

- [ ] **Step 1: Replace SECTION_DEFAULTS**

Find in `MapEditorPro.html`:
```js
  const SECTION_DEFAULTS = { main: false, build: true, production: false, levels: false };
```
Replace with:
```js
  const SECTION_DEFAULTS = { main: false, destroy: true, build: true, income: false, settings: true };
```

- [ ] **Step 2: Replace `_blank()` and add `_migrate()`**

Find in `MapEditorPro.html`:
```js
  function _blank() {
    return {
      id: '', textId: '', spriteName: '', buildingType: '',
      biome: 'Summer', filterCategory: 'FilterBuilding',
      startLevel: 1, maxLevel: 1,
      requiredTownLevel: 1, constructionTimeSeconds: 0,
      buildCostGold: 0, buildCostGems: 0, buildCostEvent: 0,
      buildRequiresRoad: false, buildPlacementRule: '',
      buildMaxPerMap: 0,
      productionGold: 0, productionFood: 0, productionLumber: 0, productionStone: 0,
      storageGold: 0, storageFood: 0, storageLumber: 0, storageStone: 0,
      levels: [_blankLevel(1)],
    };
  }

  function _blankLevel(n) {
    return {
      level: n,
      upgradePriceGold: 0, upgradePriceGems: 0,
      upgradeCondition: '', transformTo: '', unlockList: '',
    };
  }
```
Replace with:
```js
  function _blank() {
    const n = _data.buildings.length + 1;
    return {
      id: `NewBuild_${n}`,
      textId: '', descIdleId: '', descBuildId: '',
      type: 'Ground Building',
      biome: 'Summer', filter: 'FilterBuilding', spriteName: '',
      baseCostTaps: 1,
      // Destroy
      canDestroy: true,
      destroyTransformToMode: 'Parents', destroyTransformTo: '',
      destroySources: [],
      moveToStorageOnDestroy: true,
      resourceAwardedOnDestroy: true,
      destroyIncome: [],
      // Build
      canBuild: true, needRoad: true,
      availableTiles: [],
      minLevel: 1,
      price: [{ type: 'Gold', amount: 1000 }],
      premiumPrice: 0,
      additionalBuildCondition: false,
      tilesTypeMode: 'Parents', tilesTypeValue: '',
      radius: 0,
      // Income
      hexEarnsOnTap: false, destroyableByTap: false,
      incomeTransformToMode: 'Parents', incomeTransformTo: '',
      capacity: 0,
      getPerTap: [],
      incomePerTurn: [{ type: 'Gold', amount: 1 }],
      incomeConstant: [],
      spendConstant: [{ type: 'Pollution', amount: 1 }],
      // Settings
      buildingRadius: 0,
      canProduce: [], availableTilesForProduce: [],
      productionFacilities: [],
      stores: [],
    };
  }

  function _migrate(bld) {
    if (bld.type === undefined)                   bld.type = 'Ground Building';
    if (bld.filter === undefined)                 bld.filter = bld.filterCategory ?? 'FilterBuilding';
    if (bld.baseCostTaps === undefined)           bld.baseCostTaps = 1;
    if (bld.descIdleId === undefined)             bld.descIdleId = '';
    if (bld.descBuildId === undefined)            bld.descBuildId = '';
    if (bld.canDestroy === undefined)             bld.canDestroy = true;
    if (bld.destroyTransformToMode === undefined) bld.destroyTransformToMode = 'Parents';
    if (bld.destroyTransformTo === undefined)     bld.destroyTransformTo = '';
    if (!Array.isArray(bld.destroySources))       bld.destroySources = [];
    if (bld.moveToStorageOnDestroy === undefined) bld.moveToStorageOnDestroy = true;
    if (bld.resourceAwardedOnDestroy === undefined) bld.resourceAwardedOnDestroy = true;
    if (!Array.isArray(bld.destroyIncome))        bld.destroyIncome = [];
    if (bld.canBuild === undefined)               bld.canBuild = true;
    if (bld.needRoad === undefined)               bld.needRoad = true;
    if (!Array.isArray(bld.availableTiles))       bld.availableTiles = [];
    if (bld.minLevel === undefined)               bld.minLevel = bld.requiredTownLevel ?? 1;
    if (!Array.isArray(bld.price)) {
      const g = bld.buildCostGold ?? 0;
      bld.price = g > 0 ? [{ type: 'Gold', amount: g }] : [{ type: 'Gold', amount: 1000 }];
    }
    if (bld.premiumPrice === undefined)           bld.premiumPrice = bld.buildCostGems ?? 0;
    if (bld.additionalBuildCondition === undefined) bld.additionalBuildCondition = false;
    if (bld.tilesTypeMode === undefined)          bld.tilesTypeMode = 'Parents';
    if (bld.tilesTypeValue === undefined)         bld.tilesTypeValue = '';
    if (bld.radius === undefined)                 bld.radius = 0;
    if (bld.hexEarnsOnTap === undefined)          bld.hexEarnsOnTap = false;
    if (bld.destroyableByTap === undefined)       bld.destroyableByTap = false;
    if (bld.incomeTransformToMode === undefined)  bld.incomeTransformToMode = 'Parents';
    if (bld.incomeTransformTo === undefined)      bld.incomeTransformTo = '';
    if (bld.capacity === undefined)               bld.capacity = 0;
    if (!Array.isArray(bld.getPerTap))            bld.getPerTap = [];
    if (!Array.isArray(bld.incomePerTurn)) {
      const g = bld.productionGold ?? 0;
      bld.incomePerTurn = g > 0 ? [{ type: 'Gold', amount: g }] : [];
    }
    if (!Array.isArray(bld.incomeConstant))       bld.incomeConstant = [];
    if (!Array.isArray(bld.spendConstant))        bld.spendConstant = [];
    if (bld.buildingRadius === undefined)         bld.buildingRadius = 0;
    if (!Array.isArray(bld.canProduce))           bld.canProduce = [];
    if (!Array.isArray(bld.availableTilesForProduce)) bld.availableTilesForProduce = [];
    if (!Array.isArray(bld.productionFacilities)) bld.productionFacilities = [];
    if (!Array.isArray(bld.stores))               bld.stores = [];
    return bld;
  }
```

- [ ] **Step 3: Call `_migrate` in `load()` and `init()`**

Find in the `load()` function:
```js
      if (!parsed.buildings || !Array.isArray(parsed.buildings)) throw new Error('No "buildings" array');
      _data = parsed;
```
Replace with:
```js
      if (!parsed.buildings || !Array.isArray(parsed.buildings)) throw new Error('No "buildings" array');
      parsed.buildings.forEach(_migrate);
      _data = parsed;
```

Find in the `init()` function:
```js
        if (parsed && Array.isArray(parsed.buildings)) _data = parsed;
```
Replace with:
```js
        if (parsed && Array.isArray(parsed.buildings)) {
          parsed.buildings.forEach(_migrate);
          _data = parsed;
        }
```

- [ ] **Step 4: Add `getJson()` to the return statement**

Find:
```js
  return { init, add, deleteSelected, copy, paste, load, save, triggerLoad };
```
Replace with:
```js
  function getJson() { return JSON.stringify(_data, null, 2); }
  return { init, add, deleteSelected, copy, paste, load, save, triggerLoad, getJson };
```

- [ ] **Step 5: Verify in browser**

Open `MapEditorPro.html` in Chrome. Switch to BUILDINGS mode.
- Click `+ Add Building` twice.
- Open DevTools console: `JSON.parse(localStorage.getItem('blddb_autosave')).buildings`
- Expected: two records with `id: "NewBuild_1"` / `"NewBuild_2"`, and fields `canDestroy`, `destroySources`, `price`, `buildingRadius` etc. present.

- [ ] **Step 6: Commit**

```bash
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" add MapEditorPro.html
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" commit -m "refactor(bld): new Buildings Editor data schema with _migrate()"
```

---

### Task 2: BldDB Helper Functions — Tags and Resource Block Helpers

**Files:**
- Modify: `MapEditorPro.html` — BldDB module, insert before `_renderRecord`

**Interfaces:**
- Produces: `_tagsHTML(fieldName, values, disabled) → string` — renders tag chips + input
- Produces: `_resBlockHTML(fieldName, rows, disabled, resTypes?) → string` — renders resource rows + Add button
- Produces: `_resIcon(type) → string` — emoji icon for a resource type
- Produces: `BLD_DESTROY_RES`, `BLD_SPEND_RES` — resource type lists

- [ ] **Step 1: Insert helpers before `_renderRecord`**

Find in MapEditorPro.html (the line just before `_renderRecord`):
```js
  function _renderRecord(bld) {
```
Replace with:
```js
  // ── Resource / Tags helpers ───────────────────────────────
  const BLD_DESTROY_RES = ['Gold','Gems','Food','Lumber','Stone','Steel','Oil','Chips','Clay','Ore','Pollution'];
  const BLD_SPEND_RES   = ['Pollution','Energy','Gold','Gems','Food','Lumber','Stone','Steel','Oil','Chips','Clay'];
  const BLD_RES_ICONS   = {
    Gold:'🪙', Gems:'💎', Food:'🌾', Lumber:'🪵', Stone:'🪨',
    Steel:'⚙️', Oil:'🛢️', Chips:'💻', Clay:'🏺', Ore:'⛏️',
    Pollution:'☣️', Energy:'⚡'
  };

  function _resIcon(type) { return BLD_RES_ICONS[type] || '◆'; }

  function _tagsHTML(fieldName, values, disabled) {
    const dis = disabled ? ' disabled' : '';
    const tags = (values || []).map(v =>
      `<span class="hexdb-tag">${_esc(v)}<button class="hexdb-tag-remove"
         data-tags-field="${fieldName}" data-value="${_esc(v)}"${dis}>✕</button></span>`
    ).join('');
    return `<div class="hexdb-tags" data-tags-field="${fieldName}">
      ${tags}
      <input class="hexdb-tag-input" data-tags-field="${fieldName}"
        placeholder="type ID + Enter"${dis}></div>`;
  }

  function _resBlockHTML(fieldName, rows, disabled, resTypes) {
    const types = resTypes || BLD_DESTROY_RES;
    const dis = disabled ? ' disabled' : '';
    const rowsHTML = (rows || []).map((r, i) => {
      const opts = types.map(t => `<option${t === r.type ? ' selected' : ''}>${t}</option>`).join('');
      const customOpt = types.includes(r.type) ? '' : `<option selected>${_esc(r.type)}</option>`;
      return `<div class="hexdb-res-row">
        <span class="res-icon" style="font-size:16px;width:20px;text-align:center;flex-shrink:0">${_resIcon(r.type)}</span>
        <select class="hexdb-select" style="width:110px"
          data-res-field="${fieldName}" data-res-index="${i}"${dis}>${opts}${customOpt}</select>
        <input class="hexdb-input" type="number" step="1" min="0" style="width:90px"
          data-res-field="${fieldName}" data-res-index="${i}" data-res-key="amount"
          value="${r.amount ?? 0}"${dis}>
        <button class="hexdb-res-remove"
          data-res-field="${fieldName}" data-res-index="${i}"${dis}>✕</button>
      </div>`;
    }).join('');
    return `<div>${rowsHTML}
      <button class="hexdb-res-add" data-res-field="${fieldName}"${dis}>+ Add Resource</button></div>`;
  }

  function _renderRecord(bld) {
```

- [ ] **Step 2: Verify in browser console**

Open Chrome DevTools console while on BUILDINGS mode:
```js
BldDB   // should be the module object
// helpers are module-private; they'll be exercised in Task 3
```
Expected: no console errors.

- [ ] **Step 3: Commit**

```bash
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" add MapEditorPro.html
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" commit -m "refactor(bld): add _tagsHTML, _resBlockHTML, resource constants to BldDB"
```

---

### Task 3: Rewrite `_renderRecord`, `_readRecord`, and Event Wiring

This is the main task — replaces all 4 old sections (MAIN/BUILD/PRODUCTION/LEVELS) with 5 spec-compliant sections (MAIN/DESTROY/BUILD/INCOME/SETTINGS) and wires all events.

**Files:**
- Modify: `MapEditorPro.html` — BldDB module, lines ~7260–7432 and the event wiring in `_renderRecord`

**Interfaces:**
- Produces: functional 5-section form for any selected building record
- Consumes: `_tagsHTML`, `_resBlockHTML`, `_resIcon` (from Task 2), `BiomeManager.getNames()` (existing)

- [ ] **Step 1: Replace the full `_renderRecord` function body**

Find the entire function from its opening to just before `_readRecord`:
```js
  function _renderRecord(bld) {
    const right = document.getElementById('bld-right');
    const collapsed = s => _secState[s] ? '▶' : '▼';
    const bodyDisplay = s => _secState[s] ? 'none' : 'block';

    function levelCards() {
```
(through to the closing `}` of `_renderRecord`, ending just before `function _readRecord`)

Replace the entire `_renderRecord` with:
```js
  function _renderRecord(bld) {
    const right = document.getElementById('bld-right');
    const g = id => document.getElementById(id);
    const col = s => _secState[s] ? '▶' : '▼';
    const bod = s => _secState[s] ? 'none' : 'block';
    const _isDupe = id => _data.buildings.some((b, i) => b.id === id && i !== _filtered[_selFilt]);

    const canDes    = bld.canDestroy ?? true;
    const resOnDes  = bld.resourceAwardedOnDestroy ?? true;
    const canBld    = bld.canBuild ?? true;
    const hasTap    = bld.hexEarnsOnTap ?? false;
    const hasTapDes = bld.destroyableByTap ?? false;
    const addCond   = bld.additionalBuildCondition ?? false;
    const bldRad    = bld.buildingRadius ?? 0;
    const hasProd   = Array.isArray(bld.canProduce) && bld.canProduce.length > 0;

    // ── MAIN section ─────────────────────────────────────────
    const mainHTML = `
    <div class="hexdb-section">
      <div class="hexdb-section-hdr" data-sec="main">${col('main')} MAIN (0–9)</div>
      <div class="hexdb-section-body" data-sec="main" style="display:${bod('main')}">
        <div class="hexdb-field-row"><label>Id *</label>
          <div style="flex:1;min-width:0">
            <input id="bld-f-id" type="text" value="${_esc(bld.id)}"
              style="border-color:${!bld.id || _isDupe(bld.id) ? '#e57373' : ''}">
            <small style="color:#888;font-size:0.8em">Format: TypeName_Number (e.g. Plain_1, Forest_2)</small>
          </div></div>
        <div class="hexdb-field-row"><label>TextId <span class="hexdb-info" title="Localisation key for display name. No leading/trailing spaces.">ⓘ</span></label>
          <input id="bld-f-textId" type="text" value="${_esc(bld.textId)}" list="loc-keys-datalist"></div>
        <div class="hexdb-field-row"><label>Desc Idle <span class="hexdb-info" title="Key shown when building is placed on map">ⓘ</span></label>
          <input id="bld-f-descIdleId" type="text" value="${_esc(bld.descIdleId)}" list="loc-keys-datalist"></div>
        <div class="hexdb-field-row"><label>Desc Build <span class="hexdb-info" title="Key shown when building can be built">ⓘ</span></label>
          <input id="bld-f-descBuildId" type="text" value="${_esc(bld.descBuildId)}" list="loc-keys-datalist"></div>
        <div class="hexdb-field-row"><label>Type <span class="hexdb-info" title="Ground Building or Water Building">ⓘ</span></label>
          <select id="bld-f-type">
            <option${bld.type === 'Ground Building' ? ' selected' : ''}>Ground Building</option>
            <option${bld.type === 'Water Building'  ? ' selected' : ''}>Water Building</option>
          </select></div>
        <div class="hexdb-field-row"><label>Biome <span class="hexdb-info" title="Season/biome context">ⓘ</span></label>
          <select id="bld-f-biome">${BiomeManager.getNames().map(b =>
            `<option${bld.biome === b ? ' selected' : ''}>${b}</option>`).join('')}</select></div>
        <div class="hexdb-field-row"><label>Filter <span class="hexdb-info" title="UI filter category tag">ⓘ</span></label>
          <input id="bld-f-filter" type="text" value="${_esc(bld.filter)}"></div>
        <div class="hexdb-field-row"><label>SpriteName</label>
          <div style="flex:1;min-width:0">
            <input id="bld-f-spriteName" type="text" value="${_esc(bld.spriteName)}">
            <small style="color:#888;font-size:0.8em">Web: sprites/buildings/&lt;name&gt;.png | Unity: Resources/Buildings/&lt;name&gt;</small>
          </div></div>
        <div class="hexdb-field-row"><label>Base Cost Taps <span class="hexdb-info" title="Taps to unlock. Min 1.">ⓘ</span></label>
          <input id="bld-f-baseCostTaps" type="number" step="1" min="1"
            value="${Math.max(1, bld.baseCostTaps ?? 1)}"></div>
      </div>
    </div>`;

    // ── DESTROY section ───────────────────────────────────────
    const destroyHTML = `
    <div class="hexdb-section">
      <div class="hexdb-section-hdr" data-sec="destroy">${col('destroy')} DESTROY (10–17)</div>
      <div class="hexdb-section-body" data-sec="destroy" style="display:${bod('destroy')}">
        <div class="hexdb-field-row"><label>Hex Can be Destroyed</label>
          <input id="bld-f-canDestroy" type="checkbox"${canDes ? ' checked' : ''}></div>
        <div class="hexdb-field-row"${!canDes ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Transform to <span class="hexdb-info" title="Parents = tile under the building">ⓘ</span></label>
          <div style="display:flex;gap:6px;flex:1">
            <select id="bld-f-destroyTransformToMode">
              <option${bld.destroyTransformToMode === 'Parents' ? ' selected' : ''}>Parents</option>
              <option${bld.destroyTransformToMode === 'HexID'   ? ' selected' : ''}>HexID</option>
            </select>
            <input id="bld-f-destroyTransformTo" type="text" placeholder="Tile ID"
              value="${_esc(bld.destroyTransformTo)}"
              style="flex:1${bld.destroyTransformToMode === 'Parents' ? ';display:none' : ''}">
          </div></div>
        <div class="hexdb-field-row"${!canDes ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Source <span class="hexdb-info" title="Action IDs that can destroy this. Configure in Actions Editor.">ⓘ</span></label>
          ${_tagsHTML('destroySources', bld.destroySources, !canDes)}</div>
        <div class="hexdb-field-row"${!canDes ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Move to Storage on Destroy <span class="hexdb-info" title="YES: goes to Hex Storage; cost not charged, no income.">ⓘ</span></label>
          <input id="bld-f-moveToStorageOnDestroy" type="checkbox"${bld.moveToStorageOnDestroy ? ' checked' : ''}></div>
        <div class="hexdb-field-row"${!canDes ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Resources Awarded on Destroy</label>
          <input id="bld-f-resourceAwardedOnDestroy" type="checkbox"${resOnDes ? ' checked' : ''}></div>
        <div class="hexdb-field-row"${!canDes || !resOnDes ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Destroy Income</label>
          ${_resBlockHTML('destroyIncome', bld.destroyIncome, !canDes || !resOnDes)}</div>
      </div>
    </div>`;

    // ── BUILD section ─────────────────────────────────────────
    const buildHTML = `
    <div class="hexdb-section">
      <div class="hexdb-section-hdr" data-sec="build">${col('build')} BUILD (18–24)</div>
      <div class="hexdb-section-body" data-sec="build" style="display:${bod('build')}">
        <div class="hexdb-field-row"><label>Hex Can be Built</label>
          <input id="bld-f-canBuild" type="checkbox"${canBld ? ' checked' : ''}></div>
        <div class="hexdb-field-row"${!canBld ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Need Road <span class="hexdb-info" title="Ground: Roads required. Water: sea adjacency check.">ⓘ</span></label>
          <input id="bld-f-needRoad" type="checkbox"${bld.needRoad ? ' checked' : ''}></div>
        <div class="hexdb-field-row"${!canBld ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Available Tiles <span class="hexdb-info" title="Tile Type IDs where building can be placed">ⓘ</span></label>
          ${_tagsHTML('availableTiles', bld.availableTiles, !canBld)}</div>
        <div class="hexdb-field-row"${!canBld ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Min Level <span class="hexdb-info" title="Min Settlement level. Integer ≥ 1.">ⓘ</span></label>
          <input id="bld-f-minLevel" type="number" step="1" min="1"
            value="${Math.max(1, bld.minLevel ?? 1)}"></div>
        <div class="hexdb-field-row"${!canBld ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Price</label>
          ${_resBlockHTML('price', bld.price, !canBld)}</div>
        <div class="hexdb-field-row"${!canBld ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Premium Price <span class="hexdb-info" title="Gem price. 0 = disabled.">ⓘ</span></label>
          <input id="bld-f-premiumPrice" type="number" step="1" min="0"
            value="${bld.premiumPrice ?? 0}"></div>
        <div class="hexdb-field-row"${!canBld ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Additional Build Condition <span class="hexdb-info" title="Requires a specific nearby tile type">ⓘ</span></label>
          <input id="bld-f-additionalBuildCondition" type="checkbox"${addCond ? ' checked' : ''}></div>
        ${addCond && canBld ? `
        <div class="hexdb-field-row"><label>Tiles Type <span class="hexdb-info" title="Parents = copies Available Tiles. HexID/Type = specific nearby tile.">ⓘ</span></label>
          <div style="display:flex;gap:6px;flex:1">
            <select id="bld-f-tilesTypeMode">
              <option${bld.tilesTypeMode === 'Parents' ? ' selected' : ''}>Parents</option>
              <option${bld.tilesTypeMode === 'HexID'   ? ' selected' : ''}>HexID</option>
              <option${bld.tilesTypeMode === 'Type'    ? ' selected' : ''}>Type</option>
            </select>
            <input id="bld-f-tilesTypeValue" type="text" placeholder="ID or Type"
              value="${_esc(bld.tilesTypeValue)}"
              style="flex:1${bld.tilesTypeMode === 'Parents' ? ';display:none' : ''}">
          </div></div>
        <div class="hexdb-field-row"><label>Radius <span class="hexdb-info" title="0=must be on top; 1=adjacent; N=within N hexes">ⓘ</span></label>
          <input id="bld-f-radius" type="number" step="1" min="0"
            value="${bld.radius ?? 0}"></div>` : ''}
      </div>
    </div>`;

    // ── INCOME section ────────────────────────────────────────
    const incomeHTML = `
    <div class="hexdb-section">
      <div class="hexdb-section-hdr" data-sec="income">${col('income')} INCOME</div>
      <div class="hexdb-section-body" data-sec="income" style="display:${bod('income')}">
        <div class="hexdb-field-row"><label>Hex Earns on Tap</label>
          <input id="bld-f-hexEarnsOnTap" type="checkbox"${hasTap ? ' checked' : ''}></div>
        <div class="hexdb-field-row"${!hasTap ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Destroyable <span class="hexdb-info" title="Destroyed after Capacity taps">ⓘ</span></label>
          <input id="bld-f-destroyableByTap" type="checkbox"${hasTapDes ? ' checked' : ''}></div>
        <div class="hexdb-field-row"${!hasTap || !hasTapDes ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Transform to <span class="hexdb-info" title="Parents = tile under building">ⓘ</span></label>
          <div style="display:flex;gap:6px;flex:1">
            <select id="bld-f-incomeTransformToMode">
              <option${bld.incomeTransformToMode === 'Parents' ? ' selected' : ''}>Parents</option>
              <option${bld.incomeTransformToMode === 'HexID'   ? ' selected' : ''}>HexID</option>
            </select>
            <input id="bld-f-incomeTransformTo" type="text" placeholder="Tile ID"
              value="${_esc(bld.incomeTransformTo)}"
              style="flex:1${bld.incomeTransformToMode === 'Parents' ? ';display:none' : ''}">
          </div></div>
        <div class="hexdb-field-row"${!hasTap ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Capacity <span class="hexdb-info" title="Taps until destroyed (0 = unlimited)">ⓘ</span></label>
          <input id="bld-f-capacity" type="number" step="1" min="0"
            value="${bld.capacity ?? 0}"></div>
        <div class="hexdb-field-row"${!hasTap ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Get per Tap</label>
          ${_resBlockHTML('getPerTap', bld.getPerTap, !hasTap)}</div>
        <div class="hexdb-field-row"><label>Per Turn <span class="hexdb-info" title="Idle income per turn (9s) while on map">ⓘ</span></label>
          ${_resBlockHTML('incomePerTurn', bld.incomePerTurn, false)}</div>
        <div class="hexdb-field-row"><label>Income Constant <span class="hexdb-info" title="Constant income while on map">ⓘ</span></label>
          ${_resBlockHTML('incomeConstant', bld.incomeConstant, false, BLD_SPEND_RES)}</div>
        <div class="hexdb-field-row"><label>Spend Constant <span class="hexdb-info" title="Constant drain while on map">ⓘ</span></label>
          ${_resBlockHTML('spendConstant', bld.spendConstant, false, BLD_SPEND_RES)}</div>
      </div>
    </div>`;

    // ── SETTINGS section ──────────────────────────────────────
    const settingsHTML = `
    <div class="hexdb-section">
      <div class="hexdb-section-hdr" data-sec="settings">${col('settings')} BUILDINGS SETTINGS</div>
      <div class="hexdb-section-body" data-sec="settings" style="display:${bod('settings')}">
        <div class="hexdb-field-row"><label>Building Radius <span class="hexdb-info" title="Action radius. 0 = no area effect.">ⓘ</span></label>
          <input id="bld-f-buildingRadius" type="number" step="1" min="0"
            value="${bldRad}"></div>
        ${bldRad >= 1 ? `
        <div class="hexdb-field-row"><label>Can Produce <span class="hexdb-info" title="IDs auto-constructed each turn in radius at 0 cost">ⓘ</span></label>
          ${_tagsHTML('canProduce', bld.canProduce, false)}</div>
        <div class="hexdb-field-row"${!hasProd ? ' style="opacity:0.4;pointer-events:none"' : ''}><label>Available Tiles for Produce <span class="hexdb-info" title="Tile types where production deposits new tiles">ⓘ</span></label>
          ${_tagsHTML('availableTilesForProduce', bld.availableTilesForProduce, !hasProd)}</div>
        <div class="hexdb-field-row"><label>Production Facilities <span class="hexdb-info" title="Tile IDs/Types in radius that boost productivity">ⓘ</span></label>
          ${_tagsHTML('productionFacilities', bld.productionFacilities, false)}</div>` : ''}
        <div class="hexdb-field-row"><label>Stores <span class="hexdb-info" title="Storage capacity this building provides per resource">ⓘ</span></label>
          ${_resBlockHTML('stores', bld.stores, false)}</div>
      </div>
    </div>`;

    // ── Actions ───────────────────────────────────────────────
    const actionsHTML = `
    <div class="hexdb-actions">
      <button onclick="BldDB.copy()">Copy</button>
      <button onclick="BldDB.paste()">Paste</button>
    </div>`;

    right.innerHTML = `<div class="hexdb-form">
      ${mainHTML}${destroyHTML}${buildHTML}${incomeHTML}${settingsHTML}${actionsHTML}
    </div>`;

    // ── Wire section headers ──────────────────────────────────
    right.querySelectorAll('.hexdb-section-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const s = hdr.dataset.sec;
        _secState[s] = !_secState[s];
        _saveSecState();
        right.querySelector(`.hexdb-section-body[data-sec="${s}"]`).style.display =
          _secState[s] ? 'none' : 'block';
        hdr.textContent = (_secState[s] ? '▶ ' : '▼ ') + hdr.textContent.slice(2);
      });
    });

    // ── Wire simple inputs → _readRecord ─────────────────────
    right.querySelectorAll('input:not(.hexdb-tag-input):not([data-res-field]),select:not([data-res-field])').forEach(el => {
      el.addEventListener('input',  _readRecord);
      el.addEventListener('change', _readRecord);
    });

    // ── Wire toggles that trigger full re-render ──────────────
    const reRenderIds = [
      'bld-f-canDestroy', 'bld-f-resourceAwardedOnDestroy',
      'bld-f-destroyTransformToMode',
      'bld-f-canBuild', 'bld-f-additionalBuildCondition', 'bld-f-tilesTypeMode',
      'bld-f-hexEarnsOnTap', 'bld-f-destroyableByTap', 'bld-f-incomeTransformToMode',
      'bld-f-buildingRadius',
    ];
    reRenderIds.forEach(id => {
      const el = g(id);
      if (!el) return;
      el.addEventListener('change', () => {
        if (_selFilt < 0) return;
        _readRecord();
        _renderRecord(_data.buildings[_filtered[_selFilt]]);
      });
    });

    // ── Wire tags (destroySources, availableTiles, canProduce, etc.) ──
    right.querySelectorAll('.hexdb-tag-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const val = input.value.trim();
        if (!val || _selFilt < 0) return;
        const bldObj = _data.buildings[_filtered[_selFilt]];
        const field  = input.dataset.tagsField;
        if (!Array.isArray(bldObj[field])) bldObj[field] = [];
        if (!bldObj[field].includes(val)) bldObj[field].push(val);
        input.value = '';
        _autoSave();
        _renderRecord(bldObj);
      });
    });
    right.querySelectorAll('.hexdb-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_selFilt < 0) return;
        const bldObj = _data.buildings[_filtered[_selFilt]];
        const field  = btn.dataset.tagsField;
        const val    = btn.dataset.value;
        if (Array.isArray(bldObj[field])) {
          bldObj[field] = bldObj[field].filter(v => v !== val);
          _autoSave();
          _renderRecord(bldObj);
        }
      });
    });

    // ── Wire resource blocks ──────────────────────────────────
    right.querySelectorAll('[data-res-field]').forEach(el => {
      const field = el.dataset.resField;
      const idx   = parseInt(el.dataset.resIndex, 10);
      if (el.classList.contains('hexdb-res-remove')) {
        el.addEventListener('click', () => {
          if (_selFilt < 0) return;
          const bldObj = _data.buildings[_filtered[_selFilt]];
          if (Array.isArray(bldObj[field])) {
            bldObj[field].splice(idx, 1);
            _autoSave();
            _renderRecord(bldObj);
          }
        });
      } else if (el.tagName === 'SELECT') {
        el.addEventListener('change', () => {
          if (_selFilt < 0) return;
          const bldObj = _data.buildings[_filtered[_selFilt]];
          if (Array.isArray(bldObj[field]) && bldObj[field][idx]) {
            bldObj[field][idx].type = el.value;
            const icon = el.parentElement.querySelector('.res-icon');
            if (icon) icon.textContent = _resIcon(el.value);
            _autoSave();
          }
        });
      } else if (el.type === 'number') {
        el.addEventListener('input', () => {
          if (_selFilt < 0) return;
          const bldObj = _data.buildings[_filtered[_selFilt]];
          if (Array.isArray(bldObj[field]) && bldObj[field][idx]) {
            bldObj[field][idx].amount = Math.round(parseFloat(el.value) || 0);
            _autoSave();
          }
        });
      }
    });
    right.querySelectorAll('.hexdb-res-add').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_selFilt < 0) return;
        const bldObj = _data.buildings[_filtered[_selFilt]];
        const field  = btn.dataset.resField;
        if (!Array.isArray(bldObj[field])) bldObj[field] = [];
        bldObj[field].push({ type: 'Gold', amount: 0 });
        _autoSave();
        _renderRecord(bldObj);
      });
    });
  }
```

- [ ] **Step 2: Replace `_readRecord` with the new version**

Find the entire `_readRecord` function:
```js
  function _readRecord() {
    if (_selFilt < 0 || _selFilt >= _filtered.length) return;
    const bld = _data.buildings[_filtered[_selFilt]];
    const g = id => document.getElementById(id);
    const iv = id => { const el = g(id); return el ? el.value : ''; };
    const nv = id => { const el = g(id); return el ? (parseInt(el.value,10)||0) : 0; };
    const bv = id => { const el = g(id); return el ? el.checked : false; };

    bld.id              = iv('bld-f-id');
```
(through to the closing `}` of `_readRecord`)

Replace the entire function with:
```js
  function _readRecord() {
    if (_selFilt < 0 || _selFilt >= _filtered.length) return;
    const bld = _data.buildings[_filtered[_selFilt]];
    const g  = id => document.getElementById(id);
    const iv = id => { const el = g(id); return el ? el.value : ''; };
    const nv = id => { const el = g(id); return el ? (parseInt(el.value, 10) || 0) : 0; };
    const bv = id => { const el = g(id); return el ? el.checked : false; };

    // MAIN
    bld.id           = iv('bld-f-id');
    bld.textId       = iv('bld-f-textId').trim();
    bld.descIdleId   = iv('bld-f-descIdleId').trim();
    bld.descBuildId  = iv('bld-f-descBuildId').trim();
    bld.type         = iv('bld-f-type');
    bld.biome        = iv('bld-f-biome');
    bld.filter       = iv('bld-f-filter');
    bld.spriteName   = iv('bld-f-spriteName');
    bld.baseCostTaps = Math.max(1, nv('bld-f-baseCostTaps'));

    // DESTROY
    bld.canDestroy               = bv('bld-f-canDestroy');
    bld.destroyTransformToMode   = iv('bld-f-destroyTransformToMode');
    bld.destroyTransformTo       = iv('bld-f-destroyTransformTo');
    bld.moveToStorageOnDestroy   = bv('bld-f-moveToStorageOnDestroy');
    bld.resourceAwardedOnDestroy = bv('bld-f-resourceAwardedOnDestroy');

    // BUILD
    bld.canBuild                 = bv('bld-f-canBuild');
    bld.needRoad                 = bv('bld-f-needRoad');
    bld.minLevel                 = Math.max(1, nv('bld-f-minLevel'));
    bld.premiumPrice             = nv('bld-f-premiumPrice');
    bld.additionalBuildCondition = bv('bld-f-additionalBuildCondition');
    bld.tilesTypeMode            = iv('bld-f-tilesTypeMode');
    bld.tilesTypeValue           = iv('bld-f-tilesTypeValue');
    bld.radius                   = Math.max(0, nv('bld-f-radius'));

    // INCOME
    bld.hexEarnsOnTap         = bv('bld-f-hexEarnsOnTap');
    bld.destroyableByTap      = bv('bld-f-destroyableByTap');
    bld.incomeTransformToMode = iv('bld-f-incomeTransformToMode');
    bld.incomeTransformTo     = iv('bld-f-incomeTransformTo');
    bld.capacity              = Math.max(0, nv('bld-f-capacity'));

    // SETTINGS
    bld.buildingRadius = Math.max(0, nv('bld-f-buildingRadius'));

    // Update list row label
    const row = document.querySelector(`#bld-list .hexdb-list-row[data-filt-idx="${_selFilt}"]`);
    if (row) row.querySelector('.hexdb-list-id').textContent = bld.id || '(no id)';

    // ID uniqueness border
    const idEl = g('bld-f-id');
    if (idEl) {
      const isDupe = _data.buildings.some((b, i) => b.id === bld.id && i !== _filtered[_selFilt]);
      idEl.style.borderColor = (!bld.id || isDupe) ? '#e57373' : '';
    }
    _autoSave();
  }
```

- [ ] **Step 3: Verify form renders correctly in browser**

Open `MapEditorPro.html` in Chrome. Switch to BUILDINGS mode. Add a building.
- Expected: 5 collapsible sections — MAIN (0–9), DESTROY (10–17), BUILD (18–24), INCOME, BUILDINGS SETTINGS
- MAIN shows: Id, TextId, Desc Idle, Desc Build, Type (dropdown: Ground/Water Building), Biome, Filter, SpriteName, Base Cost Taps
- DESTROY shows: canDestroy checkbox (checked by default), Transform to (Parents dropdown), Source tags, Move to Storage (checked), Resources Awarded (checked), Destroy Income block
- BUILD shows: canBuild (checked), Need Road (checked), Available Tiles tags, Min Level=1, Price=1000 Gold, Premium Price=0, Additional Build Condition (unchecked) — Tiles Type and Radius hidden
- INCOME shows: Hex Earns on Tap (unchecked), Destroyable, Transform to, Capacity, Get per Tap (all dimmed), Per Turn=Gold/1, Income/Spend Constant
- SETTINGS shows: Building Radius=0, Stores block (Add Resource button), no Can Produce (radius=0)

- [ ] **Step 4: Test interactions**

- Toggle "Hex Can be Destroyed" OFF → DESTROY fields grey out
- Toggle "Additional Build Condition" ON → Tiles Type + Radius appear
- Set Building Radius to 2 → Can Produce, Available Tiles for Produce, Production Facilities appear
- Add a tag to Source field (type "Action_1" + Enter) → chip appears; ✕ removes it
- Add resource to Destroy Income → row appears with Gold/0; change type and amount → persists on re-open
- Edit Id field → list row label updates live

- [ ] **Step 5: Commit**

```bash
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" add MapEditorPro.html
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" commit -m "feat(bld): rewrite _renderRecord with 5 spec-compliant sections + event wiring"
```

---

### Task 4: Left Panel — Biome Color Indicator, Type Filter, Counter

**Files:**
- Modify: `MapEditorPro.html` — HTML `#bld-filters` div (line ~1373) and BldDB JS (`_filter`, `_applyFilter`, `_buildList`, `init`)

**Interfaces:**
- Consumes: `BiomeManager.getColor(name)` (existing)
- Produces: colored biome dot in each list row; type filter dropdown; counter showing biome+type breakdown

- [ ] **Step 1: Add type filter to HTML**

Find in MapEditorPro.html:
```html
      <div id="bld-filters">
        <input id="bld-search" type="text" placeholder="🔍 Search by id…" autocomplete="off">
        <select id="bld-filter-biome" title="Filter by Biome">
          <option value="">All Biomes</option>
          <!-- populated by BiomeManager.refreshAllDropdowns() -->
        </select>
      </div>
```
Replace with:
```html
      <div id="bld-filters">
        <input id="bld-search" type="text" placeholder="🔍 Search by id…" autocomplete="off">
        <select id="bld-filter-biome" title="Filter by Biome">
          <option value="">All Biomes</option>
        </select>
        <select id="bld-filter-type" title="Filter by Type">
          <option value="">All Types</option>
          <option>Ground Building</option>
          <option>Water Building</option>
        </select>
      </div>
```

- [ ] **Step 2: Update `_filter` object in BldDB**

Find:
```js
  let _filter      = { search: '', biome: '' };
```
Replace with:
```js
  let _filter      = { search: '', biome: '', type: '' };
```

- [ ] **Step 3: Update `_applyFilter` to include type filter**

Find:
```js
  function _applyFilter() {
    const s = _filter.search.toLowerCase();
    const b = _filter.biome;
    _filtered = _data.buildings.map((h, i) => i)
      .filter(i => (!s || _data.buildings[i].id.toLowerCase().includes(s)) &&
                   (!b || _data.buildings[i].biome === b));
  }
```
Replace with:
```js
  function _applyFilter() {
    const s = _filter.search.toLowerCase();
    const b = _filter.biome;
    const t = _filter.type;
    _filtered = _data.buildings.map((h, i) => i)
      .filter(i => {
        const bld = _data.buildings[i];
        return (!s || bld.id.toLowerCase().includes(s)) &&
               (!b || bld.biome === b) &&
               (!t || bld.type === t);
      });
    _filtered.sort((a, b) => (_data.buildings[a].id || '').localeCompare(_data.buildings[b].id || ''));
  }
```

- [ ] **Step 4: Update `_buildList` to show biome color dot and sorted list**

Find:
```js
  function _buildList() {
    const list = document.getElementById('bld-list');
    const count = document.getElementById('bld-count');
    list.innerHTML = '';
    _filtered.forEach((dataIdx, filtIdx) => {
      const h = _data.buildings[dataIdx];
      const row = document.createElement('div');
      row.className = 'hexdb-list-row' + (_selFilt === filtIdx ? ' selected' : '');
      row.dataset.filtIdx = filtIdx;
      row.innerHTML = `<span class="hexdb-list-id">${_esc(h.id) || '(no id)'}</span>`;
      row.addEventListener('click', () => _selectIdx(filtIdx));
      list.appendChild(row);
    });
    count.textContent = `${_filtered.length} shown / ${_data.buildings.length}`;
  }
```
Replace with:
```js
  function _buildList() {
    const list  = document.getElementById('bld-list');
    const count = document.getElementById('bld-count');
    list.innerHTML = '';
    _filtered.forEach((dataIdx, filtIdx) => {
      const bld   = _data.buildings[dataIdx];
      const color = BiomeManager.getColor(bld.biome) || '#888';
      const row   = document.createElement('div');
      row.className = 'hexdb-list-row' + (_selFilt === filtIdx ? ' selected' : '');
      row.dataset.filtIdx = filtIdx;
      row.innerHTML =
        `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;` +
        `background:${color};flex-shrink:0;margin-right:5px;vertical-align:middle"></span>` +
        `<span class="hexdb-list-id">${_esc(bld.id) || '(no id)'}</span>`;
      row.addEventListener('click', () => _selectIdx(filtIdx));
      list.appendChild(row);
    });
    const total  = _data.buildings.length;
    const shown  = _filtered.length;
    count.textContent = `${shown} shown / ${total}`;
  }
```

- [ ] **Step 5: Wire type filter in `init()`**

Find in `init()`:
```js
    document.getElementById('bld-filter-biome').addEventListener('change', e => {
      _filter.biome = e.target.value;
      _applyFilter(); _buildList();
      if (_selFilt >= _filtered.length) _selFilt = _filtered.length - 1;
    });
```
Replace with:
```js
    document.getElementById('bld-filter-biome').addEventListener('change', e => {
      _filter.biome = e.target.value;
      _applyFilter(); _buildList();
      if (_selFilt >= _filtered.length) _selFilt = _filtered.length - 1;
    });

    document.getElementById('bld-filter-type').addEventListener('change', e => {
      _filter.type = e.target.value;
      _applyFilter(); _buildList();
      if (_selFilt >= _filtered.length) _selFilt = _filtered.length - 1;
    });
```

- [ ] **Step 6: Verify in browser**

Switch to BUILDINGS. Add 3 buildings, set different biomes/types.
- Expected: colored biome dot before each ID in the list; list sorted alphabetically
- Filter "Ground Building" → only Ground Building rows shown; count updates
- Filter biome "Summer" → only Summer rows shown
- Combining both filters works correctly

- [ ] **Step 7: Commit**

```bash
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" add MapEditorPro.html
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" commit -m "feat(bld): biome color dots, type filter, alphabetical sort in Buildings list"
```

---

### Task 5: Nav Additions — Publish Buildings DB + Stub Editor Tabs

**Files:**
- Modify: `MapEditorPro.html` — sync bar HTML (line ~1135), toolbar mode tabs (line ~1145), mode CSS (line ~550), App.setMode (line ~5668), DriveSync module

**Interfaces:**
- Produces: `DriveSync.publishBuildingsDb()` — uploads building_database.json to Drive root folder
- Produces: mode tabs SLOTS, ACTIONS, UPGRADES, MONSTERS, QUESTS with stub panels
- Consumes: `BldDB.getJson()` (from Task 1), `DriveSync._uploadFile` (existing internal)

- [ ] **Step 1: Add Publish Buildings DB button to sync bar**

Find:
```html
    <button class="publish-btn" id="btn-publish-db"  onclick="DriveSync.publishDb()"     title="Upload HexDB + sprites to Google Drive">☁ Publish DB</button>
```
Replace with:
```html
    <button class="publish-btn" id="btn-publish-db"  onclick="DriveSync.publishDb()"     title="Upload HexDB + sprites to Google Drive">☁ Publish DB</button>
    <button class="publish-btn" id="btn-publish-bld" onclick="DriveSync.publishBuildingsDb()" title="Upload building_database.json to Google Drive">☁ Publish Buildings DB</button>
```

- [ ] **Step 2: Add `publishBuildingsDb` to DriveSync module**

Find in the DriveSync module (just before its `return` statement — search for `return {` inside the DriveSync IIFE):
```js
  return { init, signIn, signOut, syncFromDrive,
```
Replace with:
```js
  async function publishBuildingsDb() {
    const btn = document.getElementById('btn-publish-bld');
    if (btn) btn.disabled = true;
    try {
      UI.toast('Authenticating…');
      await authenticate();
      UI.progress(30, 'Uploading building_database.json…');
      const rootFiles = await _listFiles(ROOT_FOLDER);
      const byName    = Object.fromEntries(rootFiles.map(f => [f.name, f.id]));
      const content   = BldDB.getJson();
      await _uploadFile(ROOT_FOLDER, 'building_database.json', content,
        'application/json', byName['building_database.json']);
      UI.progressDone('✅ Buildings DB published');
      UI.toast('✅ building_database.json published to Drive');
    } catch(e) {
      UI.progressDone('❌ Failed');
      UI.toast('❌ Publish Buildings DB failed: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  return { init, signIn, signOut, syncFromDrive,
```
Then add `publishBuildingsDb` to the same return object — find the end of the existing return list and add it:
```js
  return { init, signIn, signOut, syncFromDrive, publishDb, publishMap,
```
Replace with:
```js
  return { init, signIn, signOut, syncFromDrive, publishDb, publishMap, publishBuildingsDb,
```
(Add `publishBuildingsDb` to whatever the actual return object keys are.)

- [ ] **Step 3: Add stub mode tabs to toolbar**

Find:
```html
      <button class="mode-tab"        id="tab-keys"        onclick="App.setMode('keys')">KEYS</button>
    </div>
```
Replace with:
```html
      <button class="mode-tab"        id="tab-keys"        onclick="App.setMode('keys')">KEYS</button>
      <button class="mode-tab"        id="tab-slots"       onclick="App.setMode('slots')">SLOTS</button>
      <button class="mode-tab"        id="tab-actions"     onclick="App.setMode('actions')">ACTIONS</button>
      <button class="mode-tab"        id="tab-upgrades"    onclick="App.setMode('upgrades')">UPGRADES</button>
      <button class="mode-tab"        id="tab-monsters"    onclick="App.setMode('monsters')">MONSTERS</button>
      <button class="mode-tab"        id="tab-quests"      onclick="App.setMode('quests')">QUESTS</button>
    </div>
```

- [ ] **Step 4: Add stub panel HTML (just after `</div>` closing `#buildings-main`)**

Find:
```html
  <!-- ── Settlements Main ───────────────────────────────────────── -->
```
Insert before it:
```html
  <!-- ── Stub editors (SLOTS / ACTIONS / UPGRADES / MONSTERS / QUESTS) ── -->
  <div id="slots-main"    class="stub-editor"><div class="stub-msg">SLOTS Editor — coming soon</div></div>
  <div id="actions-main"  class="stub-editor"><div class="stub-msg">ACTIONS Editor — coming soon</div></div>
  <div id="upgrades-main" class="stub-editor"><div class="stub-msg">UPGRADES Editor — coming soon</div></div>
  <div id="monsters-main" class="stub-editor"><div class="stub-msg">MONSTERS Editor — coming soon</div></div>
  <div id="quests-main"   class="stub-editor"><div class="stub-msg">QUESTS Editor — coming soon</div></div>

```

- [ ] **Step 5: Add CSS for stub editors and new mode visibility rules**

Find in the CSS section (near the existing mode-buildings rules around line 550):
```css
body.mode-buildings   #buildings-main   { display: grid; }
```
Add after it:
```css
body.mode-slots       #main { display: none; } body.mode-slots       #slots-main    { display: flex; }
body.mode-actions     #main { display: none; } body.mode-actions     #actions-main  { display: flex; }
body.mode-upgrades    #main { display: none; } body.mode-upgrades    #upgrades-main { display: flex; }
body.mode-monsters    #main { display: none; } body.mode-monsters    #monsters-main { display: flex; }
body.mode-quests      #main { display: none; } body.mode-quests      #quests-main   { display: flex; }
.stub-editor { align-items: center; justify-content: center; height: 100%; }
.stub-msg    { color: var(--muted); font-size: 18px; }
```

- [ ] **Step 6: Register new modes in `App.setMode`**

Find:
```js
    const MODES = ['map', 'hexdb', 'buildings', 'settlements', 'keys'];
```
Replace with:
```js
    const MODES = ['map', 'hexdb', 'buildings', 'settlements', 'keys',
                   'slots', 'actions', 'upgrades', 'monsters', 'quests'];
```

- [ ] **Step 7: Verify in browser**

- Switch to each new tab (SLOTS, ACTIONS, UPGRADES, MONSTERS, QUESTS) → "coming soon" message shown, MAP canvas hidden
- Click "☁ Publish Buildings DB" while signed out → toast "Authenticate…" or error message (no crash)
- Click while signed in → building_database.json appears in Google Drive root folder

- [ ] **Step 8: Commit**

```bash
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" add MapEditorPro.html
git -C "/Users/sergii.tyshchenko/Post Apo Map Editor" commit -m "feat(bld): Publish Buildings DB button + stub nav tabs for SLOTS/ACTIONS/UPGRADES/MONSTERS/QUESTS"
```

---

## Spec Coverage Self-Check

| Spec requirement | Task |
|---|---|
| New data schema (all spec fields) | Task 1 |
| Migration of old building records on load | Task 1 |
| `_blank()` → `NewBuild_N`, Summer, Ground Building | Task 1 |
| Helper functions (`_tagsHTML`, `_resBlockHTML`) | Task 2 |
| MAIN: Id, TextId, DescIdle, DescBuild, Type (G/W), Biome, Filter, SpriteName, BaseCostTaps | Task 3 |
| DESTROY: canDestroy, transformTo+mode, sources, moveToStorage, resourceAwarded, destroyIncome | Task 3 |
| BUILD: canBuild, needRoad, availableTiles, minLevel, price, premiumPrice, additionalBuildCondition, tilesType+mode, radius | Task 3 |
| BUILD 4 placement cases (V1–V4) via conditional fields | Task 3 |
| INCOME: hexEarnsOnTap, destroyable, transformTo, capacity, getPerTap, perTurn, constant, spendConstant | Task 3 |
| SETTINGS: buildingRadius, canProduce, availableTilesForProduce, productionFacilities, stores | Task 3 |
| SETTINGS conditional (radius≥1 unlocks produce/facilities; canProduce empty dims availableTilesForProduce) | Task 3 |
| Biome color dot in Buildings list | Task 4 |
| Filter by Type (Ground/Water Building) | Task 4 |
| Alphabetical sort in Buildings list | Task 4 |
| Publish Buildings DB sync bar button | Task 5 |
| Nav tabs: SLOTS, ACTIONS, UPGRADES, MONSTERS, QUESTS (stubs) | Task 5 |
| [Delete] Placement Rule field removed | Task 3 (not rendered) |
| [Delete] "Roads can be built on this tile" removed | Task 3 (not rendered) |
| [Delete] Levels/startLevel/maxLevel sections removed | Task 3 (not rendered) |

**Not implemented (deferred — spec incomplete):**
- Buildings Settings Block game logic (boost formulas, production rates) — "Cases/Tezisy" section is an unfinished draft in the spec
- Hex Storage UI (referenced in spec but documented separately)
- Special Info Block (not documented in this spec PDF)
- Image sprite picker / upload for Buildings sprites folder (existing HexDB pattern could be reused but no Buildings sprite folder exists yet)
