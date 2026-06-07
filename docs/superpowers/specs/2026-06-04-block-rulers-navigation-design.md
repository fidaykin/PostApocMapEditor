# Block Rulers & Navigation — Design Spec

**Date:** 2026-06-04
**Project:** Post Apo Map Editor (MapEditorPro.html)
**Problem:** A 450×450 hex map has no spatial reference system. Navigating to a specific region requires manual panning with no way to communicate locations.

---

## Solution: Excel-Style Block Rulers with Jump Navigation

Overlay two ruler strips on the map canvas (letters A–W across the top, numbers 1–23 down the left). Each ruler cell represents a 20×20-tile block. A toolbar input shows the current block address and accepts typed addresses for instant navigation. Clicking a ruler label jumps to that column or row. The minimap gets matching rulers with sparse labels.

---

## Block System

- **Block size:** 20×20 tiles fixed.
- **Block count:** `ceil(MAP_HEIGHT / 20)` columns (letters) × `ceil(MAP_WIDTH / 20)` rows (numbers). For the standard 450×450 map: 23 columns (A–W) × 23 rows (1–23). Note: columns use MAP_HEIGHT because the screen-X axis maps to the `row` dimension; rows use MAP_WIDTH because screen-Y maps to `col`.
- **Block address format:** `<letter>:<number>` — e.g. `A:1` = top-left block, `W:23` = bottom-right block.
- **Dynamic sizing:** If MAP dimensions differ from 450×450, block count adjusts automatically. Letters beyond Z are not needed (max 23 for 450 tiles).

### Axis mapping

The editor's coordinate system maps screen-X to the `row` dimension (inverted: row 0 = rightmost) and screen-Y to the `col` dimension (inverted: col 0 = bottommost). Block math compensates:

- **Column index `i` (0-based, left → right):**
  - Tile row of block center: `MAP_HEIGHT - 10 - i * 20`
  - Column label: `String.fromCharCode(65 + i)` → "A", "B", …
- **Row index `j` (0-based, top → bottom):**
  - Tile col of block center: `MAP_WIDTH - 10 - j * 20`
  - Row label: `String(j + 1)` → "1", "2", …

---

## Components

### 1. `_drawRulers(scale, radius)` — Canvas overlay

Called at the end of `render()` after all other overlays.

**Top strip** (letters, horizontal):
- Height: 20 px. Drawn at canvas y = 0, full width.
- Background: `rgba(18, 18, 18, 0.82)` (semi-transparent dark).
- For each column index `i` from 0 to `numCols - 1`:
  - `centerRow = MAP_HEIGHT - 10 - i * 20`. Skip if < 0.
  - `screenX = hexScreenPos(0, centerRow).x`
  - Skip if `screenX < RULER_LEFT` or `screenX > canvas.width`.
  - If active column: fill cell background `rgba(79, 195, 247, 0.18)`, label color `#4fc3f7`.
  - Else: label color `#666`.
  - Draw label `String.fromCharCode(65 + i)` centered at `(screenX, 10)`, font `bold 10px monospace`.

**Left strip** (numbers, vertical):
- Width: 28 px. Drawn at canvas x = 0, full height.
- Background: `rgba(18, 18, 18, 0.82)`.
- For each row index `j` from 0 to `numRows - 1`:
  - `centerCol = MAP_WIDTH - 10 - j * 20`. Skip if < 0.
  - `screenY = hexScreenPos(centerCol, 0).y`
  - Skip if `screenY < RULER_TOP` or `screenY > canvas.height`.
  - If active row: fill cell background + label color `#4fc3f7`.
  - Draw label `String(j + 1)` centered at `(14, screenY)`, font `10px monospace`.

**Corner:**
- Fill `rgba(18, 18, 18, 0.95)` at `(0, 0, RULER_LEFT, RULER_TOP)` = `(0, 0, 28, 20)`.

**Constants:**
```
RULER_TOP  = 20   // px — height of top (letter) strip
RULER_LEFT = 28   // px — width of left (number) strip
```

### 2. Active block tracking

Computed once per `render()` call before `_drawRulers()`:

```js
function _currentBlock() {
  const tile = tileAtScreenPos(canvas.width / 2, canvas.height / 2);
  if (!tile) return { col: 0, row: 0 };
  const colIdx = Math.floor((MAP_HEIGHT - 1 - tile.row) / 20);
  const rowIdx = Math.floor((MAP_WIDTH  - 1 - tile.col) / 20);
  return {
    col: Math.max(0, Math.min(numCols - 1, colIdx)),
    row: Math.max(0, Math.min(numRows - 1, rowIdx))
  };
}
```

Result used by `_drawRulers()` for highlighting, and to update the toolbar input value.

### 3. Toolbar block input

HTML added to the toolbar row:

```html
<span style="color:#888;font-size:11px;margin-left:4px">Block:</span>
<input id="block-nav-input" type="text" value="A:1"
  style="width:40px;background:#111;border:1px solid #444;color:#4fc3f7;
         font-size:11px;padding:2px 4px;border-radius:3px;font-family:monospace;text-align:center"
  title="Type block address (e.g. B:4) and press Enter">
```

Behavior:
- Updated every `render()` with the current block address (e.g. `"C:7"`).
- On `keydown` Enter: parse value, call `Canvas.jumpToBlock(colIdx, rowIdx)`, blur.
- On `blur`: revert to current block address if input is invalid.
- Parse rule: uppercase letter(s) + `:` + integer. Case-insensitive. `A:1` through `W:23` valid.

### 4. `Canvas.jumpToBlock(colIdx, rowIdx)`

Public method added to the `Canvas` module's exports:

```js
function jumpToBlock(colIdx, rowIdx) {
  const centerRow = MAP_HEIGHT - 10 - colIdx * 20;
  const centerCol = MAP_WIDTH  - 10 - rowIdx * 20;
  panToTile(
    Math.max(0, Math.min(MAP_WIDTH  - 1, centerCol)),
    Math.max(0, Math.min(MAP_HEIGHT - 1, centerRow))
  );
}
```

`panToTile` already exists in the Canvas module and centers the camera on a given tile.

### 5. Ruler click detection

In the canvas `mousedown` handler (existing `_onDown` function), before the tool-dispatch switch, add:

```js
if (e.clientY - canvasRect.top < RULER_TOP && e.clientX - canvasRect.left >= RULER_LEFT) {
  // clicked top (letter) strip — jump to that column, keep current row
  const screenX = e.clientX - canvasRect.left;
  const colIdx = _rulerColAtScreenX(screenX);
  if (colIdx >= 0) Canvas.jumpToBlock(colIdx, _currentBlock().row);
  return;
}
if (e.clientX - canvasRect.left < RULER_LEFT && e.clientY - canvasRect.top >= RULER_TOP) {
  // clicked left (number) strip — jump to that row, keep current column
  const screenY = e.clientY - canvasRect.top;
  const rowIdx = _rulerRowAtScreenY(screenY);
  if (rowIdx >= 0) Canvas.jumpToBlock(_currentBlock().col, rowIdx);
  return;
}
```

`_rulerColAtScreenX(screenX)`: finds the column index whose center is closest to `screenX` (within half a block width). Returns -1 if none.
`_rulerRowAtScreenY(screenY)`: same for rows.

### 6. Minimap rulers

Added to `drawMinimap()` after existing viewport rect and city dot draws.

**Grid lines:** For each column boundary `i` from 1 to `numCols - 1`:
```
px = MINIMAP_RULER_LEFT + (i / numCols) * (mw - MINIMAP_RULER_LEFT)
draw vertical line at px, from MINIMAP_RULER_TOP to mh
```
Same for row boundaries horizontally.

**Sparse labels** (every 4th block, 0-indexed: 0, 4, 8, 12, 16, 20):
- Top strip (10 px): letter labels `A`, `E`, `I`, `M`, `Q`, `U` at their proportional x positions. Font: `7px monospace`, color `#555`. Active column: `#4fc3f7`.
- Left strip (14 px): number labels `1`, `5`, `9`, `13`, `17`, `21` at proportional y positions. Font: `7px monospace`, color `#555`. Active row: `#4fc3f7`.

**Active block highlight:** Fill a semi-transparent `rgba(79, 195, 247, 0.15)` rectangle over the active block cell in both ruler strips on the minimap.

**Minimap ruler constants:**
```
MINIMAP_RULER_TOP  = 10   // px
MINIMAP_RULER_LEFT = 14   // px
```

The minimap canvas is 220×220 px but displayed at 220×220 via CSS. Ruler strips reduce the terrain area to `(220 - 14) × (220 - 10)` = `206 × 210` pixels.

> **Note:** The existing minimap terrain rendering (`putImageData`) fills the full 220×220 canvas. The ruler strips are drawn on top as a post-pass, so the `putImageData` call does not need to change.

---

## Data Format

No changes to map JSON. Rulers are a pure display feature.

---

## File Changes

Single file: `MapEditorPro.html`.

| Area | Change |
|---|---|
| CSS | Ruler strip cursor style (pointer on hover), block-nav-input style |
| HTML toolbar | Block input field |
| Canvas module | `_drawRulers()`, `_currentBlock()`, `_rulerColAtScreenX()`, `_rulerRowAtScreenY()`, `jumpToBlock()` added; `render()` calls `_drawRulers()`; `mousedown` handler gets ruler click detection |
| Minimap | `drawMinimap()` extended with grid lines + sparse labels + active block highlight |
| Exports | `jumpToBlock` added to `Canvas` module's public API |

---

## Out of Scope

- Named bookmarks (save specific block addresses for later)
- Printing block grid on the exported JSON / Unity game
- Sub-block precision (tile coordinates shown in status bar already cover this)
- Ruler resize / zoom-dependent label density changes
