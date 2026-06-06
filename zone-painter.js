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
  // terrainWeights keys and forbiddenTerrain values are HexDB hex IDs (strings).
  const _WATER_TYPES = ['Water_1','Water_Dirty_1','Water_Rock_1'];
  const _IMPASSABLE  = [..._WATER_TYPES, 'Hills_1','Mountain_1','Lava_Plain_1','Lava_Rift_1','Rift_1'];

  const BUILTIN_PRESETS = [
    {
      id: 'forest_edge', name: 'Forest Edge',
      terrainWeights: {'Forest_1': 0.40, 'Forest_2': 0.20, 'Plain_1': 0.30, 'Plain_2': 0.10},
      patchScale: 8, patchContrast: 1.5,
      blendWidth: 8, blendMode: 'noisy',
      settlementDensity: 'medium', settlementMinSpacing: 15,
      forbiddenTerrain: [..._IMPASSABLE, 'Rubble_1','Rubble_2','Rubble_3']
    },
    {
      id: 'deep_wasteland', name: 'Deep Wasteland',
      terrainWeights: {'Rubble_1': 0.40, 'Barren_1': 0.40, 'Plain_1': 0.20},
      patchScale: 12, patchContrast: 2.0,
      blendWidth: 6, blendMode: 'hard',
      settlementDensity: 'sparse', settlementMinSpacing: 25,
      forbiddenTerrain: [..._IMPASSABLE, 'Rubble_1','Rubble_2','Rubble_3']
    },
    {
      id: 'river_valley', name: 'River Valley',
      terrainWeights: {'Plain_1': 0.50, 'BrokenPlane_1': 0.10, 'Swamp_1': 0.20, 'Plain_2': 0.20},
      patchScale: 6, patchContrast: 1.2,
      blendWidth: 10, blendMode: 'smooth',
      settlementDensity: 'dense', settlementMinSpacing: 10,
      forbiddenTerrain: [..._IMPASSABLE, 'Rubble_1','Rubble_2','Rubble_3']
    },
    {
      id: 'mountain_rim', name: 'Mountain Rim',
      terrainWeights: {'Mountain_1': 0.50, 'Hills_1': 0.30, 'Rubble_1': 0.20},
      patchScale: 10, patchContrast: 2.0,
      blendWidth: 5, blendMode: 'hard',
      settlementDensity: 'none', settlementMinSpacing: 30,
      forbiddenTerrain: [..._WATER_TYPES, 'Lava_Plain_1','Lava_Rift_1','Rift_1']
    },
    {
      id: 'ash_plains', name: 'Ash Plains',
      terrainWeights: {'Barren_1': 0.50, 'Rift_1': 0.30, 'Rubble_1': 0.20},
      patchScale: 5, patchContrast: 1.8,
      blendWidth: 7, blendMode: 'noisy',
      settlementDensity: 'none', settlementMinSpacing: 30,
      forbiddenTerrain: [..._WATER_TYPES, 'Forest_1','Forest_2','Forest_3','Hills_1','Mountain_1','Lava_Plain_1','Lava_Rift_1']
    },
    {
      id: 'marshland', name: 'Marshland',
      terrainWeights: {'Swamp_1': 0.50, 'BrokenPlane_1': 0.30, 'Plain_1': 0.20},
      patchScale: 9, patchContrast: 1.3,
      blendWidth: 9, blendMode: 'smooth',
      settlementDensity: 'sparse', settlementMinSpacing: 20,
      forbiddenTerrain: [..._IMPASSABLE, 'Rubble_1','Rubble_2','Rubble_3']
    },
    {
      id: 'ruined_district', name: 'Ruined District',
      terrainWeights: {'Rubble_1': 0.30, 'Rubble_2': 0.20, 'Plain_1': 0.30, 'Barren_1': 0.20},
      patchScale: 4, patchContrast: 1.6,
      blendWidth: 6, blendMode: 'noisy',
      settlementDensity: 'dense', settlementMinSpacing: 8,
      forbiddenTerrain: [..._IMPASSABLE, 'Rubble_1','Rubble_2','Rubble_3']
    }
  ];

  const DENSITY_FACTORS = {none: 0, sparse: 0.002, medium: 0.005, dense: 0.010};

  // ── HexDB resolvers ───────────────────────────────────────────────────────
  // HexDB is the single source of truth. No static ID tables — new tile types
  // added to HexDB automatically become available here.

  // Returns terrainTypeId (integer) for a hex ID string, or -1 if not found.
  function _hexIdToTid(hexId) {
    if (typeof HexDB !== 'undefined') {
      const e = HexDB.getAll().find(h => h.id === hexId);
      if (e && typeof e.terrainTypeId !== 'undefined' && e.terrainTypeId >= 0)
        return e.terrainTypeId;
    }
    // Legacy: old autosaved preset stored numeric string key (e.g. '15')
    const n = parseInt(hexId, 10);
    return (!isNaN(n) && String(n) === String(hexId)) ? n : -1;
  }

  // Returns hex ID string for a terrainTypeId integer, or null if not found.
  function _tidToHexId(tid) {
    if (typeof HexDB !== 'undefined') {
      const e = HexDB.getAll().find(h => h.terrainTypeId === tid);
      if (e) return e.id;
    }
    return null;
  }

  // Upgrades presets saved before the string-ID migration.
  // Old format stored integer keys in terrainWeights (e.g. {'15': 0.4}).
  function _migratePreset(preset) {
    if (!preset.terrainWeights) return preset;
    const hasIntKeys = Object.keys(preset.terrainWeights).some(k => /^\d+$/.test(k));
    if (!hasIntKeys) return preset;
    const newWeights = {};
    for (const [key, w] of Object.entries(preset.terrainWeights)) {
      const hexId = /^\d+$/.test(key) ? (_tidToHexId(parseInt(key, 10)) || key) : key;
      newWeights[hexId] = (newWeights[hexId] || 0) + w;
    }
    const migrated = Object.assign({}, preset, { terrainWeights: newWeights });
    if (preset.forbiddenTerrain) {
      migrated.forbiddenTerrain = preset.forbiddenTerrain.map(f => {
        const s = String(f);
        return /^\d+$/.test(s) ? (_tidToHexId(parseInt(s, 10)) || s) : f;
      });
    }
    return migrated;
  }

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
    _presets   = BUILTIN_PRESETS.map(p => Object.assign({}, p, {
      terrainWeights: Object.assign({}, p.terrainWeights),
      forbiddenTerrain: p.forbiddenTerrain.slice()
    }));
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
    if (BUILTIN_PRESETS.find(b => b.id === preset.id)) {
      console.warn('ZonePainter: cannot overwrite built-in preset, use a different id');
      return;
    }
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
    // Ensure zoneLayer matches current map dimensions and is cleared
    if (!_zoneLayer || _zoneLayer.length !== w * h) _zoneLayer = new Uint8Array(w * h);
    else _zoneLayer.fill(0);
    _zones = obj.zones || [];
    _nextZoneId = obj._nextZoneId || (_zones.reduce((m, z) => Math.max(m, z.id), 0) + 1);
    _presets = BUILTIN_PRESETS.map(p => Object.assign({}, p, {
      terrainWeights: Object.assign({}, p.terrainWeights),
      forbiddenTerrain: p.forbiddenTerrain.slice()
    }));
    (obj.biomePresets || []).forEach(p => _presets.push(_migratePreset(Object.assign({}, p))));
    if (_zones.length === 0) {
      BUILTIN_PRESETS.forEach(p => {
        const id = _nextZoneId++;
        _zones.push({id, name: p.name, color: _defaultColor(id), presetId: p.id});
      });
      _selectedZoneId = _zones[0].id;
    }
    if (obj.zoneMap) {
      const bin = atob(obj.zoneMap);
      for (let i = 0; i < Math.min(bin.length, w * h); i++)
        _zoneLayer[i] = bin.charCodeAt(i);
    }
  }

  // ── Fill Engine ───────────────────────────────────────────────────────────

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

  // Maps noise value [0,1] to a HexDB hex ID string using preset's terrainWeights.
  function _noiseToTerrain(noise, preset) {
    const entries = Object.entries(preset.terrainWeights)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    let cum = 0;
    for (const [hexId, weight] of entries) {
      cum += weight;
      if (noise <= cum) return hexId;
    }
    return entries[entries.length - 1][0];
  }

  // Fills terrain for all tiles in zoneId using preset's noise parameters.
  function fillZoneTerrain(zoneId, mapData) {
    if (typeof HexDB === 'undefined') { console.warn('ZonePainter: HexDB not loaded, fill skipped'); return; }
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

    const neighbourPerms = new Map();
    for (const nzId of neighbourZones) {
      neighbourPerms.set(nzId, _buildPerm(nzId * 997 + 1));
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
          if (_tileHash(col, row, zoneId) < t) {
            const nzId = [...neighbourZones][Math.floor(_tileHash(row, col, zoneId + 1) * neighbourZones.size)];
            const nzone = _zones.find(z => z.id === nzId);
            if (nzone) {
              const np = getPreset(nzone.presetId);
              if (np) {
                const nPerm = neighbourPerms.get(nzId) || perm;
                const nn = perlinNoise(col / np.patchScale, row / np.patchScale, nPerm);
                const nn2 = Math.max(0, Math.min(1, (nn - 0.5) * (np.patchContrast||1) + 0.5));
                terrainId = _noiseToTerrain(nn2, np);
              }
            }
          }
        }

        mapData[i] = terrainId;  // write hex ID string directly
      }
    }
  }

  function _tileHash(col, row, seed) {
    let h = ((col * 73856093) ^ (row * 19349663) ^ (seed >>> 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  }

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
        if (forbidden.has(mapData[i])) continue;
        valid.push([col, row]);
      }

    if (valid.length === 0) return;

    const density = DENSITY_FACTORS[preset.settlementDensity] || 0;
    const target  = Math.round(valid.length * density);
    if (target === 0) return;

    const minDist = preset.settlementMinSpacing || 15;

    // Remove existing auto-placed settlements inside this zone first
    // (keep city type settlements)
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

  function _fillAllZones() {
    const zones = _zones;
    if (zones.length === 0) { alert('No zones defined.'); return; }
    if (typeof History !== 'undefined') History.push();
    zones.forEach(z => {
      fillZoneTerrain(z.id, mapData);
      fillZoneSettlements(z.id, mapData, settlements);
    });
    Canvas.render();
    Canvas.drawMinimap();
    IO.scheduleAutoSave();
  }

  function _toggleOverlayUI() {
    toggleOverlay();
    const btn = document.getElementById('btn-zone-overlay');
    if (btn) btn.style.opacity = _showOverlay ? '1' : '0.4';
    Canvas.render();
  }

  function _clearZonesUI() {
    if (!confirm('Clear all zone assignments? Terrain already filled is kept.')) return;
    clearZoneLayer();
    Canvas.render();
  }

  function _safeColor(color) {
    return /^#[0-9a-fA-F]{3,6}$/.test(color) ? color : '#4a8a4a';
  }

  function _uiRebuildZoneList() {
    const list = document.getElementById('zone-list');
    if (!list) return;
    list.innerHTML = '';
    _zones.forEach(z => {
      const el = document.createElement('div');
      el.className = 'zone-item' + (z.id === _selectedZoneId ? ' selected' : '');
      el.dataset.zoneId = z.id;
      // swatch and delete button use integer z.id (safe); name uses textContent (XSS-safe)
      el.innerHTML = `
        <div class="zone-swatch" title="Click to change color"
             onclick="ZonePainter._uiPickColor(${z.id}, this)"></div>
        <span class="zone-name" title="Double-click to rename"></span>
        <button class="zone-del" onclick="event.stopPropagation(); ZonePainter._uiDeleteZone(${z.id})" title="Delete zone">✕</button>
      `;
      // Set name and swatch color via DOM properties (avoids XSS and CSS injection)
      const nameSpan = el.querySelector('.zone-name');
      nameSpan.textContent = z.name;
      const swatch = el.querySelector('.zone-swatch');
      swatch.style.background = _safeColor(z.color);
      // Single click: select zone
      el.addEventListener('click', e => {
        if (e.target.classList.contains('zone-swatch') || e.target.classList.contains('zone-del')) return;
        _selectedZoneId = z.id;
        _uiRebuildZoneList();
        _uiRebuildZoneConfig();
        if (typeof Tools !== 'undefined') Tools.setActive('zone');
      });
      // Double-click on name: rename inline
      nameSpan.addEventListener('dblclick', e => {
        e.stopPropagation();
        nameSpan.contentEditable = 'true';
        nameSpan.focus();
        document.execCommand('selectAll', false, null);
        nameSpan.addEventListener('blur', () => {
          nameSpan.contentEditable = 'false';
          ZonePainter._uiRenameZone(z.id, nameSpan.textContent.trim());
        }, { once: true });
        nameSpan.addEventListener('keydown', e2 => {
          if (e2.key === 'Enter') { e2.preventDefault(); nameSpan.blur(); }
          if (e2.key === 'Escape') { nameSpan.textContent = z.name; nameSpan.blur(); }
        }, { once: true });
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
    if (typeof Canvas !== 'undefined') Canvas.render();
  }

  function _uiRenameZone(id, name) {
    const z = _zones.find(z => z.id === id);
    if (!z) return;
    z.name = name.trim() || `Zone ${id}`;
    _uiRebuildZoneList();
    if (typeof IO !== 'undefined') IO.scheduleAutoSave();
  }

  function _uiPickColor(id, swatchEl) {
    const input = document.createElement('input');
    input.type = 'color';
    const zone = _zones.find(z => z.id === id);
    input.value = zone?.color || '#4a8a4a';
    input.addEventListener('input', () => {
      if (zone) { zone.color = input.value; swatchEl.style.background = _safeColor(input.value); }
      if (typeof Canvas !== 'undefined') Canvas.render();
    });
    document.body.appendChild(input);
    input.style.position = 'absolute';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    input.click();
    input.addEventListener('change', () => document.body.removeChild(input));
  }

  let _workingPreset = null;

  function _uiRebuildZoneConfig() {
    const panel = document.getElementById('zone-config-panel');
    if (!panel) return;
    const zone = _zones.find(z => z.id === _selectedZoneId);
    if (!zone) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';

    document.getElementById('zone-config-name').value = zone.name;

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
    _workingPreset = Object.assign({}, getPreset(presetId) || _presets[0]);
    _uiRebuildZoneConfig();
  }

  function _uiPresetSlider(field, value) {
    if (!_workingPreset) return;
    _workingPreset[field] = value;
    const zone = _zones.find(z => z.id === _selectedZoneId);
    if (zone) {
      const customId = `custom_${_selectedZoneId}`;
      zone.presetId = customId;
      _workingPreset.id   = customId;
      _workingPreset.name = `Custom (Zone ${_selectedZoneId})`;
      savePreset(_workingPreset);
      // Update dropdown to show this custom preset
      const sel = document.getElementById('zone-preset-select');
      if (sel) {
        let opt = sel.querySelector(`option[value="${customId}"]`);
        if (!opt) {
          opt = document.createElement('option');
          opt.value = customId;
          sel.appendChild(opt);
        }
        opt.textContent = _workingPreset.name;
        sel.value = customId;
      }
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
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const n = perlinNoise(px / _workingPreset.patchScale, py / _workingPreset.patchScale, perm);
        const nc = Math.max(0, Math.min(1, (n - 0.5) * contrast + 0.5));
        const hexId = _noiseToTerrain(nc, _workingPreset);
        if (typeof Terrain !== 'undefined') {
          const [r, g, b] = Terrain.color(hexId);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          ctx.fillStyle = '#444';
        }
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  function _uiFillThisZone() {
    if (!_selectedZoneId) return;
    if (typeof History !== 'undefined') History.push();
    fillZoneTerrain(_selectedZoneId, mapData);
    fillZoneSettlements(_selectedZoneId, mapData, settlements);
    if (typeof Canvas !== 'undefined') { Canvas.render(); Canvas.drawMinimap(); }
    if (typeof IO !== 'undefined') IO.scheduleAutoSave();
  }

  function _uiSavePreset() {
    const name = prompt('Preset name:', _workingPreset?.name || 'My Preset');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const p = Object.assign({}, _workingPreset, {
      id: 'user_' + trimmed.toLowerCase().replace(/\s+/g,'_'),
      name: trimmed
    });
    savePreset(p);
    _uiRebuildZoneConfig();
    alert(`Preset "${trimmed}" saved.`);
  }

  return {
    init, perlinNoise, _buildPerm,
    getZoneLayer, getZones, getPresets, getPreset,
    getSelectedZoneId, setSelectedZoneId,
    isOverlayVisible, toggleOverlay,
    addZone, removeZone, clearZoneLayer,
    savePreset, toSaveObject, fromSaveObject,
    buildDistanceMap, fillZoneTerrain,
    poissonDiskSample, fillZoneSettlements,
    BUILTIN_PRESETS, DENSITY_FACTORS,
    _fillAllZones, _toggleOverlayUI, _clearZonesUI,
    _uiRebuildZoneList, _uiAddZone, _uiDeleteZone, _uiRenameZone, _uiPickColor,
    _uiRebuildZoneConfig, _uiPresetChanged, _uiPresetSlider,
    _uiUpdatePreview, _uiFillThisZone, _uiSavePreset
  };
})();
