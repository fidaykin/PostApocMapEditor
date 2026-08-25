# Coastline Shape Controls & Editor Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a designer shape the generator's continent/coastline via sliders instead of hardcoded constants, and see the same directional coastline decoration in the web editor that Unity already renders at runtime.

**Architecture:** Both pieces live entirely inside `MapEditorPro.html` (single-file app, no build step). The Generator's three hardcoded coastline constants become slider-driven parameters. A new `Coastline` module (mirroring the existing `Roads` module's shape: sprite loading + a pure edge-mask function + a draw function) computes, for every visible Water-type cell, which of its 6 sides border Ground (with a river-mouth suppression rule ported from Unity's `CoastlineEdgeDetector`), and draws the matching one of 6 pre-authored directional sprites on top. No Unity-side code changes — this only mirrors behavior that already exists there.

**Tech Stack:** Vanilla JS (no framework, no build step), HTML5 Canvas 2D, existing `HexDB`/`Terrain`/`EdgeTiling`/`Roads` module conventions already in `MapEditorPro.html`.

**Spec:** `docs/superpowers/specs/2026-08-25-coastline-shape-and-editor-preview-design.md`

## Global Constraints

- No automated test harness in this project (confirmed standing decision, restated in `2026-08-03-terrain-generation-overhaul-design.md` and `2026-08-03-river-tile-autotiling-design.md`) — every verification step below is manual/visual via a local static server, not a test runner.
- River tile generation (`EdgeTiling.resolveEdgeTile` applied to carved river paths) is already shipped (commits `fdb174d`, `51b3e29`, `34c87a6`) — do not touch that code path.
- No change to the JSON map export/import format or to any Unity-side script (`CoastlineManager.cs`, `CoastlineEdgeDetector.cs` are the reference behavior being mirrored, not modified).
- Default values for the 3 new sliders must equal today's hardcoded constants (0.72 / 0.28 / 0.20) so no existing generated map's shape changes until a designer moves a slider.
- To run the editor locally for manual verification: from the repo root, `python3 -m http.server 8000`, then open `http://localhost:8000/MapEditorPro.html` (opening the file directly via `file://` breaks `fetch()` calls the app makes for `hex_database.json`).

---

### Task 1: Copy the 6 coastline sprites from Unity into the web editor

**Files:**
- Create: `sprites/terrain/coastline/Coastline_0_UpperRight.png`
- Create: `sprites/terrain/coastline/Coastline_1_LowerRight.png`
- Create: `sprites/terrain/coastline/Coastline_2_Bottom.png`
- Create: `sprites/terrain/coastline/Coastline_3_LowerLeft.png`
- Create: `sprites/terrain/coastline/Coastline_4_UpperLeft.png`
- Create: `sprites/terrain/coastline/Coastline_5_Top.png`

**Interfaces:**
- Produces: 6 PNG files at `sprites/terrain/coastline/Coastline_<N>_<Name>.png`, consumed by Task 2's `Coastline.loadSprites()`.

- [ ] **Step 1: Copy the source PNGs**

```bash
mkdir -p "/Users/sergii.tyshchenko/Post Apo Map Editor/sprites/terrain/coastline"
cp /Users/sergii.tyshchenko/PostApocCityBuilder/Assets/_Project/Sprites/Coastline/Coastline_0_UpperRight.png \
   /Users/sergii.tyshchenko/PostApocCityBuilder/Assets/_Project/Sprites/Coastline/Coastline_1_LowerRight.png \
   /Users/sergii.tyshchenko/PostApocCityBuilder/Assets/_Project/Sprites/Coastline/Coastline_2_Bottom.png \
   /Users/sergii.tyshchenko/PostApocCityBuilder/Assets/_Project/Sprites/Coastline/Coastline_3_LowerLeft.png \
   /Users/sergii.tyshchenko/PostApocCityBuilder/Assets/_Project/Sprites/Coastline/Coastline_4_UpperLeft.png \
   /Users/sergii.tyshchenko/PostApocCityBuilder/Assets/_Project/Sprites/Coastline/Coastline_5_Top.png \
   "/Users/sergii.tyshchenko/Post Apo Map Editor/sprites/terrain/coastline/"
```

- [ ] **Step 2: Verify the 6 files landed and are non-empty**

Run: `ls -la "/Users/sergii.tyshchenko/Post Apo Map Editor/sprites/terrain/coastline/"`
Expected: 6 files listed, each with a non-zero byte size matching the source file's size in `Assets/_Project/Sprites/Coastline/`.

- [ ] **Step 3: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add sprites/terrain/coastline/
git commit -m "assets: add coastline direction sprites (copied from Unity)"
```

---

### Task 2: `Coastline` module — sprite loading + edge detection + draw

**Files:**
- Modify: `MapEditorPro.html:2625-2626` (insert new module between the end of `EdgeTiling` and the `CANVAS MODULE` comment banner)

**Interfaces:**
- Consumes: global `mapData` (flat `Int`/string array indexed `row*MAP_WIDTH+col`), global `MAP_WIDTH`/`MAP_HEIGHT`, global `_DIRS_EVEN`/`_DIRS_ODD` (`{N,S,NE,SE,NW,SW: [dc,dr]}`), `Terrain.byHexId(hexId) -> {type, edgeFaces, ...} | null` (already defined at `MapEditorPro.html:2376`).
- Produces: `Coastline.loadSprites() -> Promise<void[]>`, `Coastline.computeEdges(col, row) -> boolean[6]` (index order `['SE','NE','N','NW','SW','S']`, same as `EdgeTiling.FACE_NAMES`), `Coastline.drawOverlay(ctx, cx, cy, radius, edges)`. Consumed by Task 3.

- [ ] **Step 1: Insert the `Coastline` module**

Insert immediately after line 2625 (`})();` closing `EdgeTiling`) and before line 2627 (`// CANVAS MODULE...` banner):

