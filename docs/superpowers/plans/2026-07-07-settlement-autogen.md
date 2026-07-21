# Settlement Slot AutoGenerator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-placement algorithm to the Map Editor that distributes settlements across the map based on per-slot distance rings, hex priority lists, and configurable near/mid/far distribution percentages.

**Architecture:** All changes in `MapEditorPro.html` (single file, no build step). Extends `settlementSlots[]` schema with 5 new fields, adds two module-level priority-list arrays (`settlementPriority1`, `settlementPriority2`), implements `autoPlaceSettlements()` as a top-level function with access to all existing globals, and adds UI controls for the new fields.

**Tech Stack:** Vanilla JS, HTML, CSS — no build step, no dependencies. Browser-only, no test framework.

## Global Constraints

- Single file: all changes to `MapEditorPro.html` only
- Priority 1 defaults: exactly `['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3']`
- Priority 2 defaults: exactly `['Forest_1', 'Barren_1', 'Hills_1', 'Swamp_1']`
- Distribution defaults: 20% near / 30% mid / 50% far
- Min spacing default: 2 hexes
- Default level: 1
- `autoPlaceSettlements()` must call `History.push()` once before modifying state (single undo snapshot)
- `autoPlaceSettlements()` clears all non-city settlements before placing (not append)
- Both JSON load sites must be updated (~line 5021 and ~line 5170)
- New slot fields must be backward-compatible (load via `?? default` fallback)
- `settlement_priorities` key saved/loaded in map JSON
- History snapshots must include priority arrays

---

### Task 1: Algorithm + Schema + Save/Load

Add the 5 new slot fields, global priority arrays, helper functions, `autoPlaceSettlements()`, and all JSON save/load wiring. No UI changes — testable via browser console.

**Files:**
- Modify: `MapEditorPro.html` at lines ~9143, ~9154, ~4643, ~4950, ~5021, ~5170, ~3316/3325

**Interfaces:**
- Produces: `autoPlaceSettlements()` — global function, no arguments
- Produces: `settlementPriority1` / `settlementPriority2` — global `string[]`
- Produces: `_hexDistFromCity(col, row)` — returns integer hex distance from city
- Produces: `_hexDistBetween(col1, row1, col2, row2)` — returns integer hex distance between two grid cells
- Produces: slot schema extensions: `level` (int), `minSpacing` (int), `nearPct` (int), `midPct` (int), `farPct` (int)

---

#### Step 1a: Add global priority arrays after `settlementSlots` declaration (~line 9143)

- [ ] Find:
  ```js
  let settlementSlots = []; // [{minDist,maxDist,count,type}]
  ```
  Change to:
  ```js
  let settlementSlots = []; // [{minDist,maxDist,count,type,tapMultiplier,level,minSpacing,nearPct,midPct,farPct}]
  let settlementPriority1 = ['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3'];
  let settlementPriority2 = ['Forest_1', 'Barren_1', 'Hills_1', 'Swamp_1'];
  ```

#### Step 1b: Add helper functions and `autoPlaceSettlements` after `getCityRow` (~line 9154)

