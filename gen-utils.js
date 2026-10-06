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

  // Farthest-point sampling: the first pick is random, every next pick maximises its distance to the picks so far.
  function spreadPick(candidates, count, rng, dist) {
    count = _count(count);
    if (!candidates.length || count === 0) return [];
    const picked = [candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]];
    const best = candidates.map(c => dist(c, picked[0]));
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

  return { luminanceGrid, resampleToMap, fitWithin, normalize, applySeaLevel, spreadPick, poissonPick, oreCluster };
})();
