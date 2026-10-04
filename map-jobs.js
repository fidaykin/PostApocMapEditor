/* map-jobs.js: heavy, DOM-free map jobs.
   Loaded as a classic <script> by MapEditorPro.html (synchronous fallback) and via
   importScripts() by map-worker.js. Must not touch document/window/Terrain/HexDB. */
(function (root) {
  'use strict';
  const MapJobs = {};
  // Bump when the job protocol/algorithms change; the page sends its expected value and the worker refuses on mismatch.
  MapJobs.VERSION = 2;

// ── Satellite classification (moved verbatim from MapEditorPro.html, then parameterised) ──
  function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h * 360, s, l];
  }

  function _sample(px, _w, _h, W, H, col, row, sampleR) {
    const cx = (col / W) * _w;
    const cy = (row / H) * _h;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let dy = -sampleR; dy <= sampleR; dy++) {
      for (let dx = -sampleR; dx <= sampleR; dx++) {
        if (dx * dx + dy * dy > sampleR * sampleR) continue;
        const ix = Math.max(0, Math.min(_w - 1, Math.round(cx + dx)));
        const iy = Math.max(0, Math.min(_h - 1, Math.round(cy + dy)));
        const i  = (iy * _w + ix) * 4;
        sr += px[i]; sg += px[i+1]; sb += px[i+2];
        n++;
      }
    }
    return [sr / n, sg / n, sb / n];
  }

  function _classifyColor(T, r, g, b, sens) {
    const [h, s, l] = _rgbToHsl(r, g, b);

    if (l < 0.09) return T.RIFT;
    if ((h < 25 || h > 335) && s > 0.50 && l > 0.12 && l < 0.55) return T.LAVA;

    const wSatMin = 0.42 - sens * 0.32;
    if (h >= 170 && h <= 268 && s > wSatMin && l < 0.70) return l < 0.32 ? T.WATER_DARK : T.WATER_LIGHT;

    if (s < 0.18 && l > 0.74 - (1 - sens) * 0.12) return T.MOUNTAIN;
    if (s < 0.20) {
      if (l > 0.56) return T.HILLS;
      if (l > 0.30) return T.RUBBLE_1;
      return T.RIFT;
    }

    const fSatMin = 0.28 - sens * 0.20;
    if (h >= 78 && h <= 168) {
      if (s > fSatMin) {
        if (l < 0.22) return T.SWAMP;
        if (l < 0.37) return T.FOREST_2;
        if (l < 0.53) return T.FOREST_1;
        return T.PLAIN_1;
      }
      if (l < 0.30) return T.SWAMP;
      if (l < 0.50) return T.PLAIN_2;
      return T.PLAIN_1;
    }
    if (h >= 50 && h < 78) {
      if (s > 0.30 && l > 0.52) return T.PLAIN_1;
      if (s > 0.22 && l > 0.38) return T.PLAIN_2;
      return T.BARREN;
    }
    if (h >= 30 && h < 60 && s > 0.28 && l > 0.56) return T.DESERT;
    if (h >= 12 && h < 50) {
      if (l > 0.52 && s > 0.22) return T.BARREN;
      if (l > 0.36 && s > 0.18) return T.RUBBLE_1;
      return T.RUBBLE_2;
    }
    return T.PLAIN_1;
  }

  // job: { pixels:Uint8ClampedArray RGBA, w, h, W, H, T, sampleR, sens, flipY }
  // returns { names:string[], out:Uint8Array(W*H) } where out[row*W+col] indexes names
  MapJobs.satellite = function (job, onProgress) {
    const { pixels, w, h, W, H, T, sampleR, sens, flipY } = job;
    const names = Array.from(new Set(Object.values(T)));
    const lut = new Map(names.map((n, i) => [n, i]));
    const out = new Uint8Array(W * H);
    for (let row = 0; row < H; row++) {
      if (onProgress && (row & 15) === 0) onProgress(row / H);
      const srcRow = flipY ? H - 1 - row : row;
      for (let col = 0; col < W; col++) {
        const [r, g, b] = _sample(pixels, w, h, W, H, col, srcRow, sampleR);
        out[row * W + col] = lut.get(_classifyColor(T, r, g, b, sens));
      }
    }
    if (onProgress) onProgress(1);
    return { names, out };
  };


