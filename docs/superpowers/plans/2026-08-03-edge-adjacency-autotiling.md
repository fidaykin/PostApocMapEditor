# Edge-Adjacency Auto-Tiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Generator's carved rivers use the correct directional `River_*`/`Lake_*` tile per cell (instead of random flat water), and let the manual Paint/Fill tools auto-resolve the same way when a user paints river/lake terrain — both through one shared, family-agnostic resolver, not a water-specific hack.

**Architecture:** A new standalone top-level module, `EdgeTiling`, sits alongside the existing `Roads` module (both are auto-tiling helpers) rather than living inside `Generator` as the design spec's prose originally suggested — `Tools` (the Paint/Fill code) needs to call this too, and burying it inside `Generator` would create an awkward cross-module dependency for code that has nothing to do with procedural generation. This is a deliberate, small deviation from the spec's literal wording, not a change to what the feature does. `EdgeTiling` builds a mask→tile-id lookup from any hex records whose `type` is in a caller-supplied `familyTypes` array (today only `['Water','Rivers']` is ever passed), using the same 6-bit direction convention (`SE=0,NE=1,N=2,NW=3,SW=4,S=5`) the `Roads` module already uses.

**Tech Stack:** Vanilla JS, single inline `<script>` in `MapEditorPro.html`. No build step, no new dependencies, no new files.

## Global Constraints

- Everything stays inside the single `MapEditorPro.html` file's existing `<script>` — no new files, no `<script src="...">`.
- The `edgeFaces` field (renamed from `waterFaces`) must keep working identically for the existing Hex DB editor's "Water Exits" rosette UI — designers must still be able to view/edit which directions a river tile's water exits through, unaffected by this work.
- `_generateInto`'s output contract (flat array of string hex terrain IDs, `row*W+col` indexed, mutated in place) is unchanged — this plan only changes *which* id gets written for river cells, never the array shape.
- Validation is manual/visual, per the established project convention (no automated test harness, and introducing one is out of scope) — every task's "test cycle" is: start a local server, use the `claude-in-chrome` browser tools to drive the live page and compute objective checks (as the prior two plans' subagents did), not visual eyeballing.
- Determinism: the Generator's resolver call must consume randomness from the seeded `rng` already threaded through `_generateInto`, so generation stays reproducible per seed. The manual-paint resolver call can use `Math.random` — determinism doesn't matter for a live interactive stroke.
- `EdgeTiling` must not hardcode water anywhere in its own implementation — `familyTypes`, `fallbackIds` are always parameters supplied by the caller. The only water-specific thing anywhere in this plan is the two call sites (Generator, Paint/Fill) passing `['Water','Rivers']`.

**Local verification server (used by every task below):**
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
python3 -m http.server 8765
```
Open `http://localhost:8765/MapEditorPro.html?_=<timestamp>` (cache-bust every reload, this file changes across tasks).

---

### Task 1: Rename `waterFaces` → `edgeFaces` everywhere