- [ ] Find:
  ```js
  function getCityCol() { return Math.floor(MAP_WIDTH  / 2); }
  function getCityRow() { return Math.floor((MAP_HEIGHT - 1) / 2); }
  ```
  After it, insert:
  ```js
  // Convert map grid (col,row) to hex distance from city center.
  // Uses the same coordinate transform as the ring-overlay renderer.
  function _hexDistFromCity(col, row) {
    const wx = (MAP_HEIGHT - 1 - row) - Math.floor(MAP_HEIGHT / 2);
    const wy = col - Math.floor(MAP_WIDTH  / 2);
    return hexDist(wx, wy);
  }

  // Hex distance between two arbitrary grid cells (cube-coordinate formula).
  function _hexDistBetween(col1, row1, col2, row2) {
    function toAxial(c, r) {
      const wx = (MAP_HEIGHT - 1 - r) - Math.floor(MAP_HEIGHT / 2);
      const wy = c - Math.floor(MAP_WIDTH  / 2);
      return { q: wx, r: wy - (wx - (wx & 1)) / 2 };
    }
    const a = toAxial(col1, row1), b = toAxial(col2, row2);
    const dq = a.q - b.q, dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }

  function _fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function autoPlaceSettlements() {
    if (!settlementSlots.length) { UI.toast('No settlement slots defined.'); return; }
    History.push();

    // Remove all non-city settlements, keep city marker
    settlements = settlements.filter(s => s.type === 'city');

    let totalPlaced = 0;
    // occupied grows across slots so spacing is enforced globally
    const occupied = settlements.map(s => ({ col: s.col, row: s.row }));

    settlementSlots.forEach(slot => {
      const minD    = slot.minDist    ?? 0;
      const maxD    = slot.maxDist    ?? 20;
      const count   = Math.max(1, slot.count ?? 1);
      const type    = slot.type       || 'settlement';
      const level   = slot.level      ?? 1;
      const minSp   = slot.minSpacing ?? 2;
      const nearPct = (slot.nearPct   ?? 20) / 100;
      const midPct  = (slot.midPct    ?? 30) / 100;
      const farPct  = (slot.farPct    ?? 50) / 100;

      // Divide the distance range into 3 equal bands
      const span = Math.max(1, maxD - minD);
      const t1   = minD + span / 3;
      const t2   = minD + span * 2 / 3;
      const bands = [[], [], []]; // [near, mid, far]

      for (let row = 0; row < MAP_HEIGHT; row++) {
        for (let col = 0; col < MAP_WIDTH; col++) {
          const d = _hexDistFromCity(col, row);
          if (d < minD || d > maxD) continue;
          const hexId = mapData[row * MAP_WIDTH + col];
          const isP1  = settlementPriority1.includes(hexId);
          const isP2  = !isP1 && settlementPriority2.includes(hexId);
          if (!isP1 && !isP2) continue;
          bands[d < t1 ? 0 : d < t2 ? 1 : 2].push({ col, row, pri: isP1 ? 1 : 2 });
        }
      }

      // Within each band: P1 first (shuffled), then P2 (shuffled)
      bands.forEach(b => {
        const p1 = _fisherYates(b.filter(h => h.pri === 1));
        const p2 = _fisherYates(b.filter(h => h.pri === 2));
        b.length = 0; b.push(...p1, ...p2);
      });

      // Allocate target counts per band, guarantee they sum to `count`
      const nCount = Math.round(count * nearPct);
      const fCount = Math.round(count * farPct);
      const mCount = count - nCount - fCount;

      [[0, nCount], [1, mCount], [2, fCount]].forEach(([bi, needed]) => {
        let placed = 0;
        for (const hex of bands[bi]) {
          if (placed >= needed) break;
          if (occupied.some(o => _hexDistBetween(hex.col, hex.row, o.col, o.row) < minSp)) continue;
          settlements.push({ col: hex.col, row: hex.row, type, level });
          occupied.push({ col: hex.col, row: hex.row });
          placed++;
          totalPlaced++;
        }
      });
    });

    UI.updateSettlementCount();
    IO.scheduleAutoSave();
    Canvas.render();
    UI.toast(`Auto-placed ${totalPlaced} settlements`);
  }
  ```

#### Step 1c: Update default new-slot object (~line 4643)

- [ ] Find:
  ```js
  settlementSlots.push({ minDist: 10, maxDist: 20, count: 1, type: 'settlement', tapMultiplier: 1 });
  ```
  Change to:
  ```js
  settlementSlots.push({ minDist: 10, maxDist: 20, count: 1, type: 'settlement', tapMultiplier: 1, level: 1, minSpacing: 2, nearPct: 20, midPct: 30, farPct: 50 });
  ```

#### Step 1d: Update JSON save (~line 4950)

