# Zone Painter with Biome Presets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zone-painting + biome-fill system to MapEditorPro.html that lets users define broad map regions and fill them with organically mixed terrain and distributed settlements in 3 clicks.

**Architecture:** New `zone-painter.js` module holds all zone logic (data, noise, fill engine, Poisson disk) and exposes a `ZonePainter` global. `MapEditorPro.html` is modified to load this file, wire the Zone tool into the existing Tools/Canvas/IO modules, and add zone UI to the left panel and right panel. The existing map data (`mapData`, `settlements`) are modified in place by the fill engine — no new storage required for runtime.

**Tech Stack:** Vanilla JS (ES2020), no build step, browser canvas rendering. Terrain IDs from `Terrain.DATA` in `MapEditorPro.html` (id 0–28). Perlin gradient noise implemented from scratch. Poisson disk via Bridson's algorithm.

---

## Terrain ID Reference (from `Terrain.DATA` line 1318)

```
Water:   0=DirtyWater  1=DirtyWater_1  2=DirtyWater_2  3=River_1 … 8=River_6
Rubble:  9=Rubble_1   10=Rubble_2     11=Rubble_3
Plains: 12=Plain_1    13=Plain_2      14=BrokenPlain(fallback)
Forest: 15=Forest_1   16=Forest_2     17=Forest_3
Rocky:  18=Hills      19=Mountain
Res:    20=GoldVein   21=Oil(fallback)
Barren: 22=Barren     23=Desert
Swamp:  24=Swamp      25=RockySwamp(fallback)
Lava:   26=LavaPlain(fallback)  27=LavaRift(fallback)  28=Rift
```

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `zone-painter.js` | **Create** | ZonePainter module: zone layer, biome presets, noise, fill engine, Poisson disk |
| `MapEditorPro.html` | **Modify** | Load zone-painter.js; add Zone tool; zone overlay rendering; zone palette; right panel config; save/load |

---

## Task 1: zone-painter.js — Core data, Perlin noise, biome presets

**Files:**
- Create: `zone-painter.js`

- [ ] **Step 1: Create zone-painter.js with Perlin noise**