**Files:**
- Modify: `MapEditorPro.html` — six code locations (found by exact search, not line number, since earlier tasks will shift these): the `_blank()` hex-record template, `_waterFacesHTML()`, the section-visibility gate that calls it, the rosette click handler, and the load-time migration backfill.
- Modify (live data): `packages/postapoc/hex_database.json` on the `gh-pages` branch of this repo — every one of the 82 hex records has a `waterFaces` key (it's a default field on every record, not something added per-record; only 28 `Rivers`-typed records have a non-empty array, plus `Lake_7` has an empty one, the rest are all `[]`).

**Interfaces:**
- Produces: every hex record's `edgeFaces` field, in the same shape as `waterFaces` was (an array of direction-name strings, e.g. `['N','S']`, or `[]`). Task 2's `EdgeTiling` module reads this field name.
- Consumes: nothing new.

- [ ] **Step 1: Rename the field in the `_blank()` template**

Find:
```js
      waterFaces:[],
```
Replace with:
```js
      edgeFaces:[],
```

- [ ] **Step 2: Rename the render function and its field read**

Find:
```js
  function _waterFacesHTML(hex) {
    if (hex.type !== 'Rivers') return '';
    const faces = Array.isArray(hex.waterFaces) ? hex.waterFaces : [];
```
Replace with:
```js
  function _edgeFacesHTML(hex) {
    if (hex.type !== 'Rivers') return '';
    const faces = Array.isArray(hex.edgeFaces) ? hex.edgeFaces : [];
```
(The `hex.type !== 'Rivers'` gate stays exactly as-is — this plan doesn't add editing UI for any other terrain family, per the spec's explicit out-of-scope note. Only water/rivers has content to edit today.)

- [ ] **Step 3: Update the call site that invokes the renamed function**

Find:
```js
      (hex.type === 'Rivers' ? _sectionHTML('waterfaces', 'WATER EXITS', _waterFacesHTML(hex)) : '') +
```
Replace with:
```js
      (hex.type === 'Rivers' ? _sectionHTML('waterfaces', 'WATER EXITS', _edgeFacesHTML(hex)) : '') +
```
(The `'waterfaces'` section-id string and `'WATER EXITS'` label are UI-facing labels for the *water* family specifically — leave those as-is, they're correct and not part of what's being generalized here. Only the function name and field name change.)

- [ ] **Step 4: Update the rosette click handler**

Find:
```js
        const h = _data.hexes[_filtered[_selFilt]];
        if (!Array.isArray(h.waterFaces)) h.waterFaces = [];
        const idx = h.waterFaces.indexOf(dir);
        if (idx >= 0) h.waterFaces.splice(idx, 1);
        else h.waterFaces.push(dir);
```
Replace with:
```js
        const h = _data.hexes[_filtered[_selFilt]];
        if (!Array.isArray(h.edgeFaces)) h.edgeFaces = [];
        const idx = h.edgeFaces.indexOf(dir);
        if (idx >= 0) h.edgeFaces.splice(idx, 1);
        else h.edgeFaces.push(dir);
```

- [ ] **Step 5: Update the load-time migration backfill**

Find:
```js
      // waterFaces migration
      if (!Array.isArray(h.waterFaces)) h.waterFaces = [];
```
Replace with:
```js
      // edgeFaces migration (renamed from waterFaces) — also upgrade any
      // legacy map file that still has the old key name.
      if (Array.isArray(h.waterFaces) && !Array.isArray(h.edgeFaces)) h.edgeFaces = h.waterFaces;
      delete h.waterFaces;
      if (!Array.isArray(h.edgeFaces)) h.edgeFaces = [];
```
(Unlike the other four steps, this one keeps a small compatibility shim — it's the load-time migration function itself, whose whole job is upgrading old data, so it should carry forward anyone's already-saved map file that still says `waterFaces` rather than silently losing that data.)

- [ ] **Step 6: Confirm no other reference to the old field name remains in the file**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
grep -n "waterFaces" MapEditorPro.html
```
Expected: only the two lines inside the Step 5 migration shim (the comment and the `h.waterFaces` reads/delete) — everything else should be `edgeFaces` now.

- [ ] **Step 7: Migrate the live `hex_database.json` on `gh-pages`**

This repo has an established pattern (used throughout this project's recent history) for pushing precise data changes directly to `gh-pages` without disturbing the local `dev` branch: fetch the current tip, build a new blob with the field renamed, write a new tree, commit, push. Follow it here:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git fetch origin gh-pages --quiet
PARENT=$(git rev-parse origin/gh-pages)
echo "Parent: $PARENT"
git show origin/gh-pages:packages/postapoc/hex_database.json > /tmp/hexdb_rename.json
python3 -c "
import json
d = json.load(open('/tmp/hexdb_rename.json'))
renamed = 0
for h in d['hexes']:
    if 'waterFaces' in h:
        h['edgeFaces'] = h.pop('waterFaces')
        renamed += 1
json.dump(d, open('/tmp/hexdb_rename.json', 'w'), indent=2, ensure_ascii=False)
print(f'renamed {renamed} records')
"
```
Confirm the printed count is `82` before proceeding (every record has the field, per this task's Files note above). Then hash, build the tree, commit, and push exactly like prior sessions' data pushes:
```bash
BLOB=$(git hash-object -w /tmp/hexdb_rename.json)
rm -f /tmp/gh-pages-index-rename
GIT_INDEX_FILE=/tmp/gh-pages-index-rename git read-tree $PARENT
GIT_INDEX_FILE=/tmp/gh-pages-index-rename git update-index --add --cacheinfo 100644,$BLOB,packages/postapoc/hex_database.json
NEWTREE=$(GIT_INDEX_FILE=/tmp/gh-pages-index-rename git write-tree)
echo "New tree: $NEWTREE"
```
```bash
git commit-tree $NEWTREE -p $PARENT -m "data: rename waterFaces to edgeFaces on all hex records"
```
Verify the printed commit hash is a valid commit object (`git cat-file -t <hash>` should print `commit`) before pushing — as a standalone command, not chained with the commit-tree call, since this repo has previously hit shell-quoting issues combining multi-step git-plumbing commands in one invocation. Then:
```bash
git push origin <the commit hash>:refs/heads/gh-pages
```

- [ ] **Step 8: Manual verification**

1. Confirm the live data: `git show origin/gh-pages:packages/postapoc/hex_database.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for h in d['hexes'] if 'edgeFaces' in h), sum(1 for h in d['hexes'] if 'waterFaces' in h))"` — expect `82 0`.
2. Reload the editor locally, open the Hex DB tab, find a `River_*` record (e.g. `River_L_1`), confirm the "WATER EXITS" section still renders its rosette with the correct directions highlighted (this proves the renamed field round-trips correctly from the live JSON through the renamed template/render function).
3. Toggle one direction on and off in the rosette, confirm it persists (autosave) and the record's `edgeFaces` array updates — not `waterFaces`.
4. No console errors.

- [ ] **Step 9: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "refactor(hexdb): rename waterFaces to edgeFaces"
```

---

### Task 2: `EdgeTiling` module

**Files:**
- Modify: `MapEditorPro.html` — add a new top-level module immediately after the `Roads` module's closing `})();`.

**Interfaces:**
- Produces: `EdgeTiling.resolveEdgeTile(col, row, W, H, dataArr, familyTypes, rng, fallbackIds)` — returns a tile id string. `familyTypes`: array of `HexDB` `type` strings that count as "connects to me" (e.g. `['Water','Rivers']`). `dataArr`: the flat terrain-id array to read neighbors from (either the Generator's local `dest`, or the live `mapData`). `rng`: a `() => number in [0,1)` function (either the Generator's seeded `rng`, or `Math.random`). `fallbackIds`: array of ids to pick from (via `rng`) when no mask match exists in the table at all.
- Produces: `EdgeTiling.clearCache()` — clears the internal per-`familyTypes` lookup-table cache. Not wired to anything automatically in this plan (see Task 5's note) — exposed so a future call site can invalidate it if `HexDB`'s content ever reloads with different records (e.g. switching content packages).
- Consumes: `HexDB.getAll()` (returns hex records with `id`/`type`/`edgeFaces`), `Terrain.byHexId(id)` (existing case-insensitive lookup, returns a record with `.type` or `null`), the top-level `_DIRS_EVEN`/`_DIRS_ODD` neighbor-offset tables (same convention `Roads.getNeighbors` uses: `{N,S,NE,SE,NW,SW}` keys, chosen by row parity via `(H - 1 - row) % 2`).

- [ ] **Step 1: Add the module**

Find the end of the `Roads` module (its closing line, followed by the `Canvas` module's header comment):
```js
  return { loadSprites, calcBitmask, drawOverlay, getNeighbors };
})();