```js

// ═══════════════════════════════════════════════════════════════
// COASTLINE MODULE — mirrors Unity's CoastlineManager/CoastlineEdgeDetector:
// draws a directional edge sprite on every Water-type cell that borders
// Ground, so the editor preview matches what the game renders at runtime.
// Purely visual — never touches mapData or the exported JSON.
// ═══════════════════════════════════════════════════════════════
const Coastline = (() => {
  // Same bit order as EdgeTiling.FACE_NAMES / Roads._DIR_BITS: SE=0, NE=1,
  // N=2, NW=3, SW=4, S=5. Sprite naming follows Roads' documented convention
  // (N arm at top of PNG, NE upper-right, SE lower-right, SW lower-left,
  // NW upper-left) — verify this against Unity in Task 5 if edges look wrong.
  const FACE_NAMES = ['SE', 'NE', 'N', 'NW', 'SW', 'S'];
  const SPRITE_NAMES = [
    'Coastline_1_LowerRight',  // SE
    'Coastline_0_UpperRight',  // NE
    'Coastline_5_Top',         // N
    'Coastline_4_UpperLeft',   // NW
    'Coastline_3_LowerLeft',   // SW
    'Coastline_2_Bottom',      // S
  ];
  const OPPOSITE = { N: 'S', S: 'N', NE: 'SW', SW: 'NE', SE: 'NW', NW: 'SE' };

  const _sprites = {};

  function loadSprites() {
    return Promise.all(SPRITE_NAMES.map((name, i) =>
      new Promise(resolve => {
        const img = new Image();
        img.onload  = () => { _sprites[i] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = 'packages/postapoc/sprites/terrain/coastline/' + name + '.png';
      })
    ));
  }

  // Mirrors CoastlineEdgeDetector.RiverFacesWater, but works directly in
  // compass-label space (edgeFaces are already 'N'/'SW'/etc. strings here,
  // unlike the C# side which only has raw neighbor offsets to compare) —
  // no even-column dx/dy normalization needed.
  // Returns true when the river's water channel faces the water cell
  // (coastline should be suppressed), false when its bank/land side faces
  // the water cell (coastline should show normally).
  function _riverFacesWater(riverEntry, dirFromWaterToRiver) {
    const faces = Array.isArray(riverEntry?.edgeFaces) ? riverEntry.edgeFaces : [];
    if (faces.length === 0) return true; // no data: suppress, matches C# backward-compat fallback
    return faces.includes(OPPOSITE[dirFromWaterToRiver]);
  }

  // Returns a 6-element boolean array, index order = FACE_NAMES, true where
  // a coastline sprite should be drawn facing that neighbor direction.
  // Only Water-type cells (not Rivers, not Ground) ever get edges.
  function computeEdges(col, row) {
    const edges = new Array(6).fill(false);
    const entry = Terrain.byHexId(mapData[row * MAP_WIDTH + col]);
    if (!entry || entry.type !== 'Water') return edges;

    const dirs = (MAP_HEIGHT - 1 - row) % 2 !== 0 ? _DIRS_EVEN : _DIRS_ODD;
    FACE_NAMES.forEach((dirName, i) => {
      const [dc, dr] = dirs[dirName];
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nc >= MAP_WIDTH || nr < 0 || nr >= MAP_HEIGHT) return;
      const nEntry = Terrain.byHexId(mapData[nr * MAP_WIDTH + nc]);
      if (!nEntry) return;
      if (nEntry.type === 'Rivers') {
        if (!_riverFacesWater(nEntry, dirName)) edges[i] = true;
        return;
      }
      if (nEntry.type === 'Water') return;
      edges[i] = true; // any other terrain (Ground, etc.) → show the edge
    });
    return edges;
  }

  // Draws whichever of the 6 direction sprites are set in `edges`, unclipped,
  // at the tile's own bounding box — matches Unity placing one SpriteRenderer
  // per active edge at the tile's world position, no per-edge geometry clip.
  function drawOverlay(ctx, cx, cy, radius, edges) {
    for (let i = 0; i < 6; i++) {
      if (!edges[i]) continue;
      const sprite = _sprites[i];
      if (!sprite || !sprite.complete || !sprite.naturalWidth) continue;
      ctx.drawImage(sprite, cx - radius, cy - radius, radius * 2, radius * 2);
    }
  }

  return { loadSprites, computeEdges, drawOverlay };
})();
```