- [ ] Find:
  ```js
  if (settlementSlots.length > 0)
    result.settlement_slots = settlementSlots.map(s => ({
      minDist:       s.minDist,
      maxDist:       s.maxDist,
      count:         s.count,
      type:          s.type,
      tapMultiplier: s.tapMultiplier ?? 1
    }));
  ```
  Change to:
  ```js
  if (settlementSlots.length > 0)
    result.settlement_slots = settlementSlots.map(s => ({
      minDist:       s.minDist,
      maxDist:       s.maxDist,
      count:         s.count,
      type:          s.type,
      tapMultiplier: s.tapMultiplier ?? 1,
      level:         s.level         ?? 1,
      minSpacing:    s.minSpacing    ?? 2,
      nearPct:       s.nearPct       ?? 20,
      midPct:        s.midPct        ?? 30,
      farPct:        s.farPct        ?? 50
    }));
  result.settlement_priorities = {
    p1: [...settlementPriority1],
    p2: [...settlementPriority2]
  };
  ```

#### Step 1e: Update both JSON load sites

- [ ] Find the **first** load site (~line 5021):
  ```js
  settlementSlots = (json.settlement_slots && Array.isArray(json.settlement_slots))
    ? json.settlement_slots.map(s => ({
        minDist:       s.minDist       ?? 10,
        maxDist:       s.maxDist       ?? 20,
        count:         s.count         ?? 1,
        type:          s.type          ?? 'settlement',
        tapMultiplier: s.tapMultiplier ?? 1
      }))
    : [];
  ```
  Change to:
  ```js
  settlementSlots = (json.settlement_slots && Array.isArray(json.settlement_slots))
    ? json.settlement_slots.map(s => ({
        minDist:       s.minDist       ?? 10,
        maxDist:       s.maxDist       ?? 20,
        count:         s.count         ?? 1,
        type:          s.type          ?? 'settlement',
        tapMultiplier: s.tapMultiplier ?? 1,
        level:         s.level         ?? 1,
        minSpacing:    s.minSpacing    ?? 2,
        nearPct:       s.nearPct       ?? 20,
        midPct:        s.midPct        ?? 30,
        farPct:        s.farPct        ?? 50
      }))
    : [];
  if (json.settlement_priorities) {
    if (Array.isArray(json.settlement_priorities.p1)) settlementPriority1 = [...json.settlement_priorities.p1];
    if (Array.isArray(json.settlement_priorities.p2)) settlementPriority2 = [...json.settlement_priorities.p2];
  } else {
    settlementPriority1 = ['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3'];
    settlementPriority2 = ['Forest_1', 'Barren_1', 'Hills_1', 'Swamp_1'];
  }
  ```

- [ ] Find the **second** load site (~line 5170) — same old block, same change:
  ```js
  settlementSlots = (json.settlement_slots && Array.isArray(json.settlement_slots))
    ? json.settlement_slots.map(s => ({
        minDist:       s.minDist       ?? 10,
        maxDist:       s.maxDist       ?? 20,
        count:         s.count         ?? 1,
        type:          s.type          ?? 'settlement',
        tapMultiplier: s.tapMultiplier ?? 1
      }))
    : [];
  ```
  Change to (identical to above):
  ```js
  settlementSlots = (json.settlement_slots && Array.isArray(json.settlement_slots))
    ? json.settlement_slots.map(s => ({
        minDist:       s.minDist       ?? 10,
        maxDist:       s.maxDist       ?? 20,
        count:         s.count         ?? 1,
        type:          s.type          ?? 'settlement',
        tapMultiplier: s.tapMultiplier ?? 1,
        level:         s.level         ?? 1,
        minSpacing:    s.minSpacing    ?? 2,
        nearPct:       s.nearPct       ?? 20,
        midPct:        s.midPct        ?? 30,
        farPct:        s.farPct        ?? 50
      }))
    : [];
  if (json.settlement_priorities) {
    if (Array.isArray(json.settlement_priorities.p1)) settlementPriority1 = [...json.settlement_priorities.p1];
    if (Array.isArray(json.settlement_priorities.p2)) settlementPriority2 = [...json.settlement_priorities.p2];
  } else {
    settlementPriority1 = ['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3'];
    settlementPriority2 = ['Forest_1', 'Barren_1', 'Hills_1', 'Swamp_1'];
  }
  ```

