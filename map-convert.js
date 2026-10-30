// map-convert.js - re-targets a map JSON to another content package. Pure: no DOM, no editor globals, loadable by the page
// (<script>) and by `require`. The input map is never modified; the result is a converted deep copy plus a report.
//
// Why: a package made with Reskin+ "Copy with package prefix" has new ids (Decameroon_Plain_1 -> Hs_Decameroon_Plain_1), so the
// maps drawn with the old ids do not change when the package is applied. This renames every id of the map to the id of the
// target package that stands for it. Visual and id changes only: values (prices, income) come from the target records.
//
// Where ids live in a map file: data[row][col] (hex ids, and building ids painted as tiles: the game extracts those into buildings),
// objects[].id (building ids), tileExtras[].underTerrainId (hex id), biomePresets[].terrainWeights keys and .forbiddenTerrain
// (hex ids). Everything else is copied as is.
//
// The package list of the result is computed from what the converted map really uses, with the editor's own rule for saved maps
// (_collectMapPackages): postapoc, the package of every id in data and objects, and their dependencies.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.MapConvert = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const low = s => String(s == null ? '' : s).trim().toLowerCase();
  const isBase = r => !r.package || r.package === 'postapoc';
  const isWater = r => /water/i.test(String(r.type || ''));

  // 'medieval-2-0' -> 'Medieval20_': same rule as the editor's idPrefix(). The base package has no prefix.
  function prefixOf(pkgId) {
    if (!pkgId || pkgId === 'postapoc') return '';
    return String(pkgId).split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('') + '_';
  }

  // Same rule as the game and SkinSlotRules.compatible: hexes need an equal type, buildings only water vs ground.
  function compatible(kind, from, to) {
    if (!from || !to) return true;
    if (kind === 'bld') return isWater(from) === isWater(to);
    return low(from.type) === low(to.type);
  }

  // Lookup tables for one kind ('hex' | 'bld') and the target package.
  function index(records, target) {
    const byId = new Map(), targetById = new Map(), targetBySlot = new Map();
    for (const r of records || []) {
      if (!r || r.id == null) continue;
      byId.set(low(r.id), r);
      if (r.package === target) {
        targetById.set(low(r.id), r);
        const slot = low(r.skinSlot);
        if (slot && !targetBySlot.has(slot)) targetBySlot.set(slot, r);
      }
    }
    return { byId, targetById, targetBySlot };
  }

  // What one id becomes. { id, how } with how: same | prefix | skin | keptBase | missing | typeMismatch | unknown.
  // `id` is the new id for same/prefix/skin, else the id unchanged.
  function resolve(kind, id, ix, target, prefixFn) {
    const own = ix.byId.get(low(id));
    if (!own) return { id, how: 'unknown' };
    if (own.package === target) return { id, how: 'same' };

    const tp = prefixFn(target);
    const sp = prefixFn(own.package);
    const stripped = sp && String(id).startsWith(sp) ? String(id).slice(sp.length) : String(id);
    const tries = [];
    const slot = low(own.skinSlot) || (isBase(own) ? low(id) : '');
    if (slot && ix.targetBySlot.has(slot)) tries.push([ix.targetBySlot.get(slot), 'skin']);
    if (tp) {
      const a = ix.targetById.get(low(tp + id)); if (a) tries.push([a, 'prefix']);
      const b = ix.targetById.get(low(tp + stripped)); if (b) tries.push([b, 'prefix']);
    }
    const c = ix.targetById.get(low(stripped)); if (c) tries.push([c, 'prefix']);

    let mismatch = null;
    for (const [rec, how] of tries) {
      if (compatible(kind, own, rec)) return { id: rec.id, how };
      mismatch = mismatch || rec;
    }
    if (mismatch) return { id, how: 'typeMismatch', to: mismatch.id };
    return { id, how: isBase(own) ? 'keptBase' : 'missing' };
  }

  function newReport() {
    return { hex: bucket(), bld: bucket() };
  }
  function bucket() {
    return { converted: 0, same: 0, keptBase: 0, missing: 0, typeMismatch: 0, unknown: 0, mapping: {}, notConverted: {} };
  }
  // count: how many map cells use the id (presets and tileExtras count 1 each).
  function note(b, id, res, count) {
    if (res.how === 'prefix' || res.how === 'skin') { b.converted += count; b.mapping[id] = res.id; return; }
    b[res.how] += count;
    if (res.how === 'missing' || res.how === 'typeMismatch' || res.how === 'unknown') {
      const e = b.notConverted[id] || (b.notConverted[id] = { count: 0, how: res.how });
      e.count += count; if (res.to) e.to = res.to;
    }
  }

  // Packages the converted map needs, by the editor's rule for saved maps: postapoc, the package of every id in data and objects,
  // and the dependencies of those (ctx.resolvePackages, when given). A package of the old list that this converter knows no record
  // of (its database is not loaded) is kept, so it is never lost silently. `needs` says, per package other than postapoc, how many
  // cells use it and which ids (for "why is this package still there").
  function collectPackages(out, before, ixHex, ixBld, resolvePackages) {
    const pkgOf = id => {
      const r = ixBld.byId.get(low(id)) || ixHex.byId.get(low(id));
      return r ? (r.package || 'postapoc') : null;
    };
    const used = new Set(['postapoc']);
    const needs = {};
    const use = id => {
      if (typeof id !== 'string' || id === '') return;
      const p = pkgOf(id);
      if (!p) return;
      used.add(p);
      if (p === 'postapoc') return;
      const e = needs[p] || (needs[p] = { count: 0, ids: {} });
      e.count++; e.ids[id] = (e.ids[id] || 0) + 1;
    };
    if (Array.isArray(out.data)) for (const row of out.data) if (Array.isArray(row)) row.forEach(use);
    if (Array.isArray(out.objects)) for (const o of out.objects) if (o && typeof o === 'object') use(o.id);
    const known = new Set();
    for (const ix of [ixHex, ixBld]) for (const r of ix.byId.values()) known.add(r.package || 'postapoc');
    for (const p of before) if (!known.has(p)) used.add(p);
    if (typeof resolvePackages === 'function') {
      try { for (const p of resolvePackages([...used]) || []) used.add(p); } catch (e) { /* dependencies unknown: keep what is used */ }
    }
    return { list: [...used].sort(), needs };
  }

  /**
   * @param json  parsed map file (never modified)
   * @param ctx   { target: 'hs', hex: [{id,type,package,skinSlot}], bld: [...], prefixOf?: fn, resolvePackages?: ids => ids with dependencies }
   * @returns { json, report, packages: { before: [...], after: [...], needs: { pkg: { count, ids } } } }
   */
  function convert(json, ctx) {
    const target = ctx && ctx.target;
    if (!json || typeof json !== 'object') throw new Error('MapConvert: no map');
    if (!target || target === 'postapoc') throw new Error('MapConvert: the target must be a non-base package id');
    const prefixFn = (ctx && ctx.prefixOf) || prefixOf;
    const ixHex = index(ctx.hex, target), ixBld = index(ctx.bld, target);
    const out = JSON.parse(JSON.stringify(json));
    const report = newReport();
    const cache = { hex: new Map(), bld: new Map() };

    // One id through the cache. `prefer` is the kind to try first ('hex' in the terrain layer, 'bld' in objects): the terrain layer
    // can hold building ids too (a building painted as a tile), and an id is only a hex or a building, never both.
    const map = (prefer, id, count) => {
      if (typeof id !== 'string' || id === '') return id;
      const other = prefer === 'hex' ? 'bld' : 'hex';
      const ix = k => (k === 'hex' ? ixHex : ixBld);
      let kind = prefer;
      if (!ix(prefer).byId.has(low(id)) && ix(other).byId.has(low(id))) kind = other;
      const c = cache[kind];
      let res = c.get(id);
      if (!res) { res = resolve(kind, id, ix(kind), target, prefixFn); c.set(id, res); }
      note(report[kind], id, res, count);
      return res.id;
    };

    if (Array.isArray(out.data)) {
      for (const row of out.data) {
        if (!Array.isArray(row)) continue;
        for (let i = 0; i < row.length; i++) row[i] = map('hex', row[i], 1);
      }
    }
    if (Array.isArray(out.objects)) for (const o of out.objects) if (o && typeof o === 'object') o.id = map('bld', o.id, 1);
    if (Array.isArray(out.tileExtras)) {
      for (const t of out.tileExtras) if (t && typeof t === 'object' && t.underTerrainId) t.underTerrainId = map('hex', t.underTerrainId, 1);
    }
    if (Array.isArray(out.biomePresets)) {
      for (const p of out.biomePresets) {
        if (!p || typeof p !== 'object') continue;
        if (p.terrainWeights && typeof p.terrainWeights === 'object') {
          const w = {};
          for (const [k, v] of Object.entries(p.terrainWeights)) { const nk = map('hex', k, 1); w[nk] = (w[nk] || 0) + v; }
          p.terrainWeights = w;
        }
        if (Array.isArray(p.forbiddenTerrain)) p.forbiddenTerrain = p.forbiddenTerrain.map(f => map('hex', f, 1));
      }
    }

    const before = Array.isArray(json.packages) ? json.packages.slice() : [];
    const { list, needs } = collectPackages(out, before, ixHex, ixBld, ctx && ctx.resolvePackages);
    out.packages = list;
    return { json: out, report, packages: { before, after: out.packages, needs } };
  }

  // One line per kind for a status line or a log.
  function summary(report) {
    const f = (b, name) => `${name}: ${b.converted} converted, ${b.same} already in the package, ${b.keptBase} base kept, `
      + `${b.missing} without a counterpart, ${b.typeMismatch} with another type, ${b.unknown} unknown`;
    return [f(report.hex, 'tiles'), f(report.bld, 'buildings')].join('\n');
  }

  return { convert, summary, prefixOf, resolve };
}));
