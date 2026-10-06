// map-format.js - versioning and validation of the map JSON file. Pure: no DOM, no editor globals, loadable by the page
// (<script>), by `require` and in a bare vm context.
//
// validate() mirrors the LENIENCY of IO.loadFromJSON (MapEditorPro.html): it reports an error only for input the loader
// throws on or turns into garbage; everything the loader repairs or ignores (null/empty cells, missing rows, numeric-string
// sizes, size outside 10-450, unknown keys, wrong-typed optional lists) is at most a WARNING. The single deliberate extra
// strictness is a `__proto__` own key (prototype pollution), which no editor ever writes.
// Work is bounded: one pass over at most 450x450 cells plus one pass over each optional list; nothing is deep-copied.
// Messages are plain strings (callers render them with textContent) and never echo untrusted values.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.MapFormat = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CURRENT_VERSION = 2, MIN_SIZE = 10, MAX_SIZE = 450;
  // Keys the editor writes (tests/map-json-contract.spec.ts) plus the legacy overlay the loader still reads. Other keys are
  // legal: they are kept by migrate() and ignored by the loader.
  const KNOWN_KEYS = ['version', 'width', 'height', 'data', 'packages', 'settlements', 'settlement_priorities', 'settlement_slots',
    'bridges', 'objects', 'tileExtras', 'roads', 'zones', 'zoneMap', 'biomePresets', '_zoneNextId', 'distance_bands', 'custom_terrain'];
  // Lists the loader walks element by element: a null/undefined element makes it throw (bridges also filters on its fields).
  const ENTRY_LISTS = ['bridges', 'objects', 'roads', 'tileExtras', 'settlements', 'settlement_slots'];
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  // The loader's size handling: Math.max(10, Math.min(450, json.width)) coerces numeric strings. NaN = unusable.
  function toSize(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return NaN;
  }

  function validate(json) {
    const errors = [], warnings = [];
    const result = { ok: false, errors, warnings, version: null, clamped: null, legacyIntegerCells: false };
    try { inspect(json, result); } catch (e) { errors.push('Map file could not be inspected (unreadable structure).'); }
    result.ok = errors.length === 0;
    return result;
  }

  function inspect(json, res) {
    const { errors, warnings } = res;
    if (!isObj(json)) { errors.push('The file is not a map: expected a JSON object.'); return; }
    if (hasOwn(json, '__proto__')) errors.push('The map contains a "__proto__" key, which is not allowed.');

    // version: the loader ignores it; a missing/odd/newer value only changes what we tell the user.
    if (json.version === undefined) warnings.push('The map has no version field; it was saved by an older editor and is read as the oldest format.');
    else if (typeof json.version === 'number' && Number.isInteger(json.version)) {
      res.version = json.version;
      if (json.version > CURRENT_VERSION) warnings.push('The map was saved by a newer version of the editor (format ' + json.version + '; this editor reads format ' + CURRENT_VERSION + '). Some data may be ignored.');
    } else warnings.push('The version field is not a whole number and is ignored.');

    // size: `!json.width || !json.height || !Array.isArray(json.data)` throws in the loader
    const w = toSize(json.width), h = toSize(json.height);
    if (!json.width || !Number.isFinite(w)) errors.push('width is missing or not a number.');
    else if (!Number.isInteger(w)) errors.push('width must be a whole number.');
    if (!json.height || !Number.isFinite(h)) errors.push('height is missing or not a number.');
    else if (!Number.isInteger(h)) errors.push('height must be a whole number.');
    if (typeof json.width === 'string' || typeof json.height === 'string') warnings.push('width/height are stored as text; they are read as numbers.');
    if (!Array.isArray(json.data)) errors.push('data must be an array of rows.');
    if (errors.length) return;

    const cw = Math.max(MIN_SIZE, Math.min(MAX_SIZE, w)), ch = Math.max(MIN_SIZE, Math.min(MAX_SIZE, h));
    if (cw !== w || ch !== h) {
      res.clamped = { from: [w, h], to: [cw, ch] };
      warnings.push('The map size is outside ' + MIN_SIZE + '-' + MAX_SIZE + '; it is loaded as ' + cw + 'x' + ch + '.');
    }

    const data = json.data;
    res.legacyIntegerCells = isLegacyIntegerMap(json);
    if (data.length !== ch) warnings.push('data has ' + data.length + ' rows but the map height is ' + ch + '.');
    // One pass over exactly the region the loader reads.
    let badRow = false, badCell = false, missingRows = 0, shortRows = 0, numericInIds = 0;
    for (let r = 0; r < ch && !(badRow && badCell); r++) {
      const row = data[r];
      if (row === null || row === undefined) { missingRows++; continue; }
      if (!Array.isArray(row)) { badRow = true; continue; }
      if (row.length < cw) shortRows++;
      for (let c = 0; c < cw; c++) {
        const v = row[c];
        if (!v) continue;                                   // null, '', 0, false, undefined: loaded as Plain_1
        const t = typeof v;
        if (t === 'string') continue;
        if (t === 'number') { if (!res.legacyIntegerCells) numericInIds++; continue; }
        badCell = true; break;
      }
    }
    if (badRow) errors.push('data contains a row that is not an array.');
    if (badCell) errors.push('data contains a cell that is neither a tile id nor a number.');
    if (missingRows) warnings.push(missingRows + ' row(s) of data are missing; they are loaded as Plain_1.');
    if (shortRows) warnings.push(shortRows + ' row(s) of data are shorter than the width; the rest is loaded as Plain_1.');
    if (numericInIds) warnings.push(numericInIds + ' numeric cell(s) in a map that uses tile ids.');

    // optional lists
    for (const k of ENTRY_LISTS) {
      const list = json[k];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) {
        // `settlements` is read as `.length > 0` then `.map`: a non-array with a length throws; the others are skipped.
        if (k === 'settlements' && list && list.length > 0) errors.push('settlements must be an array.');
        else warnings.push(k + ' is not an array and is ignored.');
        continue;
      }
      let nullEntry = false, protoEntry = false;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e === null || e === undefined) { nullEntry = true; continue; }
        if (typeof e === 'object' && hasOwn(e, '__proto__')) protoEntry = true;
      }
      if (nullEntry) errors.push(k + ' contains an empty entry.');
      if (protoEntry) errors.push(k + ' contains an entry with a "__proto__" key, which is not allowed.');
    }
    if (res.legacyIntegerCells && Array.isArray(json.custom_terrain) && json.custom_terrain.some(e => e === null || e === undefined))
      errors.push('custom_terrain contains an empty entry.');
    if (json.packages !== undefined && json.packages !== null) {
      if (!Array.isArray(json.packages)) warnings.push('packages is not an array and is ignored.');
      else if (json.packages.some(p => typeof p !== 'string')) warnings.push('packages contains entries that are not text.');
    }
    for (const k of ['zones', 'biomePresets', 'distance_bands'])
      if (json[k] !== undefined && json[k] !== null && !Array.isArray(json[k])) warnings.push(k + ' is not an array and is ignored.');

    // settlements outside the map (the loader drops an off-map city and keeps other entries as they are)
    if (Array.isArray(json.settlements)) {
      let outside = 0;
      for (const s of json.settlements) {
        if (!s || typeof s !== 'object') continue;
        const col = s.col !== undefined ? s.col : s.x, row = s.row !== undefined ? s.row : s.y;
        if (!(col >= 0 && col < cw && row >= 0 && row < ch)) outside++;
      }
      if (outside) warnings.push(outside + ' settlement(s) lie outside the map.');
    }
  }

  // The loader's own test for the old integer format (first cell of the first row is a number).
  function isLegacyIntegerMap(json) {
    return !!(json && Array.isArray(json.data) && json.data[0] && typeof json.data[0][0] === 'number');
  }

  // Shallow copy without `__proto__` (assigning it would swap the prototype). Nested layers are SHARED with the input.
  function shallowCopy(json) {
    const out = {};
    if (!isObj(json)) return out;
    for (const k of Object.keys(json)) if (k !== '__proto__') out[k] = json[k];
    return out;
  }

  // Brings any format the loader tolerates to CURRENT_VERSION. Never mutates `json`, never downgrades a newer file.
  function migrate(json) {
    const out = shallowCopy(json);
    if (!(typeof out.version === 'number' && out.version >= CURRENT_VERSION)) out.version = CURRENT_VERSION;
    if (!Array.isArray(out.packages)) out.packages = ['postapoc'];
    // v1 settlements may use {x, y}; the loader reads both, the current format writes {col, row, type}.
    if (Array.isArray(out.settlements) && out.settlements.some(s => s && typeof s === 'object' && s.col === undefined && s.x !== undefined)) {
      out.settlements = out.settlements.map(s => {
        if (!s || typeof s !== 'object' || s.col !== undefined || s.x === undefined) return s;
        const n = {};
        for (const k of Object.keys(s)) if (k !== 'x' && k !== 'y' && k !== '__proto__') n[k] = s[k];
        n.col = s.x; n.row = s.y; n.type = s.type || 'settlement';
        return n;
      });
    }
    return out;
  }

  // For saving: a copy that carries CURRENT_VERSION as its first key.
  function stamp(json) {
    const src = shallowCopy(json), out = { version: CURRENT_VERSION };
    for (const k of Object.keys(src)) if (k !== 'version') out[k] = src[k];
    return out;
  }

  return { CURRENT_VERSION, MIN_SIZE, MAX_SIZE, KNOWN_KEYS, validate, migrate, stamp, isLegacyIntegerMap };
}));
