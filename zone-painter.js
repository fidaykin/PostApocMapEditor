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