```javascript
// zone-painter.js
// Depends on globals: MAP_WIDTH, MAP_HEIGHT (set before DOMContentLoaded)

const ZonePainter = (() => {

  // ── Perlin noise ─────────────────────────────────────────────────────────
  function _buildPerm(seed) {
    const p = Array.from({length: 256}, (_, i) => i);
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    return perm;
  }

  function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function _lerp(t, a, b) { return a + t * (b - a); }
  function _grad(hash, x, y) {
    const h = hash & 3;
    return ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  }

  function perlinNoise(x, y, perm) {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x),   yf = y - Math.floor(y);
    const u = _fade(xf), v = _fade(yf);
    const aa = perm[perm[xi]     + yi],     ab = perm[perm[xi]     + yi + 1];
    const ba = perm[perm[xi + 1] + yi],     bb = perm[perm[xi + 1] + yi + 1];
    const x1 = _lerp(u, _grad(aa, xf, yf),     _grad(ba, xf - 1, yf));
    const x2 = _lerp(u, _grad(ab, xf, yf - 1), _grad(bb, xf - 1, yf - 1));
    return (_lerp(v, x1, x2) + 1) / 2; // [0, 1]
  }

  // ── Built-in biome presets ────────────────────────────────────────────────
  const BUILTIN_PRESETS = [
    {
      id: 'forest_edge', name: 'Forest Edge',
      terrainWeights: {15: 0.40, 16: 0.20, 12: 0.30, 13: 0.10},
      patchScale: 8, patchContrast: 1.5,
      blendWidth: 8, blendMode: 'noisy',
      settlementDensity: 'medium', settlementMinSpacing: 15,
      forbiddenTerrain: [0,1,2,3,4,5,6,7,8,18,19,26,27,28]
    },
    {
      id: 'deep_wasteland', name: 'Deep Wasteland',
      terrainWeights: {9: 0.40, 22: 0.40, 12: 0.20},
      patchScale: 12, patchContrast: 2.0,
      blendWidth: 6, blendMode: 'hard',
      settlementDensity: 'sparse', settlementMinSpacing: 25,
      forbiddenTerrain: [0,1,2,3,4,5,6,7,8,18,19,26,27,28]
    },
    {
      id: 'river_valley', name: 'River Valley',
      terrainWeights: {12: 0.50, 3: 0.10, 0: 0.20, 24: 0.20},
      patchScale: 6, patchContrast: 1.2,
      blendWidth: 10, blendMode: 'smooth',
      settlementDensity: 'dense', settlementMinSpacing: 10,
      forbiddenTerrain: [0,1,2,3,4,5,6,7,8,18,19,26,27,28]
    },
    {
      id: 'mountain_rim', name: 'Mountain Rim',
      terrainWeights: {19: 0.50, 18: 0.30, 9: 0.20},
      patchScale: 10, patchContrast: 2.0,
      blendWidth: 5, blendMode: 'hard',
      settlementDensity: 'none', settlementMinSpacing: 30,
      forbiddenTerrain: [0,1,2,3,4,5,6,7,8,18,19,26,27,28]
    },
    {
      id: 'ash_plains', name: 'Ash Plains',
      terrainWeights: {22: 0.50, 28: 0.30, 9: 0.20},
      patchScale: 5, patchContrast: 1.8,
      blendWidth: 7, blendMode: 'noisy',
      settlementDensity: 'none', settlementMinSpacing: 30,
      forbiddenTerrain: [0,1,2,3,4,5,6,7,8,15,16,17,18,19,26,27,28]
    },
    {
      id: 'marshland', name: 'Marshland',
      terrainWeights: {24: 0.50, 0: 0.30, 12: 0.20},
      patchScale: 9, patchContrast: 1.3,
      blendWidth: 9, blendMode: 'smooth',
      settlementDensity: 'sparse', settlementMinSpacing: 20,
      forbiddenTerrain: [0,1,2,3,4,5,6,7,8,18,19,26,27,28]
    },
    {
      id: 'ruined_district', name: 'Ruined District',
      terrainWeights: {9: 0.30, 10: 0.20, 12: 0.30, 22: 0.20},
      patchScale: 4, patchContrast: 1.6,
      blendWidth: 6, blendMode: 'noisy',
      settlementDensity: 'dense', settlementMinSpacing: 8,
      forbiddenTerrain: [0,1,2,3,4,5,6,7,8,18,19,26,27,28]
    }
  ];

  const DENSITY_FACTORS = {none: 0, sparse: 0.002, medium: 0.005, dense: 0.010};

  // ── Zone state ────────────────────────────────────────────────────────────
  let _zoneLayer    = null; // Uint8Array(MAP_WIDTH * MAP_HEIGHT), 0 = no zone
  let _zones        = [];   // [{id, name, color, presetId}]
  let _presets      = [];   // user presets + builtins merged
  let _nextZoneId   = 1;
  let _showOverlay  = true;
  let _selectedZoneId = 0; // which zone is active in palette

  function init() {
    const w = typeof MAP_WIDTH  !== 'undefined' ? MAP_WIDTH  : 450;
    const h = typeof MAP_HEIGHT !== 'undefined' ? MAP_HEIGHT : 450;
    _zoneLayer = new Uint8Array(w * h);
    _presets   = BUILTIN_PRESETS.map(p => Object.assign({}, p));
  }

  function getZoneLayer()     { return _zoneLayer; }
  function getZones()         { return _zones; }
  function getPresets()       { return _presets; }
  function getSelectedZoneId(){ return _selectedZoneId; }
  function setSelectedZoneId(id){ _selectedZoneId = id; }
  function isOverlayVisible() { return _showOverlay; }
  function toggleOverlay()    { _showOverlay = !_showOverlay; }

  function getPreset(id) {
    return _presets.find(p => p.id === id) || null;
  }

  function addZone(name, color) {
    const id = _nextZoneId++;
    _zones.push({id, name: name || `Zone ${id}`, color: color || _defaultColor(id), presetId: BUILTIN_PRESETS[0].id});
    return id;
  }

  function removeZone(id) {
    _zones = _zones.filter(z => z.id !== id);
    const w = typeof MAP_WIDTH !== 'undefined' ? MAP_WIDTH : 450;
    const h = typeof MAP_HEIGHT !== 'undefined' ? MAP_HEIGHT : 450;
    for (let i = 0; i < w * h; i++) if (_zoneLayer[i] === id) _zoneLayer[i] = 0;
  }

  function clearZoneLayer() {
    _zoneLayer.fill(0);
  }

  function savePreset(preset) {
    const existing = _presets.findIndex(p => p.id === preset.id);
    if (existing >= 0) _presets[existing] = Object.assign({}, preset);
    else _presets.push(Object.assign({}, preset));
  }

  const _ZONE_COLORS = ['#4a8a4a','#8a6a2a','#2a5a8a','#7a3a3a','#5a2a7a','#2a7a6a','#7a5a2a','#3a3a8a'];
  function _defaultColor(id) { return _ZONE_COLORS[(id - 1) % _ZONE_COLORS.length]; }

  // ── Save / Load ───────────────────────────────────────────────────────────
  function toSaveObject() {
    const w = typeof MAP_WIDTH !== 'undefined' ? MAP_WIDTH : 450;
    const h = typeof MAP_HEIGHT !== 'undefined' ? MAP_HEIGHT : 450;
    // base64-encode zoneLayer
    let binary = '';
    for (let i = 0; i < w * h; i++) binary += String.fromCharCode(_zoneLayer[i]);
    const zoneMap = btoa(binary);
    const userPresets = _presets.filter(p => !BUILTIN_PRESETS.find(b => b.id === p.id));
    return {zones: _zones, zoneMap, biomePresets: userPresets, _nextZoneId};
  }

  function fromSaveObject(obj) {
    if (!obj) return;
    const w = typeof MAP_WIDTH !== 'undefined' ? MAP_WIDTH : 450;
    const h = typeof MAP_HEIGHT !== 'undefined' ? MAP_HEIGHT : 450;
    _zones = obj.zones || [];
    _nextZoneId = obj._nextZoneId || (_zones.reduce((m, z) => Math.max(m, z.id), 0) + 1);
    _presets = BUILTIN_PRESETS.map(p => Object.assign({}, p));
    (obj.biomePresets || []).forEach(p => _presets.push(Object.assign({}, p)));
    if (obj.zoneMap) {
      const bin = atob(obj.zoneMap);
      for (let i = 0; i < Math.min(bin.length, w * h); i++)
        _zoneLayer[i] = bin.charCodeAt(i);
    }
  }

  return {
    init, perlinNoise, _buildPerm,
    getZoneLayer, getZones, getPresets, getPreset,
    getSelectedZoneId, setSelectedZoneId,
    isOverlayVisible, toggleOverlay,
    addZone, removeZone, clearZoneLayer,
    savePreset, toSaveObject, fromSaveObject,
    BUILTIN_PRESETS, DENSITY_FACTORS
  };
})();
```

- [ ] **Step 2: Write browser-console tests for noise and data model**

Open `MapEditorPro.html` in browser, open DevTools console, paste and run:

```javascript
// Test 1: noise returns values in [0, 1]
const perm = ZonePainter._buildPerm(42);
for (let i = 0; i < 100; i++) {
  const v = ZonePainter.perlinNoise(Math.random()*10, Math.random()*10, perm);
  console.assert(v >= 0 && v <= 1, `noise out of range: ${v}`);
}
console.log('✓ noise range');

// Test 2: same seed produces same noise
const p1 = ZonePainter._buildPerm(99), p2 = ZonePainter._buildPerm(99);
console.assert(ZonePainter.perlinNoise(1.5, 2.3, p1) === ZonePainter.perlinNoise(1.5, 2.3, p2), 'noise not deterministic');
console.log('✓ noise deterministic');

// Test 3: addZone / removeZone
ZonePainter.init();
const id = ZonePainter.addZone('Test', '#ff0000');
console.assert(ZonePainter.getZones().length === 1, 'zone not added');
ZonePainter.removeZone(id);
console.assert(ZonePainter.getZones().length === 0, 'zone not removed');
console.log('✓ zone add/remove');

// Test 4: save/load roundtrip
ZonePainter.init();
ZonePainter.addZone('Forest', '#4a8a4a');
ZonePainter.getZoneLayer()[100] = 1;
const saved = ZonePainter.toSaveObject();
ZonePainter.init();
ZonePainter.fromSaveObject(saved);
console.assert(ZonePainter.getZones().length === 1, 'zones not restored');
console.assert(ZonePainter.getZoneLayer()[100] === 1, 'zoneLayer not restored');
console.log('✓ save/load roundtrip');
```

Expected: four `✓` lines, no assertion errors.

- [ ] **Step 3: Load zone-painter.js in MapEditorPro.html**

In `MapEditorPro.html`, find the closing `</head>` tag and add before it:

```html
<script src="zone-painter.js"></script>
```

- [ ] **Step 4: Call ZonePainter.init() on startup**

In `MapEditorPro.html`, find the `DOMContentLoaded` handler (search for `document.addEventListener('DOMContentLoaded'`) and add `ZonePainter.init();` as the first line inside it.

- [ ] **Step 5: Commit**

```bash
git add zone-painter.js MapEditorPro.html
git commit -m "feat: add ZonePainter module with Perlin noise and biome presets"
```

---

## Task 2: Fill Engine — Terrain (noise + border blending)

**Files:**
- Modify: `zone-painter.js` (add `fillZoneTerrain` and `buildDistanceMap`)

- [ ] **Step 1: Add distance map builder and terrain fill to zone-painter.js**

Add these functions inside the `ZonePainter` IIFE before the `return` statement:

```javascript
  // Builds a Float32Array of each tile's distance to the nearest tile NOT in zoneId.
  // distance = 0 means the tile is at the border; large = deep interior.
  function buildDistanceMap(zoneId) {
    const w = MAP_WIDTH, h = MAP_HEIGHT;
    const dist = new Float32Array(w * h).fill(Infinity);
    const queue = [];
    // Seed: find all tiles in zone that have a non-zone neighbour
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (_zoneLayer[i] !== zoneId) continue;
        const nbrs = [[col-1,row],[col+1,row],[col,row-1],[col,row+1]];
        for (const [nc,nr] of nbrs) {
          if (nc < 0 || nc >= w || nr < 0 || nr >= h) { queue.push(i); dist[i] = 0; break; }
          if (_zoneLayer[nr * w + nc] !== zoneId) { queue.push(i); dist[i] = 0; break; }
        }
      }
    }
    // BFS to flood distances inward
    let qi = 0;
    while (qi < queue.length) {
      const i = queue[qi++];
      const col = i % w, row = Math.floor(i / w);
      for (const [dc,dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nc = col+dc, nr = row+dr, ni = nr*w+nc;
        if (nc<0||nc>=w||nr<0||nr>=h) continue;
        if (_zoneLayer[ni] !== zoneId) continue;
        if (dist[ni] > dist[i] + 1) { dist[ni] = dist[i] + 1; queue.push(ni); }
      }
    }
    return dist;
  }

  // Maps noise value [0,1] to a terrain ID using preset's terrainWeights.
  function _noiseToTerrain(noise, preset) {
    const entries = Object.entries(preset.terrainWeights)
      .sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]));
    let cum = 0;
    for (const [idStr, weight] of entries) {
      cum += weight;
      if (noise <= cum) return parseInt(idStr);
    }
    return parseInt(entries[entries.length - 1][0]);
  }

  // Fills terrain for all tiles in zoneId using preset's noise parameters.
  // noiseOffset is added to tile coordinates to vary noise per zone.
  function fillZoneTerrain(zoneId, mapData) {
    const zone = _zones.find(z => z.id === zoneId);
    if (!zone) return;
    const preset = getPreset(zone.presetId);
    if (!preset) return;

    const w = MAP_WIDTH, h = MAP_HEIGHT;
    const perm = _buildPerm(zoneId * 997 + 1);   // deterministic per zone
    const noisePerm = _buildPerm(zoneId * 997 + 2);
    const dist = buildDistanceMap(zoneId);
    const bw = preset.blendWidth;

    // Collect neighbouring zone IDs for border blending
    const neighbourZones = new Set();
    for (let i = 0; i < w * h; i++) {
      if (dist[i] === 0 && _zoneLayer[i] === zoneId) {
        const col = i % w, row = Math.floor(i / w);
        for (const [dc,dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nc = col+dc, nr = row+dr;
          if (nc<0||nc>=w||nr<0||nr>=h) continue;
          const nz = _zoneLayer[nr*w+nc];
          if (nz !== 0 && nz !== zoneId) neighbourZones.add(nz);
        }
      }
    }

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (_zoneLayer[i] !== zoneId) continue;

        const noise = perlinNoise(col / preset.patchScale, row / preset.patchScale, perm);
        // Apply contrast: shift noise toward 0 or 1 based on patchContrast
        const contrast = preset.patchContrast || 1;
        const n = Math.max(0, Math.min(1, (noise - 0.5) * contrast + 0.5));
        let terrainId = _noiseToTerrain(n, preset);

        // Border blending
        if (bw > 0 && dist[i] < bw && neighbourZones.size > 0) {
          let t = 1 - dist[i] / bw; // 1 = border, 0 = interior
          if (preset.blendMode === 'noisy') {
            const jitter = perlinNoise(col / 3, row / 3, noisePerm) - 0.5;
            t = Math.max(0, Math.min(1, t + jitter * 0.6));
          } else if (preset.blendMode === 'hard') {
            t = t > 0.5 ? 1 : 0;
          }
          // Blend: t chance to use a neighbour zone's terrain
          if (Math.random() < t) {
            const nzId = [...neighbourZones][Math.floor(Math.random() * neighbourZones.size)];
            const nzone = _zones.find(z => z.id === nzId);
            if (nzone) {
              const np = getPreset(nzone.presetId);
              if (np) {
                const nn = perlinNoise(col / np.patchScale, row / np.patchScale, perm);
                const nn2 = Math.max(0, Math.min(1, (nn - 0.5) * (np.patchContrast||1) + 0.5));
                terrainId = _noiseToTerrain(nn2, np);
              }
            }
          }
        }

        mapData[i] = terrainId;
      }
    }
  }
```