// CANVAS MODULE — hex renderer, viewport, zoom/pan
// ════════════════════════════════════════════════════════════
const Canvas = (() => {
```
Replace with:
```js
  return { loadSprites, calcBitmask, drawOverlay, getNeighbors };
})();

// ═══════════════════════════════════════════════════════════════
// EDGE TILING — generic neighbor-adjacency tile resolver. Given a
// terrain "family" (a set of HexDB `type` values, e.g. water/rivers),
// looks up which pre-authored directional tile matches a cell's real
// neighbors, the same way Roads picks a road sprite by bitmask. Not
// hardcoded to any one family — callers supply familyTypes/fallbackIds.
// ═══════════════════════════════════════════════════════════════
const EdgeTiling = (() => {
  const FACE_NAMES = ['SE', 'NE', 'N', 'NW', 'SW', 'S']; // same bit order as Roads' _DIR_BITS

  const _tableCache = new Map(); // "familyTypes,sorted,joined" -> { [mask]: [ids] }

  function _buildEdgeMaskTable(familyTypes) {
    const key = familyTypes.slice().sort().join(',');
    if (_tableCache.has(key)) return _tableCache.get(key);
    const table = {};
    if (typeof HexDB !== 'undefined') {
      for (const h of HexDB.getAll()) {
        if (!familyTypes.includes(h.type)) continue;
        const faces = Array.isArray(h.edgeFaces) ? h.edgeFaces : [];
        let mask = 0;
        for (const f of faces) {
          const bit = FACE_NAMES.indexOf(f);
          if (bit >= 0) mask |= (1 << bit);
        }
        if (!table[mask]) table[mask] = [];
        table[mask].push(h.id);
      }
    }
    _tableCache.set(key, table);
    return table;
  }

  function _neighborCoords(col, row, W, H) {
    const dirs = (H - 1 - row) % 2 !== 0 ? _DIRS_EVEN : _DIRS_ODD;
    return FACE_NAMES.map(name => {
      const [dc, dr] = dirs[name];
      return { col: col + dc, row: row + dr };
    });
  }

  function resolveEdgeTile(col, row, W, H, dataArr, familyTypes, rng, fallbackIds) {
    const table = _buildEdgeMaskTable(familyTypes);
    const neighbors = _neighborCoords(col, row, W, H);
    let mask = 0;
    neighbors.forEach(({ col: nc, row: nr }, i) => {
      if (nc < 0 || nc >= W || nr < 0 || nr >= H) return;
      const nId = dataArr[nr * W + nc];
      const nEntry = typeof Terrain !== 'undefined' ? Terrain.byHexId(nId) : null;
      if (nEntry && familyTypes.includes(nEntry.type)) mask |= (1 << i);
    });
    const options = table[mask];
    if (options && options.length) return options[Math.floor(rng() * options.length)];
    return fallbackIds[Math.floor(rng() * fallbackIds.length)];
  }

  function clearCache() { _tableCache.clear(); }

  return { resolveEdgeTile, clearCache };
})();

