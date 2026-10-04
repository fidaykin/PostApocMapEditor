// hex-utils.js - pure hex-grid geometry for the editor. No DOM and no editor globals.
// Grid model (matches Canvas.hexCenterWorld): flat-top odd-q offset with
//   q = (H - 1 - row) - floor(H / 2)                 (screen x axis, odd q columns are shifted UP)
//   r = (col - floor(W / 2)) - (q - (q & 1)) / 2
// col grows UP the screen and row grows toward the WEST. Cube = { q, r, s = -q - r }.
// rotateCube turns SCREEN-CLOCKWISE; mirrorCube 'h' flips left/right, 'v' flips top/bottom.
(function (root) {
  'use strict';
  const _par = n => ((n % 2) + 2) % 2;
  const _z = v => v + 0;                       // normalises -0 to 0 so equality checks behave

  const CUBE_DIRS = [
    { q: 1, r: -1, s: 0 }, { q: 1, r: 0, s: -1 }, { q: 0, r: 1, s: -1 },
    { q: -1, r: 1, s: 0 }, { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 },
  ];

  function toCube(col, row, W, H) {
    const q = (H - 1 - row) - Math.floor(H / 2);
    const r = (col - Math.floor(W / 2)) - (q - _par(q)) / 2;
    return { q: _z(q), r: _z(r), s: _z(0 - q - r) };
  }

  function fromCube(c, W, H) {
    const row = H - 1 - (c.q + Math.floor(H / 2));
    const col = c.r + (c.q - _par(c.q)) / 2 + Math.floor(W / 2);
    return { col: _z(col), row: _z(row) };
  }

  function cubeDistance(a, b) {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  }

  function cubeRound(f) {
    let q = Math.round(f.q), r = Math.round(f.r), s = Math.round(f.s);
    const dq = Math.abs(q - f.q), dr = Math.abs(r - f.r), ds = Math.abs(s - f.s);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s; else s = -q - r;
    return { q: _z(q), r: _z(r), s: _z(s) };
  }

  // Cube lerp line. The 1e-6 nudge keeps exact-edge ties from flipping between runs.
  function cubeLine(a, b) {
    const n = cubeDistance(a, b), out = [];
    const e = { q: a.q + 1e-6, r: a.r + 2e-6, s: a.s - 3e-6 };
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      out.push(cubeRound({ q: e.q + (b.q - e.q) * t, r: e.r + (b.r - e.r) * t, s: e.s + (b.s - e.s) * t }));
    }
    return out;
  }

  function cubeDisc(center, radius) {
    const out = [];
    for (let dq = -radius; dq <= radius; dq++)
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++)
        out.push({ q: center.q + dq, r: center.r + dr, s: _z(center.s - dq - dr) });
    return out;
  }

  function cubeRing(center, radius) {
    if (radius === 0) return [{ q: center.q, r: center.r, s: center.s }];
    const out = [];
    let c = { q: center.q + CUBE_DIRS[4].q * radius, r: center.r + CUBE_DIRS[4].r * radius, s: center.s + CUBE_DIRS[4].s * radius };
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < radius; j++) {
        out.push(c);
        const d = CUBE_DIRS[i];
        c = { q: c.q + d.q, r: c.r + d.r, s: c.s + d.s };
      }
    }
    return out;
  }

  function rotateCube(c, steps) {
    let { q, r, s } = c;
    steps = ((steps % 6) + 6) % 6;
    for (let i = 0; i < steps; i++) { const nq = -s, nr = -q, ns = -r; q = nq; r = nr; s = ns; }
    return { q: _z(q), r: _z(r), s: _z(s) };
  }

  function mirrorCube(c, axis) {
    return axis === 'h'
      ? { q: _z(-c.q), r: _z(-c.s), s: _z(-c.r) }
      : { q: _z(c.q), r: _z(c.s), s: _z(c.r) };
  }

  function inBounds(col, row, W, H) { return col >= 0 && col < W && row >= 0 && row < H; }

  function cellsFromCubes(cubes, W, H) {
    const out = [], seen = new Set();
    for (const c of cubes) {
      const p = fromCube(c, W, H);
      if (!inBounds(p.col, p.row, W, H)) continue;
      const k = p.col + ',' + p.row;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    return out;
  }

  // Fast path for inputs whose cubes are already pairwise distinct (disc): fromCube is a bijection, so
  // no dedup is needed. Avoids the string-keyed Set and the intermediate cube objects.
  function _distinctCells(center, radius, W, H) {
    const out = [], hh = Math.floor(H / 2), wh = Math.floor(W / 2);
    for (let dq = -radius; dq <= radius; dq++) {
      const q = center.q + dq, row = H - 1 - (q + hh);
      if (row < 0 || row >= H) continue;
      const half = (q - _par(q)) / 2 + wh;
      const lo = Math.max(-radius, -dq - radius), hi = Math.min(radius, -dq + radius);
      for (let dr = lo; dr <= hi; dr++) {
        const col = center.r + dr + half;
        if (col >= 0 && col < W) out.push({ col, row });
      }
    }
    return out;
  }

  const _add = (c, d) => ({ q: c.q + d.q, r: c.r + d.r, s: c.s + d.s });
  function neighbors(col, row, W, H) {
    const c = toCube(col, row, W, H);
    return cellsFromCubes(CUBE_DIRS.map(d => _add(c, d)), W, H);
  }
  function discCells(col, row, radius, W, H) {
    return _distinctCells(toCube(col, row, W, H), radius, W, H);
  }
  // Ring cubes are pairwise distinct, so no dedup: clip in the original cubeRing walk order.
  function ringCells(col, row, radius, W, H) {
    const out = [];
    for (const c of cubeRing(toCube(col, row, W, H), radius)) {
      const p = fromCube(c, W, H);
      if (inBounds(p.col, p.row, W, H)) out.push(p);
    }
    return out;
  }
  function lineCells(a, b, W, H) {
    return cellsFromCubes(cubeLine(toCube(a.col, a.row, W, H), toCube(b.col, b.row, W, H)), W, H);
  }

  // Unit-size flat-top pixel centre (screen y points down). Matches hexCenterWorld up to a constant offset.
  function cubeToPixel(c) { return { x: 1.5 * c.q, y: -Math.sqrt(3) * (c.r + c.q / 2) }; }

  function _inPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // Cells on the outline (cube lines between consecutive vertices) plus, when filled, every cell whose
  // centre is inside the polygon (even-odd rule, so concave polygons are exact). Clipped to the map.
  function polygonCells(verts, W, H, filled) {
    const out = new Map();
    const add = c => out.set(c.q + ',' + c.r, c);
    if (verts.length === 1) add(verts[0]);
    else for (let i = 0; i < verts.length; i++) {
      for (const c of cubeLine(verts[i], verts[(i + 1) % verts.length])) add(c);
      if (verts.length === 2) break;
    }
    if (filled !== false && verts.length >= 3) {
      const px = verts.map(cubeToPixel);
      let qMin = Infinity, qMax = -Infinity, rMin = Infinity, rMax = -Infinity;
      for (const v of verts) { qMin = Math.min(qMin, v.q); qMax = Math.max(qMax, v.q); rMin = Math.min(rMin, v.r); rMax = Math.max(rMax, v.r); }
      // The bounding box in (q, r) is a superset of the polygon: r spans at most the vertex r range plus half the q range.
      const rLo = rMin - Math.ceil((qMax - qMin) / 2) - 1, rHi = rMax + Math.ceil((qMax - qMin) / 2) + 1;
      for (let q = qMin; q <= qMax; q++)
        for (let r = rLo; r <= rHi; r++) {
          const c = { q, r, s: 0 - q - r };
          if (!out.has(q + ',' + r) && _inPoly(cubeToPixel(c), px)) add(c);
        }
    }
    return cellsFromCubes([...out.values()], W, H);
  }

  root.HexUtils = {
    CUBE_DIRS, toCube, fromCube, cubeDistance, cubeRound, cubeLine, cubeDisc, cubeRing,
    rotateCube, mirrorCube, inBounds, cellsFromCubes, neighbors, discCells, ringCells, lineCells,
    cubeToPixel, polygonCells,
  };
})(typeof self !== 'undefined' ? self : this);