Then add to the `return` statement:
```javascript
  return {
    // ... existing exports ...
    buildDistanceMap, fillZoneTerrain,
  };
```

- [ ] **Step 2: Write browser-console tests for fill engine**

```javascript
// Test: fillZoneTerrain fills only zone tiles
ZonePainter.init();
const mapTest = new Int8Array(MAP_WIDTH * MAP_HEIGHT).fill(12); // all Plain_1
ZonePainter.addZone('TestForest', '#4a8a4a');
// Paint a 10x10 block as zone 1
for (let r=10; r<20; r++)
  for (let c=10; c<20; c++)
    ZonePainter.getZoneLayer()[r*MAP_WIDTH+c] = 1;
ZonePainter.fillZoneTerrain(1, mapTest);
// Check: tiles in zone changed from 12
let changed = 0;
for (let r=10; r<20; r++)
  for (let c=10; c<20; c++)
    if (mapTest[r*MAP_WIDTH+c] !== 12) changed++;
console.assert(changed > 50, `only ${changed}/100 tiles changed`);
// Check: tiles outside zone untouched
console.assert(mapTest[0] === 12, 'tile outside zone was modified');
console.log(`✓ fill engine: ${changed}/100 tiles filled`);
```

Expected: `✓ fill engine: XX/100 tiles filled` where XX > 50.

- [ ] **Step 3: Commit**

```bash
git add zone-painter.js
git commit -m "feat: add fill engine with noise terrain and border blending"
```

---

## Task 3: Fill Engine — Settlement Distribution (Poisson disk)

**Files:**
- Modify: `zone-painter.js` (add `fillZoneSettlements`)

- [ ] **Step 1: Add Poisson disk sampling to zone-painter.js**

Add inside the `ZonePainter` IIFE before the `return`:

```javascript
  // Bridson's Poisson disk sampling constrained to a set of valid (col, row) tiles.
  // tileset: Array of [col, row]. minDist: minimum distance in tiles.
  // Returns array of [col, row] points.
  function poissonDiskSample(tileset, minDist) {
    if (tileset.length === 0) return [];
    const cellSize = minDist / Math.SQRT2;
    const grid = new Map(); // "col_row" -> [col, row]
    const result = [];
    const active = [];

    function gridKey(col, row) {
      return `${Math.floor(col/cellSize)}_${Math.floor(row/cellSize)}`;
    }
    function tooClose(col, row) {
      const gc = Math.floor(col/cellSize), gr = Math.floor(row/cellSize);
      for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) {
        const p = grid.get(`${gc+dc}_${gr+dr}`);
        if (p && Math.hypot(p[0]-col, p[1]-row) < minDist) return true;
      }
      return false;
    }

    const tileSet = new Set(tileset.map(([c,r]) => `${c}_${r}`));
    function isValid(col, row) { return tileSet.has(`${col}_${row}`); }

    // Start with random tile from tileset
    const start = tileset[Math.floor(Math.random() * tileset.length)];
    result.push(start); active.push(start); grid.set(gridKey(...start), start);

    while (active.length > 0) {
      const idx = Math.floor(Math.random() * active.length);
      const [ac, ar] = active[idx];
      let found = false;
      for (let k = 0; k < 30; k++) {
        const angle = Math.random() * 2 * Math.PI;
        const r = minDist + Math.random() * minDist;
        const nc = Math.round(ac + Math.cos(angle) * r);
        const nr = Math.round(ar + Math.sin(angle) * r);
        if (isValid(nc, nr) && !tooClose(nc, nr)) {
          const p = [nc, nr];
          result.push(p); active.push(p); grid.set(gridKey(nc, nr), p);
          found = true;
          break;
        }
      }
      if (!found) active.splice(idx, 1);
    }
    return result;
  }

  // Places settlements in zoneId using Poisson disk sampling.
  // settlements: the global settlements array (mutated in place).
  // mapData: current terrain array (used to skip forbidden terrain).
  function fillZoneSettlements(zoneId, mapData, settlements) {
    const zone = _zones.find(z => z.id === zoneId);
    if (!zone) return;
    const preset = getPreset(zone.presetId);
    if (!preset || preset.settlementDensity === 'none') return;

    const w = MAP_WIDTH, h = MAP_HEIGHT;
    const forbidden = new Set(preset.forbiddenTerrain || []);

    // Collect valid tiles: in zone, terrain not forbidden
    const valid = [];
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (_zoneLayer[i] !== zoneId) continue;
        if (forbidden.has(mapData[i] & 0xFF)) continue;
        valid.push([col, row]);
      }

    if (valid.length === 0) return;

    const density = ZonePainter.DENSITY_FACTORS[preset.settlementDensity] || 0;
    const target  = Math.round(valid.length * density);
    if (target === 0) return;

    const minDist = preset.settlementMinSpacing || 15;

    // Remove existing auto-placed settlements inside this zone first
    // (keep manually-placed ones outside zone bounds)
    const existingInZone = settlements.filter(s => {
      const i = s.row * w + s.col;
      return _zoneLayer[i] === zoneId && s.type !== 'city';
    });
    existingInZone.forEach(s => {
      const idx = settlements.indexOf(s);
      if (idx >= 0) settlements.splice(idx, 1);
    });

    // Build occupied set from remaining settlements for spacing check
    const occupied = settlements.filter(s => s.type !== 'city').map(s => [s.col, s.row]);

    // Filter valid tiles to respect existing settlement spacing
    const filteredValid = valid.filter(([c,r]) =>
      !occupied.some(([oc,or]) => Math.hypot(oc-c, or-r) < minDist)
    );

    const points = poissonDiskSample(filteredValid, minDist);
    const toAdd = points.slice(0, target);
    toAdd.forEach(([col, row]) => settlements.push({col, row, type: 'settlement'}));
  }
```