// CANVAS MODULE — hex renderer, viewport, zoom/pan
// ════════════════════════════════════════════════════════════
const Canvas = (() => {
```

- [ ] **Step 2: Manual verification**

Since this module has no UI hookup yet (Tasks 3/4 wire it up), verify it directly via the browser console:
1. Load tools: ToolSearch with query `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__javascript_tool`
2. Navigate to `http://localhost:8765/MapEditorPro.html?_=<timestamp>`.
3. Confirm the module loads and the mask table builds correctly:
   ```js
   (function() {
     const table = EdgeTiling.resolveEdgeTile; // just confirm it's a function, not undefined
     // Build a table manually to inspect it (the function itself is private, so
     // infer correctness by calling resolveEdgeTile against a synthetic scenario):
     const W = 5, H = 5;
     const data = new Array(W * H).fill('Plain_1');
     // Put a water tile directly north and south of (2,2) to force a "straight through" mask.
     // Use HexDB.getAll() to find the two real neighbor coords for (2,2) at whatever
     // parity row 2 has, so this test is grid-accurate rather than guessed.
     return typeof EdgeTiling.resolveEdgeTile;
   })()
   ```
4. Confirm `HexDB.getAll().filter(h => h.type === 'Rivers' && h.edgeFaces && h.edgeFaces.length).length` returns `28` (the count from Task 1, now under the new field name) — this is the real precondition for the mask table having any content at all.
5. No console errors from simply loading the page with the new module present.

- [ ] **Step 3: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(edge-tiling): add generic neighbor-adjacency tile resolver"
```

---

### Task 3: Generator integration

**Files:**
- Modify: `MapEditorPro.html` — the river-carving block inside `_generateInto` (the `if (p.rivers > 0 && !opts.skipExpensive) { ... }` block).

**Interfaces:**
- Consumes: `EdgeTiling.resolveEdgeTile(col, row, W, H, dest, familyTypes, rng, fallbackIds)` from Task 2.
- Produces: no new exports — this is a behavior change inside an existing private block. `dest` still ends up with the same output contract (flat string-id array), just with directional ids for river cells instead of random flat ones.

Current code (as of Task 1/2's commits — this exact block is untouched by those, so it should still read like this):
```js
    if (p.rivers > 0 && !opts.skipExpensive) {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      const cr2  = infR * infR;
      const _riverT = _getGenT();
      const _riverV = [_riverT.WATER_DARK, _riverT.WATER_LIGHT, _riverT.WATER_ROCK];
      let carved = 0, tries = 0;
      while (carved < p.rivers && tries < 1200) {
        tries++;
        const sc = Math.floor(rng() * (W - 20)) + 10;
        const sr = Math.floor(rng() * (H - 20)) + 10;
        if (elev[sr * W + sc] < p.mThr) continue;
        const ddx = sc - halfW, ddy = sr - halfH;
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
          for (const { idx, val } of paintBuf) dest[idx] = val;
          carved++;
        }
      }
    }
```

- [ ] **Step 1: Track committed river-cell indices, then resolve them after all rivers are carved**

The walk itself keeps assigning a random flat water tile exactly as today — that's now just a *placeholder* value, correct enough that neighbor-membership checks still see it as "water" during the resolution pass (flat water tiles are `type: 'Water'`, which is included in the `familyTypes` this task passes). After every river attempt is done, a second pass overwrites each committed cell with the real directional tile, now that every river's final path (and the coastline) is known.

Find:
```js
        if (steps >= 18) {
          for (const { idx, val } of paintBuf) dest[idx] = val;
          carved++;
        }
      }
    }
