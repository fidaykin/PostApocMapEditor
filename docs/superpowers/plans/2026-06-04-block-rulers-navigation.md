# Block Rulers & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay Excel-style block rulers on the 450×450 hex map canvas (letters A–W across the top, numbers 1–23 down the left) and add a toolbar input for jumping to any 20×20-tile block by address (e.g. `C:5`).

**Architecture:** All changes are in a single file (`MapEditorPro.html`). New functions are added inside the existing `Canvas` IIFE module. Rulers are drawn as a canvas overlay at the end of every `render()` call and on the minimap at the end of `drawMinimap()`. The toolbar gets a small text input wired up in `Canvas.init()`. No new files, no JSON format changes.

**Tech Stack:** Vanilla JS, HTML5 Canvas 2D API, no build tools.

---

## Codebase orientation

**File:** `MapEditorPro.html` — single-file app (~6000+ lines).

Key locations you need:

| What | Line (approx) |
|---|---|
| Canvas IIFE module starts | 1542 |
| Canvas module variables (`let _selectedSlotIdx...`) | 1557 |
| `hexCenterWorld(col, row)` — world coords from tile | 1583 |
| `hexScreenPos(col, row)` — screen coords from tile | 1598 |
| `screenToHex(sx, sy)` — tile from screen coords | 1615 |
| `render()` function | 1639–1702 |
| `drawMinimap()` function | 1817–1856 |
| `_onMouseDown(e)` handler | 1919–1932 |
| `Canvas.init()` function | 1880–1903 |
| `setSelectedSlot` (last function before `return {}`) | 2177 |
| Canvas module `return {}` exports | 2179–2185 |
| `#map-tools` toolbar div (zone buttons) | 911–915 |

**Axis reminder:** In this editor, `row` drives screen-X (row 0 = rightmost) and `col` drives screen-Y (col 0 = bottommost). Block columns (letters) index into `MAP_HEIGHT` (the row dimension); block rows (numbers) index into `MAP_WIDTH` (the col dimension).

**`panToTile` does NOT exist** — `jumpToBlock` must inline the camera pan using the same pattern as `centerOnCity` (line 1789).

---

## Task 1: Block constants + core math + `jumpToBlock`

**Files:**
- Modify: `MapEditorPro.html`

### Step 1a — Add ruler constants inside Canvas IIFE

Find this exact text (line ~1557):

```
  let _selectedSlotIdx = -1;
```

Replace with:

```
  let _selectedSlotIdx = -1;

  const BLOCK_SIZE  = 20;    // tiles per block (width and height)
  const RULER_TOP   = 20;    // px — height of letter strip at top
  const RULER_LEFT  = 28;    // px — width of number strip at left
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 1b — Add `_numCols`, `_numRows`, `_currentBlock`, `jumpToBlock`

Find this exact text (line ~2177):

```
  function setSelectedSlot(idx) { _selectedSlotIdx = idx; render(); }

  return {
```

Replace with:

```
  function setSelectedSlot(idx) { _selectedSlotIdx = idx; render(); }

  // ── Block rulers ─────────────────────────────────────────
  function _numCols() { return Math.ceil(MAP_HEIGHT / BLOCK_SIZE); }
  function _numRows() { return Math.ceil(MAP_WIDTH  / BLOCK_SIZE); }

  function _currentBlock() {
    if (!canvas || !mapData) return { col: 0, row: 0 };
    const { col, row } = screenToHex(canvas.width / 2, canvas.height / 2);
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return { col: 0, row: 0 };
    const colIdx = Math.floor((MAP_HEIGHT - 1 - row) / BLOCK_SIZE);
    const rowIdx = Math.floor((MAP_WIDTH  - 1 - col) / BLOCK_SIZE);
    return {
      col: Math.max(0, Math.min(_numCols() - 1, colIdx)),
      row: Math.max(0, Math.min(_numRows() - 1, rowIdx))
    };
  }

  function jumpToBlock(colIdx, rowIdx) {
    const centerRow = Math.max(0, Math.min(MAP_HEIGHT - 1, MAP_HEIGHT - 10 - colIdx * BLOCK_SIZE));
    const centerCol = Math.max(0, Math.min(MAP_WIDTH  - 1, MAP_WIDTH  - 10 - rowIdx * BLOCK_SIZE));
    const scale = zoom / 100;
    const w = hexCenterWorld(centerCol, centerRow);
    cameraX = w.x * scale - canvas.width  / 2;
    cameraY = w.y * scale - canvas.height / 2;
    clampCamera();
    render();
    drawMinimap();
  }

  return {
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 1c — Export `jumpToBlock`

Find:

```
    toggleZones, hexDist, setSelectedSlot
  };
```

Replace with:

```
    toggleZones, hexDist, setSelectedSlot,
    jumpToBlock
  };
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 1d — Verify in browser

- [ ] Open `MapEditorPro.html` in Chrome/Firefox
- [ ] Load any map (or generate one)
- [ ] Open DevTools console
- [ ] Run: `Canvas.jumpToBlock(0, 0)` — map should pan so the top-left block is centred
- [ ] Run: `Canvas.jumpToBlock(11, 11)` — map should pan to roughly the centre
- [ ] Run: `Canvas.jumpToBlock(22, 22)` — map should pan to bottom-right area
- [ ] Confirm no console errors

### Step 1e — Commit

- [ ] Run:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: add block ruler constants and jumpToBlock"
```

---

## Task 2: `_drawRulers()` overlay + render hook

**Files:**
- Modify: `MapEditorPro.html`

### Step 2a — Add `_drawRulers` function

Find (right before the `return {` line, after the `jumpToBlock` function you added in Task 1):

```
  return {
    init, render, drawMinimap, forceRedraw,
```

Replace with:

```
  function _drawRulers() {
    if (!canvas || !mapData) return;
    const numCols = _numCols();
    const numRows = _numRows();
    const block   = _currentBlock();
    const scale   = zoom / 100;
    const blockPxW = BLOCK_SIZE * COL_PITCH * scale;
    const blockPxH = BLOCK_SIZE * ROW_PITCH * scale;

    ctx.save();

    // Top strip background (letters)
    ctx.fillStyle = 'rgba(18,18,18,0.82)';
    ctx.fillRect(0, 0, canvas.width, RULER_TOP);

    // Left strip background (numbers)
    ctx.fillStyle = 'rgba(18,18,18,0.82)';
    ctx.fillRect(0, RULER_TOP, RULER_LEFT, canvas.height - RULER_TOP);

    // Corner
    ctx.fillStyle = 'rgba(18,18,18,0.95)';
    ctx.fillRect(0, 0, RULER_LEFT, RULER_TOP);

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Top strip: letter labels (A, B, C…)
    ctx.font = 'bold 10px monospace';
    for (let i = 0; i < numCols; i++) {
      const centerRow = MAP_HEIGHT - 10 - i * BLOCK_SIZE;
      if (centerRow < 0) continue;
      const screenX = hexScreenPos(0, centerRow).x;
      if (screenX < RULER_LEFT || screenX > canvas.width) continue;
      if (i === block.col) {
        ctx.fillStyle = 'rgba(79,195,247,0.18)';
        ctx.fillRect(screenX - blockPxW / 2, 0, blockPxW, RULER_TOP);
        ctx.fillStyle = '#4fc3f7';
      } else {
        ctx.fillStyle = '#666';
      }
      ctx.fillText(String.fromCharCode(65 + i), screenX, RULER_TOP / 2);
    }

    // Left strip: number labels (1, 2, 3…)
    ctx.font = '10px monospace';
    for (let j = 0; j < numRows; j++) {
      const centerCol = MAP_WIDTH - 10 - j * BLOCK_SIZE;
      if (centerCol < 0) continue;
      const screenY = hexScreenPos(centerCol, 0).y;
      if (screenY < RULER_TOP || screenY > canvas.height) continue;
      if (j === block.row) {
        ctx.fillStyle = 'rgba(79,195,247,0.18)';
        ctx.fillRect(0, screenY - blockPxH / 2, RULER_LEFT, blockPxH);
        ctx.fillStyle = '#4fc3f7';
      } else {
        ctx.fillStyle = '#666';
      }
      ctx.fillText(String(j + 1), RULER_LEFT / 2, screenY);
    }

    ctx.restore();
  }

  return {
    init, render, drawMinimap, forceRedraw,
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 2b — Call `_drawRulers()` at end of `render()`

Find the closing of the brush cursor preview block inside `render()`. The exact text to find:

```
      ctx.restore();
    }
  }

  function _drawHexTile(cx, cy, radius, terrainId, spriteOverride) {
```

Replace with:

```
      ctx.restore();
    }

    _drawRulers();
  }

  function _drawHexTile(cx, cy, radius, terrainId, spriteOverride) {
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 2c — Verify in browser

- [ ] Open `MapEditorPro.html` in browser with a loaded map
- [ ] You should see a dark strip across the top of the map canvas with letters A B C… appearing at the positions of each block column — letters scroll as you pan
- [ ] You should see a dark strip down the left side with numbers 1 2 3… at each block row position
- [ ] The letter/number for the viewport centre tile should be highlighted in blue
- [ ] Pan the map — letters and numbers scroll with the map correctly
- [ ] Zoom in/out — labels stay at correct positions
- [ ] Confirm no console errors

### Step 2d — Commit

- [ ] Run:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: add block ruler overlay on main canvas"
```

---

## Task 3: Toolbar block input

**Files:**
- Modify: `MapEditorPro.html`

### Step 3a — Add block input HTML to toolbar

Find in `#map-tools` div:

```
      <button class="hexdb-tool-btn" onclick="ZonePainter._clearZonesUI()" title="Clear zone assignments">🗑 Clear Zones</button>
    </div>
```

Replace with:

```
      <button class="hexdb-tool-btn" onclick="ZonePainter._clearZonesUI()" title="Clear zone assignments">🗑 Clear Zones</button>
      <span style="color:#888;font-size:11px;margin-left:8px">Block:</span>
      <input id="block-nav-input" type="text" value="A:1"
        style="width:40px;background:#111;border:1px solid #444;color:#4fc3f7;font-size:11px;padding:2px 4px;border-radius:3px;font-family:monospace;text-align:center"
        title="Type block address (e.g. B:4) and press Enter">
    </div>
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 3b — Wire input events in `Canvas.init()`

Find in `init()`:

```
    window.addEventListener('mouseup', () => mc.removeEventListener('mousemove', _minimapPan));
  }
