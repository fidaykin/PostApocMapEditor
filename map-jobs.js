/* map-jobs.js: heavy, DOM-free map jobs.
   Loaded as a classic <script> by MapEditorPro.html (synchronous fallback) and via
   importScripts() by map-worker.js. Must not touch document/window/Terrain/HexDB. */
(function (root) {
  'use strict';
  const MapJobs = {};

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

  root.MapJobs = MapJobs;
})(typeof self !== 'undefined' ? self : this);