```
Replace with:
```js
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
        dest[idx] = EdgeTiling.resolveEdgeTile(rcol, rrow, W, H, dest, ['Water', 'Rivers'], rng, _riverV);
      }
    }
```

- [ ] **Step 2: Declare `riverCellIndices` alongside the other per-block state**

Find:
```js
      const _riverT = _getGenT();
      const _riverV = [_riverT.WATER_DARK, _riverT.WATER_LIGHT, _riverT.WATER_ROCK];
      let carved = 0, tries = 0;
```
Replace with:
```js
      const _riverT = _getGenT();
      const _riverV = [_riverT.WATER_DARK, _riverT.WATER_LIGHT, _riverT.WATER_ROCK];
      const riverCellIndices = [];
      let carved = 0, tries = 0;
```

- [ ] **Step 3: Manual verification**

1. Load tools: ToolSearch with query `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages`
2. Navigate to `http://localhost:8765/MapEditorPro.html?_=<timestamp>`.
3. Generate rivers and confirm they now use directional tiles, not just flat water:
   ```js
   (function() {
     document.getElementById('gen-rivers').value = 6;
     document.getElementById('gen-seed').value = 42;
     Generator.applyPreset('jungle');
     Generator.apply();
     const W = MAP_WIDTH, H = MAP_HEIGHT;
     const counts = {};
     for (let i = 0; i < W*H; i++) {
       const id = mapData[i];
       if (/river|lake/i.test(id)) counts[id] = (counts[id]||0) + 1;
     }
     return counts;
   })()
   ```
   Confirm the result has *multiple distinct* `River_*`/`Lake_*` ids (not just flat `Water_*` ids) — this is the core proof the resolver is running.
4. Re-run the prior plan's river-carving success-rate check (isolated-water-tile count, and per-preset success rate across ~20 seeds for wasteland/jungle/arctic/desert) and confirm it's unchanged from the last verified numbers (100%/100%/100%/88%) — this task must not affect whether a river carve *succeeds*, only what tile ends up on the ground.
5. Confirm determinism still holds: same seed + same slider values, `Generator.apply()` twice, `mapData.join('|')` identical both times.
6. Confirm performance is still well under 1 second for `Generator.apply()` (`performance.now()` before/after).
7. No console errors.