#### Step 1f: Update History snapshot/restore (~line 3316/3325)

- [ ] Find the History push snapshot object (contains `slots: settlementSlots.map(...)`). It looks like:
  ```js
  slots:       settlementSlots.map(s => Object.assign({}, s)),
  ```
  Add priority arrays next to it. Find the full object and add two lines. The object likely starts with `{` and contains `mapData:`, `settlements:`, `slots:`. Add:
  ```js
  p1:          [...settlementPriority1],
  p2:          [...settlementPriority2],
  ```
  immediately after the `slots:` line.

- [ ] Find the History restore section (contains `settlementSlots = (snap.slots || [])`). After that line add:
  ```js
  if (snap.p1) settlementPriority1 = [...snap.p1];
  if (snap.p2) settlementPriority2 = [...snap.p2];
  ```

#### Step 1g: Verify in browser console

- [ ] Open `MapEditorPro.html` in browser
- [ ] Open DevTools → Console
- [ ] Run: `settlementPriority1` → should log `['Plain_1', 'Plain_2', 'Rubble_1', 'Rubble_2', 'Rubble_3']`
- [ ] Run: `settlementPriority2` → should log `['Forest_1', 'Barren_1', 'Hills_1', 'Swamp_1']`
- [ ] Click "+ Add Slot" in the slot panel
- [ ] Run: `settlementSlots[0]` → should include `level:1, minSpacing:2, nearPct:20, midPct:30, farPct:50`
- [ ] Run: `autoPlaceSettlements()` on a blank map (no terrain) → should toast "Auto-placed 0 settlements" (no eligible hexes on blank `Plain_1` only map — actually Plain_1 IS in P1, so it should place some)
- [ ] Actually on default blank map (`Plain_1` fill), with one slot (dist 10-20, count 3), `autoPlaceSettlements()` should place 3 settlements. Verify `settlements.length === 4` (3 new + city).
- [ ] Press Ctrl+Z → `settlements.length` should be 1 (just city) confirming undo works.
- [ ] Save map as JSON, open it in a text editor, confirm `settlement_priorities` key is present.

- [ ] Commit:
  ```bash
  git add "MapEditorPro.html"
  git commit -m "feat(autogen): add auto-place algorithm with priority hex lists and distribution bands"
  ```

---

### Task 2: UI — Slot Row Fields + Priority Config + Auto-Place Button

Extend each slot row with the 5 new field inputs, add a priority config section below the slot list, and wire the ⚡ Auto-Place button.

**Files:**
- Modify: `MapEditorPro.html` (CSS ~line 296, HTML ~line 1345, JS `_buildSlotRow` ~line 4559, `_wireSlotPanel` ~line 4623)

**Interfaces:**
- Consumes: `autoPlaceSettlements()` from Task 1
- Consumes: `settlementPriority1` / `settlementPriority2` from Task 1
- Consumes: `slot.level`, `slot.minSpacing`, `slot.nearPct`, `slot.midPct`, `slot.farPct` from Task 1

---

#### Step 2a: CSS additions (~line 296, after `.slot-mult-hint`)

- [ ] Find:
  ```css
  .slot-mult-hint { font-size: 10px; color: var(--muted); }
  ```
  After it, add:
  ```css
  .slot-extra-row { flex: 0 0 100%; display: flex; gap: 4px; align-items: center; padding-left: 2px; margin-top: 2px; }
  .slot-extra-row .hexdb-input { width: 40px !important; }
  .slot-extra-label { font-size: 10px; color: var(--muted); }
  #priority-config { padding: 6px 0 2px; border-top: 1px solid var(--border); margin-top: 4px; }
  #priority-config label { display: block; font-size: 10px; color: var(--muted); margin-bottom: 2px; }
  #priority-config input { width: 100%; box-sizing: border-box; font-size: 11px; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 3px 5px; border-radius: 3px; margin-bottom: 4px; }
  #slot-autogen { margin-top: 4px; width: 100%; background: none; border: 1px solid var(--accent); color: var(--accent); padding: 4px; cursor: pointer; border-radius: 3px; font-size: 11px; }
  #slot-autogen:hover { background: var(--accent); color: #000; }
  #slot-panel.collapsed #slot-autogen,
  #slot-panel.collapsed #priority-config { display: none; }
  ```

