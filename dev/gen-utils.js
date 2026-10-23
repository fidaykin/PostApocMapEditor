// gen-utils.js - pure helpers for map generation. No DOM, no editor globals.
const GenUtils = (() => {
  // ── Heightmap import ─────────────────────────────────────────
  function luminanceGrid(rgba, w, h) {
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
      out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    return out;
  }

  // Resample an image (row-major, w*h) onto the map grid, indexed [row*W+col], with the SCREEN orientation of the grid
  // (Unity axis flip, see Canvas.hexCenterWorld): the horizontal screen axis is the ROW axis (xi = H-1-row grows east)
  // and the vertical screen axis is the COL axis (col grows north), so a north-up, west-left image lands the same way
  // round on screen. The image is stretched over the bounding box of the hex grid (cell centres +/- half a hex):
  //   x: centre 1.5*xi (units of the hex circumradius), extent +/-1  -> fx = (1.5*xi + 1) / (1.5*(H-1) + 2)
  //   y: centre yu in row pitches, extent +/-0.5, odd worldX (xi - floor(H/2)) columns sit half a pitch UP
  //      -> fy = (yu + 0.5) / (W + 0.5), yu = (W-1-col) + 0.5 - (odd ? 0.5 : 0)
  // Nearest neighbour (as the design spec says), deterministic, exactly W*H source reads whatever the image size.
  function resampleToMap(src, sw, sh, W, H) {
    const out = new Float32Array(W * H);
    const halfH = Math.floor(H / 2), xDen = 1.5 * (H - 1) + 2, yDen = W + 0.5;
    const sxOf = new Int32Array(H);
    for (let row = 0; row < H; row++)
      sxOf[row] = Math.max(0, Math.min(sw - 1, Math.floor(((1.5 * (H - 1 - row) + 1) / xDen) * sw)));
    for (let row = 0; row < H; row++) {
      const xi = H - 1 - row, odd = ((xi - halfH) % 2) !== 0;
      const sx = sxOf[row];
      for (let col = 0; col < W; col++) {
        const yu = (W - 1 - col) + (odd ? 0 : 0.5);
        const sy = Math.max(0, Math.min(sh - 1, Math.floor(((yu + 0.5) / yDen) * sh)));
        out[row * W + col] = src[sy * sw + sx];
      }
    }
    return out;
  }

  // Largest size that fits `max` on both sides, aspect kept, never below 1 px. Used to bound the per-pixel work of an
  // import: the image is scaled down by the browser BEFORE any pixel is read.
  function fitWithin(w, h, max) {
    if (w <= max && h <= max) return { w, h };
    const k = max / Math.max(w, h);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  function normalize(grid) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (v < min) min = v; if (v > max) max = v; }
    const out = new Float32Array(grid.length);
    if (!(max > min)) { out.fill(0.5); return { grid: out, flat: true }; }
    const span = max - min;
    for (let i = 0; i < grid.length; i++) out[i] = (grid[i] - min) / span;
    return { grid: out, flat: false };
  }

  function applySeaLevel(grid, offset) {
    const out = new Float32Array(grid.length);
    for (let i = 0; i < grid.length; i++) out[i] = Math.max(0, Math.min(1, grid[i] - offset));
    return out;
  }

  // ── Placement primitives (T3.7) ──────────────────────────────
  // Pure: the caller supplies the candidates, a seeded rng (never Math.random here) and the metric `dist(a, b)`; nothing is
  // read from the page and no input is mutated. Cost: spreadPick O(candidates * count), poissonPick O(candidates * picks) worst case.
  function _count(n) { n = Math.floor(Number(n)); return n > 0 ? n : 0; }
  function _shuffled(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Farthest-point sampling: every pick maximises its distance to the picks so far AND to the points in `taken` (already placed
  // things of other kinds). With nothing taken the first pick is random (unchanged); with `taken` the first pick is the
  // candidate farthest from them (deterministic, first on ties).
  function spreadPick(candidates, count, rng, dist, taken) {
    count = _count(count);
    if (!candidates.length || count === 0) return [];
    const t = taken || [];
    const picked = [];
    let best;
    if (t.length) {
      best = candidates.map(c => { let m = Infinity; for (let j = 0; j < t.length; j++) { const d = dist(c, t[j]); if (d < m) m = d; } return m; });
    } else {
      picked.push(candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]);
      best = candidates.map(c => dist(c, picked[0]));
    }
    while (picked.length < count && picked.length < candidates.length) {
      let bi = -1, bd = 0;
      for (let i = 0; i < candidates.length; i++) if (best[i] > bd) { bd = best[i]; bi = i; }
      if (bi < 0) break;                                   // every remaining candidate coincides with a pick
      picked.push(candidates[bi]);
      for (let i = 0; i < candidates.length; i++) { const d = dist(candidates[i], candidates[bi]); if (d < best[i]) best[i] = d; }
    }
    return picked;
  }

  // Random-order rejection sampling: nothing closer than `minSpacing` to an earlier pick or to anything in `taken`.
  function poissonPick(candidates, count, minSpacing, rng, dist, taken) {
    count = _count(count);
    const picked = [], all = (taken || []).slice();
    if (count === 0) return picked;
    for (const c of _shuffled(candidates, rng)) {
      if (picked.length >= count) break;
      let ok = true;
      for (let i = 0; i < all.length; i++) if (dist(c, all[i]) < minSpacing) { ok = false; break; }
      if (ok) { picked.push(c); all.push(c); }
    }
    return picked;
  }

  // A deposit: the centre first, then random distinct cells of its radius-2 disc (at most the 19 cells of the disc).
  // `center` is a cube {q,r,s}; the cells are cubes too.
  function oreCluster(center, size, rng) {
    size = Math.min(_count(size), 19);
    if (size === 0) return [];
    const ring = [];
    for (let dq = -2; dq <= 2; dq++)
      for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr++)
        if (dq !== 0 || dr !== 0) ring.push({ q: center.q + dq, r: center.r + dr, s: center.s - dq - dr });
    return [{ q: center.q, r: center.r, s: center.s }].concat(_shuffled(ring, rng).slice(0, size - 1));
  }

  // ── Tile classes ─────────────────────────────────────────────
  // role -> preferred id and HexDB `type` (the class used when the preferred id is missing).
  const ROLE_SPEC = {
    WATER_DARK:   { id: 'Water_Dirty_1',  cls: 'Water' },
    WATER_LIGHT:  { id: 'Water_1',        cls: 'Water' },
    WATER_ROCK:   { id: 'Water_Rock_1',   cls: 'Water' },
    RUBBLE_1:     { id: 'Rubble_1',       cls: 'Rubble' },
    RUBBLE_2:     { id: 'Rubble_2',       cls: 'Rubble' },
    RUBBLE_3:     { id: 'Rubble_3',       cls: 'Rubble' },
    PLAIN_1:      { id: 'Plain_1',        cls: 'Plains' },
    PLAIN_2:      { id: 'Plain_2',        cls: 'Plains' },
    BROKEN_PLAIN: { id: 'BrokenPlane_1',  cls: null, like: 'PLAIN_2' },
    FOREST_1:     { id: 'Forest_1',       cls: 'Forests' },
    FOREST_2:     { id: 'Forest_2',       cls: 'Forests' },
    FOREST_3:     { id: 'Forest_3',       cls: 'Forests' },
    HILLS:        { id: 'Hills_1',        cls: 'Hills/Mountains' },
    MOUNTAIN:     { id: 'Mountain_1',     cls: 'Hills/Mountains' },
    GOLD:         { id: 'GoldVein_1',     cls: 'Resources' },
    OIL:          { id: 'Oil_1',          cls: 'Resources' },
    BARREN:       { id: 'Barren_1',       cls: 'Barren/Desert' },
    DESERT:       { id: 'Desert_1',       cls: 'Barren/Desert' },
    SWAMP:        { id: 'Swamp_1',        cls: 'Swamp' },
    LAVA:         { id: 'Lava_Plain_1',   cls: 'Volcanic/Rift' },
    LAVA_RIFT:    { id: 'Lava_Rift_1',    cls: 'Volcanic/Rift' },
    RIFT:         { id: 'Rift_1',         cls: 'Volcanic/Rift' },
  };
  const _EXCLUDE = /_test|kaiju|chicken|settlement/i;
  const _sid = h => !!h && typeof h.id === 'string' && h.id !== '';
  function _plainEntry(h) {
    return _sid(h) && !(Array.isArray(h.occupiedOffsets) && h.occupiedOffsets.length) && !h.isLayered &&
           !(Array.isArray(h.edgeFaces) && h.edgeFaces.length) && !_EXCLUDE.test(h.id);
  }
  function _idCmp(a, b) {
    const la = a.toLowerCase(), lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  }

  // Resolve every role to a tile id of `entries` (HexDB entries: id, type, occupiedOffsets, isLayered, edgeFaces).
  // Order: the exact preferred id (case-insensitive); else a plain tile of the role's class (candidates sorted by id,
  // preferring ids no other role holds, cycling when the class has fewer tiles than roles); else the role's `like`
  // role; else the raw preferred id (it renders as the fallback colour, see missingRoles). Pure and deterministic.
  function resolveRoles(entries) {
    entries = (Array.isArray(entries) ? entries : []).filter(_sid);
    const byLower = new Map();
    for (const h of entries) { const lo = h.id.toLowerCase(); if (!byLower.has(lo)) byLower.set(lo, h.id); }
    const out = {};
    for (const [role, spec] of Object.entries(ROLE_SPEC))
      if (byLower.has(spec.id.toLowerCase())) out[role] = byLower.get(spec.id.toLowerCase());
    for (const [role, spec] of Object.entries(ROLE_SPEC)) {
      if (out[role] || !spec.cls) continue;
      const pool = [...new Set(entries.filter(h => h.type === spec.cls && _plainEntry(h)).map(h => h.id))].sort(_idCmp);
      if (!pool.length) continue;
      const taken = new Set(Object.values(out));
      out[role] = pool.find(id => !taken.has(id)) || pool[0];
    }
    const res = {};
    for (const [role, spec] of Object.entries(ROLE_SPEC))
      res[role] = out[role] || (spec.like && out[spec.like]) || spec.id;
    return res;
  }

  // Roles whose resolved id is not a tile of `entries` at all (nothing of the class was left to stand in).
  function missingRoles(entries, table) {
    const have = new Set((Array.isArray(entries) ? entries : []).filter(_sid).map(h => h.id.toLowerCase()));
    return Object.keys(ROLE_SPEC).filter(r => !table || typeof table[r] !== 'string' || !have.has(table[r].toLowerCase()));
  }

  return { ROLE_SPEC, resolveRoles, missingRoles, luminanceGrid, resampleToMap, fitWithin, normalize, applySeaLevel, spreadPick, poissonPick, oreCluster };
})();