- [ ] **Step 2: Load the sprites at startup**

Modify `MapEditorPro.html:12550` — add the load call next to `Roads.loadSprites();`:

```js
  Roads.loadSprites();
  Coastline.loadSprites();
```

- [ ] **Step 3: Manually verify sprite loading and edge computation via the browser console**

Run: `cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && python3 -m http.server 8000`
Open `http://localhost:8000/MapEditorPro.html` in a browser, open devtools console, and run:

```js
Coastline.computeEdges(0, 0)
```

Expected: returns an array of 6 `false`/`true` values without throwing (cell 0,0 may or may not be Water depending on the current map — either result is fine, the check is that it runs and returns a 6-element boolean array). Then find a coastal Water cell by eye (use the Eyedropper tool or `Select Tile` to confirm a cell's terrain is `Water`), note its col/row from the status bar, and run `Coastline.computeEdges(col, row)` for that cell — expect at least one `true` in the array since it borders land.

- [ ] **Step 4: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(coastline): add Coastline module — edge detection, sprite load, draw"
```

---

### Task 3: Wire the coastline overlay into rendering, add the toggle button

**Files:**
- Modify: `MapEditorPro.html:2643` (Canvas module state, next to `_showZones`)
- Modify: `MapEditorPro.html:2748` (Canvas module `render()` main draw loop)
- Modify: `MapEditorPro.html:3780-3792` (Canvas module `return {}` block, next to `toggleRulers`)
- Modify: `MapEditorPro.html:1342` (toolbar HTML, next to the Rulers toggle button)

**Interfaces:**
- Consumes: `Coastline.computeEdges(col, row) -> boolean[6]`, `Coastline.drawOverlay(ctx, cx, cy, radius, edges)` (from Task 2).
- Produces: `Canvas.toggleCoastline()`, exposed on `window` via the existing `onclick="Canvas.X()"` pattern; button `#btn-toggle-coastline`.

- [ ] **Step 1: Add the visibility flag**

Modify `MapEditorPro.html:2643` — add next to the existing `_showZones` declaration:

```js
  let _showZones = false;
  let _showCoastline = true;
```

- [ ] **Step 2: Draw the overlay in the main render loop**

Modify `MapEditorPro.html` at the loop body around line 2744-2751 — currently:

```js
        const _hid = mapData[row * MAP_WIDTH + col];
        _drawHexTile(s.x, s.y, radius, _hid, col, row);
        const _he = Terrain.byHexId(_hid);
        if (Array.isArray(_he?.occupiedOffsets) && _he.occupiedOffsets.length > 0)
          _anchorPass.push({ cx: s.x, cy: s.y, col, row, entry: _he });
```

Change to:

```js
        const _hid = mapData[row * MAP_WIDTH + col];
        _drawHexTile(s.x, s.y, radius, _hid, col, row);
        const _he = Terrain.byHexId(_hid);
        if (Array.isArray(_he?.occupiedOffsets) && _he.occupiedOffsets.length > 0)
          _anchorPass.push({ cx: s.x, cy: s.y, col, row, entry: _he });
        if (_showCoastline && _he && _he.type === 'Water') {
          const _edges = Coastline.computeEdges(col, row);
          if (_edges.some(Boolean)) Coastline.drawOverlay(ctx, s.x, s.y, radius, _edges);
        }
```

- [ ] **Step 3: Add the toggle function**

Modify `MapEditorPro.html:3780-3792` — the `return { ... }` block currently ends with `toggleRulers`; add `toggleCoastline` alongside it:

```js
  return {
    init, render, drawMinimap, forceRedraw,
    hexCenterWorld, hexScreenPos, hexClipPath, screenToHex,
    clampCamera, setZoom, zoomIn, zoomOut, centerOnCity, fitToScreen,
    setMouseCallbacks, getCtx, getZoom, getCamera,
    toggleZones, hexDist, setSelectedSlot,
    jumpToBlock,
    selectTile, clearSelection, applyTileInspectorUnder, clearTileInspectorUnder,
    toggleRulers: () => {
      _showRulers = !_showRulers;
      const btn = document.getElementById('btn-toggle-rulers');
      if (btn) btn.style.opacity = _showRulers ? '1' : '0.4';
      render();
    },
    toggleCoastline: () => {
      _showCoastline = !_showCoastline;
      const btn = document.getElementById('btn-toggle-coastline');
      if (btn) btn.style.opacity = _showCoastline ? '1' : '0.4';
      render();
    }
  };
```

- [ ] **Step 4: Add the toolbar button**

Modify `MapEditorPro.html:1342` — add right after the Rulers button:

```html
      <button id="btn-toggle-rulers" class="hexdb-tool-btn" onclick="Canvas.toggleRulers()" title="Show/hide block rulers and grid">⊞ Rulers</button>
      <button id="btn-toggle-coastline" class="hexdb-tool-btn" onclick="Canvas.toggleCoastline()" title="Show/hide coastline preview along water/land borders">🌊 Coastline</button>
```

- [ ] **Step 5: Manually verify in the browser**

With the local server still running (`http://localhost:8000/MapEditorPro.html`), open or generate a map that has both land and water adjacent (e.g. use the existing Generator with any preset, since coastline already exists in every generated map). Confirm:
1. On load, water cells bordering land show a coastline decoration along the land-facing edge(s).
2. Clicking "🌊 Coastline" dims the button (opacity 0.4) and immediately removes all coastline decoration from the canvas.
3. Clicking it again restores full opacity and redraws the decoration.
4. Paint a new Water tile next to existing land with the Paint tool — confirm the coastline decoration appears on it immediately without needing to toggle or reload.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(coastline): render coastline overlay in editor, add toggle button"
```

---

### Task 4: Coastline shape sliders in the Generator modal

**Files:**
- Modify: `MapEditorPro.html:2168-2169` (Generator modal HTML — new "Coastline" section)
- Modify: `MapEditorPro.html:6807-6823` (`Generator._getParams()`)
- Modify: `MapEditorPro.html:6875-6878` (`Generator._generateInto()` — coastline mask constants)
- Modify: `MapEditorPro.html:7006-7011` (`Generator._updateLabels()`)

**Interfaces:**
- Produces: `p.coastR`, `p.coastWobble`, `p.coastBand` on the object returned by `Generator._getParams()`, consumed inside `_generateInto` in the same task.

- [ ] **Step 1: Add the 3 sliders to the modal**

Modify `MapEditorPro.html` — insert between line 2168 (`</div>` closing the "Water" threshold row) and line 2169 (`<!-- Features -->`):

```html
        </div>
        <!-- Coastline -->
        <div class="gen-section">Coastline</div>
        <div class="gen-row">
          <label>Coast Radius</label>
          <input id="gen-coastR" type="range" min="0.50" max="0.95" step="0.01" value="0.72"
                 oninput="Generator.schedule()">
          <span id="gen-coastR-v" class="gen-val">0.72</span>
        </div>
        <div class="gen-row">
          <label>Coast Wobble</label>
          <input id="gen-coastWobble" type="range" min="0.00" max="0.60" step="0.01" value="0.28"
                 oninput="Generator.schedule()">
          <span id="gen-coastWobble-v" class="gen-val">0.28</span>
        </div>
        <div class="gen-row">
          <label>Coast Band</label>
          <input id="gen-coastBand" type="range" min="0.05" max="0.35" step="0.01" value="0.20"
                 oninput="Generator.schedule()">
          <span id="gen-coastBand-v" class="gen-val">0.20</span>
        </div>
        <!-- Features -->
```

(The leading `</div>` above is the existing line 2168, shown for placement context — do not duplicate it.)

- [ ] **Step 2: Read the new sliders in `_getParams()`**

Modify `MapEditorPro.html:6807-6823` — add before the closing brace:

```js
  function _getParams() {
    return {
      seed:       parseInt(document.getElementById('gen-seed').value)       || 42,
      elevScale:  parseFloat(document.getElementById('gen-elevScale').value),
      moistScale: parseFloat(document.getElementById('gen-moistScale').value),
      biomeScale: parseFloat(document.getElementById('gen-biomeScale').value),
      mThr:       parseFloat(document.getElementById('gen-mountain').value),
      hThr:       parseFloat(document.getElementById('gen-hill').value),
      wThr:       parseFloat(document.getElementById('gen-water').value),
      coastR:       parseFloat(document.getElementById('gen-coastR').value),
      coastWobble:  parseFloat(document.getElementById('gen-coastWobble').value),
      coastBand:    parseFloat(document.getElementById('gen-coastBand').value),
      rivers:     parseInt(document.getElementById('gen-rivers').value),
      gold:       document.getElementById('gen-gold').checked,
      goldCount:  parseInt(document.getElementById('gen-goldCount').value),
      oil:        document.getElementById('gen-oil').checked,
      oilCount:   parseInt(document.getElementById('gen-oilCount').value),
      debug:      document.getElementById('gen-debug').checked,
    };
  }
```

- [ ] **Step 3: Use the params instead of hardcoded constants**

Modify `MapEditorPro.html` inside `_generateInto` — currently:

```js
    const COAST_BASE_R  = maxR * 0.72;   // average landmass radius
    const COAST_WOBBLE   = 0.28;          // +/- fraction of COAST_BASE_R the coastline wobbles by
    const COAST_BAND     = maxR * 0.20;   // width of the land->ocean blend band
```

Change to:

```js
    const COAST_BASE_R  = maxR * p.coastR;      // average landmass radius
    const COAST_WOBBLE   = p.coastWobble;        // +/- fraction of COAST_BASE_R the coastline wobbles by
    const COAST_BAND     = maxR * p.coastBand;   // width of the land->ocean blend band
```

- [ ] **Step 4: Update the live label text under the sliders**

Modify `MapEditorPro.html:7006-7011` — add the 3 new ids to the decimal-places list:

```js
  function _updateLabels() {
    [['gen-elevScale',3],['gen-moistScale',3],['gen-biomeScale',3],
     ['gen-mountain',2],['gen-hill',2],['gen-water',2],
     ['gen-coastR',2],['gen-coastWobble',2],['gen-coastBand',2]].forEach(([id, dp]) => {
      const v = document.getElementById(id + '-v');
      if (v) v.textContent = parseFloat(document.getElementById(id).value).toFixed(dp);
    });
    ['gen-rivers','gen-goldCount','gen-oilCount'].forEach(id => {
      const v = document.getElementById(id + '-v');
      if (v) v.textContent = document.getElementById(id).value;
    });
  }
```

- [ ] **Step 5: Manually verify in the browser**

With the local server running, open the editor, open "🎲 Procedural Generator" (Generate menu). Confirm:
1. A new "Coastline" section with 3 sliders appears between "Thresholds" and "Features", each starting at 0.72 / 0.28 / 0.20 and showing that value next to the slider.
2. Dragging "Coast Radius" left/right visibly shrinks/grows the landmass in the preview canvas.
3. Dragging "Coast Wobble" to 0 makes the coastline a near-perfect circle in the preview; dragging it up makes it visibly more irregular.
4. Dragging "Coast Band" changes how gradual the land→ocean transition looks in the preview.
5. Click a preset button (e.g. "🏚️ Wasteland") — confirm the 3 coastline sliders keep their current values (presets don't reset them, since `GEN_PRESETS` entries carry no coastline fields).
6. Click "▶ Generate" with default coastline values (0.72/0.28/0.20) on the "Wasteland" preset with a fixed seed, and confirm the resulting map's landmass shape looks the same as it did before this change (regression check for the default-matches-hardcoded-value requirement).

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(generator): expose coastline radius/wobble/band as sliders"
```

---

### Task 5: Cross-check editor preview against Unity, fix direction mapping if needed

**Files:**
- Modify (only if a mismatch is found): `MapEditorPro.html` — the `SPRITE_NAMES` array inside the `Coastline` module added in Task 2.

**Interfaces:**
- Consumes: `Coastline.SPRITE_NAMES` (module-internal array from Task 2) — this task may reorder its 6 entries; no other module reads it.

- [ ] **Step 1: Generate and export a map with a clear coastline**

In the web editor (local server running), open the Generator, set Coast Wobble to 0 (for an easy-to-reason-about circular coastline) and any preset, click Generate, then export via `File → Save Map` (or the existing map save flow) to a JSON file.

- [ ] **Step 2: Import the map into Unity and enter Play mode**

Use the existing Unity map import flow (`PostApoc → Map Tools → Import Map from Excel`, or whichever current import menu path the project uses) to load the exported JSON, then enter Play mode and reveal a coastal area (use the existing debug reveal-all if available, matching what `CoastlineManager`'s `PopulateCoastlines` comment describes).

- [ ] **Step 3: Compare a handful of coastal cells side by side**

Pick 3-4 coastal cells at different positions around the landmass (e.g. due north, due south, due east, due west of the map center) and compare the coastline sprite orientation shown in the web editor against the same cell in Unity Play mode. For each cell, confirm the coastline decoration faces the same real-world direction (toward open water, away from land) in both.

- [ ] **Step 4a: If all sampled cells match — no code change needed**

Note the confirmation in the commit message for Step 5 below (nothing to fix).

- [ ] **Step 4b: If any cell's sprite orientation is rotated/mirrored relative to Unity**

Edit the `SPRITE_NAMES` array inside the `Coastline` module (`MapEditorPro.html`, from Task 2) to rotate the mapping — for example, if every sprite appears rotated one position clockwise relative to Unity, shift the array by one position:

```js
  const SPRITE_NAMES = [
    'Coastline_0_UpperRight',  // SE  (was 'Coastline_1_LowerRight')
    'Coastline_5_Top',         // NE  (was 'Coastline_0_UpperRight')
    'Coastline_4_UpperLeft',   // N   (was 'Coastline_5_Top')
    'Coastline_3_LowerLeft',   // NW  (was 'Coastline_4_UpperLeft')
    'Coastline_2_Bottom',      // SW  (was 'Coastline_3_LowerLeft')
    'Coastline_1_LowerRight',  // S   (was 'Coastline_2_Bottom')
  ];
```

(The exact rotation/mirror to apply depends on what Step 3 actually observes — this is illustrative of the fix shape, not a prediction of which direction it'll be. Re-run Step 3 after any change until all sampled cells match.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "fix(coastline): verify editor/Unity direction mapping against Play mode"
```

(If Step 4a applied and no file changed, skip this commit — there's nothing to commit.)

---

## Self-Review Notes

- **Spec coverage:** Part A (coastline sliders) → Task 4. Part B (editor coastline overlay: assets, edge detection, render hook, toggle) → Tasks 1-3. The spec's explicit direction-mapping risk → Task 5. All spec sections have a corresponding task.
- **Type/interface consistency:** `Coastline.computeEdges(col, row)` returns the same `boolean[6]` shape consumed by `Coastline.drawOverlay` in both its Task 2 verification and its Task 3 render-loop usage. `_getParams()`'s new `coastR`/`coastWobble`/`coastBand` names match exactly what Task 4 Step 3 reads off `p`.
- **No placeholders:** every step includes the literal code to write or the literal command to run and its expected output.