```

Replace with:

```
    window.addEventListener('mouseup', () => mc.removeEventListener('mousemove', _minimapPan));

    const blockInput = document.getElementById('block-nav-input');
    if (blockInput) {
      blockInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const m = blockInput.value.trim().toUpperCase().match(/^([A-Z]):(\d+)$/);
        if (m) {
          const colIdx = m[1].charCodeAt(0) - 65;
          const rowIdx = parseInt(m[2], 10) - 1;
          if (colIdx >= 0 && colIdx < _numCols() && rowIdx >= 0 && rowIdx < _numRows()) {
            jumpToBlock(colIdx, rowIdx);
          }
        }
        blockInput.blur();
      });
      blockInput.addEventListener('blur', () => {
        const b = _currentBlock();
        blockInput.value = String.fromCharCode(65 + b.col) + ':' + (b.row + 1);
      });
    }
  }
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 3c — Keep input current during render

Find in `render()` (the line that calls `_drawRulers`):

```
    _drawRulers();
  }

  function _drawHexTile(cx, cy, radius, terrainId, spriteOverride) {
```

Replace with:

```
    const _blkInput = document.getElementById('block-nav-input');
    if (_blkInput && document.activeElement !== _blkInput) {
      const b = _currentBlock();
      _blkInput.value = String.fromCharCode(65 + b.col) + ':' + (b.row + 1);
    }
    _drawRulers();
  }

  function _drawHexTile(cx, cy, radius, terrainId, spriteOverride) {
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 3d — Verify in browser

- [ ] Load map in browser
- [ ] The toolbar shows "Block: A:1" (or whatever the current viewport centre block is)
- [ ] Pan the map — the input updates to match the new block
- [ ] Click the input, type `C:5`, press Enter — map jumps to block C:5, input shows `C:5`
- [ ] Click the input, type `a:1` (lowercase) — parses as `A:1`, jumps correctly
- [ ] Click the input, type `ZZ:99`, press Enter — nothing happens, input reverts to current block
- [ ] Click the input, type `A:0`, press Enter — nothing happens (row 0 is out of range), input reverts
- [ ] Confirm no console errors

### Step 3e — Commit

- [ ] Run:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: add block address toolbar input"
```

