# MapEditorPro — Core Editor Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `MapEditorPro.html` — a single-file StarEdit-inspired hex map editor with brush engine, undo/redo, minimap, and full IO.

**Architecture:** Single HTML file, no build step, no external dependencies. JS split into named namespace objects (`Terrain`, `Canvas`, `Tools`, `Brush`, `History`, `UI`, `IO`) separated by comment banners. CSS Grid layout (menubar / toolbar / palette+canvas+rightpanel / statusbar).

**Tech Stack:** Vanilla HTML5 / CSS3 / Canvas 2D API. Sprites from existing `sprites/hex/` directory. JSON format unchanged — compatible with Unity `MapImporter.cs`.

**Spec:** `/Users/sergii.tyshchenko/Post Apo Map Editor/docs/superpowers/specs/2026-04-17-map-editor-pro-design.md`

**Reference:** Existing editor at `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorHex.html` (port geometry and sprite loading from here).

---

## File Structure

| File | Role |
|---|---|
| `MapEditorPro.html` | Single output file — all CSS and JS embedded |

No other files created. All JS lives in `<script>` tags as `const` namespace objects.

---

## Hex Geometry Reference

The geometry is **flat-top hex, odd-q offset** (odd columns shift DOWN), identical to the game engine:

```js
const HEX_SIZE  = 40;
const SQRT3     = Math.sqrt(3);
const COL_PITCH = HEX_SIZE * 1.5;       // 60
const ROW_PITCH = HEX_SIZE * SQRT3;     // ~69.28
const STAGGER   = ROW_PITCH / 2;        // odd-col Y offset

// City: CITY_COL = floor(W/2), CITY_ROW = floor((H-1)/2)
```

**6 neighbors — even col:** `(0,-1)` N, `(+1,-1)` NE, `(+1,0)` SE, `(0,+1)` S, `(-1,0)` SW, `(-1,-1)` NW  
**6 neighbors — odd col:** `(0,-1)` N, `(+1,0)` NE, `(+1,+1)` SE, `(0,+1)` S, `(-1,+1)` SW, `(-1,0)` NW

---

## Task 1: HTML Shell + CSS Layout

**Files:**
- Create: `MapEditorPro.html`

- [ ] **Step 1: Create the HTML shell with CSS Grid layout**

Create `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html` with this exact content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>MapEditorPro</title>
<style>
/* ── Reset & theme variables ──────────────────────────────── */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg:       #1e1e1e;
  --panel:    #2a2a2a;
  --border:   #3a3a3a;
  --accent:   #4fc3f7;
  --text:     #ffffff;
  --muted:    #888888;
  --danger:   #ef5350;
  --hover:    #333333;
  --canvas-bg:#0a0a0a;
}

html, body {
  width: 100%; height: 100%; overflow: hidden;
  font-family: 'Segoe UI', Arial, sans-serif;
  background: var(--bg); color: var(--text);
  font-size: 13px;
}

/* ── 4-row CSS Grid shell ─────────────────────────────────── */
#app {
  display: grid;
  grid-template-rows: 28px 40px 1fr 24px;
  grid-template-columns: 1fr;
  height: 100vh;
  width: 100vw;
}

/* ── Menu bar ─────────────────────────────────────────────── */
#menubar {
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: stretch;
  z-index: 100;
  user-select: none;
}

.menu-item {
  position: relative;
  padding: 0 12px;
  display: flex; align-items: center;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
}
.menu-item:hover, .menu-item.open { background: var(--hover); }

.menu-dropdown {
  display: none;
  position: absolute;
  top: 100%; left: 0;
  min-width: 200px;
  background: var(--panel);
  border: 1px solid var(--border);
  box-shadow: 0 4px 16px rgba(0,0,0,0.6);
  z-index: 200;
}
.menu-item.open .menu-dropdown { display: block; }

.menu-dropdown button {
  display: block; width: 100%;
  padding: 7px 16px;
  background: none; border: none;
  color: var(--text); font-size: 12px;
  text-align: left; cursor: pointer;
  white-space: nowrap;
}
.menu-dropdown button:hover { background: var(--hover); }
.menu-dropdown button:disabled { color: var(--muted); cursor: default; }
.menu-dropdown .separator { border-top: 1px solid var(--border); margin: 4px 0; }
.menu-shortcut { float: right; margin-left: 24px; color: var(--muted); font-size: 11px; }

/* ── Toolbar ──────────────────────────────────────────────── */
#toolbar {
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center;
  gap: 4px; padding: 0 8px;
}

.tool-btn {
  width: 32px; height: 32px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 4px; cursor: pointer;
  font-size: 16px; display: flex; align-items: center; justify-content: center;
  position: relative; color: var(--text);
  transition: background 0.1s, border-color 0.1s;
}
.tool-btn:hover { background: var(--hover); }
.tool-btn.active { border-color: var(--accent); background: rgba(79,195,247,0.12); }

.tool-btn .tooltip {
  display: none;
  position: absolute;
  top: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  background: #111; border: 1px solid var(--border);
  padding: 4px 8px; border-radius: 4px; white-space: nowrap;
  font-size: 11px; color: var(--text); pointer-events: none; z-index: 300;
}
.tool-btn:hover .tooltip { display: block; }

/* ── Main area (palette | canvas | rightpanel) ────────────── */
#main {
  display: grid;
  grid-template-columns: 220px 1fr 220px;
  overflow: hidden;
}

/* ── Left palette ─────────────────────────────────────────── */
#palette-panel {
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  overflow: hidden;
}

#palette-scroll {
  flex: 1; overflow-y: auto; padding: 8px;
}

.cat-header {
  background: var(--bg); border: none;
  width: 100%; text-align: left;
  padding: 6px 8px; margin-bottom: 4px;
  color: #FFA500; font-size: 11px; font-weight: bold;
  cursor: pointer; border-radius: 3px;
  display: flex; align-items: center; gap: 6px;
  letter-spacing: 0.5px;
}
.cat-header::before { content: '▼'; font-size: 9px; transition: transform 0.15s; }
.cat-header.collapsed::before { transform: rotate(-90deg); }
.cat-items { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.cat-items.collapsed { display: none; }

.tile-btn {
  width: 52px; height: 52px;
  background: var(--bg); border: 2px solid var(--border);
  border-radius: 4px; cursor: pointer; padding: 2px;
  position: relative;
  transition: border-color 0.1s, background 0.1s;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.tile-btn:hover { background: var(--hover); }
.tile-btn.selected { border-color: var(--accent); }
.tile-btn img {
  width: 38px; height: 38px; display: block; image-rendering: pixelated;
  clip-path: polygon(100% 50%, 75% 6.7%, 25% 6.7%, 0% 50%, 25% 93.3%, 75% 93.3%);
}
.tile-btn .warn {
  position: absolute; top: 1px; right: 2px;
  font-size: 9px; line-height: 1;
}
.tile-btn .tile-tooltip {
  display: none; position: absolute;
  bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  background: #111; border: 1px solid var(--border);
  padding: 3px 7px; border-radius: 3px; white-space: nowrap;
  font-size: 11px; pointer-events: none; z-index: 300; color: var(--text);
}
.tile-btn:hover .tile-tooltip { display: block; }

#palette-selected {
  padding: 10px 8px; border-top: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
  background: var(--bg); flex-shrink: 0;
}
#palette-selected img {
  width: 80px; height: 80px; image-rendering: pixelated; flex-shrink: 0;
  clip-path: polygon(100% 50%, 75% 6.7%, 25% 6.7%, 0% 50%, 25% 93.3%, 75% 93.3%);
}
#palette-selected-info { display: flex; flex-direction: column; gap: 3px; }
#palette-selected-name { font-size: 13px; font-weight: bold; }
#palette-selected-id   { font-size: 11px; color: var(--muted); }

/* ── Canvas ───────────────────────────────────────────────── */
#canvas-container {
  position: relative; overflow: hidden;
  background: var(--canvas-bg); cursor: crosshair;
}
#map-canvas { display: block; }

/* ── Right panel ──────────────────────────────────────────── */
#right-panel {
  background: var(--panel);
  border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  overflow: hidden;
}

#minimap-container {
  width: 220px; height: 220px; flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  position: relative; cursor: crosshair;
}
#minimap { display: block; width: 220px; height: 220px; }

#brush-panel { padding: 10px; border-bottom: 1px solid var(--border); }
#brush-panel .section-title {
  font-size: 11px; color: var(--muted); letter-spacing: 1px;
  text-transform: uppercase; margin-bottom: 8px;
}
#brush-sizes { display: flex; gap: 6px; }

.brush-btn {
  flex: 1; height: 32px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 4px; cursor: pointer; font-size: 11px;
  color: var(--text); transition: border-color 0.1s, background 0.1s;
}
.brush-btn:hover { background: var(--hover); }
.brush-btn.active { border-color: var(--accent); background: rgba(79,195,247,0.12); }

#right-active-terrain {
  padding: 10px; border-bottom: 1px solid var(--border);
}
#right-active-terrain .section-title {
  font-size: 11px; color: var(--muted); letter-spacing: 1px;
  text-transform: uppercase; margin-bottom: 8px;
}
.right-terrain-display { display: flex; align-items: center; gap: 10px; }
#right-terrain-img {
  width: 64px; height: 64px; image-rendering: pixelated; flex-shrink: 0;
  clip-path: polygon(100% 50%, 75% 6.7%, 25% 6.7%, 0% 50%, 25% 93.3%, 75% 93.3%);
}
#right-terrain-name { font-size: 12px; font-weight: bold; }
#right-terrain-id   { font-size: 11px; color: var(--muted); }

