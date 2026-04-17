# MapEditorPro — Plan B: Generator + Satellite Modals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two `alert()` stubs in the Generate menu with fully functional Procedural Generator and Satellite Import modals.

**Architecture:** Two IIFE constants (`Generator`, `Satellite`) inserted into `MapEditorPro.html` after the IO module and before the shared-state block. Each owns its modal HTML, CSS, and logic. Generator ports multi-octave Perlin noise + city smoothstep + river carving from `MapEditorHex.html`, adding a 270×270 live preview debounced at 150ms. Satellite ports RGB→HSL color classification with a single Sensitivity slider (1–100) and a classified terrain preview. Both call `History.push()` before mutating `mapData`, then trigger `Canvas.render()` + `Canvas.drawMinimap()` + `UI.toast()`.

**Tech Stack:** Vanilla JS/CSS/HTML, single file. No build step. `Terrain.color(id)` returns `[r, g, b]` — used by both preview renderers.

---

## File Map

Single target file: `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html`

All edits are insertions or replacements at specific anchor text:

| What | Where in the file |
|---|---|
| Generator + Satellite CSS | Append inside `<style>` block, just before the closing `</style>` tag |
| Generator modal HTML | Insert after `<input type="file" id="file-input" ...>` line |
| Satellite modal HTML | Insert after generator modal HTML |
| `const Generator = (...)()` | Insert after the line `return { newMap, openMap, saveMap, exportCSV, clearMap, fillMap, initFileInput, initKeyboard };` and the closing `})();` of the IO IIFE, and before `// ── Shared state` |
| `const Satellite = (...)()` | Insert after Generator IIFE, before `// ── Shared state` |
| Menu button wire | Replace two `alert(...)` lines on the Generate menu |

---

## Task 1: Generator Module

**Files:**
- Modify: `MapEditorPro.html` — 4 insertion/replacement sites

- [ ] **Step 1: Add Generator CSS**

Append the following inside the `<style>` block, just before the closing `</style>` tag (after the `.btn-cancel` rule):

```css
/* ── Generator modal ─────────────────────────────────────────── */
.gen-modal-box {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,0.8);
  display: flex; flex-direction: column;
  max-width: 780px; width: 90vw; max-height: 90vh; overflow: hidden;
}
.gen-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  font-size: 15px; font-weight: bold; flex-shrink: 0;
}
.gen-modal-close {
  background: none; border: none; color: var(--muted); cursor: pointer;
  font-size: 18px; padding: 4px 8px; border-radius: 4px; line-height: 1;
}
.gen-modal-close:hover { background: var(--hover); color: var(--text); }
.gen-modal-body {
  display: flex; gap: 16px; padding: 16px;
  flex: 1; overflow-y: auto; min-height: 0;
}
.gen-controls { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.gen-preview-col {
  flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px;
}
#gen-preview {
  width: 270px; height: 270px; image-rendering: pixelated;
  border: 1px solid var(--border); border-radius: 4px; background: #0a0a0a;
  display: block;
}
.gen-preview-label { font-size: 11px; color: var(--muted); }
.gen-section {
  font-size: 11px; color: var(--muted); text-transform: uppercase;
  letter-spacing: 1px; margin-top: 6px; margin-bottom: 2px;
  border-bottom: 1px solid var(--border); padding-bottom: 3px;
}
.gen-row {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
}
.gen-row label { width: 68px; flex-shrink: 0; color: var(--muted); }
.gen-row input[type=range] { flex: 1; min-width: 0; }
.gen-row input[type=number] {
  flex: 1; min-width: 0; background: var(--bg); color: var(--text);
  border: 1px solid var(--border); padding: 4px 8px;
  border-radius: 4px; font-size: 12px;
}
.gen-val {
  width: 44px; text-align: right; color: var(--accent);
  font-size: 12px; font-variant-numeric: tabular-nums; flex-shrink: 0;
}
.gen-presets { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 2px; }
.gen-preset-btn {
  background: var(--bg); border: 1px solid var(--border);
  color: var(--text); padding: 4px 8px; border-radius: 4px;
  cursor: pointer; font-size: 11px;
}
.gen-preset-btn:hover { background: var(--hover); border-color: var(--accent); }
.gen-rnd-btn {
  background: var(--bg); border: 1px solid var(--border);
  color: var(--text); padding: 4px 10px; border-radius: 4px;
  cursor: pointer; font-size: 13px; flex-shrink: 0;
}
.gen-rnd-btn:hover { background: var(--hover); }
.gen-check-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; margin-top: 4px;
}
.gen-check-row label { cursor: pointer; }
.gen-modal-footer {
  display: flex; gap: 10px; justify-content: flex-end;
  padding: 12px 16px; border-top: 1px solid var(--border); flex-shrink: 0;
}
```

- [ ] **Step 2: Add Generator modal HTML**

Insert the following immediately after the line:
```html
<input type="file" id="file-input" accept=".json" style="display:none">
```