Report actual counts/numbers, not just "looks right."

- [ ] **Step 4: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(generator): resolve carved rivers to directional tiles via EdgeTiling"
```

---

### Task 4: Manual Paint/Fill integration

**Files:**
- Modify: `MapEditorPro.html` — `Tools._paint(col, row)` and `Tools._fill(col, row)`.

**Interfaces:**
- Consumes: `EdgeTiling.resolveEdgeTile(...)` from Task 2.
- Produces: no new exports — this is additive behavior at the end of two existing private functions, both of which already end with `Canvas.render()` (a full-grid redraw, so no separate re-render call is needed for the extra neighbor cells this task mutates — the next `Canvas.render()` picks them up automatically).

Current `_paint` (unaffected lines above/below omitted for brevity — find by this exact excerpt):
```js
    const tiles = Brush.getAffectedTiles(col, row);
    const hexId = UI.getSelectedTerrain();
    tiles.forEach(({ col: c, row: r }) => {
      if (c >= 0 && c < MAP_WIDTH && r >= 0 && r < MAP_HEIGHT) {
        if (getSatelliteAnchor(c, r)) return; // block painting under multi-tile footprint
        mapData[r * MAP_WIDTH + c] = hexId;
        const bi = bridgesData.findIndex(b => b.col === c && b.row === r);
        if (bi >= 0) bridgesData.splice(bi, 1);
      }
    });
    invalidateSatelliteMap();
    Canvas.render();
  }
```

Current `_fill`:
```js
  function _fill(col, row) {
    const targetId = mapData[row * MAP_WIDTH + col];
    const fillId   = UI.getSelectedTerrain();
    if (targetId === fillId) return;

    const visited = new Set();
    const queue   = [[col, row]];
    const key = (c, r) => c * 10000 + r;
    visited.add(key(col, row));

    while (queue.length) {
      const [c, r] = queue.shift();
      if (getSatelliteAnchor(c, r)) continue; // skip tiles under multi-tile footprint
      mapData[r * MAP_WIDTH + c] = fillId;
      const even = c % 2 === 0;
      const nbrs = [
        [c, r-1], [c+1, even ? r-1 : r], [c+1, even ? r : r+1],
        [c, r+1], [c-1, even ? r   : r+1], [c-1, even ? r-1 : r]
      ];
      nbrs.forEach(([nc, nr]) => {
        if (nc < 0 || nc >= MAP_WIDTH || nr < 0 || nr >= MAP_HEIGHT) return;
        const k = key(nc, nr);
        if (visited.has(k)) return;
        if (mapData[nr * MAP_WIDTH + nc] !== targetId) return;
        visited.add(k);
        queue.push([nc, nr]);
      });
    }
    invalidateSatelliteMap();
    Canvas.render();
  }
