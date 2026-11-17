// pattern-brush.js - the PatternBrush module: paints a map fragment (a "pattern") tiled over the brushed cells, like a Photoshop pattern stamp.
// CLASSIC script, not a module: `const PatternBrush` is a global lexical binding like Brush (brush.js). No DOM, no editor globals: the pure core,
// so it also loads in Node (module.exports at the bottom) for tests. The editor connects it to the brush (Tools, tool 'pattern').
//
// Three extension seams, see docs/superpowers/specs/2026-11-17-pattern-brush-design.md:
//   Pattern  { name, w, h, ids: (string|null)[] }  rectangular, row by row, null = nothing drawn
//   Source   registerSource(key, { label, load(arg) -> Pattern })            where a pattern comes from
//   Mapper   registerMapper(key, { label, pick(pattern, col, row, opts) -> id|null })   which pattern cell lands on which map cell
// Stroke options (`opts`): { mapper: 'grid', ox: 0, oy: 0, skip: [ids never drawn], ...anything a mapper wants }.
const PatternBrush = (() => {
  const MAX_CELLS = 1000000;   // a pattern bigger than 1000x1000 is not a pattern
  const _sources = new Map(), _mappers = new Map();

  const mod = (a, n) => ((a % n) + n) % n;

  // ── pattern ─────────────────────────────────────────────
  /** Validates and normalises a pattern; throws a readable error. Empty strings and non-strings become null (nothing drawn). */
  function makePattern(w, h, ids, name) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error('Pattern: size must be at least 1x1');
    if (w * h > MAX_CELLS) throw new Error('Pattern: too big (' + w + 'x' + h + ', limit ' + MAX_CELLS + ' cells)');
    if (!Array.isArray(ids) || ids.length !== w * h) throw new Error('Pattern: expected ' + (w * h) + ' cells, got ' + (Array.isArray(ids) ? ids.length : 'none'));
    return { name: String(name || 'Pattern'), w, h, ids: ids.map(v => (typeof v === 'string' && v !== '' ? v : null)) };
  }
  /** Pattern cell at (c, r) with wrap-around; any integers. */
  function cellAt(pattern, c, r) { return pattern.ids[mod(r, pattern.h) * pattern.w + mod(c, pattern.w)]; }

  // ── registries ──────────────────────────────────────────
  function registerSource(key, def) {
    if (!key || !def || typeof def.load !== 'function') throw new Error('registerSource: a key and { load } are required');
    _sources.set(key, { label: def.label || key, load: def.load });
  }
  function registerMapper(key, def) {
    if (!key || !def || typeof def.pick !== 'function') throw new Error('registerMapper: a key and { pick } are required');
    _mappers.set(key, { label: def.label || key, pick: def.pick });
  }
  const listSources = () => [..._sources].map(([key, d]) => ({ key, label: d.label }));
  const listMappers = () => [..._mappers].map(([key, d]) => ({ key, label: d.label }));
  /** Loads a pattern from a registered source. */
  async function load(sourceKey, arg) {
    const s = _sources.get(sourceKey);
    if (!s) throw new Error('Pattern source "' + sourceKey + '" is not registered');
    const p = await s.load(arg);
    return makePattern(p.w, p.h, p.ids, p.name);
  }

  // ── core: which id goes on which cell ───────────────────
  /**
   * The cells to write for a brushed area: [{ col, row, id }] (cells whose pattern id is empty or in opts.skip are left out).
   * `cells` are map cells ({ col, row }); the editor passes the brush footprint (already symmetry-expanded) and writes the result with _writeTerrain.
   */
  function cellsFor(cells, pattern, opts) {
    const o = Object.assign({ mapper: 'grid', ox: 0, oy: 0, skip: [] }, opts || {});
    const m = _mappers.get(o.mapper);
    if (!m) throw new Error('Pattern mapper "' + o.mapper + '" is not registered');
    const skip = new Set((o.skip || []).map(s => String(s).toLowerCase()));
    const out = [];
    for (const c of cells) {
      const id = m.pick(pattern, c.col, c.row, o);
      if (id == null || skip.has(id.toLowerCase())) continue;
      out.push({ col: c.col, row: c.row, id });
    }
    return out;
  }

  // ── built-in mapper: grid (variant A) ───────────────────
  // The pattern is pinned to the map grid: cell (col,row) shows pattern cell ((col-ox) mod w, (row-oy) mod h), wherever and whenever you paint.
  // Hex grids shift odd rows, so a pattern of odd height changes parity at every repeat: use an even height (a 50x50 map is fine).
  registerMapper('grid', { label: 'Tiled on the map grid', pick: (p, col, row, o) => cellAt(p, col - (o.ox | 0), row - (o.oy | 0)) });

  // ── built-in sources ────────────────────────────────────
  // map: the parsed JSON of a map file ({ width, height, data: string[][] }), arg = { json, name }
  registerSource('map', {
    label: 'A map',
    load: ({ json, name }) => {
      if (!json || !Array.isArray(json.data) || !json.data.length || !Array.isArray(json.data[0])) throw new Error('Not a map: no "data" rows');
      const h = json.data.length, w = json.data[0].length;
      if (json.data.some(r => !Array.isArray(r) || r.length !== w)) throw new Error('Not a map: rows have different lengths');
      return { name: name || 'Map ' + w + 'x' + h, w, h, ids: json.data.flat() };
    },
  });
  // cells: a rectangle of {col,row,id} (the editor's selection or a stamp rasterised to map cells), arg = { cells, name }; gaps stay empty
  registerSource('cells', {
    label: 'Selected cells',
    load: ({ cells, name }) => {
      if (!Array.isArray(cells) || !cells.length) throw new Error('Nothing selected');
      let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
      for (const c of cells) { c0 = Math.min(c0, c.col); c1 = Math.max(c1, c.col); r0 = Math.min(r0, c.row); r1 = Math.max(r1, c.row); }
      const w = c1 - c0 + 1, h = r1 - r0 + 1;
      if (w * h > MAX_CELLS) throw new Error('Selection is too large for a pattern');
      const ids = new Array(w * h).fill(null);
      for (const c of cells) ids[(c.row - r0) * w + (c.col - c0)] = c.id || null;
      return { name: name || 'Selection ' + w + 'x' + h, w, h, ids };
    },
  });

  return { makePattern, cellAt, cellsFor, registerSource, registerMapper, listSources, listMappers, load, MAX_CELLS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PatternBrush;