#### Step 2b: HTML slot panel additions (~line 1345)

- [ ] Find:
  ```html
  <button id="slot-add">+ Add Slot</button>
  ```
  Replace with:
  ```html
  <button id="slot-add">+ Add Slot</button>
  <button id="slot-autogen" onclick="autoPlaceSettlements()">⚡ Auto-Place All Slots</button>
  <div id="priority-config">
    <label>Priority 1 hexes (preferred, comma-separated IDs)</label>
    <input id="priority-p1" type="text" placeholder="Plain_1, Plain_2, Rubble_1, Rubble_2, Rubble_3">
    <label>Priority 2 hexes (fallback, comma-separated IDs)</label>
    <input id="priority-p2" type="text" placeholder="Forest_1, Barren_1, Hills_1, Swamp_1">
  </div>
  ```

#### Step 2c: Extend `_buildSlotRow` with two new sub-rows (~line 4559)

- [ ] Find the end of the `div.innerHTML = \`` template string in `_buildSlotRow`. Currently it ends with:
  ```js
          <div class="slot-mult-row">
            <span style="color:var(--muted);font-size:10px">tap ×</span>
            <input type="number" class="hexdb-input slot-mult" min="0.1" max="10" step="0.1"
              value="${(slot.tapMultiplier ?? 1).toFixed(1)}"
              title="Tap cost multiplier for this ring (1 = no change, 1.5 = 50% more taps)">
            <span class="slot-mult-hint">(1 = no change)</span>
          </div>`;
  ```
  Change to (append two new rows before the closing backtick):
  ```js
          <div class="slot-mult-row">
            <span style="color:var(--muted);font-size:10px">tap ×</span>
            <input type="number" class="hexdb-input slot-mult" min="0.1" max="10" step="0.1"
              value="${(slot.tapMultiplier ?? 1).toFixed(1)}"
              title="Tap cost multiplier for this ring (1 = no change, 1.5 = 50% more taps)">
            <span class="slot-mult-hint">(1 = no change)</span>
          </div>
          <div class="slot-extra-row">
            <span class="slot-extra-label">Lv:</span>
            <input type="number" class="hexdb-input slot-level" min="1" max="99" step="1"
              value="${slot.level ?? 1}" title="Settlement starting level">
            <span class="slot-extra-label">spacing:</span>
            <input type="number" class="hexdb-input slot-spacing" min="1" max="20" step="1"
              value="${slot.minSpacing ?? 2}" title="Min hexes between auto-placed settlements">
            <span class="slot-extra-label">hex</span>
          </div>
          <div class="slot-extra-row">
            <span class="slot-extra-label">near</span>
            <input type="number" class="hexdb-input slot-near" min="0" max="100" step="1"
              value="${slot.nearPct ?? 20}" title="% placed in near zone">
            <span class="slot-extra-label">% mid</span>
            <input type="number" class="hexdb-input slot-mid" min="0" max="100" step="1"
              value="${slot.midPct ?? 30}" title="% placed in middle zone">
            <span class="slot-extra-label">% far</span>
            <input type="number" class="hexdb-input slot-far" min="0" max="100" step="1"
              value="${slot.farPct ?? 50}" title="% placed in far zone">
            <span class="slot-extra-label">%</span>
          </div>`;
  ```

#### Step 2d: Wire new slot inputs in `_wireSlotPanel` (~line 4623, after the `.slot-mult` block)