```html
<!-- Generator Modal -->
<div class="modal-overlay" id="gen-modal">
  <div class="gen-modal-box">
    <div class="gen-modal-header">
      <span>🎲 Procedural Generator</span>
      <button class="gen-modal-close" onclick="Generator.close()">✕</button>
    </div>
    <div class="gen-modal-body">
      <div class="gen-controls">
        <!-- Seed -->
        <div class="gen-row">
          <label>Seed</label>
          <input id="gen-seed" type="number" value="42" min="1" max="999999"
                 oninput="Generator.schedule()">
          <button class="gen-rnd-btn"
                  onclick="document.getElementById('gen-seed').value=Math.floor(Math.random()*999998)+1;Generator.schedule()">🎲</button>
        </div>
        <!-- Presets -->
        <div class="gen-section">Presets</div>
        <div class="gen-presets">
          <button class="gen-preset-btn" onclick="Generator.applyPreset('wasteland')">🏚️ Wasteland</button>
          <button class="gen-preset-btn" onclick="Generator.applyPreset('jungle')">🌿 Jungle</button>
          <button class="gen-preset-btn" onclick="Generator.applyPreset('desert')">🏜️ Desert</button>
          <button class="gen-preset-btn" onclick="Generator.applyPreset('arctic')">❄️ Arctic</button>
          <button class="gen-preset-btn" onclick="Generator.applyPreset('volcanic')">🌋 Volcanic</button>
        </div>
        <!-- Noise Scales -->
        <div class="gen-section">Noise Scales</div>
        <div class="gen-row">
          <label>Elevation</label>
          <input id="gen-elevScale" type="range" min="0.004" max="0.04" step="0.001" value="0.015"
                 oninput="Generator.schedule()">
          <span id="gen-elevScale-v" class="gen-val">0.015</span>
        </div>
        <div class="gen-row">
          <label>Moisture</label>
          <input id="gen-moistScale" type="range" min="0.004" max="0.04" step="0.001" value="0.022"
                 oninput="Generator.schedule()">
          <span id="gen-moistScale-v" class="gen-val">0.022</span>
        </div>
        <div class="gen-row">
          <label>Biome</label>
          <input id="gen-biomeScale" type="range" min="0.004" max="0.04" step="0.001" value="0.020"
                 oninput="Generator.schedule()">
          <span id="gen-biomeScale-v" class="gen-val">0.020</span>
        </div>
        <!-- Thresholds -->
        <div class="gen-section">Thresholds</div>
        <div class="gen-row">
          <label>Mountain</label>
          <input id="gen-mountain" type="range" min="0.50" max="0.92" step="0.01" value="0.70"
                 oninput="Generator.schedule()">
          <span id="gen-mountain-v" class="gen-val">0.70</span>
        </div>
        <div class="gen-row">
          <label>Hills</label>
          <input id="gen-hill" type="range" min="0.40" max="0.80" step="0.01" value="0.58"
                 oninput="Generator.schedule()">
          <span id="gen-hill-v" class="gen-val">0.58</span>
        </div>
        <div class="gen-row">
          <label>Water</label>
          <input id="gen-water" type="range" min="0.10" max="0.50" step="0.01" value="0.30"
                 oninput="Generator.schedule()">
          <span id="gen-water-v" class="gen-val">0.30</span>
        </div>
        <!-- Features -->
        <div class="gen-section">Features</div>
        <div class="gen-row">
          <label>Rivers</label>
          <input id="gen-rivers" type="range" min="0" max="14" step="1" value="4"
                 oninput="Generator.schedule()">
          <span id="gen-rivers-v" class="gen-val">4</span>
        </div>
        <!-- Resources -->
        <div class="gen-section">Resources</div>
        <div class="gen-check-row">
          <input id="gen-gold" type="checkbox" checked onchange="Generator.schedule()">
          <label for="gen-gold" style="color:#e8cc10">Gold Veins</label>
        </div>
        <div class="gen-row">
          <label>Count</label>
          <input id="gen-goldCount" type="range" min="1" max="40" step="1" value="12"
                 oninput="Generator.schedule()">
          <span id="gen-goldCount-v" class="gen-val">12</span>
        </div>
        <div class="gen-check-row">
          <input id="gen-oil" type="checkbox" checked onchange="Generator.schedule()">
          <label for="gen-oil" style="color:#aaa">Oil Deposits</label>
        </div>
        <div class="gen-row">
          <label>Count</label>
          <input id="gen-oilCount" type="range" min="1" max="30" step="1" value="8"
                 oninput="Generator.schedule()">
          <span id="gen-oilCount-v" class="gen-val">8</span>
        </div>
      </div>
      <!-- Preview -->
      <div class="gen-preview-col">
        <canvas id="gen-preview" width="270" height="270"></canvas>
        <div class="gen-preview-label">Preview</div>
      </div>
    </div>
    <div class="gen-modal-footer">
      <button class="btn btn-cancel" onclick="Generator.close()">✕ Cancel</button>
      <button class="btn btn-primary" onclick="Generator.apply()">▶ Generate</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add Generator IIFE**

Insert the following after the IO IIFE's closing `})();` line (the line that reads `return { newMap, openMap, saveMap, exportCSV, clearMap, fillMap, initFileInput, initKeyboard };` followed by `})();`) and before the `// ── Shared state` comment:

```javascript
// ════════════════════════════════════════════════════════════
// GENERATOR MODULE
// ════════════════════════════════════════════════════════════
const Generator = (() => {
  const GEN_PRESETS = {
    wasteland: { elevScale:0.018, moistScale:0.022, biomeScale:0.020, mountainThr:0.72, hillThr:0.60, waterThr:0.25, rivers:2  },
    jungle:    { elevScale:0.015, moistScale:0.030, biomeScale:0.022, mountainThr:0.74, hillThr:0.62, waterThr:0.28, rivers:7  },
    desert:    { elevScale:0.016, moistScale:0.014, biomeScale:0.018, mountainThr:0.68, hillThr:0.55, waterThr:0.15, rivers:1  },
    arctic:    { elevScale:0.017, moistScale:0.018, biomeScale:0.020, mountainThr:0.65, hillThr:0.52, waterThr:0.35, rivers:3  },
    volcanic:  { elevScale:0.020, moistScale:0.016, biomeScale:0.022, mountainThr:0.62, hillThr:0.50, waterThr:0.22, rivers:0  },
  };

  let _debounce = null;

  // ── Seeded smooth value noise (identical to MapEditorHex) ──
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

  // ── Terrain classification (2D moisture×biome) ─────────────
  function _classify(e, m, b, mThr, hThr, wThr) {
    if (e > mThr) {
      const ex = e - mThr;
      if (ex > 0.13) return b > 0.65 ? 27 : 26;
      if (b > 0.75)  return 28;
      return b > 0.45 ? 19 : 18;
    }
    if (e > hThr) {
      if (m > 0.65 && b > 0.50) return 17;
      if (m > 0.55) return b > 0.60 ? 16 : 25;
      if (b > 0.60) return 17;
      return 18;
    }
    if (e < wThr) {
      const depth = (wThr - e) / wThr;
      if (depth > 0.55) return Math.floor(b * 3) % 3;
      return m > 0.55 ? 24 : (b > 0.50 ? 1 : 0);
    }
    const norm = (e - wThr) / Math.max(hThr - wThr, 0.001);
    if (m < 0.28) {
      if (b < 0.35) return norm > 0.50 ? 22 : 23;
      if (b < 0.65) return norm > 0.50 ? 22 : 14;
      return norm > 0.60 ? 18 : 11;
    }
    if (m > 0.70) {
      if (b < 0.30) return norm > 0.45 ? 24 : 0;
      if (b < 0.60) return norm > 0.50 ? 16 : 15;
      return norm > 0.55 ? 17 : 24;
    }
    if (m < 0.45) {
      if (b < 0.25) return norm > 0.55 ? 11 : 22;
      if (b < 0.55) return norm > 0.50 ? 14 : 12;
      if (b < 0.80) return norm > 0.45 ? 13 : 12;
      return norm > 0.60 ? 9 : 14;
    }
    if (m < 0.60) {
      if (b < 0.30) return norm > 0.60 ? 14 : 12;
      if (b < 0.55) return norm > 0.50 ? 13 : 12;
      if (b < 0.75) return norm > 0.45 ? 15 : 13;
      return norm > 0.50 ? 16 : 15;
    }
    if (b < 0.25) return norm > 0.55 ? 25 : 24;
    if (b < 0.50) return norm > 0.50 ? 15 : 13;
    if (b < 0.75) return norm > 0.45 ? 16 : 15;
    return norm > 0.55 ? 17 : 16;
  }

  // ── Read current UI parameter values ─────────────────────
  function _getParams() {
    return {
      seed:       parseInt(document.getElementById('gen-seed').value)       || 42,
      elevScale:  parseFloat(document.getElementById('gen-elevScale').value),
      moistScale: parseFloat(document.getElementById('gen-moistScale').value),
      biomeScale: parseFloat(document.getElementById('gen-biomeScale').value),
      mThr:       parseFloat(document.getElementById('gen-mountain').value),
      hThr:       parseFloat(document.getElementById('gen-hill').value),
      wThr:       parseFloat(document.getElementById('gen-water').value),
      rivers:     parseInt(document.getElementById('gen-rivers').value),
      gold:       document.getElementById('gen-gold').checked,
      goldCount:  parseInt(document.getElementById('gen-goldCount').value),
      oil:        document.getElementById('gen-oil').checked,
      oilCount:   parseInt(document.getElementById('gen-oilCount').value),
    };
  }

  // ── Core: write generated terrain into dest (Int8Array) ──
  function _generateInto(dest, p) {
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const rng    = _lcg(p.seed);
    const seedE  = Math.floor(rng() * 100000);
    const seedM  = Math.floor(rng() * 100000);
    const seedB  = Math.floor(rng() * 100000);
    const eNoise = _multiOctave(seedE, p.elevScale);
    const mNoise = _makeNoise2D(seedM);
    const bNoise = _makeNoise2D(seedB);
    const halfW  = Math.floor(W / 2);
    const halfH  = Math.floor(H / 2);
    const elev   = new Float32Array(W * H);
    const infR   = Math.min(W, H) * 0.08;
    const TARGET_E = 0.46, TARGET_M = 0.50, TARGET_B = 0.55;

    // Fill terrain with city-center smoothstep influence
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const dist = Math.sqrt((col - halfW) ** 2 + (row - halfH) ** 2);
        const t    = Math.max(0, 1.0 - dist / infR);
        const inf  = t * t * (3 - 2 * t);  // smoothstep
        const e = eNoise(col, row)                         * (1-inf) + TARGET_E * inf;
        const m = mNoise(col*p.moistScale, row*p.moistScale) * (1-inf) + TARGET_M * inf;
        const b = bNoise(col*p.biomeScale, row*p.biomeScale) * (1-inf) + TARGET_B * inf;
        elev[row * W + col] = e;
        dest[row * W + col] = _classify(e, m, b, p.mThr, p.hThr, p.wThr);
      }
    }

    // Downhill river carving
    if (p.rivers > 0) {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      const cr2  = infR * infR;
      let carved = 0, tries = 0;
      while (carved < p.rivers && tries < 400) {
        tries++;
        const sc = Math.floor(rng() * (W - 20)) + 10;
        const sr = Math.floor(rng() * (H - 20)) + 10;
        if (elev[sr * W + sc] < p.mThr) continue;
        const ddx = sc - halfW, ddy = sr - halfH;
        if (ddx * ddx + ddy * ddy < 625) continue;
        const visited = new Set();
        let cc = sc, cr = sr, steps = 0;
        while (steps < 350) {
          const key = cr * W + cc;
          if (visited.has(key)) break;
          visited.add(key);
          const dx = cc - halfW, dy = cr - halfH;
          if (dx * dx + dy * dy <= cr2) break;
          dest[cr * W + cc] = 3 + Math.floor(rng() * 6);
          let bc = cc, br = cr, be = elev[cr * W + cc];
          const jitter = (rng() - 0.5) * 0.04;
          for (const [dc, dr] of dirs) {
            const nc = cc + dc, nr = cr + dr;
            if (nc < 1 || nc >= W-1 || nr < 1 || nr >= H-1) continue;
            const ne = elev[nr * W + nc] + jitter;
            if (ne < be) { be = ne; bc = nc; br = nr; }
          }
          if (bc === cc && br === cr) break;
          cc = bc; cr = br; steps++;
          if (elev[cr * W + cc] < p.wThr) break;
        }
        if (steps >= 18) carved++;
      }
    }

    // Resource scatter — outside city influence zone
    const excR2 = infR * infR;
    function scatter(type, count, minE, maxE) {
      let placed = 0, tries = 0;
      while (placed < count && tries < count * 30) {
        tries++;
        const ac = Math.floor(rng() * (W - 8)) + 4;
        const ar = Math.floor(rng() * (H - 8)) + 4;
        const e  = elev[ar * W + ac];
        if (e < minE || e > maxE) continue;
        const dx = ac - halfW, dy = ar - halfH;
        if (dx * dx + dy * dy <= excR2) continue;
        dest[ar * W + ac] = type; placed++;
      }
    }
    if (p.gold) scatter(20, p.goldCount, p.hThr, 1.0);
    if (p.oil)  scatter(21, p.oilCount,  p.wThr, p.hThr);
  }

  // ── Update slider value labels ──────────────────────────
  function _updateLabels() {
    [['gen-elevScale',3],['gen-moistScale',3],['gen-biomeScale',3],
     ['gen-mountain',2],['gen-hill',2],['gen-water',2]].forEach(([id, dp]) => {
      const v = document.getElementById(id + '-v');
      if (v) v.textContent = parseFloat(document.getElementById(id).value).toFixed(dp);
    });
    ['gen-rivers','gen-goldCount','gen-oilCount'].forEach(id => {
      const v = document.getElementById(id + '-v');
      if (v) v.textContent = document.getElementById(id).value;
    });
  }

  // ── Preview canvas render (270×270, uses Terrain.color) ──
  function _renderPreview() {
    if (!mapData) return;
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const tmp = new Int8Array(W * H);
    _generateInto(tmp, _getParams());

    const cv = document.getElementById('gen-preview');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const pw = cv.width, ph = cv.height;
    const img = ctx.createImageData(pw, ph);
    for (let py = 0; py < ph; py++) {
      for (let px = 0; px < pw; px++) {
        const col = Math.floor(px / pw * W);
        const row = Math.floor(py / ph * H);
        const id  = tmp[row * W + col];
        const [r, g, b] = Terrain.color(id);
        const i = (py * pw + px) * 4;
        img.data[i] = r; img.data[i+1] = g; img.data[i+2] = b; img.data[i+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── Debounced schedule (called by all oninput handlers) ──
  function schedule() {
    clearTimeout(_debounce);
    _updateLabels();
    _debounce = setTimeout(_renderPreview, 150);
  }

  // ── Apply preset values to sliders ───────────────────────
  function applyPreset(name) {
    const p = GEN_PRESETS[name]; if (!p) return;
    document.getElementById('gen-elevScale').value  = p.elevScale;
    document.getElementById('gen-moistScale').value = p.moistScale;
    document.getElementById('gen-biomeScale').value = p.biomeScale;
    document.getElementById('gen-mountain').value   = p.mountainThr;
    document.getElementById('gen-hill').value       = p.hillThr;
    document.getElementById('gen-water').value      = p.waterThr;
    document.getElementById('gen-rivers').value     = p.rivers;
    schedule();
  }

  // ── Open modal ───────────────────────────────────────────
  function open() {
    UI.closeAllMenus();
    document.getElementById('gen-modal').classList.add('open');
    schedule();  // render preview immediately on open
  }

  // ── Close modal ──────────────────────────────────────────
  function close() {
    clearTimeout(_debounce);
    document.getElementById('gen-modal').classList.remove('open');
  }

  // ── Apply: push history, generate into mapData, re-seat city ─
  function apply() {
    if (!mapData) return;
    History.push();
    _generateInto(mapData, _getParams());
    const cityC = getCityCol(), cityR = getCityRow();
    settlements = settlements.filter(s => s.type !== 'city');
    settlements.unshift({ col: cityC, row: cityR, type: 'city' });
    UI.updateSettlementCount();
    close();
    Canvas.render();
    Canvas.drawMinimap();
    UI.toast('Map generated');
  }

  return { open, close, apply, applyPreset, schedule };
})();
```