```

- [ ] **Step 1: Add a shared helper that auto-resolves a set of painted cells plus their neighbors**

Add this new function directly above `function _paint(col, row) {`:
```js
  // If the id just painted at (col,row) belongs to an edge-tiled family
  // (i.e. it has edgeFaces data — today that's only Water/Rivers), re-resolve
  // this cell and its 6 neighbors so the correct directional tile is used,
  // the same way the Generator's river-carving does. Plain terrain (no
  // edgeFaces) is untouched — this is a no-op for ordinary painting.
  function _autoResolveEdgesAround(cellsPainted) {
    if (typeof EdgeTiling === 'undefined' || typeof HexDB === 'undefined') return;
    const familyTypes = ['Water', 'Rivers'];
    const toResolve = new Set();
    for (const { col: c, row: r } of cellsPainted) {
      if (c < 0 || c >= MAP_WIDTH || r < 0 || r >= MAP_HEIGHT) continue;
      const entry = Terrain.byHexId(mapData[r * MAP_WIDTH + c]);
      // Only trigger when the painted cell itself is a directional river/lake
      // tile (non-empty edgeFaces) — this is the exact condition from the
      // spec. Plain flat water (Water_1 etc.) has an empty edgeFaces array
      // despite being type:'Water', so it correctly falls through untouched
      // here even though 'Water' is in familyTypes below (that broader check
      // is only for whether a *neighbor* counts toward the adjacency mask,
      // not for whether the painted cell itself should trigger resolution).
      if (!entry || !Array.isArray(entry.edgeFaces) || entry.edgeFaces.length === 0) continue;
      const idx = r * MAP_WIDTH + c;
      toResolve.add(idx);
      const dirs = (MAP_HEIGHT - 1 - r) % 2 !== 0 ? _DIRS_EVEN : _DIRS_ODD;
      for (const [dc, dr] of Object.values(dirs)) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= MAP_WIDTH || nr < 0 || nr >= MAP_HEIGHT) continue;
        const nEntry = Terrain.byHexId(mapData[nr * MAP_WIDTH + nc]);
        if (nEntry && familyTypes.includes(nEntry.type)) toResolve.add(nr * MAP_WIDTH + nc);
      }
    }
    const fallbackIds = [_riverFallbackId('Water_Dirty_1'), _riverFallbackId('Water_1'), _riverFallbackId('Water_Rock_1')];
    for (const idx of toResolve) {
      const rr = Math.floor(idx / MAP_WIDTH), rc = idx % MAP_WIDTH;
      mapData[idx] = EdgeTiling.resolveEdgeTile(rc, rr, MAP_WIDTH, MAP_HEIGHT, mapData, familyTypes, Math.random, fallbackIds);
    }
  }

  function _riverFallbackId(hexId) {
    if (typeof HexDB !== 'undefined') {
      const e = HexDB.getAll().find(h => h.id && h.id.toLowerCase() === hexId.toLowerCase());
      if (e) return e.id;
    }
    return hexId;
  }
```

- [ ] **Step 2: Call it from `_paint`, right before the existing `Canvas.render()`**

Find (inside `_paint`):
```js
    invalidateSatelliteMap();
    Canvas.render();
  }

  // ── Zone Paint ────────────────────────────────────────────
```
Replace with:
```js
    invalidateSatelliteMap();
    _autoResolveEdgesAround(tiles);
    Canvas.render();
  }

  // ── Zone Paint ────────────────────────────────────────────
```
(This is the `_paint` function's ending — `tiles` is the same `Brush.getAffectedTiles(col, row)` array already computed earlier in the function; reuse it rather than recomputing.)

- [ ] **Step 3: Call it from `_fill`, right before its own `Canvas.render()`**

Find (inside `_fill`):
```js
    invalidateSatelliteMap();
    Canvas.render();
  }

  // ── Rectangle ──────────────────────────────────────────────
```
Replace with:
```js
    invalidateSatelliteMap();
    _autoResolveEdgesAround([...visited].map(k => ({ col: Math.floor(k / 10000), row: k % 10000 })));
    Canvas.render();
  }

  // ── Rectangle ──────────────────────────────────────────────
