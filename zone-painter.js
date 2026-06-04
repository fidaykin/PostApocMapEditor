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
    _zones = obj.zones || [];
    _nextZoneId = obj._nextZoneId || (_zones.reduce((m, z) => Math.max(m, z.id), 0) + 1);
    _presets = BUILTIN_PRESETS.map(p => Object.assign({}, p, {
      terrainWeights: Object.assign({}, p.terrainWeights),
      forbiddenTerrain: p.forbiddenTerrain.slice()
    }));
    (obj.biomePresets || []).forEach(p => _presets.push(Object.assign({}, p)));
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

        mapData[i] = terrainId;
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
        if (forbidden.has(mapData[i] & 0xFF)) continue;
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
    _fillAllZones, _toggleOverlayUI, _clearZonesUI
  };
})();