- [ ] Find:
  ```js
  document.querySelectorAll('.slot-mult').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.closest('.slot-row').dataset.slotIdx);
      settlementSlots[idx].tapMultiplier = Math.max(0.1, parseFloat(el.value) || 1);
      IO.scheduleAutoSave();
    });
  });
  ```
  After that block, add:
  ```js
  document.querySelectorAll('.slot-level').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.closest('.slot-row').dataset.slotIdx);
      settlementSlots[idx].level = Math.max(1, parseInt(el.value) || 1);
      IO.scheduleAutoSave();
    });
  });
  document.querySelectorAll('.slot-spacing').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.closest('.slot-row').dataset.slotIdx);
      settlementSlots[idx].minSpacing = Math.max(1, parseInt(el.value) || 2);
      IO.scheduleAutoSave();
    });
  });
  document.querySelectorAll('.slot-near, .slot-mid, .slot-far').forEach(el => {
    el.addEventListener('change', () => {
      const idx  = parseInt(el.closest('.slot-row').dataset.slotIdx);
      const row  = el.closest('.slot-row');
      settlementSlots[idx].nearPct = parseInt(row.querySelector('.slot-near').value) || 0;
      settlementSlots[idx].midPct  = parseInt(row.querySelector('.slot-mid').value)  || 0;
      settlementSlots[idx].farPct  = parseInt(row.querySelector('.slot-far').value)  || 0;
      IO.scheduleAutoSave();
    });
  });
  ```

#### Step 2e: Wire priority inputs in `_wireSlotPanel` (at the end, after the `hdr` click wiring)

- [ ] Find the very end of `_wireSlotPanel` — after the slot-panel-hdr click handler closes. Add:
  ```js
  function _wirePriorityInputs() {
    const p1El = document.getElementById('priority-p1');
    if (p1El) {
      p1El.value = settlementPriority1.join(', ');
      const p1New = p1El.cloneNode(true);
      p1El.replaceWith(p1New);
      p1New.addEventListener('change', e => {
        settlementPriority1 = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
        IO.scheduleAutoSave();
      });
    }
    const p2El = document.getElementById('priority-p2');
    if (p2El) {
      p2El.value = settlementPriority2.join(', ');
      const p2New = p2El.cloneNode(true);
      p2El.replaceWith(p2New);
      p2New.addEventListener('change', e => {
        settlementPriority2 = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
        IO.scheduleAutoSave();
      });
    }
  }
  _wirePriorityInputs();
  ```

  Also call `_wirePriorityInputs()` at the end of `rebuildSlotPanel()` (it already calls `_wireSlotPanel()` which now calls `_wirePriorityInputs()` — so no extra call needed, it's wired through `_wireSlotPanel`).

#### Step 2f: Verify in browser

- [ ] Open `MapEditorPro.html` in browser
- [ ] Generate a map (Generate → Procedural Generator) to get varied terrain
- [ ] Expand "🏘️ Settlement Slots" in the right panel
- [ ] Click "+ Add Slot" → verify the row now shows:
  - Row 1: `[minDist] → [maxDist] × [count] [type-select] ✕`
  - Row 2: `tap × [mult] (1 = no change)`
  - Row 3: `Lv: [1] spacing: [2] hex`
  - Row 4: `near [20] % mid [30] % far [50] %`
- [ ] Verify Priority 1 input shows: `Plain_1, Plain_2, Rubble_1, Rubble_2, Rubble_3`
- [ ] Verify Priority 2 input shows: `Forest_1, Barren_1, Hills_1, Swamp_1`
- [ ] Click "⚡ Auto-Place All Slots" → verify toast "Auto-placed N settlements"
- [ ] Verify settlements appear on the map canvas
- [ ] Change near/mid/far to 0 / 0 / 100, click Auto-Place → verify settlements cluster toward the far boundary ring
- [ ] Change Priority 1 to just `Plain_1`, click Auto-Place → verify only Plain_1 hexes receive settlements (Rubble tiles excluded)
- [ ] Press Ctrl+Z → all auto-placed settlements removed
- [ ] Save map JSON → verify `settlement_priorities` and new slot fields present in file

- [ ] Commit:
  ```bash
  git add "MapEditorPro.html"
  git commit -m "feat(autogen): add slot UI fields for level/spacing/distribution and priority config panel"
  ```