```
(`_fill`'s own `visited` set already holds every filled cell, encoded via its local `key(c,r) = c*10000+r` scheme — decode it back to `{col,row}` pairs for `_autoResolveEdgesAround`. `_applyRect` is intentionally left untouched — the spec named "Paint/Fill tools" specifically, not the rectangle tool; extending to it is a reasonable follow-up but not required here.)

- [ ] **Step 4: Manual verification**

1. Load tools: ToolSearch with query `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages`
2. Navigate to `http://localhost:8765/MapEditorPro.html?_=<timestamp>`.
3. Confirm plain painting is unaffected: `Tools._paint` is a private function inside the `Tools` IIFE, not directly callable from the console, so drive it the same way a real user would — call `Tools.setActive('paint')`, select a non-water terrain (e.g. `Plain_1`) via `UI.selectTerrain('Plain_1')`, then use `mcp__claude-in-chrome__computer` to click a known point on the map canvas. Confirm `mapData` at the corresponding cell (compute col/row from the click's screen position and the canvas's current pan/zoom, or just read `Canvas`'s hover-tracked `_cursorCol`/`_cursorRow` right before clicking) is exactly `'Plain_1'`, unaltered by any resolver logic.
4. Confirm water/river auto-resolve: select a specific river tile with a known shape (e.g. `River_L_1`, a straight-through tile) in the palette, paint a short 3-4 cell line of river tiles in a row using the brush, then inspect `mapData` for that line and confirm: the two end cells resolved to a dead-end (`Lake_*`) tile, and the middle cells resolved to a straight-through or bend tile — not all uniformly `River_L_1` (proving the auto-resolve actually ran, not just left whatever was manually selected).
5. Confirm the neighbor-repaint behavior specifically: paint a single isolated river cell (should resolve to a `Lake_*` dead-end, 0 water neighbors → mask 0), then paint an adjacent cell next to it — confirm the ORIGINAL cell's id changes from a dead-end to a through-tile once it has a real neighbor, proving `_autoResolveEdgesAround` correctly re-resolves neighbors, not just the newly-painted cell.
6. Confirm Fill triggers the same behavior: use `UI.selectTerrain(...)` with a river tile, flood-fill a small enclosed area, confirm the filled region's edges (where it meets non-river terrain) resolve to dead-end/edge tiles while interior-facing cells resolve to through/bend tiles.
7. No console errors across all of the above.

Report actual before/after `mapData` values for the specific cells checked, not just "looks right."

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat(tools): auto-resolve edge tiles when painting/filling water or river terrain"
```

---

### Task 5: Full end-to-end verification pass

**Files:** none (verification-only task, no code changes expected unless a genuine cross-task regression surfaces — if one does, fix it, re-run the relevant task's checklist, then commit the fix with a clear message, same pattern as the prior plan's Task 6).

**Interfaces:** none.

- [ ] **Step 1: Verify against the spec's success criteria**

Reload the editor, and for each item below, use the browser tools to check objectively (not by eyeballing):

1. **Generated rivers show geometrically-correct directional tiles** — repeat Task 3's verification across all 5 presets × 3 seeds each (15 generations), confirming each generation's river cells include multiple distinct `River_*`/`Lake_*` ids, not a uniform flat-water look.
2. **River-carving success rates unaffected** — confirm the previously-established 100%/100%/100%/88% success rates (wasteland/jungle/arctic/desert) still hold across a fresh 20-seed sample per preset.
3. **Manual paint/fill auto-resolves correctly** — repeat Task 4's dead-end/through-tile checks with a couple of different shapes (an L-bend, a 3-way junction touching an existing river) and confirm each resolves to a sensible tile (either an exact catalog match, or the documented flat-water fallback for the one uncovered sharp-bend case — confirm which one occurred and that it's not a crash or an obviously wrong id).
4. **Plain water painting is unaffected** — paint a patch of plain open water (`Water_1`, no `edgeFaces`) and confirm no auto-resolution triggers (the painted cells stay exactly `Water_1`, not replaced by a directional tile) and no extra console activity/errors.
5. **`edgeFaces` migration is complete and correct** — `grep -c "waterFaces" MapEditorPro.html` should show only the two references inside Task 1's migration-shim comment/code; the live `hex_database.json` should show `edgeFaces` on all 82 records via the same check as Task 1 Step 8.

- [ ] **Step 2: Confirm nothing downstream broke**

1. Export the map (existing save/export flow) and confirm the JSON's `data` array still contains valid terrain-id strings at the positions checked above (spot-check a couple of the resolved river cells specifically).
2. Confirm the Hex DB editor's "WATER EXITS" rosette (Task 1's verification) still works after all of Tasks 2-4's changes — open a `River_*` record, confirm the rosette still renders and toggles correctly.
3. Confirm `Generator.applyPreset()` still works cleanly for all 5 presets with no console errors, and a normal `Generator.apply()` run completes in well under 1 second.

- [ ] **Step 3: Final commit (only if Step 1/2 turned up fixes)**

If everything passes cleanly, there's nothing to commit — the feature is done as of Task 4's commit. If an issue surfaces, fix it, re-run the relevant task's checklist, then:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "fix(edge-tiling): <describe the specific fix>"
```