---

## Task 4: Ruler click detection

**Files:**
- Modify: `MapEditorPro.html`

### Step 4a — Add hit-detection helpers

Find the line that starts `_drawRulers`:

```
  function _drawRulers() {
```

Insert the two helper functions **directly before** it. Find:

```
  function _drawRulers() {
    if (!canvas || !mapData) return;
```

Replace with:

```
  function _rulerColAtScreenX(screenX) {
    const numCols = _numCols();
    const scale   = zoom / 100;
    const halfW   = BLOCK_SIZE * COL_PITCH * scale / 2;
    for (let i = 0; i < numCols; i++) {
      const centerRow = MAP_HEIGHT - 10 - i * BLOCK_SIZE;
      if (centerRow < 0) continue;
      const cx = hexScreenPos(0, centerRow).x;
      if (Math.abs(screenX - cx) <= halfW) return i;
    }
    return -1;
  }

  function _rulerRowAtScreenY(screenY) {
    const numRows = _numRows();
    const scale   = zoom / 100;
    const halfH   = BLOCK_SIZE * ROW_PITCH * scale / 2;
    for (let j = 0; j < numRows; j++) {
      const centerCol = MAP_WIDTH - 10 - j * BLOCK_SIZE;
      if (centerCol < 0) continue;
      const cy = hexScreenPos(centerCol, 0).y;
      if (Math.abs(screenY - cy) <= halfH) return j;
    }
    return -1;
  }

  function _drawRulers() {
    if (!canvas || !mapData) return;
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 4b — Add click detection in `_onMouseDown`

Find in `_onMouseDown`:

```
    if (e.button === 1 || e.button === 2 || isSpacePan) {
      isPanning = true;
      lastPanX = e.clientX; lastPanY = e.clientY;
      panStartX = e.clientX; panStartY = e.clientY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (_onMouseDownCb) _onMouseDownCb(sx, sy, e);
```

Replace with:

```
    if (e.button === 1 || e.button === 2 || isSpacePan) {
      isPanning = true;
      lastPanX = e.clientX; lastPanY = e.clientY;
      panStartX = e.clientX; panStartY = e.clientY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    // Ruler strip clicks
    if (e.button === 0 && mapData) {
      if (sy < RULER_TOP && sx >= RULER_LEFT) {
        const colIdx = _rulerColAtScreenX(sx);
        if (colIdx >= 0) { jumpToBlock(colIdx, _currentBlock().row); return; }
      }
      if (sx < RULER_LEFT && sy >= RULER_TOP) {
        const rowIdx = _rulerRowAtScreenY(sy);
        if (rowIdx >= 0) { jumpToBlock(_currentBlock().col, rowIdx); return; }
      }
    }
    if (_onMouseDownCb) _onMouseDownCb(sx, sy, e);
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 4c — Verify in browser

- [ ] Load map in browser
- [ ] Click a letter label (e.g. `D`) in the top ruler strip — map pans so column D is centred horizontally, vertical position unchanged
- [ ] Click a number label (e.g. `7`) in the left ruler strip — map pans so row 7 is centred vertically, horizontal position unchanged
- [ ] Click in the corner (top-left 28×20 px) — nothing happens
- [ ] Normal painting/tool use still works when clicking on the map itself (not the ruler strips)
- [ ] Confirm no console errors

### Step 4d — Commit

- [ ] Run:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: ruler label click-to-jump navigation"
```

---

## Task 5: Minimap rulers

**Files:**
- Modify: `MapEditorPro.html`

### Step 5a — Extend `drawMinimap()` with rulers

Find the end of `drawMinimap()`:

```
    mCtx.fillStyle = '#ffffff';
    mCtx.beginPath();
    mCtx.arc(cdotX, cdotY, 3, 0, Math.PI * 2);
    mCtx.fill();
  }

  // ── Minimap click/drag → pan ──────────────────────────────
```

Replace with:

```
    mCtx.fillStyle = '#ffffff';
    mCtx.beginPath();
    mCtx.arc(cdotX, cdotY, 3, 0, Math.PI * 2);
    mCtx.fill();

    // Block rulers on minimap
    const ML = 14, MT = 10;   // ruler strip sizes in minimap px
    const mapAreaW = mw - ML;
    const mapAreaH = mh - MT;
    const nCols = Math.ceil(MAP_HEIGHT / BLOCK_SIZE);
    const nRows = Math.ceil(MAP_WIDTH  / BLOCK_SIZE);
    const blk   = _currentBlock();

    // Ruler strip backgrounds
    mCtx.fillStyle = 'rgba(18,18,18,0.72)';
    mCtx.fillRect(ML, 0, mapAreaW, MT);    // top (letters)
    mCtx.fillRect(0, MT, ML, mapAreaH);    // left (numbers)
    mCtx.fillStyle = 'rgba(18,18,18,0.9)';
    mCtx.fillRect(0, 0, ML, MT);           // corner

    // Active block highlight in ruler strips
    const acx = ML + (blk.col / nCols) * mapAreaW;
    const acy = MT + (blk.row / nRows) * mapAreaH;
    const bcw = mapAreaW / nCols;
    const bch = mapAreaH / nRows;
    mCtx.fillStyle = 'rgba(79,195,247,0.25)';
    mCtx.fillRect(acx, 0, bcw, MT);        // active column in top strip
    mCtx.fillRect(0, acy, ML, bch);        // active row in left strip

    // Block grid lines on minimap map area
    mCtx.strokeStyle = 'rgba(255,255,255,0.12)';
    mCtx.lineWidth = 0.5;
    for (let i = 1; i < nCols; i++) {
      const px = ML + (i / nCols) * mapAreaW;
      mCtx.beginPath(); mCtx.moveTo(px, MT); mCtx.lineTo(px, mh); mCtx.stroke();
    }
    for (let j = 1; j < nRows; j++) {
      const py = MT + (j / nRows) * mapAreaH;
      mCtx.beginPath(); mCtx.moveTo(ML, py); mCtx.lineTo(mw, py); mCtx.stroke();
    }

    // Active block cell outline on minimap map area
    mCtx.strokeStyle = 'rgba(79,195,247,0.35)';
    mCtx.lineWidth = 0.75;
    mCtx.strokeRect(acx, acy, bcw, bch);

    // Sparse labels on top strip: every 4th column (A, E, I, M, Q, U)
    mCtx.font = '7px monospace';
    mCtx.textBaseline = 'middle';
    mCtx.textAlign = 'center';
    for (let i = 0; i < nCols; i += 4) {
      const px = ML + (i + 0.5) / nCols * mapAreaW;
      mCtx.fillStyle = (i === blk.col) ? '#4fc3f7' : '#555';
      mCtx.fillText(String.fromCharCode(65 + i), px, MT / 2);
    }

    // Sparse labels on left strip: every 4th row (1, 5, 9, 13, 17, 21)
    mCtx.textAlign = 'right';
    for (let j = 0; j < nRows; j += 4) {
      const py = MT + (j + 0.5) / nRows * mapAreaH;
      mCtx.fillStyle = (j === blk.row) ? '#4fc3f7' : '#555';
      mCtx.fillText(String(j + 1), ML - 1, py);
    }
  }

  // ── Minimap click/drag → pan ──────────────────────────────
```

- [ ] Apply the edit above to `MapEditorPro.html`

### Step 5b — Verify in browser

- [ ] Load map in browser
- [ ] Minimap shows a faint block grid overlay (subtle lines dividing it into 23×23 cells)
- [ ] The current viewport block is highlighted: blue cell in the top ruler strip + blue cell in the left ruler strip
- [ ] Sparse letter labels visible on the top strip of the minimap: A, E, I, M, Q, U at roughly correct positions (7px monospace)
- [ ] Sparse number labels visible on the left strip: 1, 5, 9, 13, 17, 21
- [ ] Pan the main map — active block highlight on minimap updates
- [ ] Existing minimap features still work: clicking minimap pans main view, viewport rect visible, city dot visible
- [ ] Confirm no console errors

### Step 5c — Commit

- [ ] Run:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: add block rulers to minimap"
```

---

## Task 6: Deploy

- [ ] Push feature branch:
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git push origin feature/hex-grid
```

- [ ] Deploy to gh-pages:
```bash
git checkout gh-pages
git checkout feature/hex-grid -- MapEditorPro.html
git add MapEditorPro.html
git commit -m "feat: block rulers and navigation"
git push origin gh-pages
git checkout feature/hex-grid
```