Update the `return`:
```javascript
  return {
    // ... existing exports ...
    poissonDiskSample, fillZoneSettlements,
  };
```

- [ ] **Step 2: Write browser-console tests for Poisson disk**

```javascript
// Test: Poisson disk respects minDist
const tiles = [];
for (let c=0; c<50; c++) for (let r=0; r<50; r++) tiles.push([c,r]);
const points = ZonePainter.poissonDiskSample(tiles, 10);
let minFound = Infinity;
for (let i=0; i<points.length; i++)
  for (let j=i+1; j<points.length; j++) {
    const d = Math.hypot(points[i][0]-points[j][0], points[i][1]-points[j][1]);
    minFound = Math.min(minFound, d);
  }
console.assert(minFound >= 9.9, `minDist violated: ${minFound.toFixed(2)}`);
console.assert(points.length > 0, 'no points generated');
console.log(`✓ Poisson disk: ${points.length} points, min dist ${minFound.toFixed(1)}`);
```

Expected: `✓ Poisson disk: N points, min dist ≥ 9.9`

- [ ] **Step 3: Commit**

```bash
git add zone-painter.js
git commit -m "feat: add Poisson disk settlement distribution to fill engine"
```

---

## Task 4: HTML — Zone tool, canvas overlay, global fill action

**Files:**
- Modify: `MapEditorPro.html`

**Context:** Tools module is at line ~2120. `Tools._active` is the current tool string. `Canvas.render()` is at line ~1538. `_onDown`/`_onMove` at lines ~2230/2272.

- [ ] **Step 1: Add Zone tool to TOOL_NAMES and keyboard shortcut**

In `MapEditorPro.html`, find `const TOOL_NAMES = {` (line ~2122) and add `zone`:

```javascript
const TOOL_NAMES = {
    paint:      'Paint',
    fill:       'Fill',
    rect:       'Rectangle',
    eye:        'Eyedropper',
    settlement: 'Place Settlement',
    erase:      'Erase Settlement',
    zone:       'Zone Painter',          // ← ADD THIS
};
```

Find the keyboard shortcut handler (search for `case 'P':` or `key === 'p'`) and add:

```javascript
case 'z': case 'Z': Tools.setActive('zone'); break;
```

- [ ] **Step 2: Add zone painting in _onDown and _onMove**

Find `function _onDown(sx, sy, e)` (line ~2230). Inside it, locate the `switch (_active)` or the chain of `if (_active === 'paint')` calls. Add a case for zone:

```javascript
    if (_active === 'zone') {
      _paintZone(col, row);
      return;
    }
```

Find `function _onMove(sx, sy, e)` (line ~2272). Add similarly (inside the mouse-is-down guard):

```javascript
    if (_active === 'zone' && _isDown) {
      _paintZone(col, row);
      return;
    }
```

Add the `_paintZone` function inside the Tools IIFE, after `_paint`:

```javascript
    function _paintZone(col, row) {
      const zoneId = ZonePainter.getSelectedZoneId();
      if (!zoneId) return; // no zone selected
      const W = MAP_WIDTH, H = MAP_HEIGHT;
      const size = Brush.getSize(); // 0=1tile,1=7,2=19,3=37
      const brush = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]].slice(0,
        size===0?1: size===1?7: size===2?7:7); // simple: just use radius
      const radius = [0,1,2,3][Math.min(size,3)];
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dc)+Math.abs(dr) > radius + (radius>0?1:0)) continue;
          const nc = col+dc, nr = row+dr;
          if (nc>=0&&nc<W&&nr>=0&&nr<H)
            ZonePainter.getZoneLayer()[nr*W+nc] = zoneId;
        }
      }
      Canvas.render();
    }
```

- [ ] **Step 3: Draw zone overlay in Canvas.render()**

Find `Canvas.render()` (line ~1538). After the main double loop that draws terrain tiles but **before** the brush cursor preview section, add:

```javascript
    // Draw zone overlay
    if (ZonePainter.isOverlayVisible()) {
      const zones = ZonePainter.getZones();
      const zl    = ZonePainter.getZoneLayer();
      if (zones.length > 0) {
        for (let row = visRowMin; row <= visRowMax; row++) {
          for (let col = visColMin; col <= visColMax; col++) {
            const zoneId = zl[row * MAP_WIDTH + col];
            if (!zoneId) continue;
            const zone = zones.find(z => z.id === zoneId);
            if (!zone) continue;
            const {x: cx, y: cy} = _hexCenter(col, row);
            if (cx < -radius*2 || cx > canvas.width + radius*2) continue;
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = zone.color;
            ctx.beginPath();
            // flat-top hex path matching existing renderer
            for (let k=0; k<6; k++) {
              const angle = Math.PI/180 * (60*k);
              const px = cx + radius * Math.cos(angle);
              const py = cy + radius * Math.sin(angle);
              k===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1.0;
          }
        }
      }
    }
```

**Note:** Replace `_hexCenter` with whatever function the editor uses to get the canvas pixel position for a tile — search for how existing settlement drawing gets `cx, cy` from col/row and use the same approach.

- [ ] **Step 4: Add Fill All Zones + Toggle Overlay + Clear Zone buttons to toolbar**

Find the toolbar HTML (the `<div id="toolbar">` section, line ~800). Add after the existing tool buttons:

```html
<div class="toolbar-sep"></div>
<button id="btn-fill-zones"    title="Fill All Zones (apply biome presets)" onclick="ZonePainter._fillAllZones()">🗺️ Fill Zones</button>
<button id="btn-toggle-overlay" title="Toggle zone overlay visibility"      onclick="ZonePainter._toggleOverlayUI()">👁️ Zones</button>
<button id="btn-clear-zones"   title="Clear all zone assignments"            onclick="ZonePainter._clearZonesUI()">🗑️ Clear Zones</button>
```

Add the three UI action functions at the bottom of `zone-painter.js`:

```javascript
  function _fillAllZones() {
    const zones = _zones;
    if (zones.length === 0) { alert('No zones defined.'); return; }
    // mapData and settlements are editor globals
    zones.forEach(z => {
      fillZoneTerrain(z.id, mapData);
      fillZoneSettlements(z.id, mapData, settlements);
    });
    Canvas.render();
    IO.scheduleAutoSave();
  }

  function _toggleOverlayUI() {
    toggleOverlay();
    Canvas.render();
  }

  function _clearZonesUI() {
    if (!confirm('Clear all zone assignments? Terrain already filled is kept.')) return;
    clearZoneLayer();
    Canvas.render();
  }
```

Update `return` to export these.

- [ ] **Step 5: Manual verification**

Open `MapEditorPro.html` in browser:
1. Press `Z` — status bar should show "Zone Painter"
2. Select a zone in the palette (next task), paint on map — colored overlay appears
3. Click "Fill Zones" — zone tiles fill with mixed terrain
4. Click "👁️ Zones" — overlay toggles on/off
5. Click "🗑️ Clear Zones" — overlay disappears, terrain unchanged

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html zone-painter.js
git commit -m "feat: add Zone tool, canvas overlay, and fill/clear toolbar actions"
```

---

## Task 5: HTML — Zone Palette (Left Panel)

**Files:**
- Modify: `MapEditorPro.html`

**Context:** Left panel has `<div id="palette-panel">` with `<div id="palette-scroll">`. `UI.buildPalette()` at line ~2945 dynamically builds the terrain palette.

- [ ] **Step 1: Add zone palette HTML below terrain palette**

Find `<div id="palette-panel">` in the HTML. After the closing tag of that panel, add:

```html
<div id="zone-panel">
  <div class="panel-header">
    <span>🗺️ ZONES</span>
    <button id="btn-add-zone" onclick="ZonePainter._uiAddZone()" title="Add zone">+</button>
  </div>
  <div id="zone-list"></div>
