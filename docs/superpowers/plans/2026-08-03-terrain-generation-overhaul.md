# Logical Terrain Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web editor's global procedural `Generator` produce a geographically coherent 450×450 landscape (real coastline, sensible biome regions, rivers that reach water, clustered resources) instead of a speckled, arbitrary-looking noise field, without changing its modal UI, presets, or output format.

**Architecture:** Surgical fixes inside the existing `Generator` IIFE in `MapEditorPro.html` (lines ~6579–6873) — not a rewrite. Root causes, confirmed by reading the current code: (1) there is no landmass/coastline shaping at all, only a small "city clear zone" blend near map center; (2) elevation already uses 3-octave `_multiOctave` noise but moisture and biome use single-octave `_makeNoise2D`, feeding `_classify()`'s many closely-spaced thresholds (0.25/0.30/0.45/0.50/0.55/0.60/0.65/0.70/0.75/0.80) — this mismatch is what produces the speckled look; (3) there is no post-classification smoothing pass; (4) `scatter()` for gold/oil is pure independent rejection sampling with zero clustering.

**Tech Stack:** Vanilla JS, single inline `<script>` in `MapEditorPro.html`. No build step, no new dependencies, no new files.

## Global Constraints

- `_generateInto` must keep producing a flat array of string hex terrain IDs indexed `row*W+col`, mutated in place into whatever `dest` array is passed in — every consumer (`apply()`, `_renderPreview()`) depends on this exact output contract; do not change it. (Its parameter list does gain an optional 3rd `opts` argument in Task 3 — that's a signature addition, not a change to this output contract.)
- No changes to the "New Map" flow, the map JSON export format, or Unity's `RuntimeMapLoader` import path.
- Everything stays inside the single `MapEditorPro.html` file's existing `Generator` IIFE — no new files, no `<script src="...">`, since `deploy-dev.yml`/`deploy.sh` only copy this one file.
- Full-resolution generation on `apply()` must stay well under 1 second in-browser.
- Validation is manual/visual, per the approved spec (`docs/superpowers/specs/2026-08-03-terrain-generation-overhaul-design.md`) — this app has no automated test harness, and introducing one is explicitly out of scope. Every task's "test cycle" is: start a local server, open the Generator modal, follow the task's specific verification checklist.
- The existing exported API `{ open, close, apply, applyPreset, schedule }` must keep working identically from the modal's perspective; the one addition (a debug-view toggle in Task 5) is purely additive.
- All 5 existing presets (`wasteland`/`jungle`/`desert`/`arctic`/`volcanic`) and their exact field names (`elevScale, moistScale, biomeScale, mountainThr, hillThr, waterThr, rivers`) must keep working — no preset schema changes.

**Local verification server (used by every task below):**
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
python3 -m http.server 8765
```
Then open `http://localhost:8765/MapEditorPro.html`, and in the toolbar click the 🎲 Generator icon (or however the modal is currently opened — it's `onclick="Generator.open()"` wherever that button lives) to reach the modal described in the spec.

---

### Task 1: Continent/coastline mask

**Files:**
- Modify: `MapEditorPro.html` — inside `Generator`'s `_generateInto(dest, p)` function (currently lines 6711–6793 before any edits in this plan; locate by the `function _generateInto(dest, p) {` signature, since line numbers will shift after this task).

**Interfaces:**
- Consumes: the existing `elev` computation loop, `halfW`/`halfH`, `rng` (from `_lcg(p.seed)`), all already in scope inside `_generateInto`.
- Produces: no new exported functions. The elevation value `e` used for classification and for the `elev[]` array now includes a coastline falloff — the existing river-carving block (gated further in Task 3) and resource scatter (rewritten in Task 4) both read this same updated `elev[]`, so they automatically respect the new coastline without any changes of their own.

Current code (the loop body, exact as of today):
```js
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const dist = Math.sqrt((col - halfW) ** 2 + (row - halfH) ** 2);
        const t    = Math.max(0, 1.0 - dist / infR);
        const inf  = t * t * (3 - 2 * t);
        const e = eNoise(col, row)                           * (1-inf) + TARGET_E * inf;
        const m = mNoise(col*p.moistScale, row*p.moistScale) * (1-inf) + TARGET_M * inf;
        const b = bNoise(col*p.biomeScale, row*p.biomeScale) * (1-inf) + TARGET_B * inf;
        elev[row * W + col] = e;
        dest[row * W + col] = _classify(e, m, b, p.mThr, p.hThr, p.wThr);
      }
    }
```

- [ ] **Step 1: Add a seeded angular-noise function and coastline constants before the main loop**

Find this line (just before the `for (let row = 0; row < H; row++) {` loop):
```js
    const TARGET_E = 0.46, TARGET_M = 0.50, TARGET_B = 0.55;
```

Replace it with:
```js
    const TARGET_E = 0.46, TARGET_M = 0.50, TARGET_B = 0.55;

    // Continent/coastline mask: elevation falls off toward open ocean far from
    // the map center. Landmass radius is perturbed per-angle by a small seeded
    // noise so the coastline is an irregular blob, not a perfect circle.
    const maxR       = Math.sqrt(halfW * halfW + halfH * halfH);
    const coastNoise = _makeNoise2D(Math.floor(rng() * 100000));
    const COAST_BASE_R  = maxR * 0.72;   // average landmass radius
    const COAST_WOBBLE   = 0.28;          // +/- fraction of COAST_BASE_R the coastline wobbles by
    const COAST_BAND     = maxR * 0.20;   // width of the land->ocean blend band
    const TARGET_OCEAN    = 0.05;          // elevation deep in the ocean, well below any wThr in GEN_PRESETS (min 0.15)
```

- [ ] **Step 2: Blend elevation toward ocean beyond the coastline radius**

Replace the loop body from Step 0 with:
```js
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const dx = col - halfW, dy = row - halfH;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t    = Math.max(0, 1.0 - dist / infR);
        const inf  = t * t * (3 - 2 * t);
        let e = eNoise(col, row)                           * (1-inf) + TARGET_E * inf;
        const m = mNoise(col*p.moistScale, row*p.moistScale) * (1-inf) + TARGET_M * inf;
        const b = bNoise(col*p.biomeScale, row*p.biomeScale) * (1-inf) + TARGET_B * inf;

        // Coastline: sample angular noise as a point on a small circle in noise
        // space (seamless wrap at angle 0/2*PI), perturb the landmass radius by it.
        const angle    = Math.atan2(dy, dx);
        const wobble   = coastNoise(Math.cos(angle) * 3 + 3, Math.sin(angle) * 3 + 3);
        const landR    = COAST_BASE_R * (1 + (wobble * 2 - 1) * COAST_WOBBLE);
        const coastT   = Math.max(0, Math.min(1, (dist - landR) / COAST_BAND));
        const coastInf = coastT * coastT * (3 - 2 * coastT);
        e = e * (1 - coastInf) + TARGET_OCEAN * coastInf;

        elev[row * W + col] = e;
        dest[row * W + col] = _classify(e, m, b, p.mThr, p.hThr, p.wThr);
      }
    }
```

- [ ] **Step 3: Manual verification**

Start the local server (see Global Constraints), open `http://localhost:8765/MapEditorPro.html`, open the Generator modal, and for each of the 5 presets:
1. Click the preset button, then look at the 270×270 preview canvas.
2. Confirm: there is a roughly blob-shaped landmass with visible ocean surrounding it (especially near the four corners), not water scattered arbitrarily across the whole square.
3. Confirm: the coastline is irregular/wobbly, not a perfect circle.
4. Try 3 different seed values (via the 🎲 button) per preset — the coastline shape should change each time but always form a single coherent landmass.

- [ ] **Step 4: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(generator): add continent/coastline mask to elevation field"
```

---

### Task 2: Multi-octave moisture and biome noise

**Files:**
- Modify: `MapEditorPro.html` — inside `_generateInto`, the `mNoise`/`bNoise` construction and their call sites inside the loop (touched by Task 1; locate the same function).

**Interfaces:**
- Consumes: `_multiOctave(seed, scale)` (already defined, unchanged, lines ~6605–6611 before this task) — returns a `(x, y) => value` closure with scale already baked in, unlike `_makeNoise2D(seedOff)` which returns `(x, y) => value` requiring the caller to pre-multiply coordinates by scale.
- Produces: smoother `m`/`b` fields feeding the same `_classify()` call from Task 1 — no signature changes.

Current code (before this task):
```js
    const eNoise = _multiOctave(seedE, p.elevScale);
    const mNoise = _makeNoise2D(seedM);
    const bNoise = _makeNoise2D(seedB);
```
and, inside the loop (from Task 1's Step 2):
```js
        const m = mNoise(col*p.moistScale, row*p.moistScale) * (1-inf) + TARGET_M * inf;
        const b = bNoise(col*p.biomeScale, row*p.biomeScale) * (1-inf) + TARGET_B * inf;
```

- [ ] **Step 1: Swap the noise constructors**

Replace:
```js
    const eNoise = _multiOctave(seedE, p.elevScale);
    const mNoise = _makeNoise2D(seedM);
    const bNoise = _makeNoise2D(seedB);
```
with:
```js
    const eNoise = _multiOctave(seedE, p.elevScale);
    const mNoise = _multiOctave(seedM, p.moistScale);
    const bNoise = _multiOctave(seedB, p.biomeScale);
```

- [ ] **Step 2: Update the call sites — scale is now baked into the closure, so stop pre-multiplying**

Replace:
```js
        const m = mNoise(col*p.moistScale, row*p.moistScale) * (1-inf) + TARGET_M * inf;
        const b = bNoise(col*p.biomeScale, row*p.biomeScale) * (1-inf) + TARGET_B * inf;
```
with:
```js
        const m = mNoise(col, row) * (1-inf) + TARGET_M * inf;
        const b = bNoise(col, row) * (1-inf) + TARGET_B * inf;
```

- [ ] **Step 3: Manual verification**

Reload `http://localhost:8765/MapEditorPro.html` (hard refresh to bypass cache), open the Generator modal:
1. Click "Wasteland" preset, look at the preview. Zoom your browser in (Cmd/Ctrl + `+`) on the 270×270 canvas or take a screenshot and crop a small region — confirm you no longer see individual single-pixel color flecks scattered through what should be a uniform region (e.g. a forest patch shouldn't have random single desert pixels inside it).
2. Repeat for "Jungle" and "Desert" presets — these have the widest `moistScale`/`biomeScale` spread (0.030/0.022 and 0.014/0.018 respectively) so are the most likely to still show artifacts if something's wrong.
3. Compare against a screenshot taken before this task's change (from Task 1's verification) — regions should look visibly smoother/more blob-like, not pixel-grainy.

- [ ] **Step 4: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(generator): use multi-octave noise for moisture and biome fields"
```

---

### Task 3: Post-classification smoothing pass, plus deferring expensive steps during live preview

**Files:**
- Modify: `MapEditorPro.html` — add a new private helper function inside the `Generator` IIFE; give `_generateInto` a 3rd `opts` parameter; call the new helper conditionally; update both call sites (`apply()` and `_renderPreview()`).

**Interfaces:**
- Produces: `_smoothTerrain(dest, W, H, passes)` — new private function (not exported from `Generator`). Mutates `dest` in place. Must run **before** rivers (`if (p.rivers > 0) { ... }`) and before `scatter()` calls, so it only ever smooths the base biome classification — never a river or resource tile, which are added afterward and must stay untouched (a majority filter would otherwise erase single-tile-wide rivers or shrink small resource clusters).
- Produces: `_generateInto(dest, p, opts)` — **signature change**, adds an optional 3rd parameter `opts` (defaults to `{}`). Recognizes `opts.skipExpensive` (boolean): when true, skips both river carving and the smoothing pass, so a debounced live-preview redraw doesn't pay for the two priciest steps on every slider tick. **Task 5 also extends this same `opts` object** (with `opts.debugOut`) — don't introduce a second positional parameter there; both tasks share this one `opts` bag.
- Consumes: nothing new for the smoothing function itself — operates purely on the string-ID array already produced by the classify loop.

This directly implements the approved spec's performance section: *"Rivers and the smoothing pass only run on final Apply, at full resolution... they're the most expensive steps and the least useful to see mid-drag."*

**Scope note:** the spec also mentions downsampling the live preview's resolution (e.g. every 2nd–4th cell) as a further mitigation. This plan deliberately does not implement that part — `_generateInto` reads `MAP_WIDTH`/`MAP_HEIGHT` directly from outer-scope globals rather than taking them as parameters, so true downsampling would mean threading a separate width/height through the function and restructuring the main loop with stride logic, which meaningfully raises the risk of this change for a cost the `skipExpensive` gate above likely already covers (the smoothing pass's per-cell `Map` allocation is the single most expensive addition in this plan, and rivers were already computed during preview before this plan with no reported responsiveness problem). Confirm actual preview responsiveness in Task 6 (Step 1.5) before considering downsampling as a follow-up.

- [ ] **Step 1: Add the smoothing helper function**

Add this new function directly above `function _generateInto(dest, p) {`:
```js
  // Majority-filter smoothing: each cell becomes whichever terrain ID is most
  // common among its 8 neighbors + itself. Run on the base biome classification
  // only, BEFORE rivers/resources are stamped on top (see call site below) —
  // otherwise a river's single-tile width or a small resource cluster's edges
  // would get voted out by their surrounding neighbors.
  function _smoothTerrain(dest, W, H, passes) {
    for (let pass = 0; pass < passes; pass++) {
      const src = dest.slice();
      for (let row = 0; row < H; row++) {
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
```

- [ ] **Step 2: Give `_generateInto` an `opts` parameter**

Find:
```js
  function _generateInto(dest, p) {
    const W = MAP_WIDTH, H = MAP_HEIGHT;
```
Replace with:
```js
  function _generateInto(dest, p, opts) {
    opts = opts || {};
    const W = MAP_WIDTH, H = MAP_HEIGHT;
```

- [ ] **Step 3: Call smoothing conditionally, right after the classify loop, before rivers**

Find this line (the end of the classify loop, right before the `if (p.rivers > 0) {` block):
```js
    }

    if (p.rivers > 0) {
```
Replace with:
```js
    }

    if (!opts.skipExpensive) _smoothTerrain(dest, W, H, 1);

    if (p.rivers > 0 && !opts.skipExpensive) {
```

- [ ] **Step 4: Pass `{ skipExpensive: true }` from the live preview, leave `apply()` unchanged**

`apply()`'s existing call site (`_generateInto(mapData, _getParams())`) needs no change — omitting the 3rd argument means `opts` defaults to `{}`, so `skipExpensive` is falsy and the full pipeline (rivers + smoothing) runs on every real Generate click, exactly as today.

Find `_renderPreview()`'s call to `_generateInto` (read the function body first to get its exact current form — it calls `_generateInto(tmp, _getParams())` per the existing code), and change that call to:
```js
    _generateInto(tmp, _getParams(), { skipExpensive: true });
```

- [ ] **Step 5: Manual verification**

Reload the editor, open the Generator modal:
1. Drag the "Elevation" or "Water" slider back and forth a few times while watching the preview — it should still update live at roughly the same responsiveness as before this task (it's now doing less work per tick, not more, since rivers/smoothing are skipped in preview).
2. Set "Rivers" to a non-zero value (e.g. 4) and click "Generate" (`apply()`, not just the live preview) — confirm rivers still appear as continuous unbroken lines reaching water in the actual applied map. This is the one place rivers/smoothing now only run, so verify here rather than in the preview.
3. Click through all 5 presets and Generate each — confirm biome regions read as clean, contiguous patches with smooth borders, no isolated single-tile "islands" of a different terrain type inside a larger region.
4. Enable Gold/Oil and set a mid-range count (e.g. 12/8, the defaults), Generate — confirm resource tiles are still visible as small clusters (this task shouldn't change their shape yet — cluster quality is Task 4).

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(generator): add post-classification smoothing pass, defer rivers/smoothing during live preview"
```

---

### Task 4: Cluster-based resource placement

**Files:**
- Modify: `MapEditorPro.html` — the `scatter(type, count, minE, maxE)` inner function inside `_generateInto`.

**Interfaces:**
- Consumes: `elev` (Float32Array, already populated with the coastline-adjusted elevation from Task 1), `rng`, `halfW`/`halfH`, `excR2` — all already in scope at the `scatter` call sites.
- Produces: same call sites, same signature (`scatter(type, count, minE, maxE)`), same two call sites unchanged:
  ```js
  if (p.gold) scatter(_getGenT().GOLD, p.goldCount, p.hThr, 1.0);
  if (p.oil)  scatter(_getGenT().OIL,  p.oilCount,  p.wThr, p.hThr);
  ```
  Only `scatter`'s internal placement strategy changes — `count` still means "total tiles placed" (approximately, same as today's behavior which also isn't exact due to rejection sampling), so the modal's existing count sliders need no changes.

Current code (before this task):
```js
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
```

- [ ] **Step 1: Replace `scatter` with a cluster-based version**

Replace the whole function above with:
```js
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
```

- [ ] **Step 2: Manual verification**

Reload the editor, open the Generator modal:
1. Enable Gold Veins only (uncheck Oil), set count to 12 (default), generate a few seeds.
2. Confirm gold tiles appear in small clumps of ~3-4 adjacent/nearby tiles, not as ~12 independently scattered single tiles across the map.
3. Repeat with Oil only, count 8 (default).
4. Set gold count to the slider maximum (40) and confirm it still produces multiple distinct deposits rather than one giant blob covering everything (10 clusters of 4 at max settings, which should still read as separate deposits given the map is 450×450).

- [ ] **Step 3: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(generator): cluster gold/oil deposits instead of independent scatter"
```

---

### Task 5: Elevation/moisture debug heatmap view

**Files:**
- Modify: `MapEditorPro.html` — the generator modal HTML (the `<div class="gen-controls">` block, ~line 2103 before this task's edits — locate by the `<!-- Seed -->` comment), `_getParams()`, and `_renderPreview()`.

**Interfaces:**
- Produces: a new recognized field `opts.debugOut` on the `opts` object Task 3 already added to `_generateInto(dest, p, opts)` — no further signature change. When `opts.debugOut` is `{ elev: Float32Array, moist: Float32Array }` (both pre-allocated by the caller at `W*H` length), this function fills them in alongside its normal work. `apply()`'s call site is unaffected (it never sets `debugOut`).
- Consumes: `p.debug` (new boolean field from `_getParams()`, read from a new `#gen-debug` checkbox).

- [ ] **Step 1: Add the debug checkbox to the modal**

Find (inside `<div class="gen-controls">`, right after the closing of the Seed row and its `</div>`, before `<!-- Presets -->`):
```html
        <!-- Presets -->
```
Replace with:
```html
        <div class="gen-check-row">
          <input id="gen-debug" type="checkbox" onchange="Generator.schedule()">
          <label for="gen-debug" style="color:#8ab4f8">Debug: show elevation/moisture</label>
        </div>
        <!-- Presets -->
```

- [ ] **Step 2: Read the new checkbox in `_getParams()`**

Find:
```js
      oil:        document.getElementById('gen-oil').checked,
      oilCount:   parseInt(document.getElementById('gen-oilCount').value),
    };
  }
```
Replace with:
```js
      oil:        document.getElementById('gen-oil').checked,
      oilCount:   parseInt(document.getElementById('gen-oilCount').value),
      debug:      document.getElementById('gen-debug').checked,
    };
  }
```

- [ ] **Step 3: Extend the shared `opts` object (from Task 3) with `debugOut`, and fill it in**

`_generateInto`'s signature already gained an `opts` parameter in Task 3 (`function _generateInto(dest, p, opts) { opts = opts || {}; ...`) — this task adds a new recognized field on that same object, `opts.debugOut`, rather than a new positional parameter.

Find the loop body written in Task 2 (the `const m = mNoise(col, row) ...` line and its neighbors), specifically this line which is unchanged by Task 3 (Task 3 only touches code after the loop closes):
```js
        elev[row * W + col] = e;
        dest[row * W + col] = _classify(e, m, b, p.mThr, p.hThr, p.wThr);
```
Replace with:
```js
        elev[row * W + col] = e;
        if (opts.debugOut) { opts.debugOut.elev[row * W + col] = e; opts.debugOut.moist[row * W + col] = m; }
        dest[row * W + col] = _classify(e, m, b, p.mThr, p.hThr, p.wThr);
```

- [ ] **Step 4: Render the heatmap in `_renderPreview()` when debug is on**

Read `_renderPreview()`'s existing body first (after Task 3, it calls `_generateInto(tmp, _getParams(), { skipExpensive: true })`) to get its exact current local variable names for the canvas/context/per-pixel write mechanism — this plan doesn't reproduce that body verbatim, so adapt the names below to match rather than introducing new ones. The change needed:

1. Build a `debugOut` object and merge it into the same opts bag already being passed:
```js
    const params = _getParams();
    const debugOut = params.debug
      ? { elev: new Float32Array(MAP_WIDTH * MAP_HEIGHT), moist: new Float32Array(MAP_WIDTH * MAP_HEIGHT) }
      : null;
    _generateInto(tmp, params, { skipExpensive: true, debugOut });
```
2. When `debugOut` is set, instead of the existing per-pixel `Terrain.color(id)` lookup, paint each pixel as a grayscale value from `debugOut.elev` (left half of canvas) and `debugOut.moist` (right half of canvas) — split the 270-wide canvas down the middle:
```js
    if (debugOut) {
      for (let py = 0; py < canvasH; py++) {
        for (let px = 0; px < canvasW; px++) {
          const col = Math.floor(px / canvasW * MAP_WIDTH);
          const row = Math.floor(py / canvasH * MAP_HEIGHT);
          const idx = row * MAP_WIDTH + col;
          const isLeftHalf = px < canvasW / 2;
          const v = isLeftHalf ? debugOut.elev[idx] : debugOut.moist[idx];
          const gray = Math.max(0, Math.min(255, Math.round(v * 255)));
          setPixel(px, py, gray, gray, gray);  // use whatever per-pixel ImageData write helper _renderPreview already uses
        }
      }
    } else {
      // existing Terrain.color(id)-based rendering, unchanged
    }
```
(`canvasW`/`canvasH`/`setPixel` should match whatever local names `_renderPreview` already uses for the 270×270 canvas and its per-pixel write mechanism.)

**Note:** since preview always passes `skipExpensive: true` (from Task 3), the debug heatmap will reflect elevation/moisture *before* rivers are carved — this is expected and actually more useful for debugging (it shows the raw fields driving classification, undistorted by river tiles overwriting cells).

- [ ] **Step 5: Manual verification**

Reload the editor, open the Generator modal, check "Debug: show elevation/moisture":
1. Confirm the preview canvas now shows two grayscale halves instead of colored terrain.
2. Confirm the left half (elevation) shows dark edges/corners (ocean, from Task 1's coastline mask) and lighter blobs inland (higher elevation) — this is the fastest way to confirm Task 1 is working correctly.
3. Confirm the right half (moisture) looks smooth/blobby (from Task 2's multi-octave change), not grainy.
4. Uncheck the box, confirm the preview goes back to normal colored terrain.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(generator): add elevation/moisture debug heatmap view"
```

---

### Task 6: Full end-to-end verification pass

**Files:** none (verification-only task, no code changes expected — this task exists to catch cross-task regressions before calling the feature done).

**Interfaces:** none.

- [ ] **Step 1: Verify each success criterion from the approved spec**

Reload the editor at `http://localhost:8765/MapEditorPro.html`, open the Generator modal, and for at least 3 different seeds per preset (15 generations total):

1. **No speckling** — zoom into the preview or apply-and-zoom the actual map canvas; confirm no isolated single-tile biome flecks.
2. **Coherent geography** — a visible coastline against ocean, elevation bands (lowlands → hills → mountains) that read as a real landscape, not arbitrary placement.
3. **Rivers reach water** — with Rivers set to each preset's default, confirm every visible river runs from high ground to the ocean or a lake without stopping mid-land (a short truncated river is acceptable per the existing "steps >= 18" minimum-length filter, but it should still end at a lower-elevation area, not just stop arbitrarily on a hillside).
4. **Resource clusters** — gold/oil each read as small clumps, not scattered singles.
5. **Performance** — open your browser's DevTools Performance/Console tab, click "Generate" (`apply()`) at full 450×450, confirm it completes in well under 1 second (the existing "Map generated" toast firing quickly is a reasonable proxy if you don't want to instrument timing directly). Also note whether the live preview (before clicking Generate) still feels responsive while dragging sliders — this is the thing Task 3's `skipExpensive` gate is meant to protect.
6. **Determinism** — pick one seed, Generate, note the result (or export it); re-enter the exact same seed and all the same slider values, Generate again; confirm the output is pixel-identical. This must still hold since no task touches the `_lcg`/seed-derivation mechanism, but it's cheap to confirm directly.

- [ ] **Step 2: Confirm nothing downstream broke**

1. After clicking "Generate" (`apply()`), confirm the city settlement still appears at map center (unchanged behavior from `apply()`'s existing `getCityCol()/getCityRow()` logic).
2. Export the map (existing "Save"/export flow) and confirm the JSON still has the expected `width`/`height`/`data` shape (spot-check a few cells against what's visible on screen).
3. Confirm `Generator.applyPreset()` still works for all 5 presets (buttons visibly update the sliders and trigger a preview refresh).

- [ ] **Step 3: Final commit (only if Step 1/2 turned up fixes)**

If everything in Steps 1–2 passes cleanly, there's nothing to commit — the feature is done as of Task 5's commit. If any issue surfaces, fix it, re-run the relevant task's verification checklist, then:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "fix(generator): <describe the specific fix>"
```