#settlement-count {
  padding: 10px; font-size: 12px; color: var(--muted);
  margin-top: auto; border-top: 1px solid var(--border);
}

/* ── Status bar ───────────────────────────────────────────── */
#statusbar {
  background: var(--panel);
  border-top: 1px solid var(--border);
  display: flex; align-items: center;
  padding: 0 12px; gap: 20px;
  font-size: 12px; color: var(--muted);
  user-select: none;
}
.status-item span:first-child { color: var(--muted); }
.status-item span:last-child  { color: var(--text); }

/* ── Toast ─────────────────────────────────────────────────── */
#toast-container {
  position: fixed; bottom: 32px; left: 50%;
  transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center;
  gap: 6px; z-index: 1000; pointer-events: none;
}
.toast {
  background: #333; border: 1px solid var(--border);
  padding: 8px 18px; border-radius: 6px; font-size: 13px;
  opacity: 1; transition: opacity 0.4s ease;
}
.toast.fade-out { opacity: 0; }

/* ── Modals (confirm / new-map) ─────────────────────────────── */
.modal-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,0.72); z-index: 500;
  align-items: center; justify-content: center;
}
.modal-overlay.open { display: flex; }
.modal-box {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 24px; min-width: 280px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.8);
}
.modal-box h3 { margin-bottom: 12px; font-size: 15px; }
.modal-box p  { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
.btn { padding: 7px 18px; border-radius: 4px; border: none; cursor: pointer; font-size: 13px; }
.btn-primary { background: var(--accent); color: #000; }
.btn-danger  { background: var(--danger); color: #fff; }
.btn-cancel  { background: var(--hover); color: var(--text); border: 1px solid var(--border); }
</style>
</head>
<body>

<div id="app">

  <!-- ── Menu bar ─────────────────────────────────────────── -->
  <div id="menubar">
    <div class="menu-item" id="menu-file">File
      <div class="menu-dropdown">
        <button onclick="IO.newMap()">New Map <span class="menu-shortcut">Ctrl+N</span></button>
        <button onclick="IO.openMap()">Open… <span class="menu-shortcut">Ctrl+O</span></button>
        <button onclick="IO.saveMap()">Save <span class="menu-shortcut">Ctrl+S</span></button>
        <div class="separator"></div>
        <button onclick="IO.exportCSV()">Export CSV</button>
      </div>
    </div>
    <div class="menu-item" id="menu-edit">Edit
      <div class="menu-dropdown">
        <button id="menu-undo" onclick="History.undo()">Undo <span class="menu-shortcut">Ctrl+Z</span></button>
        <button id="menu-redo" onclick="History.redo()">Redo <span class="menu-shortcut">Ctrl+Y</span></button>
        <div class="separator"></div>
        <button onclick="IO.clearMap()">Clear Map</button>
        <button onclick="IO.fillMap()">Fill Map</button>
      </div>
    </div>
    <div class="menu-item" id="menu-layer">Layer
      <div class="menu-dropdown">
        <button onclick="UI.toggleSettlements()">Toggle Settlement Visibility</button>
      </div>
    </div>
    <div class="menu-item" id="menu-view">View
      <div class="menu-dropdown">
        <button onclick="Canvas.zoomIn()">Zoom In</button>
        <button onclick="Canvas.zoomOut()">Zoom Out</button>
        <button onclick="Canvas.fitToScreen()">Fit Map</button>
      </div>
    </div>
    <div class="menu-item" id="menu-generate">Generate
      <div class="menu-dropdown">
        <button onclick="alert('Generator: Plan B')">Procedural Generator…</button>
        <button onclick="alert('Satellite: Plan B')">Satellite Import…</button>
      </div>
    </div>
  </div>

  <!-- ── Toolbar ──────────────────────────────────────────── -->
  <div id="toolbar">
    <button class="tool-btn active" data-tool="paint" onclick="Tools.setActive('paint')">✏️<span class="tooltip">Paint (P)</span></button>
    <button class="tool-btn" data-tool="fill"  onclick="Tools.setActive('fill')">🪣<span class="tooltip">Fill (F)</span></button>
    <button class="tool-btn" data-tool="rect"  onclick="Tools.setActive('rect')">▭<span class="tooltip">Rectangle (R)</span></button>
    <button class="tool-btn" data-tool="eye"   onclick="Tools.setActive('eye')">💧<span class="tooltip">Eyedropper (E)</span></button>
    <button class="tool-btn" data-tool="settlement" onclick="Tools.setActive('settlement')">📍<span class="tooltip">Place Settlement (S)</span></button>
    <button class="tool-btn" data-tool="erase" onclick="Tools.setActive('erase')">✕<span class="tooltip">Erase Settlement (D)</span></button>
  </div>

  <!-- ── Main ─────────────────────────────────────────────── -->
  <div id="main">

    <!-- Left palette -->
    <div id="palette-panel">
      <div id="palette-scroll"></div>
      <div id="palette-selected">
        <img id="palette-sel-img" src="" alt="">
        <div id="palette-selected-info">
          <div id="palette-selected-name">Plain_1</div>
          <div id="palette-selected-id">ID: 12</div>
        </div>
      </div>
    </div>

    <!-- Canvas -->
    <div id="canvas-container">
      <canvas id="map-canvas"></canvas>
    </div>

    <!-- Right panel -->
    <div id="right-panel">
      <div id="minimap-container">
        <canvas id="minimap" width="220" height="220"></canvas>
      </div>
      <div id="brush-panel">
        <div class="section-title">Brush Size</div>
        <div id="brush-sizes">
          <button class="brush-btn active" data-brush="0" onclick="Brush.setSize(0)" title="1 tile">•</button>
          <button class="brush-btn" data-brush="1" onclick="Brush.setSize(1)" title="~7 tiles">3×3</button>
          <button class="brush-btn" data-brush="2" onclick="Brush.setSize(2)" title="~19 tiles">5×5</button>
          <button class="brush-btn" data-brush="3" onclick="Brush.setSize(3)" title="~37 tiles">○7</button>
        </div>
      </div>
      <div id="right-active-terrain">
        <div class="section-title">Active Terrain</div>
        <div class="right-terrain-display">
          <img id="right-terrain-img" src="" alt="">
          <div>
            <div id="right-terrain-name">Plain_1</div>
            <div id="right-terrain-id">ID: 12</div>
          </div>
        </div>
      </div>
      <div id="settlement-count">Settlements: 0</div>
    </div>

  </div>

  <!-- Status bar -->
  <div id="statusbar">
    <div class="status-item"><span>Tool: </span><span id="st-tool">Paint</span></div>
    <div class="status-item"><span>Terrain: </span><span id="st-terrain">Plain_1</span></div>
    <div class="status-item"><span>Tile: </span><span id="st-tile">—</span></div>
    <div class="status-item"><span>Zoom: </span><span id="st-zoom">100%</span></div>
    <div class="status-item"><span>Map: </span><span id="st-size">450 × 450</span></div>
  </div>

</div>

<!-- Toast container -->
<div id="toast-container"></div>

<!-- Confirm modal (New Map / Clear) -->
<div class="modal-overlay" id="confirm-modal">
  <div class="modal-box">
    <h3 id="confirm-title">Confirm</h3>
    <p id="confirm-msg"></p>
    <div class="modal-actions">
      <button class="btn btn-cancel" onclick="UI.closeConfirm()">Cancel</button>
      <button class="btn btn-danger"  id="confirm-ok">OK</button>
    </div>
  </div>
</div>

<input type="file" id="file-input" accept=".json" style="display:none">

<script>
// ════════════════════════════════════════════════════════════
// MODULE STUBS — filled in by subsequent tasks
// ════════════════════════════════════════════════════════════

const Terrain  = {};
const Canvas   = {};
const Tools    = {};
const Brush    = {};
const History  = {};
const UI       = {};
const IO       = {};

// ── Shared state (visible to all modules) ──────────────────
let MAP_WIDTH  = 450;
let MAP_HEIGHT = 450;
let mapData    = null;  // Int8Array (filled by IO.newMap / load)
let settlements = [];
let settlementsVisible = true;

const HEX_SIZE  = 40;
const SQRT3     = Math.sqrt(3);
const COL_PITCH = HEX_SIZE * 1.5;
const ROW_PITCH = HEX_SIZE * SQRT3;
const STAGGER   = ROW_PITCH / 2;

function getCityCol() { return Math.floor(MAP_WIDTH  / 2); }
function getCityRow() { return Math.floor((MAP_HEIGHT - 1) / 2); }

window.addEventListener('load', async () => {
  await Terrain.load();
  IO.newMap(true);  // silent new map — no toast, no confirm
  Canvas.init();
  UI.init();
  UI.buildPalette();
  UI.selectTerrain(12);
  Canvas.centerOnCity();
  console.log('[MapEditorPro] Ready.');
});
</script>

</body>
</html>
```

- [ ] **Step 2: Open in browser and verify layout**

Open `MapEditorPro.html` by double-clicking in Finder (or drag to browser). Verify:
- 5-region layout visible: menu bar (top), toolbar, 3-column middle, status bar (bottom)
- Left panel 220px, right panel 220px, canvas fills rest
- No JS errors in browser console
- `[MapEditorPro] Ready.` logged (with errors from missing module stubs — expected)

- [ ] **Step 3: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: MapEditorPro HTML shell with CSS Grid layout and module stubs"
```

---

## Task 2: Terrain Module

**Files:**
- Modify: `MapEditorPro.html` — replace `const Terrain = {};` stub with full implementation

- [ ] **Step 1: Replace the Terrain stub with the full module**

In `MapEditorPro.html`, replace `const Terrain  = {};` with:

```js
// ════════════════════════════════════════════════════════════
// TERRAIN MODULE
// ════════════════════════════════════════════════════════════
const Terrain = (() => {
  const HEX_DIR = 'sprites/hex/';

  const DATA = [
    // Water / River (0–8)
    { id:  0, name: "DirtyWater",  cat: "💧 WATER / RIVER",     file: "Water.png"    },
    { id:  1, name: "DirtyWater_1",cat: "",                      file: "Water.png"    },
    { id:  2, name: "DirtyWater_2",cat: "",                      file: "Water.png"    },
    { id:  3, name: "River_1",     cat: "",                      file: "Water.png"    },
    { id:  4, name: "River_2",     cat: "",                      file: "Water.png"    },
    { id:  5, name: "River_3",     cat: "",                      file: "Water.png"    },
    { id:  6, name: "River_4",     cat: "",                      file: "Water.png"    },
    { id:  7, name: "River_5",     cat: "",                      file: "Water.png"    },
    { id:  8, name: "River_6",     cat: "",                      file: "Water.png"    },
    // Rubble / Wasteland (9–11)
    { id:  9, name: "Rubble_1",    cat: "🏚️ RUBBLE/WASTELAND",   file: "Rubble_1.png" },
    { id: 10, name: "Rubble_2",    cat: "",                      file: "Rubble_2.png" },
    { id: 11, name: "Rubble_3",    cat: "",                      file: "Rubble_3.png" },
    // Plains (12–14)
    { id: 12, name: "Plain_1",     cat: "🌾 PLAINS",             file: "Plain_1.png"  },
    { id: 13, name: "Plain_2",     cat: "",                      file: "Plain_2.png"  },
    { id: 14, name: "BrokenPlain", cat: "",                      file: "Rubble_1.png", fallback: true },
    // Forest (15–17)
    { id: 15, name: "Forest_1",    cat: "🌲 FOREST",             file: "Forest_1.png" },
    { id: 16, name: "Forest_2",    cat: "",                      file: "Forest_2.png" },
    { id: 17, name: "Forest_3",    cat: "",                      file: "Forest_3.png" },
    // Rocky / Mountain (18–19)
    { id: 18, name: "Hills",       cat: "⛰️ ROCKY/MOUNTAIN",     file: "Hills.png"    },
    { id: 19, name: "Mountain",    cat: "",                      file: "Mountain.png" },
    // Resources (20–21)
    { id: 20, name: "GoldVein",    cat: "💎 RESOURCES",          file: "GoldVein.png" },
    { id: 21, name: "Oil",         cat: "",                      file: "Rubble_2.png", fallback: true },
    // Barren / Desert (22–23)
    { id: 22, name: "Barren",      cat: "🏜️ BARREN/DESERT",      file: "Rubble_1.png", fallback: true },
    { id: 23, name: "Desert",      cat: "",                      file: "Plain_1.png",  fallback: true },
    // Swamp (24–25)
    { id: 24, name: "Swamp",       cat: "🟫 SWAMP",              file: "Water.png",    fallback: true },
    { id: 25, name: "RockySwamp",  cat: "",                      file: "Hills.png",    fallback: true },
    // Volcanic / Rift (26–28)
    { id: 26, name: "LavaPlain",   cat: "🌋 VOLCANIC/RIFT",      file: "Rift.png",     fallback: true },
    { id: 27, name: "LavaRift",    cat: "",                      file: "Rift.png",     fallback: true },
    { id: 28, name: "Rift",        cat: "",                      file: "Rift.png"     },
  ];

  // RGB triples for minimap color rendering
  const COLORS = {
     0:[42,70,100],  1:[50,80,120],  2:[35,60,95],
     3:[60,100,160], 4:[60,100,160], 5:[60,100,160],
     6:[60,100,160], 7:[60,100,160], 8:[60,100,160],
     9:[100,85,65], 10:[85,70,50],  11:[65,50,35],
    12:[120,155,85],13:[100,135,65],14:[130,130,75],
    15:[50,115,50], 16:[35,95,35],  17:[65,130,65],
    18:[100,120,90],19:[150,150,150],
    20:[200,170,25],21:[50,50,50],
    22:[150,130,95],23:[210,185,120],
    24:[50,80,50],  25:[80,95,75],
    26:[170,70,20], 27:[130,35,15], 28:[35,25,25]
  };

  const sprites  = {};  // id → HTMLImageElement
  let   citySprite = null;

  async function load() {
    const jobs = DATA.map(t => new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { sprites[t.id] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = HEX_DIR + t.file;
    }));
    const cityJob = new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { citySprite = img; resolve(); };
      img.onerror = () => resolve();
      img.src = HEX_DIR + 'Settlements_1.png';
    });
    await Promise.all([...jobs, cityJob]);
  }

  function getSprite(id) { return sprites[id] || null; }
  function getCitySprite() { return citySprite; }
  function color(id) { return COLORS[id] || [120,155,85]; }
  function byId(id)  { return DATA.find(t => t.id === id) || DATA[12]; }
  function getAll()  { return DATA; }

  return { load, getSprite, getCitySprite, color, byId, getAll };
})();
```

- [ ] **Step 2: Verify in browser**

Open/reload `MapEditorPro.html`. In the browser console, run:
```js
Terrain.byId(12)  // should return { id:12, name:"Plain_1", ... }
Terrain.byId(28)  // should return { id:28, name:"Rift", ... }
Terrain.color(0)  // should return [42,70,100]
```
No errors expected.

- [ ] **Step 3: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: Terrain module — 29 terrain entries, sprite loading, color map"
```

---

## Task 3: Canvas Module (hex renderer + zoom/pan)

**Files:**
- Modify: `MapEditorPro.html` — replace `const Canvas = {};` stub

- [ ] **Step 1: Replace the Canvas stub with the full renderer**

Replace `const Canvas   = {};` with:

```js
// ════════════════════════════════════════════════════════════
// CANVAS MODULE — hex renderer, viewport, zoom/pan
// ════════════════════════════════════════════════════════════
const Canvas = (() => {
  let canvas, ctx, container;
  let cameraX = 0, cameraY = 0;
  let zoom = 100;                   // percent; range 25–200
  let isPanning = false;
  let isSpacePan = false;
  let lastPanX = 0, lastPanY = 0;
  let panStartX = 0, panStartY = 0;
  let touchStartDist = 0, touchStartZoom = 100;
  let touches = [];
  let _onMouseDownCb = null;        // set by Tools after init
  let _onMouseMoveCb = null;
  let _onMouseUpCb   = null;

  // ── Geometry ────────────────────────────────────────────
  function hexCenterWorld(col, row) {
    return {
      x: col * COL_PITCH,
      y: row * ROW_PITCH + (col % 2 !== 0 ? STAGGER : 0)
    };
  }

  function hexScreenPos(col, row) {
    const scale = zoom / 100;
    const w = hexCenterWorld(col, row);
    return { x: w.x * scale - cameraX, y: w.y * scale - cameraY };
  }

  function hexClipPath(cx, cy, radius) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const px = cx + radius * Math.cos(a);
      const py = cy + radius * Math.sin(a);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function screenToHex(screenX, screenY) {
    const scale  = zoom / 100;
    const worldX = (screenX + cameraX) / scale;
    const worldY = (screenY + cameraY) / scale;
    const estCol = Math.round(worldX / COL_PITCH);
    let bestCol = estCol, bestRow = 0, minDist = Infinity;
    for (let c = estCol - 1; c <= estCol + 1; c++) {
      if (c < 0 || c >= MAP_WIDTH) continue;
      const stg = (c % 2 !== 0) ? STAGGER : 0;
      const r   = Math.round((worldY - stg) / ROW_PITCH);
      if (r < 0 || r >= MAP_HEIGHT) continue;
      const d = Math.hypot(worldX - c * COL_PITCH, worldY - (r * ROW_PITCH + stg));
      if (d < minDist) { minDist = d; bestCol = c; bestRow = r; }
    }
    return { col: bestCol, row: bestRow };
  }

  // ── Rendering ────────────────────────────────────────────
  function render() {
    if (!canvas || !mapData) return;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale   = zoom / 100;
    const radius  = HEX_SIZE * scale;
    const padding = radius * 2;

    for (let row = 0; row < MAP_HEIGHT; row++) {
      for (let col = 0; col < MAP_WIDTH; col++) {
        const s = hexScreenPos(col, row);
        if (s.x + padding < 0 || s.x - padding > canvas.width  ||
            s.y + padding < 0 || s.y - padding > canvas.height) continue;
        _drawHexTile(s.x, s.y, radius, mapData[row * MAP_WIDTH + col]);
      }
    }

    if (settlementsVisible) {
      settlements.forEach(s => {
        const pos = hexScreenPos(s.col, s.row);
        if (pos.x + radius < 0 || pos.x - radius > canvas.width  ||
            pos.y + radius < 0 || pos.y - radius > canvas.height) return;
        _drawSettlement(pos.x, pos.y, radius, s.type);
      });
    }

    // Rect preview overlay drawn by Tools if needed
    if (Tools._rectPreview) {
      _drawRectPreview(Tools._rectPreview, radius);
    }
  }

  function _drawHexTile(cx, cy, radius, terrainId) {
    const sprite = Terrain.getSprite(terrainId);
    ctx.save();
    hexClipPath(cx, cy, radius);
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      ctx.clip();
      ctx.drawImage(sprite, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
      ctx.fillStyle = '#444'; ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function _drawSettlement(cx, cy, radius, type) {
    ctx.save();
    hexClipPath(cx, cy, radius);
    if (type === 'city') {
      const cityImg = Terrain.getCitySprite();
      if (cityImg && cityImg.complete) {
        ctx.clip();
        ctx.drawImage(cityImg, cx - radius, cy - radius, radius * 2, radius * 2);
      }
      hexClipPath(cx, cy, radius);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, radius * 0.08);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = Math.max(2, radius * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  function _drawRectPreview(preview, radius) {
    const { c1, r1, c2, r2 } = preview;
    const minC = Math.min(c1, c2), maxC = Math.max(c1, c2);
    const minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
    ctx.save();
    ctx.strokeStyle = 'rgba(79,195,247,0.8)';
    ctx.lineWidth = 2;
    for (let col = minC; col <= maxC; col++) {
      for (let row = minR; row <= maxR; row++) {
        const s = hexScreenPos(col, row);
        hexClipPath(s.x, s.y, radius);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── Camera ────────────────────────────────────────────────
  function clampCamera() {
    const scale  = zoom / 100;
    const radius = HEX_SIZE * scale;
    const last   = hexCenterWorld(MAP_WIDTH - 1, MAP_HEIGHT - 1);
    const maxX   = last.x * scale + radius * 2 - canvas.width;
    const maxY   = last.y * scale + radius * 2 - canvas.height;
    cameraX = Math.max(-radius * 2, Math.min(maxX + radius * 2, cameraX));
    cameraY = Math.max(-radius * 2, Math.min(maxY + radius * 2, cameraY));
  }

  function setZoom(pct, pivotScreenX, pivotScreenY) {
    const oldScale = zoom / 100;
    const px = pivotScreenX !== undefined ? pivotScreenX : canvas.width  / 2;
    const py = pivotScreenY !== undefined ? pivotScreenY : canvas.height / 2;
    const worldX = (cameraX + px) / oldScale;
    const worldY = (cameraY + py) / oldScale;
    zoom = Math.max(25, Math.min(200, Math.round(pct)));
    const newScale = zoom / 100;
    cameraX = worldX * newScale - px;
    cameraY = worldY * newScale - py;
    clampCamera();
    document.getElementById('st-zoom').textContent = zoom + '%';
    render();
    Canvas.drawMinimap();
  }

  function zoomIn()  { setZoom(zoom + 10); }
  function zoomOut() { setZoom(zoom - 10); }

  function centerOnCity() {
    const scale = zoom / 100;
    const w = hexCenterWorld(getCityCol(), getCityRow());
    cameraX = w.x * scale - canvas.width  / 2;
    cameraY = w.y * scale - canvas.height / 2;
    clampCamera();
    render();
    drawMinimap();
  }

  function fitToScreen() {
    const mapPixelW = (MAP_WIDTH  - 1) * COL_PITCH + HEX_SIZE * 2;
    const mapPixelH = (MAP_HEIGHT - 1) * ROW_PITCH + STAGGER   + HEX_SIZE * 2;
    const fit = Math.floor(Math.min(
      canvas.width  / mapPixelW * 100,
      canvas.height / mapPixelH * 100
    ));
    zoom = Math.max(25, Math.min(200, fit));
    const scale = zoom / 100;
    cameraX = (mapPixelW * scale - canvas.width)  / 2;
    cameraY = (mapPixelH * scale - canvas.height) / 2;
    clampCamera();
    document.getElementById('st-zoom').textContent = zoom + '%';
    render();
    drawMinimap();
  }

  // ── Minimap ───────────────────────────────────────────────
  function drawMinimap() {
    if (!mapData) return;
    const mc  = document.getElementById('minimap');
    const mCtx = mc.getContext('2d');
    const mw = mc.width, mh = mc.height;
    const imgD = mCtx.createImageData(mw, mh);

    for (let py = 0; py < mh; py++) {
      for (let px = 0; px < mw; px++) {
        const col = Math.floor(px / mw * MAP_WIDTH);
        const row = Math.floor(py / mh * MAP_HEIGHT);
        const id  = mapData[row * MAP_WIDTH + col] ?? 12;
        const [r, g, b] = Terrain.color(id);
        const i = (py * mw + px) * 4;
        imgD.data[i] = r; imgD.data[i+1] = g; imgD.data[i+2] = b; imgD.data[i+3] = 255;
      }
    }
    mCtx.putImageData(imgD, 0, 0);

    // Viewport rect
    const scale = zoom / 100;
    const vx = (cameraX / scale) / (((MAP_WIDTH - 1) * COL_PITCH + HEX_SIZE * 2)) * mw;
    const vy = (cameraY / scale) / (((MAP_HEIGHT- 1) * ROW_PITCH + STAGGER + HEX_SIZE * 2)) * mh;
    const vw = (canvas.width  / scale) / ((MAP_WIDTH - 1) * COL_PITCH + HEX_SIZE * 2) * mw;
    const vh = (canvas.height / scale) / ((MAP_HEIGHT-1) * ROW_PITCH + STAGGER + HEX_SIZE * 2) * mh;
    mCtx.strokeStyle = '#4fc3f7';
    mCtx.lineWidth = 1.5;
    mCtx.strokeRect(vx, vy, vw, vh);

    // City dot
    const cdotX = (getCityCol() / MAP_WIDTH) * mw;
    const cdotY = (getCityRow() / MAP_HEIGHT) * mh;
    mCtx.fillStyle = '#ffffff';
    mCtx.beginPath();
    mCtx.arc(cdotX, cdotY, 3, 0, Math.PI * 2);
    mCtx.fill();
  }

  // ── Minimap click/drag → pan ──────────────────────────────
  function _minimapPan(e) {
    const mc   = document.getElementById('minimap');
    const rect = mc.getBoundingClientRect();
    const mx   = Math.max(0, Math.min(1, (e.clientX - rect.left)  / rect.width));
    const my   = Math.max(0, Math.min(1, (e.clientY - rect.top)   / rect.height));
    const mapPixelW = (MAP_WIDTH  - 1) * COL_PITCH + HEX_SIZE * 2;
    const mapPixelH = (MAP_HEIGHT - 1) * ROW_PITCH + STAGGER   + HEX_SIZE * 2;
    const scale = zoom / 100;
    cameraX = mx * mapPixelW * scale - canvas.width  / 2;
    cameraY = my * mapPixelH * scale - canvas.height / 2;
    clampCamera();
    render();
    drawMinimap();
  }

  // ── Input ────────────────────────────────────────────────
  function _resizeCanvas() {
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;
  }

  function init() {
    canvas    = document.getElementById('map-canvas');
    ctx       = canvas.getContext('2d');
    container = document.getElementById('canvas-container');
    _resizeCanvas();
    window.addEventListener('resize', () => { _resizeCanvas(); render(); drawMinimap(); });

    canvas.addEventListener('mousedown',  _onMouseDown);
    canvas.addEventListener('mousemove',  _onMouseMove);
    canvas.addEventListener('mouseup',    _onMouseUp);
    canvas.addEventListener('mouseleave', _onMouseUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', _onWheel, { passive: false });
    canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  _onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   _onTouchEnd,   { passive: false });

    window.addEventListener('keydown', _onKeyDown);
    window.addEventListener('keyup',   _onKeyUp);

    const mc = document.getElementById('minimap');
    mc.addEventListener('mousedown', e => { e.preventDefault(); _minimapPan(e); mc.addEventListener('mousemove', _minimapPan); });
    window.addEventListener('mouseup', () => mc.removeEventListener('mousemove', _minimapPan));
  }

  function _onKeyDown(e) {
    if (e.code === 'Space' && !e.repeat && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      isSpacePan = true;
      canvas.style.cursor = 'grab';
    }
  }
  function _onKeyUp(e) {
    if (e.code === 'Space') {
      isSpacePan = false;
      canvas.style.cursor = 'crosshair';
    }
  }

  function _onMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (e.button === 1 || e.button === 2 || isSpacePan) {
      isPanning = true;
      lastPanX = e.clientX; lastPanY = e.clientY;
      panStartX = e.clientX; panStartY = e.clientY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (_onMouseDownCb) _onMouseDownCb(sx, sy, e);
  }

  function _onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (isPanning) {
      cameraX -= e.clientX - lastPanX;
      cameraY -= e.clientY - lastPanY;
      lastPanX = e.clientX; lastPanY = e.clientY;
      clampCamera(); render(); drawMinimap();
      return;
    }
    if (_onMouseMoveCb) _onMouseMoveCb(sx, sy, e);

    // Status bar hover info
    const { col, row } = screenToHex(sx, sy);
    if (col >= 0 && col < MAP_WIDTH && row >= 0 && row < MAP_HEIGHT) {
      document.getElementById('st-tile').textContent = `${col}, ${row}`;
      if (mapData) {
        const t = Terrain.byId(mapData[row * MAP_WIDTH + col]);
        document.getElementById('st-terrain').textContent = t ? t.name : '—';
      }
    }
  }

  function _onMouseUp(e) {
    if (isPanning && e.button === 2) {
      const moved = Math.hypot(e.clientX - panStartX, e.clientY - panStartY);
      if (moved < 5) {
        // Right-click without move → eyedropper
        const rect = canvas.getBoundingClientRect();
        const { col, row } = screenToHex(e.clientX - rect.left, e.clientY - rect.top);
        if (col >= 0 && col < MAP_WIDTH && row >= 0 && row < MAP_HEIGHT) {
          UI.selectTerrain(mapData[row * MAP_WIDTH + col]);
        }
      }
    }
    isPanning = false;
    canvas.style.cursor = isSpacePan ? 'grab' : 'crosshair';
    if (_onMouseUpCb) _onMouseUpCb(e);
  }

  function _onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    setZoom(zoom - Math.sign(e.deltaY) * 5, e.clientX - rect.left, e.clientY - rect.top);
  }

  function _onTouchStart(e) {
    e.preventDefault();
    touches = Array.from(e.touches);
    if (touches.length === 2) {
      touchStartDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      touchStartZoom = zoom; isPanning = false;
    } else {
      isPanning = true; lastPanX = touches[0].clientX; lastPanY = touches[0].clientY;
    }
  }

  function _onTouchMove(e) {
    e.preventDefault();
    touches = Array.from(e.touches);
    if (touches.length === 2) {
      const dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      setZoom(touchStartZoom * dist / touchStartDist);
    } else if (touches.length === 1 && isPanning) {
      cameraX -= touches[0].clientX - lastPanX;
      cameraY -= touches[0].clientY - lastPanY;
      lastPanX = touches[0].clientX; lastPanY = touches[0].clientY;
      clampCamera(); render(); drawMinimap();
    }
  }

  function _onTouchEnd(e) {
    e.preventDefault();
    touches = Array.from(e.touches);
    if (touches.length === 0) isPanning = false;
  }

  function setMouseCallbacks(down, move, up) {
    _onMouseDownCb = down; _onMouseMoveCb = move; _onMouseUpCb = up;
  }

  function getCtx()    { return ctx; }
  function getZoom()   { return zoom; }
  function getCamera() { return { x: cameraX, y: cameraY }; }

  return {
    init, render, drawMinimap,
    hexCenterWorld, hexScreenPos, hexClipPath, screenToHex,
    clampCamera, setZoom, zoomIn, zoomOut, centerOnCity, fitToScreen,
    setMouseCallbacks, getCtx, getZoom, getCamera
  };
})();
```

- [ ] **Step 2: Verify in browser**

Open/reload `MapEditorPro.html`. After loading (map filled with Plain_1):
- Canvas shows a green hex grid
- Scroll wheel zooms centered on cursor
- Right-click drag pans (no context menu)
- Space+drag pans
- Minimap shows top-left colored pixel preview with teal viewport rect and white city dot
- `st-tile` in status bar updates on hover

- [ ] **Step 3: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: Canvas module — hex renderer, zoom/pan, minimap, touch support"
```

---

## Task 4: UI Module (palette, terrain selection, settlements visibility)

**Files:**
- Modify: `MapEditorPro.html` — replace `const UI = {};` stub

- [ ] **Step 1: Replace the UI stub with the full module**

Replace `const UI   = {};` with:

```js
// ════════════════════════════════════════════════════════════
// UI MODULE — palette, terrain selection, confirm modal, toasts
// ════════════════════════════════════════════════════════════
const UI = (() => {
  let _selectedId = 12;
  let _confirmCallback = null;

  function init() {
    // Confirm modal OK button
    document.getElementById('confirm-ok').addEventListener('click', () => {
      closeConfirm();
      if (_confirmCallback) _confirmCallback();
    });
    // Escape closes open menus
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAllMenus();
    });
    // Click outside menu closes menus
    document.addEventListener('click', e => {
      if (!e.target.closest('.menu-item')) closeAllMenus();
    });
    // Menu item toggle
    document.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', e => {
        const isOpen = item.classList.contains('open');
        closeAllMenus();
        if (!isOpen) item.classList.add('open');
        e.stopPropagation();
      });
    });

    updateSettlementCount();
  }

  function buildPalette() {
    const scroll = document.getElementById('palette-scroll');
    scroll.innerHTML = '';

    let catHeader = null, catItems = null;
    const PLAINS_CAT = '🌾 PLAINS';

    Terrain.getAll().forEach(t => {
      if (t.cat) {
        catHeader = document.createElement('button');
        catHeader.className = 'cat-header';
        if (t.cat !== PLAINS_CAT) catHeader.classList.add('collapsed');
        catHeader.textContent = t.cat;
        catHeader.addEventListener('click', () => {
          catHeader.classList.toggle('collapsed');
          catItems.classList.toggle('collapsed');
        });
        catItems = document.createElement('div');
        catItems.className = 'cat-items';
        if (t.cat !== PLAINS_CAT) catItems.classList.add('collapsed');
        scroll.appendChild(catHeader);
        scroll.appendChild(catItems);
      }

      const btn = document.createElement('button');
      btn.className = 'tile-btn';
      btn.dataset.tid = t.id;
      btn.addEventListener('click', () => selectTerrain(t.id));

      const img = document.createElement('img');
      const sprite = Terrain.getSprite(t.id);
      if (sprite) img.src = sprite.src;
      img.alt = t.name;
      btn.appendChild(img);

      if (t.fallback) {
        const warn = document.createElement('span');
        warn.className = 'warn'; warn.textContent = '⚠';
        btn.appendChild(warn);
      }

      const tt = document.createElement('span');
      tt.className = 'tile-tooltip';
      tt.textContent = `${t.name} (${t.id})`;
      btn.appendChild(tt);

      (catItems || scroll).appendChild(btn);
    });
  }

  function selectTerrain(id) {
    _selectedId = id;
    const t = Terrain.byId(id);

    // Highlight in palette
    document.querySelectorAll('.tile-btn').forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.tid) === id);
    });

    // Palette bottom display
    const sprite = Terrain.getSprite(id);
    const selImg = document.getElementById('palette-sel-img');
    if (sprite) selImg.src = sprite.src;
    document.getElementById('palette-selected-name').textContent = t.name;
    document.getElementById('palette-selected-id').textContent   = `ID: ${id}`;

    // Right panel active terrain
    const rtImg = document.getElementById('right-terrain-img');
    if (sprite) rtImg.src = sprite.src;
    document.getElementById('right-terrain-name').textContent = t.name;
    document.getElementById('right-terrain-id').textContent   = `ID: ${id}`;

    // Status bar
    document.getElementById('st-terrain').textContent = t.name;
  }

  function getSelectedTerrain() { return _selectedId; }

  function updateSettlementCount() {
    document.getElementById('settlement-count').textContent =
      `Settlements: ${settlements.length}`;
  }

  function updateMenuHistoryState() {
    const u = document.getElementById('menu-undo');
    const r = document.getElementById('menu-redo');
    const us = History.undoSize(), rs = History.redoSize();
    u.textContent = us > 0 ? `Undo (${us})` : 'Undo';
    r.textContent = rs > 0 ? `Redo (${rs})` : 'Redo';
    u.disabled = us === 0;
    r.disabled = rs === 0;
    // Restore shortcuts (textContent wiped them)
    const shortcut = (txt, key) => {
      const btn = txt === 'Undo' || txt.startsWith('Undo') ? u : r;
      btn.innerHTML = txt + ` <span class="menu-shortcut">${key}</span>`;
    };
    shortcut(u.textContent, 'Ctrl+Z');
    shortcut(r.textContent, 'Ctrl+Y');
  }

  function toggleSettlements() {
    settlementsVisible = !settlementsVisible;
    Canvas.render();
  }

  function closeAllMenus() {
    document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
  }

  function showConfirm(title, msg, onOk) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent   = msg;
    _confirmCallback = onOk;
    document.getElementById('confirm-modal').classList.add('open');
  }

  function closeConfirm() {
    document.getElementById('confirm-modal').classList.remove('open');
  }

  function toast(msg) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 400); }, 2000);
  }

  function updateStatusTool(name) {
    document.getElementById('st-tool').textContent = name;
  }

  function updateStatusSize() {
    document.getElementById('st-size').textContent = `${MAP_WIDTH} × ${MAP_HEIGHT}`;
  }

  return {
    init, buildPalette, selectTerrain, getSelectedTerrain,
    updateSettlementCount, updateMenuHistoryState,
    toggleSettlements, closeAllMenus,
    showConfirm, closeConfirm, toast,
    updateStatusTool, updateStatusSize
  };
})();
```

- [ ] **Step 2: Verify in browser**

Open/reload. Verify:
- Left palette shows terrain tiles grouped by category. Plains is open, others collapsed.
- Click a category header → toggles open/closed.
- Click a tile → highlights it with teal border, updates bottom-of-palette display and right-panel active terrain display, updates status bar terrain name.
- Fallback terrains (14, 21, 22, 23, 24, 25, 26, 27) show `⚠` badge.
- Hover tile → tooltip shows `Name (ID)`.

- [ ] **Step 3: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: UI module — collapsible terrain palette, terrain selection, toasts, confirm modal"
```

---

## Task 5: Tools + Brush Modules

**Files:**
- Modify: `MapEditorPro.html` — replace `const Tools = {};` and `const Brush = {};` stubs

- [ ] **Step 1: Add the Brush module (replace `const Brush = {};`)**

Replace `const Brush    = {};` with:

```js
// ════════════════════════════════════════════════════════════
// BRUSH MODULE — size/shape, hex neighbor expansion
// ════════════════════════════════════════════════════════════
const Brush = (() => {
  let _size = 0;   // 0=single, 1=r1, 2=r2, 3=r3

  // 6 neighbors for flat-top odd-q offset
  function _neighbors(col, row) {
    const even = col % 2 === 0;
    return [
      [col,   row - 1],                         // N
      [col+1, even ? row-1 : row],               // NE
      [col+1, even ? row   : row+1],             // SE
      [col,   row + 1],                          // S
      [col-1, even ? row   : row+1],             // SW
      [col-1, even ? row-1 : row],               // NW
    ].filter(([c, r]) => c >= 0 && c < MAP_WIDTH && r >= 0 && r < MAP_HEIGHT);
  }

  function getAffectedTiles(col, row) {
    if (_size === 0) return [{ col, row }];

    const inBounds = (c, r) => c >= 0 && c < MAP_WIDTH && r >= 0 && r < MAP_HEIGHT;
    if (!inBounds(col, row)) return [];

    const visited = new Set();
    const key = (c, r) => c * 10000 + r;
    const result = [];
    let frontier = [{ col, row }];
    visited.add(key(col, row));
    result.push({ col, row });

    for (let ring = 0; ring < _size; ring++) {
      const next = [];
      frontier.forEach(({ col: fc, row: fr }) => {
        _neighbors(fc, fr).forEach(([nc, nr]) => {
          const k = key(nc, nr);
          if (!visited.has(k)) {
            visited.add(k);
            result.push({ col: nc, row: nr });
            next.push({ col: nc, row: nr });
          }
        });
      });
      frontier = next;
    }
    return result;
  }

  function setSize(s) {
    _size = s;
    document.querySelectorAll('.brush-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.brush) === s);
    });
  }

  function getSize() { return _size; }

  return { getAffectedTiles, setSize, getSize };
})();
```

- [ ] **Step 2: Add the Tools module (replace `const Tools = {};`)**

Replace `const Tools    = {};` with:

```js
// ════════════════════════════════════════════════════════════
// TOOLS MODULE — paint, fill, rect, eyedropper, settlement, erase
// ════════════════════════════════════════════════════════════
const Tools = (() => {
  let _active   = 'paint';
  let _isDown   = false;
  let _rectStart = null;    // { col, row } when rect tool held
  let _lastPainted = null;  // avoid re-painting same tile on mousemove

  // Public: rect preview for Canvas renderer
  // eslint-disable-next-line no-var
  var _rectPreview = null;

  const TOOL_NAMES = {
    paint: 'Paint', fill: 'Fill', rect: 'Rectangle',
    eye: 'Eyedropper', settlement: 'Place Settlement', erase: 'Erase Settlement'
  };

  function setActive(name) {
    _active = name;
    _rectStart = null;
    _rectPreview = null;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === name);
    });
    UI.updateStatusTool(TOOL_NAMES[name] || name);
  }

  function getActive() { return _active; }

  // ── Paint ──────────────────────────────────────────────
  function _paint(col, row) {
    const tiles = Brush.getAffectedTiles(col, row);
    tiles.forEach(({ col: c, row: r }) => {
      if (c >= 0 && c < MAP_WIDTH && r >= 0 && r < MAP_HEIGHT) {
        mapData[r * MAP_WIDTH + c] = UI.getSelectedTerrain();
      }
    });
    Canvas.render();
  }

  // ── Fill (flood fill) ──────────────────────────────────
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
      mapData[r * MAP_WIDTH + c] = fillId;
      // 4-directional (same hex-col neighbors + N/S) — use 6-hex neighbors
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
    Canvas.render();
  }

  // ── Rectangle ─────────────────────────────────────────
  function _applyRect(c1, r1, c2, r2) {
    const minC = Math.min(c1, c2), maxC = Math.max(c1, c2);
    const minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
    const fillId = UI.getSelectedTerrain();
    for (let c = minC; c <= maxC; c++)
      for (let r = minR; r <= maxR; r++)
        mapData[r * MAP_WIDTH + c] = fillId;
    Canvas.render();
  }

  // ── Settlements ────────────────────────────────────────
  function _placeSettlement(col, row) {
    if (settlements.some(s => s.col === col && s.row === row)) return;
    const type = (col === getCityCol() && row === getCityRow()) ? 'city' : 'settlement';
    settlements.push({ col, row, type });
    UI.updateSettlementCount();
    Canvas.render();
  }

  function _eraseSettlement(col, row) {
    const idx = settlements.findIndex(s => s.col === col && s.row === row && s.type !== 'city');
    if (idx >= 0) {
      settlements.splice(idx, 1);
      UI.updateSettlementCount();
      Canvas.render();
    }
  }

  // ── Mouse callbacks (set into Canvas) ─────────────────
  function _onDown(sx, sy, e) {
    const { col, row } = Canvas.screenToHex(sx, sy);
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return;
    _isDown = true;

    switch (_active) {
      case 'paint':
        _paint(col, row);
        _lastPainted = { col, row };
        break;
      case 'fill':
        History.push();
        _fill(col, row);
        History.push();
        Canvas.drawMinimap();
        UI.toast('Fill applied');
        _isDown = false;
        break;
      case 'rect':
        _rectStart = { col, row };
        _rectPreview = { c1: col, r1: row, c2: col, r2: row };
        break;
      case 'eye':
        UI.selectTerrain(mapData[row * MAP_WIDTH + col]);
        _isDown = false;
        break;
      case 'settlement':
        _placeSettlement(col, row);
        break;
      case 'erase':
        _eraseSettlement(col, row);
        break;
    }
  }

  function _onMove(sx, sy, e) {
    if (!_isDown) return;
    const { col, row } = Canvas.screenToHex(sx, sy);
    if (col < 0 || col >= MAP_WIDTH || row < 0 || row >= MAP_HEIGHT) return;

    switch (_active) {
      case 'paint':
        if (_lastPainted && _lastPainted.col === col && _lastPainted.row === row) break;
        _paint(col, row);
        _lastPainted = { col, row };
        break;
      case 'rect':
        if (_rectStart) {
          _rectPreview = { c1: _rectStart.col, r1: _rectStart.row, c2: col, r2: row };
          Canvas.render(); // re-render to show preview
        }
        break;
    }
  }

  function _onUp(e) {
    if (!_isDown) return;
    _isDown = false;

    if (_active === 'paint') {
      History.push();
      Canvas.drawMinimap();
    } else if (_active === 'rect' && _rectStart) {
      const rect = Canvas.getBoundingClientRect ? null : null;
      // Use stored _rectPreview end coords
      if (_rectPreview) {
        History.push();
        _applyRect(_rectPreview.c1, _rectPreview.r1, _rectPreview.c2, _rectPreview.r2);
        History.push();
        Canvas.drawMinimap();
        UI.toast('Rectangle applied');
      }
      _rectStart   = null;
      _rectPreview = null;
      Canvas.render();
    }
    _lastPainted = null;
  }

  function init() {
    Canvas.setMouseCallbacks(_onDown, _onMove, _onUp);
    // Keyboard tool shortcuts
    window.addEventListener('keydown', e => {
      if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.ctrlKey || e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case 'p': setActive('paint');      break;
        case 'f': setActive('fill');       break;
        case 'r': setActive('rect');       break;
        case 'e': setActive('eye');        break;
        case 's': setActive('settlement'); break;
        case 'd': setActive('erase');      break;
      }
    });
  }

  return { init, setActive, getActive, _rectPreview: null };
})();

// Expose _rectPreview as a property that Canvas checks by reference
Object.defineProperty(Tools, '_rectPreview', {
  get: function() { return this._rp; },
  set: function(v) { this._rp = v; },
  configurable: true
});
```

**Note:** The `_rectPreview` sharing requires a small tweak. In `_onMove` and `_onUp` inside Tools, assign `Tools._rp = ...` directly. Replace both occurrences of `_rectPreview = ...` inside the Tools IIFE with `Tools._rp = ...`, and the `Canvas.render()` path that reads `Tools._rectPreview` will work via the getter.

Actually, a simpler approach: just move `_rectPreview` to module scope outside the IIFE, as a bare `let`:

```js
let _toolsRectPreview = null;  // shared between Tools and Canvas._drawRectPreview
```

Then in Tools, assign `_toolsRectPreview = ...` and in Canvas._drawRectPreview read `_toolsRectPreview`. Update the Canvas render check:
```js
if (_toolsRectPreview) {
  _drawRectPreview(_toolsRectPreview, radius);
}
```
And in Tools `_onMove`: `_toolsRectPreview = { c1:..., r1:..., c2:..., r2:... };`
And in Tools `_onUp`: `_toolsRectPreview = null;`

Apply these replacements when implementing.

- [ ] **Step 3: Wire Tools.init() into the load handler**

In the `window.addEventListener('load', ...)` block at the bottom of the script, add `Tools.init();` after `UI.init()`:

```js
window.addEventListener('load', async () => {
  await Terrain.load();
  IO.newMap(true);
  Canvas.init();
  UI.init();
  UI.buildPalette();
  UI.selectTerrain(12);
  Tools.init();           // ← add this line
  Canvas.centerOnCity();
  console.log('[MapEditorPro] Ready.');
});
```

- [ ] **Step 4: Verify in browser**

Open/reload. Verify:
- `P` key activates Paint tool (teal border on toolbar button)
- `F` → Fill, `R` → Rectangle, `E` → Eyedropper, `S` → Settlement, `D` → Erase Settlement
- Paint tool: click/drag paints tiles with selected terrain
- With brush size 3×3 selected: dragging paints ~7-tile radius
- Fill tool: click fills entire contiguous region
- Rectangle tool: click-drag shows teal preview outline; on release paints rectangle
- Eyedropper: click samples terrain, updates palette selection
- Right-click anywhere samples terrain (eyedropper regardless of tool)

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: Tools module (paint/fill/rect/eye/settlement/erase) and Brush module (hex radius expansion)"
```

---

## Task 6: History Module (undo/redo)

**Files:**
- Modify: `MapEditorPro.html` — replace `const History = {};` stub

- [ ] **Step 1: Replace the History stub**

Replace `const History  = {};` with:

```js
// ════════════════════════════════════════════════════════════
// HISTORY MODULE — 50-step Int8Array undo/redo
// ════════════════════════════════════════════════════════════
const History = (() => {
  const MAX = 50;
  const _undo = [];   // stack of Int8Array snapshots (past states)
  const _redo = [];   // stack of Int8Array snapshots (future states)

  function _snapshot() {
    // mapData is an Int8Array; copy it
    return new Int8Array(mapData);
  }

  function push() {
    if (_undo.length >= MAX) _undo.shift();  // evict oldest
    _undo.push(_snapshot());
    _redo.length = 0;   // clear redo on new action
    UI.updateMenuHistoryState();
  }

  function undo() {
    if (_undo.length === 0) return;
    _redo.push(_snapshot());
    mapData.set(_undo.pop());
    Canvas.render();
    Canvas.drawMinimap();
    UI.updateMenuHistoryState();
    UI.toast('Undo');
  }

  function redo() {
    if (_redo.length === 0) return;
    _undo.push(_snapshot());
    mapData.set(_redo.pop());
    Canvas.render();
    Canvas.drawMinimap();
    UI.updateMenuHistoryState();
    UI.toast('Redo');
  }

  function clear() {
    _undo.length = 0;
    _redo.length = 0;
    UI.updateMenuHistoryState();
  }

  function undoSize() { return _undo.length; }
  function redoSize() { return _redo.length; }

  function initKeyboard() {
    window.addEventListener('keydown', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault(); redo();
      }
    });
  }

  return { push, undo, redo, clear, undoSize, redoSize, initKeyboard };
})();
```

- [ ] **Step 2: Update mapData to use Int8Array**

The current `IO.newMap` sets `mapData` as a flat Int8Array. Update the shared state declaration at module scope (at the top of the script, near `let mapData = null;`) — it's already declared. The key is that `IO.newMap` creates it as `new Int8Array(MAP_WIDTH * MAP_HEIGHT).fill(12)`. This will be implemented in Task 9. For now verify History compiles cleanly.

Also wire `History.initKeyboard()` into the load handler:

```js
window.addEventListener('load', async () => {
  await Terrain.load();
  IO.newMap(true);
  Canvas.init();
  UI.init();
  UI.buildPalette();
  UI.selectTerrain(12);
  Tools.init();
  History.initKeyboard();   // ← add this
  Canvas.centerOnCity();
  console.log('[MapEditorPro] Ready.');
});
```

- [ ] **Step 3: Wire History.push() calls into Tools**

In the Tools module, `History.push()` is already called in `_onDown` (before fill) and `_onUp` (after paint stroke and after rect). Verify the two-call pattern for fill and rect:
- Before destructive operation: `History.push()` (saves pre-state)
- After: `History.push()` is NOT called again (the second call in fill/rect is a bug — remove it)

**Correct pattern:** call `History.push()` ONCE, before the operation. The undo stack stores the state before the change. Remove the second `History.push()` in the fill and rect branches.

Find in Tools `_onDown`:
```js
case 'fill':
  History.push();
  _fill(col, row);
  History.push();   // ← remove this line
  Canvas.drawMinimap();
```

Find in Tools `_onUp`:
```js
if (_rectPreview) {
  History.push();
  _applyRect(...);
  History.push();   // ← remove this line
```

- [ ] **Step 4: Verify undo/redo**

Open/reload. Verify:
- Paint a few tiles with one terrain, then different terrain
- `Ctrl+Z` undoes last stroke (tiles revert)
- `Ctrl+Y` or `Ctrl+Shift+Z` redoes it
- Edit menu shows `Undo (N)` / `Redo (N)` with correct counts
- After undo, painting new stroke clears redo stack (Redo grays out)
- Fill tool: undo reverts the fill

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: History module — 50-step Int8Array undo/redo with Ctrl+Z/Y"
```

---

## Task 7: IO Module (new/open/save/export + toasts)

**Files:**
- Modify: `MapEditorPro.html` — replace `const IO = {};` stub

- [ ] **Step 1: Replace the IO stub**

Replace `const IO       = {};` with:

```js
// ════════════════════════════════════════════════════════════
// IO MODULE — new map, open JSON, save JSON, export CSV
// ════════════════════════════════════════════════════════════
const IO = (() => {
  function newMap(silent) {
    const apply = () => {
      MAP_WIDTH  = 450;
      MAP_HEIGHT = 450;
      mapData    = new Int8Array(MAP_WIDTH * MAP_HEIGHT).fill(12); // Plain_1
      settlements = [{ col: getCityCol(), row: getCityRow(), type: 'city' }];
      History.clear();
      History.push();
      UI.updateSettlementCount();
      UI.updateStatusSize();
      if (Canvas.render) { Canvas.render(); Canvas.drawMinimap(); }
      if (!silent) UI.toast('New map created');
    };

    if (silent) { apply(); return; }

    UI.closeAllMenus();
    UI.showConfirm('New Map', 'Create a new blank map? All unsaved changes will be lost.', apply);
  }

  function openMap() {
    UI.closeAllMenus();
    document.getElementById('file-input').click();
  }

  function _loadFromJSON(json) {
    try {
      if (!json.width || !json.height || !Array.isArray(json.data))
        throw new Error('Invalid map file format');

      MAP_WIDTH  = Math.max(10, Math.min(450, json.width));
      MAP_HEIGHT = Math.max(10, Math.min(450, json.height));

      // Convert 2D array to flat Int8Array
      mapData = new Int8Array(MAP_WIDTH * MAP_HEIGHT);
      for (let r = 0; r < MAP_HEIGHT; r++) {
        const srcRow = json.data[r];
        if (!srcRow) continue;
        for (let c = 0; c < MAP_WIDTH; c++) {
          mapData[r * MAP_WIDTH + c] = srcRow[c] ?? 12;
        }
      }

      // Settlements: support both {x,y} and {col,row}
      if (json.settlements && json.settlements.length > 0) {
        settlements = json.settlements.map(s => ({
          col:  s.col !== undefined ? s.col : s.x,
          row:  s.row !== undefined ? s.row : s.y,
          type: s.type || 'settlement'
        }));
        // Ensure city exists at center
        const cc = getCityCol(), cr = getCityRow();
        const cityIdx = settlements.findIndex(s => s.col === cc && s.row === cr);
        if (cityIdx >= 0) settlements[cityIdx].type = 'city';
        else settlements.unshift({ col: cc, row: cr, type: 'city' });
      } else {
        settlements = [{ col: getCityCol(), row: getCityRow(), type: 'city' }];
      }

      History.clear();
      History.push();
      UI.updateSettlementCount();
      UI.updateStatusSize();
      Canvas.render();
      Canvas.drawMinimap();
      Canvas.centerOnCity();
      UI.toast('Map loaded');
    } catch (err) {
      alert('Failed to load map: ' + err.message);
    }
  }

  function saveMap() {
    UI.closeAllMenus();
    if (!mapData) return;
    // Convert flat Int8Array back to 2D array for JSON
    const data2d = [];
    for (let r = 0; r < MAP_HEIGHT; r++) {
      data2d.push(Array.from(mapData.subarray(r * MAP_WIDTH, (r + 1) * MAP_WIDTH)));
    }
    const json = {
      width:  MAP_WIDTH,
      height: MAP_HEIGHT,
      data:   data2d,
      settlements: settlements.map(s => ({ x: s.col, y: s.row, type: s.type }))
    };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'map_export.json';
    a.click();
    UI.toast('Map saved');
  }

  function exportCSV() {
    UI.closeAllMenus();
    if (!mapData) return;
    const rows = [];
    for (let r = 0; r < MAP_HEIGHT; r++) {
      rows.push(Array.from(mapData.subarray(r * MAP_WIDTH, (r+1) * MAP_WIDTH)).join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'map_export.csv';
    a.click();
    UI.toast('CSV exported');
  }

  function clearMap() {
    UI.closeAllMenus();
    UI.showConfirm('Clear Map', 'Clear all terrain? City settlement will be preserved.', () => {
      History.push();
      mapData.fill(12);
      settlements = settlements.filter(s => s.type === 'city');
      if (settlements.length === 0) settlements.push({ col: getCityCol(), row: getCityRow(), type: 'city' });
      UI.updateSettlementCount();
      Canvas.render();
      Canvas.drawMinimap();
      UI.toast('Map cleared');
    });
  }

  function fillMap() {
    UI.closeAllMenus();
    const t = Terrain.byId(UI.getSelectedTerrain());
    UI.showConfirm('Fill Map', `Fill entire map with ${t.name}?`, () => {
      History.push();
      mapData.fill(UI.getSelectedTerrain());
      Canvas.render();
      Canvas.drawMinimap();
      UI.toast(`Map filled with ${t.name}`);
    });
  }

  // Wire file input
  function initFileInput() {
    document.getElementById('file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try { _loadFromJSON(JSON.parse(ev.target.result)); }
        catch(err) { alert('Failed to parse JSON: ' + err.message); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  function initKeyboard() {
    window.addEventListener('keydown', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case 'n': e.preventDefault(); newMap();   break;
        case 'o': e.preventDefault(); openMap();  break;
        case 's': e.preventDefault(); saveMap();  break;
      }
    });
  }

  return { newMap, openMap, saveMap, exportCSV, clearMap, fillMap, initFileInput, initKeyboard };
})();
```

- [ ] **Step 2: Wire IO into load handler**

Update the `window.addEventListener('load', ...)`:

```js
window.addEventListener('load', async () => {
  await Terrain.load();
  IO.newMap(true);
  Canvas.init();
  UI.init();
  UI.buildPalette();
  UI.selectTerrain(12);
  Tools.init();
  History.initKeyboard();
  IO.initFileInput();    // ← add
  IO.initKeyboard();     // ← add
  Canvas.centerOnCity();
  console.log('[MapEditorPro] Ready.');
});
```

- [ ] **Step 3: Verify IO operations**

Open/reload. Verify:
- `Ctrl+N` → confirm dialog → OK creates blank Plain_1 map, toast "New map created"
- `Ctrl+S` → downloads `map_export.json`; open the file and verify JSON structure has `width`, `height`, `data`, `settlements`
- File → Open → select the downloaded JSON → map reloads, toast "Map loaded"
- Load original `MapEditorHex.html` save file → verify it loads correctly (settlements in `{x,y}` format)
- File → Export CSV → downloads `.csv` with comma-separated terrain IDs
- Edit → Clear Map → confirm → terrain fills with Plain_1, city marker preserved
- Edit → Fill Map → confirm → terrain fills with selected terrain

- [ ] **Step 4: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: IO module — new/open/save/export CSV with JSON compatibility, confirm dialogs, toast notifications"
```

---

## Task 8: Keyboard Shortcuts + Menu Wiring + Status Bar Polish

**Files:**
- Modify: `MapEditorPro.html` — wire remaining menu actions and verify all keyboard shortcuts

- [ ] **Step 1: Verify all keyboard shortcuts work**

Open/reload. Test each shortcut — they should all work after previous tasks:
| Key | Expected |
|---|---|
| `P` | Paint tool active (teal border, status bar "Paint") |
| `F` | Fill tool active |
| `R` | Rectangle tool active |
| `E` | Eyedropper tool active |
| `S` | Place Settlement active |
| `D` | Erase Settlement active |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+N` | New Map confirm |
| `Ctrl+O` | Open file picker |
| `Ctrl+S` | Save JSON download |
| `Escape` | Closes open menu |

- [ ] **Step 2: Wire View menu zoom actions**

The View menu buttons call `Canvas.zoomIn()`, `Canvas.zoomOut()`, `Canvas.fitToScreen()` — these are already implemented in Canvas. Verify clicking them works.

- [ ] **Step 3: Verify Edit menu undo/redo count labels**

Paint some tiles, then open Edit menu. Verify it shows `Undo (N)` with count. After undo, verify `Redo (N)` appears. Verify `Undo` is greyed out when nothing to undo.

The `UI.updateMenuHistoryState()` function sets the text directly via `innerHTML` which replaces the shortcut spans. The current implementation in Task 4 has a shortcut bug — the `shortcut()` helper inside `updateMenuHistoryState` modifies `u` and `r` after already reading their `textContent`. 

Replace the `updateMenuHistoryState` function in the UI module with:

```js
function updateMenuHistoryState() {
  const u = document.getElementById('menu-undo');
  const r = document.getElementById('menu-redo');
  const us = History.undoSize(), rs = History.redoSize();
  u.innerHTML = `${us > 0 ? `Undo (${us})` : 'Undo'} <span class="menu-shortcut">Ctrl+Z</span>`;
  r.innerHTML = `${rs > 0 ? `Redo (${rs})` : 'Redo'} <span class="menu-shortcut">Ctrl+Y</span>`;
  u.disabled = us === 0;
  r.disabled = rs === 0;
}
```

- [ ] **Step 4: Verify Layer menu**

Click `Layer → Toggle Settlement Visibility`:
- Settlements and city marker disappear from canvas
- Click again — they reappear
- The underlying `settlements` data is unchanged (save/load still includes them)

- [ ] **Step 5: Commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: wire all menu actions, fix undo/redo label in Edit menu"
```

---

## Task 9: Integration Pass — Full Smoke Test and Fixes

**Files:**
- Modify: `MapEditorPro.html` — fix any integration issues found during smoke test

- [ ] **Step 1: Full smoke test**

Open `MapEditorPro.html` in a clean browser tab (no cached state). Run through this checklist:

**Layout:**
- [ ] 5-region layout correct: menubar, toolbar, palette+canvas+rightpanel, statusbar
- [ ] Left palette scrolls independently; bottom selected-terrain strip always visible
- [ ] Minimap is 220×220, shows colored pixel map, viewport rect, white city dot
- [ ] Status bar shows all 5 items: Tool, Terrain, Tile, Zoom, Map size

**Terrain palette:**
- [ ] All 29 terrains present; IDs 14,21,22,23,24,25,26,27 show ⚠ badge
- [ ] Plains open by default, all others collapsed
- [ ] Click any terrain → left palette, right panel, and status bar all update

**Canvas:**
- [ ] Scroll zoom: 25%–200%, centered on cursor
- [ ] Right-click drag pans; Space+drag pans; minimap click/drag pans
- [ ] centerOnCity on page load (city tile centered)
- [ ] Hover updates tile coords and terrain name in status bar

**Tools:**
- [ ] Paint (P): single tile and multi-tile brush sizes paint correctly
- [ ] Fill (F): floods contiguous region, undo works
- [ ] Rectangle (R): drag shows teal outline, release paints rect, undo works
- [ ] Eyedropper (E): click updates selected terrain
- [ ] Right-click always eyedroppers regardless of tool
- [ ] Settlement (S): places teal outline at clicked tile; won't duplicate
- [ ] Erase Settlement (D): removes settlement; city immune to erase

**Brush sizes (apply only to Paint):**
- [ ] `•` (1): single tile
- [ ] `3×3`: ~7 tile radius
- [ ] `5×5`: ~19 tile radius
- [ ] `○7`: ~37 tile radius
- [ ] Fill and Rectangle ignore brush size

**Undo/redo:**
- [ ] Ctrl+Z undoes last stroke; Edit menu count decrements
- [ ] Ctrl+Y redoes; Ctrl+Shift+Z redoes
- [ ] New paint after undo clears redo stack

**IO:**
- [ ] Ctrl+N → confirm → blank map + toast
- [ ] Ctrl+S → downloads `map_export.json`
- [ ] Reload that JSON via Ctrl+O → map identical
- [ ] Export CSV → valid comma-separated file
- [ ] Clear Map → confirm → fills Plain_1, keeps city
- [ ] Fill Map → confirm → fills selected terrain

**Minimap:**
- [ ] Updates after each completed paint stroke
- [ ] Updates after fill, clear, new map
- [ ] Click on minimap → canvas pans to that region

- [ ] **Step 2: Fix any issues found**

Document each fix with a comment inline: `// FIXME → fix description`

- [ ] **Step 3: Final commit**

```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: MapEditorPro core editor — full integration, smoke tested"
```

---

## Spec Coverage Check

| Spec section | Covered by Task |
|---|---|
| HTML shell, CSS Grid layout, theme | Task 1 |
| Menu bar (5 menus, shortcuts) | Task 1 (HTML), Task 7 (IO), Task 8 (wiring) |
| Toolbar (6 tools, icons, tooltips) | Task 1 (HTML), Task 5 (Tools) |
| Terrain palette — category tree, tiles, fallback badge | Task 4 |
| Terrain palette — selected terrain display | Task 4 |
| Brush palette — 4 sizes | Task 1 (HTML), Task 5 (Brush) |
| Active terrain display (right panel) | Task 4 |
| Settlement counter | Task 4, Task 5 |
| Minimap — colored pixels, viewport rect, city dot | Task 3 |
| Minimap — click/drag pans canvas | Task 3 |
| Brush engine — hex neighbor expansion | Task 5 |
| Undo/redo — 50-step Int8Array | Task 6 |
| Edit menu undo/redo count | Task 8 |
| Canvas — hex renderer, culling | Task 3 |
| Canvas — zoom 25–200%, pan, touch | Task 3 |
| Canvas — settlement/city overlays | Task 3 |
| IO — JSON load/save (compatible format) | Task 7 |
| IO — Export CSV | Task 7 |
| IO — New Map, Clear Map, Fill Map | Task 7 |
| Toast notifications | Task 4 (UI.toast) |
| Status bar — real-time updates | Task 3 (hover), Task 4 (tool/terrain) |
| Keyboard shortcuts (all) | Tasks 5, 6, 7, 8 |
| Right-click eyedropper | Task 3 |
| Settlement visibility toggle | Task 4 |

**Out of scope for Plan A (deferred to Plan B):**
- Procedural Generator modal
- Satellite Import modal