- [ ] **Step 4: Wire Generate menu button**

Replace (line with `alert('Generator: Plan B')`):
```html
        <button onclick="alert('Generator: Plan B')">Procedural Generator…</button>
```
With:
```html
        <button onclick="Generator.open()">Procedural Generator…</button>
```

- [ ] **Step 5: Open browser and verify Generator**

Serve the file: `cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && python3 -m http.server 8080`

Check the following in the browser at `http://localhost:8080/MapEditorPro.html`:

1. Generate → Procedural Generator… opens a two-column modal (controls left, preview canvas right)
2. Preview canvas shows a colored map within ~150ms of opening
3. Moving any slider updates preview after ~150ms debounce
4. Clicking a preset (e.g., "🌿 Jungle") updates all sliders and refreshes preview
5. 🎲 button changes seed and refreshes preview
6. ✕ Cancel closes modal without changing the map
7. ▶ Generate writes to map, re-centers camera (via existing centerOnCity), shows "Map generated" toast, closes modal
8. Ctrl+Z undoes generation and restores previous map
9. Minimap updates after generation

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: add Generator module — live preview + Perlin noise generation (Plan B Task 1)"
```

---

## Task 2: Satellite Module

**Files:**
- Modify: `MapEditorPro.html` — 4 insertion/replacement sites

- [ ] **Step 1: Add Satellite CSS**

Append the following inside the `<style>` block, just before the closing `</style>` tag (after the Generator CSS from Task 1):

```css
/* ── Satellite modal ─────────────────────────────────────────── */
.sat-modal-box {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,0.8);
  display: flex; flex-direction: column;
  max-width: 560px; width: 90vw; max-height: 90vh; overflow: hidden;
}
.sat-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  font-size: 15px; font-weight: bold; flex-shrink: 0;
}
.sat-modal-body {
  padding: 16px; flex: 1; overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px;
}
.sat-drop {
  border: 2px dashed var(--border); border-radius: 6px;
  padding: 20px; text-align: center; cursor: pointer;
  position: relative; transition: border-color 0.15s, background 0.15s;
  min-height: 72px; display: flex; align-items: center; justify-content: center;
}
.sat-drop:hover, .sat-drop.dragover {
  border-color: var(--accent); background: rgba(79,195,247,0.06);
}
.sat-drop input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.sat-drop-label { font-size: 13px; color: var(--muted); pointer-events: none; line-height: 1.6; }
.sat-drop img { max-height: 100px; max-width: 100%; object-fit: contain; border-radius: 4px; pointer-events: none; }
.sat-previews { display: flex; gap: 12px; }
.sat-preview-box { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.sat-preview-box > label { font-size: 11px; color: var(--muted); }
#sat-orig-thumb {
  width: 100%; aspect-ratio: 1; object-fit: contain;
  background: #0a0a0a; border: 1px solid var(--border); border-radius: 4px; display: block;
}
#sat-class-canvas {
  width: 100%; aspect-ratio: 1; display: block;
  image-rendering: pixelated;
  background: #0a0a0a; border: 1px solid var(--border); border-radius: 4px;
}
.sat-section {
  font-size: 11px; color: var(--muted); text-transform: uppercase;
  letter-spacing: 1px; border-bottom: 1px solid var(--border); padding-bottom: 3px;
}
.sat-row {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
}
.sat-row label { width: 90px; flex-shrink: 0; color: var(--muted); }
.sat-row input[type=range] { flex: 1; min-width: 0; }
.sat-val {
  width: 32px; text-align: right; color: var(--accent);
  font-size: 12px; font-variant-numeric: tabular-nums; flex-shrink: 0;
}
.sat-options { display: flex; flex-direction: column; gap: 6px; }
.sat-options label { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
.sat-modal-footer {
  display: flex; gap: 10px; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-top: 1px solid var(--border); flex-shrink: 0;
}
.sat-modal-footer a { font-size: 12px; color: var(--accent); text-decoration: none; }
.sat-modal-footer a:hover { text-decoration: underline; }
#sat-apply-btn { transition: opacity 0.2s; }
#sat-apply-btn:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 2: Add Satellite modal HTML**

Insert the following immediately after the Generator modal `</div>` (i.e., after the line `</div>` that closes `<div class="modal-overlay" id="gen-modal">`):

```html
<!-- Satellite Import Modal -->
<div class="modal-overlay" id="sat-modal">
  <div class="sat-modal-box">
    <div class="sat-modal-header">
      <span>🛰 Satellite Import</span>
      <button class="gen-modal-close" onclick="Satellite.close()">✕</button>
    </div>
    <div class="sat-modal-body">
      <p style="font-size:12px;color:var(--muted)">Upload any satellite or map screenshot — colours are classified into terrain types.</p>
      <!-- Drop zone -->
      <div id="sat-drop" class="sat-drop"
           ondragover="Satellite.onDragOver(event)"
           ondragleave="Satellite.onDragLeave()"
           ondrop="Satellite.onDrop(event)">
        <input type="file" accept="image/*" onchange="Satellite.onFileInput(event)">
        <img id="sat-drop-img" style="display:none">
        <span id="sat-drop-label" class="sat-drop-label">📂 Drop image here or click to browse<br>
          <span style="font-size:10px;color:#555">PNG · JPG · WebP · any size</span></span>
      </div>
      <!-- Dual preview -->
      <div class="sat-previews">
        <div class="sat-preview-box">
          <label>Source image</label>
          <img id="sat-orig-thumb">
        </div>
        <div class="sat-preview-box">
          <label>Terrain preview</label>
          <canvas id="sat-class-canvas" width="270" height="270"></canvas>
        </div>
      </div>
      <!-- Sliders -->
      <div class="sat-section">Colour Sensitivity</div>
      <div class="sat-row">
        <label>Sensitivity</label>
        <input id="sat-sens" type="range" min="1" max="100" step="1" value="50"
               oninput="document.getElementById('sat-sens-v').textContent=this.value; Satellite.onParamChange()">
        <span id="sat-sens-v" class="sat-val">50</span>
      </div>
      <div class="sat-row">
        <label>Sample radius</label>
        <input id="sat-sampleR" type="range" min="1" max="10" step="1" value="3"
               oninput="document.getElementById('sat-sampleR-v').textContent=this.value; Satellite.onParamChange()">
        <span id="sat-sampleR-v" class="sat-val">3</span>
      </div>
      <!-- Options -->
      <div class="sat-section">Options</div>
      <div class="sat-options">
        <label>
          <input type="checkbox" id="sat-flipY" onchange="Satellite.onParamChange()">
          Flip image vertically (south-up images)
        </label>
        <label>
          <input type="checkbox" id="sat-keepCity" checked>
          Keep city center tile passable
        </label>
        <label>
          <input type="checkbox" id="sat-clearWater" checked>
          Clear impassable terrain around city (radius 3)
        </label>
      </div>
    </div>
    <div class="sat-modal-footer">
      <a href="SatelliteColorGuide.html" target="_blank" rel="noopener">Color Guide ↗</a>
      <div style="display:flex;gap:8px">
        <button class="btn btn-cancel" onclick="Satellite.close()">✕ Cancel</button>
        <button id="sat-apply-btn" class="btn btn-primary" onclick="Satellite.apply()" disabled>🗺 Apply to Map</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add Satellite IIFE**

Insert the following immediately after the Generator IIFE's closing `})();` line and before the `// ── Shared state` comment:

```javascript
// ════════════════════════════════════════════════════════════
// SATELLITE MODULE
// ════════════════════════════════════════════════════════════
const Satellite = (() => {
  let _pixels = null, _w = 0, _h = 0;
  let _classified = null;  // Uint8Array [MAP_WIDTH * MAP_HEIGHT]

  // ── RGB → HSL ────────────────────────────────────────────
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

  // ── Sample averaged pixel at hex grid position ───────────
  function _sample(col, row, sampleR) {
    const cx = (col / MAP_WIDTH)  * _w;
    const cy = (row / MAP_HEIGHT) * _h;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let dy = -sampleR; dy <= sampleR; dy++) {
      for (let dx = -sampleR; dx <= sampleR; dx++) {
        if (dx * dx + dy * dy > sampleR * sampleR) continue;
        const ix = Math.max(0, Math.min(_w - 1, Math.round(cx + dx)));
        const iy = Math.max(0, Math.min(_h - 1, Math.round(cy + dy)));
        const i  = (iy * _w + ix) * 4;
        sr += _pixels.data[i]; sg += _pixels.data[i+1]; sb += _pixels.data[i+2];
        n++;
      }
    }
    return [sr / n, sg / n, sb / n];
  }

  // ── Classify RGB → terrain ID
  // sens (0–1) derived from single slider (sens = sliderValue / 100)
  // controls how aggressively blue→water, green→forest, pale→mountain are detected
  function _classifyColor(r, g, b, sens) {
    const [h, s, l] = _rgbToHsl(r, g, b);

    if (l < 0.09) return 28;                                           // absolute dark → Rift
    if ((h < 25 || h > 335) && s > 0.50 && l > 0.12 && l < 0.55) return 26; // lava

    const wSatMin = 0.42 - sens * 0.32;
    if (h >= 170 && h <= 268 && s > wSatMin && l < 0.70) return l < 0.32 ? 0 : 1;

    if (s < 0.18 && l > 0.74 - (1 - sens) * 0.12) return 19;         // snow/mountain
    if (s < 0.20) {
      if (l > 0.56) return 18;   // Hills
      if (l > 0.30) return 9;    // Rubble
      return 28;                 // dark rock
    }

    const fSatMin = 0.28 - sens * 0.20;
    if (h >= 78 && h <= 168) {
      if (s > fSatMin) {
        if (l < 0.22) return 24;   // Swamp
        if (l < 0.37) return 16;   // Dense forest
        if (l < 0.53) return 15;   // Forest
        return 12;                  // Light plain
      }
      if (l < 0.30) return 24;
      if (l < 0.50) return 13;
      return 12;
    }
    if (h >= 50 && h < 78) {
      if (s > 0.30 && l > 0.52) return 12;
      if (s > 0.22 && l > 0.38) return 13;
      return 22;
    }
    if (h >= 30 && h < 60 && s > 0.28 && l > 0.56) return 23;   // sandy/desert
    if (h >= 12 && h < 50) {
      if (l > 0.52 && s > 0.22) return 22;   // Barren
      if (l > 0.36 && s > 0.18) return 9;    // Rubble_1
      return 10;
    }
    return 12;  // default Plain_1
  }

  // ── Run classification into _classified ──────────────────
  function _classify() {
    if (!_pixels) return;
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const sampleR = parseInt(document.getElementById('sat-sampleR').value);
    const sens    = parseInt(document.getElementById('sat-sens').value) / 100;
    const flipY   = document.getElementById('sat-flipY').checked;

    _classified = new Uint8Array(W * H);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const srcRow = flipY ? H - 1 - row : row;
        const [r, g, b] = _sample(col, srcRow, sampleR);
        _classified[row * W + col] = _classifyColor(r, g, b, sens);
      }
    }
    _renderPreview();
    document.getElementById('sat-apply-btn').disabled = false;
  }

  // ── Render classified preview canvas ────────────────────
  function _renderPreview() {
    if (!_classified) return;
    const cv = document.getElementById('sat-class-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const pw = cv.width, ph = cv.height;
    const W = MAP_WIDTH, H = MAP_HEIGHT;
    const img = ctx.createImageData(pw, ph);
    for (let py = 0; py < ph; py++) {
      for (let px = 0; px < pw; px++) {
        const col = Math.floor(px / pw * W);
        const row = Math.floor(py / ph * H);
        const id  = _classified[row * W + col] ?? 12;
        const [r, g, b] = Terrain.color(id);
        const i = (py * pw + px) * 4;
        img.data[i] = r; img.data[i+1] = g; img.data[i+2] = b; img.data[i+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── Load an image File object ─────────────────────────────
  function _loadImage(file) {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        _w = Math.round(img.width  * scale);
        _h = Math.round(img.height * scale);
        const offC = document.createElement('canvas');
        offC.width = _w; offC.height = _h;
        const offX = offC.getContext('2d');
        offX.drawImage(img, 0, 0, _w, _h);
        _pixels = offX.getImageData(0, 0, _w, _h);

        const thumb = document.getElementById('sat-orig-thumb');
        thumb.src = ev.target.result;

        const dropImg = document.getElementById('sat-drop-img');
        dropImg.src = ev.target.result;
        dropImg.style.display = 'block';
        document.getElementById('sat-drop-label').style.display = 'none';

        _classify();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ── Open / close ─────────────────────────────────────────
  function open() {
    UI.closeAllMenus();
    _pixels = null; _classified = null;
    document.getElementById('sat-drop-img').src = '';
    document.getElementById('sat-drop-img').style.display = 'none';
    document.getElementById('sat-drop-label').style.display = '';
    document.getElementById('sat-orig-thumb').src = '';
    document.getElementById('sat-class-canvas').getContext('2d').clearRect(0, 0, 270, 270);
    document.getElementById('sat-apply-btn').disabled = true;
    document.getElementById('sat-modal').classList.add('open');
  }

  function close() {
    document.getElementById('sat-modal').classList.remove('open');
  }

  // ── Apply: push history, copy classified data, city cleanup ─
  function apply() {
    if (!_classified) return;
    History.push();
    // Copy classified (Uint8Array) into mapData (Int8Array) — IDs 0-28 fit in both
    const len = MAP_WIDTH * MAP_HEIGHT;
    for (let i = 0; i < len; i++) mapData[i] = _classified[i];

    const cityC = getCityCol(), cityR = getCityRow();
    const keepCity   = document.getElementById('sat-keepCity').checked;
    const clearWater = document.getElementById('sat-clearWater').checked;
    if (keepCity || clearWater) {
      const clearR   = 3;
      const waterIds = new Set([0,1,2,3,4,5,6,7,8,19,26,27,28]);
      for (let dr = -clearR; dr <= clearR; dr++) {
        for (let dc = -clearR; dc <= clearR; dc++) {
          if (dc * dc + dr * dr > clearR * clearR) continue;
          const r = cityR + dr, c = cityC + dc;
          if (r < 0 || r >= MAP_HEIGHT || c < 0 || c >= MAP_WIDTH) continue;
          const idx = r * MAP_WIDTH + c;
          if (clearWater && waterIds.has(mapData[idx])) mapData[idx] = 12;
          if (keepCity && dr === 0 && dc === 0) mapData[idx] = 12;
        }
      }
    }

    settlements = settlements.filter(s => s.type !== 'city');
    settlements.unshift({ col: cityC, row: cityR, type: 'city' });
    UI.updateSettlementCount();
    close();
    Canvas.render();
    Canvas.drawMinimap();
    UI.toast('Satellite map applied');
  }

  return {
    open, close, apply,
    onDragOver(e)   { e.preventDefault(); document.getElementById('sat-drop').classList.add('dragover'); },
    onDragLeave()   { document.getElementById('sat-drop').classList.remove('dragover'); },
    onDrop(e)       { e.preventDefault(); document.getElementById('sat-drop').classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) _loadImage(f); },
    onFileInput(e)  { const f = e.target.files[0]; if (f) _loadImage(f); e.target.value = ''; },
    onParamChange() { _classify(); },
  };
})();
```