</div>
```

Add minimal CSS in the `<style>` block:

```css
#zone-panel { border-top: 1px solid #333; padding: 6px; }
#zone-panel .panel-header { display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#888; text-transform:uppercase; margin-bottom:6px; }
#zone-panel .panel-header button { background:#333; border:none; color:#ccc; cursor:pointer; border-radius:3px; padding:1px 6px; font-size:13px; }
.zone-item { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:4px; cursor:pointer; font-size:12px; margin-bottom:2px; }
.zone-item.selected { background:#2a3a2a; outline:1px solid #5a8a5a; }
.zone-item .zone-swatch { width:14px; height:14px; border-radius:2px; flex-shrink:0; cursor:pointer; }
.zone-item .zone-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.zone-item .zone-del { background:none; border:none; color:#666; cursor:pointer; font-size:11px; padding:0 2px; }
.zone-item .zone-del:hover { color:#c07070; }
```

- [ ] **Step 2: Add zone palette JS to zone-painter.js**

```javascript
  function _uiRebuildZoneList() {
    const list = document.getElementById('zone-list');
    if (!list) return;
    list.innerHTML = '';
    _zones.forEach(z => {
      const el = document.createElement('div');
      el.className = 'zone-item' + (z.id === _selectedZoneId ? ' selected' : '');
      el.dataset.zoneId = z.id;
      el.innerHTML = `
        <div class="zone-swatch" style="background:${z.color}" title="Click to change color"
             onclick="ZonePainter._uiPickColor(${z.id}, this)"></div>
        <span class="zone-name" contenteditable="true"
              onblur="ZonePainter._uiRenameZone(${z.id}, this.textContent)">${z.name}</span>
        <button class="zone-del" onclick="ZonePainter._uiDeleteZone(${z.id})" title="Delete zone">✕</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('zone-swatch') || e.target.classList.contains('zone-del')) return;
        _selectedZoneId = z.id;
        _uiRebuildZoneList();
        _uiRebuildZoneConfig();
        // Switch to zone tool
        if (typeof Tools !== 'undefined') Tools.setActive('zone');
      });
      list.appendChild(el);
    });
  }

  function _uiAddZone() {
    const id = addZone();
    _selectedZoneId = id;
    _uiRebuildZoneList();
    _uiRebuildZoneConfig();
  }

  function _uiDeleteZone(id) {
    if (!confirm('Delete this zone? Zone assignments will be cleared.')) return;
    removeZone(id);
    if (_selectedZoneId === id) _selectedZoneId = _zones[0]?.id || 0;
    _uiRebuildZoneList();
    _uiRebuildZoneConfig();
    if (typeof Canvas !== 'undefined') Canvas.render();
  }

  function _uiRenameZone(id, name) {
    const z = _zones.find(z => z.id === id);
    if (z) z.name = name.trim() || `Zone ${id}`;
  }

  function _uiPickColor(id, swatchEl) {
    const input = document.createElement('input');
    input.type = 'color';
    const zone = _zones.find(z => z.id === id);
    input.value = zone?.color || '#4a8a4a';
    input.addEventListener('input', () => {
      if (zone) { zone.color = input.value; swatchEl.style.background = input.value; }
      if (typeof Canvas !== 'undefined') Canvas.render();
    });
    input.click();
  }
```

Update `return` to export `_uiRebuildZoneList, _uiAddZone, _uiDeleteZone, _uiRenameZone, _uiPickColor`.

- [ ] **Step 3: Call _uiRebuildZoneList on init**

In `MapEditorPro.html`, in the `DOMContentLoaded` handler after `ZonePainter.init()`, add:
```javascript
ZonePainter._uiRebuildZoneList();
```

- [ ] **Step 4: Manual verification**

1. Open editor — zone panel appears below terrain palette
2. Click `+` — new zone appears in list, auto-named "Zone 1"
3. Click zone swatch — color picker opens, changing color updates the list and map overlay
4. Click zone name — editable inline
5. Click `✕` — zone removed, confirm dialog shown

- [ ] **Step 5: Commit**

```bash
git add MapEditorPro.html zone-painter.js
git commit -m "feat: add zone palette UI to left panel"
```

---

## Task 6: HTML — Right Panel Zone Config + Save/Load

**Files:**
- Modify: `MapEditorPro.html`, `zone-painter.js`

**Context:** Right panel is at HTML line ~914. `IO._buildJson()` at line ~3421. `IO.tryRestoreAutosave()` at line ~3469.

- [ ] **Step 1: Add zone config section to right panel HTML**

Find the right panel in the HTML (search for `id="right-panel"` or the minimap section). After the settlement slots section, add:

```html
<div id="zone-config-panel" style="display:none">
  <div class="panel-header" style="font-size:11px;color:#888;text-transform:uppercase;padding:6px 0 4px">
    Zone Config
  </div>
  <div id="zone-config-name" style="font-size:12px;font-weight:bold;color:#7ec87e;margin-bottom:8px"></div>

  <label style="font-size:11px;color:#888">Biome Preset</label>
  <select id="zone-preset-select" style="width:100%;margin:4px 0 10px;background:#222;border:1px solid #444;color:#ccc;border-radius:3px;padding:3px"
          onchange="ZonePainter._uiPresetChanged(this.value)"></select>

  <label style="font-size:11px;color:#888">Patch Size</label>
  <input type="range" id="zone-patch-scale" min="1" max="20" step="1" style="width:100%;margin:4px 0"
         oninput="ZonePainter._uiPresetSlider('patchScale', this.value); ZonePainter._uiUpdatePreview()">

  <label style="font-size:11px;color:#888">Border Blend (tiles)</label>
  <input type="range" id="zone-blend-width" min="0" max="20" step="1" style="width:100%;margin:4px 0"
         oninput="ZonePainter._uiPresetSlider('blendWidth', this.value)">

  <label style="font-size:11px;color:#888">Blend Mode</label>
  <select id="zone-blend-mode" style="width:100%;margin:4px 0 10px;background:#222;border:1px solid #444;color:#ccc;border-radius:3px;padding:3px"
          onchange="ZonePainter._uiPresetSlider('blendMode', this.value)">
    <option value="smooth">Smooth</option>
    <option value="noisy">Noisy</option>
    <option value="hard">Hard</option>
  </select>

  <label style="font-size:11px;color:#888">Settlements</label>
  <select id="zone-settle-density" style="width:100%;margin:4px 0;background:#222;border:1px solid #444;color:#ccc;border-radius:3px;padding:3px"
          onchange="ZonePainter._uiPresetSlider('settlementDensity', this.value)">
    <option value="none">None</option>
    <option value="sparse">Sparse</option>
    <option value="medium">Medium</option>
    <option value="dense">Dense</option>
  </select>

  <label style="font-size:11px;color:#888">Min Spacing</label>
  <input type="range" id="zone-settle-spacing" min="5" max="50" step="1" style="width:100%;margin:4px 0 10px"
         oninput="ZonePainter._uiPresetSlider('settlementMinSpacing', parseInt(this.value))">

  <canvas id="zone-preview" width="120" height="80" style="border-radius:4px;display:block;margin:0 auto 10px"></canvas>

  <button onclick="ZonePainter._uiFillThisZone()" style="width:100%;padding:5px;background:#4a6a4a;border:1px solid #7ec87e;color:#7ec87e;border-radius:4px;cursor:pointer;margin-bottom:4px">
    ▶ Fill This Zone
  </button>
  <button onclick="ZonePainter._uiSavePreset()" style="width:100%;padding:5px;background:#333;border:1px solid #555;color:#aaa;border-radius:4px;cursor:pointer">
    Save as Preset
  </button>
</div>
```

- [ ] **Step 2: Add zone config JS to zone-painter.js**

```javascript
  // Current working preset for the selected zone (may be customized from a base preset)
  let _workingPreset = null;

  function _uiRebuildZoneConfig() {
    const panel = document.getElementById('zone-config-panel');
    if (!panel) return;
    const zone = _zones.find(z => z.id === _selectedZoneId);
    if (!zone) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';

    document.getElementById('zone-config-name').textContent = zone.name;

    // Populate preset dropdown
    const sel = document.getElementById('zone-preset-select');
    sel.innerHTML = '';
    _presets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = zone.presetId;

    _workingPreset = Object.assign({}, getPreset(zone.presetId) || _presets[0]);

    document.getElementById('zone-patch-scale').value    = _workingPreset.patchScale;
    document.getElementById('zone-blend-width').value    = _workingPreset.blendWidth;
    document.getElementById('zone-blend-mode').value     = _workingPreset.blendMode;
    document.getElementById('zone-settle-density').value = _workingPreset.settlementDensity;
    document.getElementById('zone-settle-spacing').value = _workingPreset.settlementMinSpacing;
    _uiUpdatePreview();
  }

  function _uiPresetChanged(presetId) {
    const zone = _zones.find(z => z.id === _selectedZoneId);
    if (zone) zone.presetId = presetId;
    _workingPreset = Object.assign({}, getPreset(presetId));
    _uiRebuildZoneConfig();
  }

  function _uiPresetSlider(field, value) {
    if (!_workingPreset) return;
    _workingPreset[field] = value;
    const zone = _zones.find(z => z.id === _selectedZoneId);
    if (zone) {
      // Store customized preset inline on the zone
      zone.presetId = `custom_${_selectedZoneId}`;
      _workingPreset.id = zone.presetId;
      _workingPreset.name = `Custom (Zone ${_selectedZoneId})`;
      savePreset(_workingPreset);
    }
  }

  function _uiUpdatePreview() {
    const canvas = document.getElementById('zone-preview');
    if (!canvas || !_workingPreset) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const perm = _buildPerm(Date.now() & 0xFFFF);
    const contrast = _workingPreset.patchContrast || 1;
    ctx.clearRect(0, 0, W, H);
    // Map terrain IDs to representative colors for preview
    const TERRAIN_COLORS = {
      0:'#1a3a5a',1:'#1a3a5a',2:'#1a3a5a',3:'#2a5a8a',4:'#2a5a8a',
      5:'#2a5a8a',6:'#2a5a8a',7:'#2a5a8a',8:'#2a5a8a',
      9:'#5a4a3a',10:'#6a5a4a',11:'#7a6a5a',
      12:'#6a8a4a',13:'#7a9a5a',14:'#5a6a4a',
      15:'#2a5a2a',16:'#3a7a3a',17:'#4a6a3a',
      18:'#6a6a7a',19:'#8a8a9a',
      20:'#c8a820',21:'#8a7a5a',
      22:'#8a7a5a',23:'#9a8a6a',
      24:'#3a5a3a',25:'#4a6a5a',
      26:'#8a3a1a',27:'#9a4a2a',28:'#6a2a1a'
    };
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const n = perlinNoise(px / _workingPreset.patchScale, py / _workingPreset.patchScale, perm);
        const nc = Math.max(0, Math.min(1, (n - 0.5) * contrast + 0.5));
        const tid = _noiseToTerrain(nc, _workingPreset);
        ctx.fillStyle = TERRAIN_COLORS[tid] || '#444';
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  function _uiFillThisZone() {
    if (!_selectedZoneId) return;
    fillZoneTerrain(_selectedZoneId, mapData);
    fillZoneSettlements(_selectedZoneId, mapData, settlements);
    if (typeof Canvas !== 'undefined') Canvas.render();
    if (typeof IO !== 'undefined') IO.scheduleAutoSave();
  }

  function _uiSavePreset() {
    const name = prompt('Preset name:', _workingPreset?.name || 'My Preset');
    if (!name) return;
    const p = Object.assign({}, _workingPreset, {
      id: 'user_' + name.toLowerCase().replace(/\s+/g,'_'),
      name
    });
    savePreset(p);
    // Refresh dropdown
    _uiRebuildZoneConfig();
    alert(`Preset "${name}" saved.`);
  }
```

Update `return` to export all `_ui*` functions.

Also call `_uiRebuildZoneConfig()` inside `_uiRebuildZoneList()` when a zone is selected.

- [ ] **Step 3: Extend IO._buildJson() to include zone data**

Find `IO._buildJson()` (line ~3421). Inside it, find where the save object is constructed (the `return { ... }` or object assignment). Add zone data:

```javascript
    // After existing fields (width, height, data, settlements, etc.)
    const zoneData = ZonePainter.toSaveObject();
    // Add to the returned object:
    Object.assign(saveObj, {
      zones:        zoneData.zones,
      zoneMap:      zoneData.zoneMap,
      biomePresets: zoneData.biomePresets,
      _zoneNextId:  zoneData._nextZoneId,
    });
```

**Note:** The exact structure of `_buildJson` may use a different pattern — find the object being returned and add these four keys to it.

- [ ] **Step 4: Restore zone data in IO.tryRestoreAutosave()**

Find `IO.tryRestoreAutosave()` (line ~3469). After the point where `mapData` and `settlements` are restored from the parsed JSON, add:

```javascript
    ZonePainter.fromSaveObject({
      zones:        parsed.zones        || [],
      zoneMap:      parsed.zoneMap      || null,
      biomePresets: parsed.biomePresets || [],
      _nextZoneId:  parsed._zoneNextId  || 1,
    });
    ZonePainter._uiRebuildZoneList();
    ZonePainter._uiRebuildZoneConfig();
```

- [ ] **Step 5: Manual end-to-end verification**

1. Open editor → add a zone, paint it on map, assign Forest Edge preset
2. Click **Fill This Zone** → terrain fills with mixed forest/plains pattern
3. Click **Fill All Zones** → all zones fill
4. Save the map (File → Save or autosave)
5. Reload the page → zones are restored, overlay appears, terrain is preserved
6. Verify existing tools (paint, fill, rectangle, procedural generator) work unchanged
7. Export map JSON → open in text editor, verify `zones`, `zoneMap`, `biomePresets` keys present
8. Import into Unity game → loads without error (Unity ignores unknown JSON keys)

- [ ] **Step 6: Commit**

```bash
git add MapEditorPro.html zone-painter.js
git commit -m "feat: zone config right panel, live preview, save/load integration"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Zone Layer (Uint8Array, zone palette, keyboard shortcut Z) → Tasks 4, 5
- ✅ Biome Preset data model + 8 built-in presets → Task 1
- ✅ Fill engine: noise terrain + border blending → Task 2
- ✅ Fill engine: Poisson disk settlements → Task 3
- ✅ Right panel: preset picker, sliders, preview, Fill/Save buttons → Task 6
- ✅ Global actions: Fill All Zones, Clear Zone Layer, Toggle Overlay → Task 4
- ✅ Data format: zones/zoneMap/biomePresets in JSON → Task 6
- ✅ Save/load roundtrip → Task 6

**Placeholder scan:** No TBDs. Task 4 Step 3 has a note about finding `_hexCenter` — this is a codebase-specific lookup needed at implementation time, not a design gap.

**Type consistency:** `_workingPreset` fields (`patchScale`, `blendWidth`, `blendMode`, `settlementDensity`, `settlementMinSpacing`, `terrainWeights`) are consistently named across Tasks 1, 2, 3, 6. `fillZoneTerrain` and `fillZoneSettlements` both receive `(zoneId, mapData)` / `(zoneId, mapData, settlements)` — consistent with how they're called in `_fillAllZones` and `_uiFillThisZone`.