// ── Generator core (moved from MapEditorPro.html Generator, then parameterised) ──
  // Keep in sync: tests/edge-drift.spec.ts (runs this and EdgeTiling.resolveEdgeTile on identical inputs).
  // Port of EdgeTiling.resolveEdgeTile; tables come from the page (HexDB is not visible here). Neighbour order
  // (edge.faceNames), the mask lookup and the rng consumption (one draw per resolved tile) are identical.
  function _resolveEdgeTile(col, row, W, H, dataArr, edge, rng, fallbackIds) {
    const dirs = (H - 1 - row) % 2 !== 0 ? edge.dirsEven : edge.dirsOdd;
    let mask = 0;
    edge.faceNames.forEach((name, i) => {
      const [dc, dr] = dirs[name];
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nc >= W || nr < 0 || nr >= H) return;
      const nId = dataArr[nr * W + nc];
      const t = (nId && typeof nId === 'string') ? edge.typeByLowerId.get(nId.toLowerCase()) : undefined;
      if (t === 'Water' || t === 'Rivers') mask |= (1 << i);
    });
    const options = edge.table[mask];
    if (options && options.length) return options[Math.floor(rng() * options.length)];
    return fallbackIds[Math.floor(rng() * fallbackIds.length)];
  }

  function _makeNoise2D(seedOff) {
    const s = (seedOff * 2246822519) >>> 0;
    function h(xi, yi) {
      let v = (Math.imul(xi, 374761393) + Math.imul(yi, 1103515245) + s) >>> 0;
      v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0;
      return ((v ^ (v >>> 15)) >>> 0) / 4294967295.0;
    }
    return (x, y) => {
      const gx=Math.floor(x), gy=Math.floor(y), fx=x-gx, fy=y-gy;
      const ux=fx*fx*(3-2*fx), uy=fy*fy*(3-2*fy);
      const a=h(gx,gy), b=h(gx+1,gy), c=h(gx,gy+1), d=h(gx+1,gy+1);
      return a+(b-a)*ux+(c-a)*uy+(d-b+a-c)*ux*uy;
    };
  }

  function _multiOctave(seed, scale) {
    const n1=_makeNoise2D(seed), n2=_makeNoise2D(seed+1000), n3=_makeNoise2D(seed+2000);
    return (x, y) =>
      n1(x*scale, y*scale)*0.55 +
      n2(x*scale*2.1, y*scale*2.1)*0.30 +
      n3(x*scale*4.5, y*scale*4.5)*0.15;
  }

  function _lcg(seed) {
    let s = seed >>> 0;
    return () => { s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296.0; };
  }

  function _classify(T, e, m, b, mThr, hThr, wThr) {
    if (e > mThr) {
      const ex = e - mThr;
      if (ex > 0.13) return b > 0.65 ? T.LAVA_RIFT : T.LAVA;
      if (b > 0.75)  return T.RIFT;
      return b > 0.45 ? T.MOUNTAIN : T.HILLS;
    }
    if (e > hThr) {
      if (m > 0.65 && b > 0.50) return T.FOREST_3;
      if (m > 0.55) return b > 0.60 ? T.FOREST_2 : T.FOREST_3;
      if (b > 0.60) return T.FOREST_3;
      return T.HILLS;
    }
    if (e < wThr) {
      const depth = (wThr - e) / wThr;
      const waterV = [T.WATER_DARK, T.WATER_LIGHT, T.WATER_ROCK];
      if (depth > 0.55) return waterV[Math.floor(b * 3) % 3];
      return m > 0.55 ? T.SWAMP : (b > 0.50 ? T.WATER_LIGHT : T.WATER_DARK);
    }
    const norm = (e - wThr) / Math.max(hThr - wThr, 0.001);
    if (m < 0.28) {
      if (b < 0.35) return norm > 0.50 ? T.BARREN : T.DESERT;
      if (b < 0.65) return norm > 0.50 ? T.BARREN : T.BROKEN_PLAIN;
      return norm > 0.60 ? T.HILLS : T.RUBBLE_3;
    }
    if (m > 0.70) {
      if (b < 0.30) return norm > 0.45 ? T.SWAMP : T.WATER_DARK;
      if (b < 0.60) return norm > 0.50 ? T.FOREST_2 : T.FOREST_1;
      return norm > 0.55 ? T.FOREST_3 : T.SWAMP;
    }
    if (m < 0.45) {
      if (b < 0.25) return norm > 0.55 ? T.RUBBLE_3 : T.BARREN;
      if (b < 0.55) return norm > 0.50 ? T.BROKEN_PLAIN : T.PLAIN_1;
      if (b < 0.80) return norm > 0.45 ? T.PLAIN_2 : T.PLAIN_1;
      return norm > 0.60 ? T.RUBBLE_1 : T.BROKEN_PLAIN;
    }
    if (m < 0.60) {
      if (b < 0.30) return norm > 0.60 ? T.BROKEN_PLAIN : T.PLAIN_1;
      if (b < 0.55) return norm > 0.50 ? T.PLAIN_2 : T.PLAIN_1;
      if (b < 0.75) return norm > 0.45 ? T.FOREST_1 : T.PLAIN_2;
      return norm > 0.50 ? T.FOREST_2 : T.FOREST_1;
    }
    if (b < 0.25) return norm > 0.55 ? T.FOREST_1 : T.SWAMP;
    if (b < 0.50) return norm > 0.50 ? T.FOREST_1 : T.PLAIN_2;
    if (b < 0.75) return norm > 0.45 ? T.FOREST_2 : T.FOREST_1;
    return norm > 0.55 ? T.FOREST_3 : T.FOREST_2;
  }

  // Majority-filter smoothing: each cell becomes whichever terrain ID is most
  // common among its 8 neighbors + itself. Run on the base biome classification
  // only, BEFORE rivers/resources are stamped on top (see call site below) —
  // otherwise a river's single-tile width or a small resource cluster's edges
  // would get voted out by their surrounding neighbors.
  function _smoothTerrain(dest, W, H, passes, onProgress) {
    for (let pass = 0; pass < passes; pass++) {
      const src = dest.slice();
      for (let row = 0; row < H; row++) {
        if (onProgress && (row & 15) === 0) onProgress(row / H);
        for (let col = 0; col < W; col++) {
          const counts = new Map();
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = row + dr, nc = col + dc;
              if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
              const id = src[nr * W + nc];
              counts.set(id, (counts.get(id) || 0) + 1);
            }
          }
          let bestId = src[row * W + col], bestCount = -1;
          for (const [id, count] of counts) {
            if (count > bestCount) { bestCount = count; bestId = id; }
          }
          dest[row * W + col] = bestId;
        }
      }
    }
  }

  function _generateInto(dest, p, opts, T, edge, onProgress) {
    opts = opts || {};
    const W = opts.W, H = opts.H;
    const rng    = _lcg(p.seed);
    const seedE  = Math.floor(rng() * 100000);
    const seedM  = Math.floor(rng() * 100000);
    const seedB  = Math.floor(rng() * 100000);
    const eNoise = _multiOctave(seedE, p.elevScale);
    const mNoise = _multiOctave(seedM, p.moistScale);
    const bNoise = _multiOctave(seedB, p.biomeScale);
    const halfW  = Math.floor(W / 2);
    const halfH  = Math.floor(H / 2);
    const elev   = new Float32Array(W * H);
    const infR   = Math.min(W, H) * 0.08;
    const TARGET_E = 0.46, TARGET_M = 0.50, TARGET_B = 0.55;

    // Continent/coastline mask: elevation falls off toward open ocean far from
    // the map center. Landmass radius is perturbed per-angle by a small seeded
    // noise so the coastline is an irregular blob, not a perfect circle.
    const maxR       = Math.sqrt(halfW * halfW + halfH * halfH);
    const coastNoise = _makeNoise2D(Math.floor(rng() * 100000));
    const COAST_BASE_R  = maxR * p.coastR;      // average landmass radius
    const COAST_WOBBLE   = p.coastWobble;        // +/- fraction of COAST_BASE_R the coastline wobbles by
    const COAST_BAND     = maxR * p.coastBand;   // width of the land->ocean blend band
    const TARGET_OCEAN    = 0.05;          // elevation deep in the ocean, well below any wThr in GEN_PRESETS (min 0.15)

    for (let row = 0; row < H; row++) {
      if (onProgress && (row & 15) === 0) onProgress(0.5 * row / H);
      for (let col = 0; col < W; col++) {
        const dx = col - halfW, dy = row - halfH;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t    = Math.max(0, 1.0 - dist / infR);
        const inf  = t * t * (3 - 2 * t);
        let e = eNoise(col, row)                           * (1-inf) + TARGET_E * inf;
        const m = mNoise(col, row) * (1-inf) + TARGET_M * inf;
        const b = bNoise(col, row) * (1-inf) + TARGET_B * inf;

        // Coastline: sample angular noise as a point on a small circle in noise
        // space (seamless wrap at angle 0/2*PI), perturb the landmass radius by it.
        const angle    = Math.atan2(dy, dx);
        const wobble   = coastNoise(Math.cos(angle) * 3 + 3, Math.sin(angle) * 3 + 3);
        const landR    = COAST_BASE_R * (1 + (wobble * 2 - 1) * COAST_WOBBLE);
        const coastT   = Math.max(0, Math.min(1, (dist - landR) / COAST_BAND));
        const coastInf = coastT * coastT * (3 - 2 * coastT);
        e = e * (1 - coastInf) + TARGET_OCEAN * coastInf;

        elev[row * W + col] = e;
        if (opts.debugOut) { opts.debugOut.elev[row * W + col] = e; opts.debugOut.moist[row * W + col] = m; }
        dest[row * W + col] = _classify(T, e, m, b, p.mThr, p.hThr, p.wThr);
      }
    }

    if (!opts.skipExpensive) _smoothTerrain(dest, W, H, 1, onProgress && (f => onProgress(0.5 + 0.3 * f)));

    if (p.rivers > 0 && !opts.skipExpensive) {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      const cr2  = infR * infR;
      const _riverT = T;
      const _riverV = [_riverT.WATER_DARK, _riverT.WATER_LIGHT, _riverT.WATER_ROCK];
      const riverCellIndices = [];
      let carved = 0, tries = 0;
      while (carved < p.rivers && tries < 1200) {
        tries++;
        const sc = Math.floor(rng() * (W - 20)) + 10;
        const sr = Math.floor(rng() * (H - 20)) + 10;
        if (elev[sr * W + sc] < p.mThr) continue;
        const ddx = sc - halfW, ddy = sr - halfH;
        // Seeds must start outside the city exclusion zone (cr2), not just a
        // smaller fixed radius — otherwise a seed can land in the gap between
        // the old fixed radius and cr2 and instantly fail on the first check
        // below, wasting the try.
        if (ddx * ddx + ddy * ddy <= cr2) continue;
        const visited = new Set();
        const paintBuf = [];
        let cc = sc, cr = sr, steps = 0;
        while (steps < 350) {
          const key = cr * W + cc;
          if (visited.has(key)) break;
          visited.add(key);
          const dx = cc - halfW, dy = cr - halfH;
          if (dx * dx + dy * dy <= cr2) break;
          paintBuf.push({ idx: cr * W + cc, val: _riverV[Math.floor(rng() * 3)] });
          // Steepest-descent with a fallback: prefer a strictly-lower neighbor,
          // but if none exists, still move to the lowest unvisited neighbor
          // (even if it's not lower than here) so a small local bump doesn't
          // dead-end the walk immediately — real water finds a way around.
          // Only a neighbor that's already part of this walk, or genuinely out
          // of bounds, stops it.
          let bc = -1, br = -1, be = Infinity;
          const jitter = (rng() - 0.5) * 0.04;
          for (const [dc, dr] of dirs) {
            const nc = cc + dc, nr = cr + dr;
            if (nc < 1 || nc >= W-1 || nr < 1 || nr >= H-1) continue;
            if (visited.has(nr * W + nc)) continue;
            const ne = elev[nr * W + nc] + jitter;
            if (ne < be) { be = ne; bc = nc; br = nr; }
          }
          if (bc === -1) break;
          cc = bc; cr = br; steps++;
          if (elev[cr * W + cc] < p.wThr) break;
        }
        if (steps >= 18) {
          for (const { idx, val } of paintBuf) { dest[idx] = val; riverCellIndices.push(idx); }
          carved++;
        }
      }

      // Every river's cells currently hold a random flat-water placeholder.
      // Now that all rivers (and the coastline, computed earlier in this
      // function) are final, replace each one with the correct directional
      // River_*/Lake_* tile based on its real final neighbors.
      for (const idx of riverCellIndices) {
        const rrow = Math.floor(idx / W), rcol = idx % W;
        dest[idx] = _resolveEdgeTile(rcol, rrow, W, H, dest, edge, rng, _riverV);
      }
    }

    const excR2 = infR * infR;
    function scatter(type, count, minE, maxE) {
      const CLUSTER_SIZE   = 4;      // target tiles per deposit
      const CLUSTER_RADIUS = 2.2;    // max spread of a deposit's tiles around its center
      const numClusters = Math.max(1, Math.round(count / CLUSTER_SIZE));
      let placed = 0, tries = 0;
      const maxTries = numClusters * 30;
      while (placed < count && tries < maxTries) {
        tries++;
        const ac = Math.floor(rng() * (W - 8)) + 4;
        const ar = Math.floor(rng() * (H - 8)) + 4;
        const e  = elev[ar * W + ac];
        if (e < minE || e > maxE) continue;
        const dx = ac - halfW, dy = ar - halfH;
        if (dx * dx + dy * dy <= excR2) continue;

        const blobCount = Math.min(CLUSTER_SIZE, count - placed);
        for (let i = 0; i < blobCount; i++) {
          const angle  = rng() * Math.PI * 2;
          const radius = rng() * CLUSTER_RADIUS;
          const tc = Math.round(ac + Math.cos(angle) * radius);
          const tr = Math.round(ar + Math.sin(angle) * radius);
          if (tc < 1 || tc >= W - 1 || tr < 1 || tr >= H - 1) continue;
          const te = elev[tr * W + tc];
          if (te < minE || te > maxE) continue;
          const tdx = tc - halfW, tdy = tr - halfH;
          if (tdx * tdx + tdy * tdy <= excR2) continue;
          dest[tr * W + tc] = type;
          placed++;
        }
      }
    }
    if (p.gold) scatter(T.GOLD, p.goldCount, p.hThr, 1.0);
    if (p.oil)  scatter(T.OIL,  p.oilCount,  p.wThr, p.hThr);
  }


  // job: { p, W, H, T, opts:{skipExpensive,debug}, edge }
  // returns { names, grid:Uint16Array(W*H) indexing names, elev?:Float32Array, moist?:Float32Array }
  MapJobs.generate = function (job, onProgress) {
    const { p, W, H, T, edge } = job;
    const dest = new Array(W * H).fill('Plain_1');
    const debugOut = job.opts.debug ? { elev: new Float32Array(W * H), moist: new Float32Array(W * H) } : null;
    _generateInto(dest, p, { W, H, skipExpensive: !!job.opts.skipExpensive, debugOut }, T, edge, onProgress);
    if (onProgress) onProgress(0.95);
    const lut = new Map(); const names = [];
    const grid = new Uint16Array(W * H);
    for (let i = 0; i < grid.length; i++) {
      let k = lut.get(dest[i]);
      if (k === undefined) { k = names.length; lut.set(dest[i], k); names.push(dest[i]); }
      grid[i] = k;
    }
    if (onProgress) onProgress(1);
    return { names, grid, elev: debugOut ? debugOut.elev : undefined, moist: debugOut ? debugOut.moist : undefined };
  };

  MapJobs._resolveEdgeTile = _resolveEdgeTile;   // test hook for tests/edge-drift.spec.ts
  root.MapJobs = MapJobs;
})(typeof self !== 'undefined' ? self : this);