- [ ] **Step 4: Wire Satellite menu button**

Replace (line with `alert('Satellite: Plan B')`):
```html
        <button onclick="alert('Satellite: Plan B')">Satellite Import…</button>
```
With:
```html
        <button onclick="Satellite.open()">Satellite Import…</button>
```

- [ ] **Step 5: Open browser and verify Satellite**

Serve the file: `cd "/Users/sergii.tyshchenko/Post Apo Map Editor" && python3 -m http.server 8080`

Check the following at `http://localhost:8080/MapEditorPro.html`:

1. Generate → Satellite Import… opens a modal with: drop zone, dual preview area, Sensitivity + Sample radius sliders, Options checkboxes, Color Guide link, Apply (disabled) + Cancel buttons
2. Drop or upload an image → source thumbnail appears in drop zone and in left preview, classified terrain appears in right preview; Apply button becomes enabled
3. Moving Sensitivity or Sample radius slider re-classifies and updates preview
4. Flip vertically checkbox re-classifies and updates preview
5. Color Guide ↗ link opens a new tab (may 404 — that's expected, the guide file doesn't exist yet)
6. ✕ Cancel closes without changing map
7. 🗺 Apply to Map writes to map, shows "Satellite map applied" toast, updates minimap, closes modal
8. Ctrl+Z undoes the apply and restores previous map
9. City center tile is passable after apply (if "Keep city center" is checked)
10. Re-opening modal resets the drop zone and disables Apply

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: add Satellite module — RGB→HSL classification with terrain preview (Plan B Task 2)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| Generator modal: seed, random button | Task 1 Step 2 (HTML) |
| Generator: 5 presets (Wasteland, Jungle, Desert, Arctic, Volcanic) | Task 1 Step 2 (HTML) + Step 3 (JS `applyPreset`) |
| Generator: elevation/moisture/biome noise scales (sliders) | Task 1 Step 2 + Step 3 |
| Generator: mountain/hill/water thresholds (sliders) | Task 1 Step 2 + Step 3 |
| Generator: river count (0–14) | Task 1 Step 2 + Step 3 |
| Generator: gold/oil toggle + count (1–40, 1–30) | Task 1 Step 2 + Step 3 |
| Generator: 270×270 preview, live on slider, debounced 150ms | Task 1 Step 3 (`schedule()`, `_renderPreview()`) |
| Generator: Apply writes to mapData, History.push(), undoable | Task 1 Step 3 (`apply()`) |
| Generator algorithm identical to SmartMapGeneratorWindow.cs | Task 1 Step 3 (ported from MapEditorHex.html) |
| Satellite: drag-drop or click upload | Task 2 Step 2 (HTML) + Step 3 (`onDrop`, `onFileInput`) |
| Satellite: downscale to max 1024px | Task 2 Step 3 (`_loadImage`) |
| Satellite: live 270×270 preview using Terrain.color() | Task 2 Step 3 (`_renderPreview`) |
| Satellite: Color Sensitivity slider (1–100, default 50) | Task 2 Step 2 + Step 3 |
| Satellite: Sample Radius slider (1–10px, default 3) | Task 2 Step 2 + Step 3 |
| Satellite: "Color Guide ↗" link → SatelliteColorGuide.html | Task 2 Step 2 |
| Satellite: Apply writes to mapData, History.push(), undoable | Task 2 Step 3 (`apply()`) |
| Toast notifications for both generate and satellite apply | Task 1 Step 3 + Task 2 Step 3 |
| Minimap redraw after apply | Task 1 Step 3 + Task 2 Step 3 |
| Generate menu buttons wired | Task 1 Step 4 + Task 2 Step 4 |

**Potential issues:**

- `_classify()` runs synchronously on main thread — 450×450 map with sampleR=3 is ~5M pixel lookups, typically <100ms in Chrome. Acceptable.
- `_generateInto` for 450×450 allocates a `Float32Array(202500)` for elevation — ~800KB per call, GC'd after preview. Acceptable.
- `Terrain.color(id)` fallback is `[120,155,85]` for unknown IDs — safe default.
- Generator preview allocates `new Int8Array(W * H)` on every keyframe (150ms debounced) — acceptable.
- Satellite `_classified` is `Uint8Array`; copying to `Int8Array mapData` uses a loop (not `.set()`) because TypedArray.set with different typed arrays in some browsers may not truncate values correctly. IDs 0-28 fit unsigned and signed, so the loop copy is safe and explicit.
