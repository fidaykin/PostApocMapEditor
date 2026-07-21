# Settlement Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add settlement slots — distance-ring rules that the Unity map loader resolves into random settlement positions at import time, configurable in the HTML map editor.

**Architecture:** Editor gets a `settlementSlots` global array with right-panel UI, canvas ring visualization, and JSON export. Unity gets 4 new parallel lists on `MapSaveData`, a `ParseSettlementSlots` parser in both importers, and a new `SettlementSlotResolver` static class that runs at import time.

**Tech Stack:** HTML/JS (MapEditorPro.html), C# / Unity 2022+ (PostApocCityBuilder)

---

## File Map

| File | Change |
|---|---|
| `Post Apo Map Editor/MapEditorPro.html` | Add `settlementSlots` state, History, export, UI, canvas rings |
| `PostApocCityBuilder/Assets/_Project/Scripts/Save/GameSaveData.cs` | 4 new parallel lists on `MapSaveData` |
| `PostApocCityBuilder/Assets/_Project/Scripts/Map/RuntimeMapApplier.cs` | Add `ParseSettlementSlots()`, call resolver |
| `PostApocCityBuilder/Assets/_Project/Scripts/Map/RuntimeMapLoader.cs` | Add `ParseSettlementSlots()` call |
| `PostApocCityBuilder/Assets/_Project/Scripts/Map/SettlementSlotResolver.cs` | **New** — static Resolve() method |
| `PostApocCityBuilder/Assets/_Project/Scripts/UI/DebugController.cs` | Preserve slot lists through reset |

---

### Task 1: Editor — `settlementSlots` state, History, export/restore

**Files:**
- Modify: `Post Apo Map Editor/MapEditorPro.html:5006` (near `let settlements = []`)
- Modify: `Post Apo Map Editor/MapEditorPro.html:2200-2215` (History snapshot/restore)
- Modify: `Post Apo Map Editor/MapEditorPro.html:2621-2628` (`_buildJson`)
- Modify: `Post Apo Map Editor/MapEditorPro.html:2670-2684` (`tryRestoreAutosave`)
- Modify: `Post Apo Map Editor/MapEditorPro.html:2688-2695` (`newMap`)

- [ ] **Step 1: Add `settlementSlots` declaration next to `settlements`**

In `MapEditorPro.html` at line 5006, after `let settlements = [];` add:

```javascript
let settlements = [];
let settlementSlots = []; // [{minDist,maxDist,count,type}]
```

- [ ] **Step 2: Include `settlementSlots` in History snapshots**

In `History._snapshot()` (around line 2206), change:

```javascript
function _snapshot() {
    return {
        grid:        new Int8Array(mapData),
        overlay:     Object.assign({}, customTerrainOverlay),
        settlements: settlements.map(s => Object.assign({}, s)),
        slots:       settlementSlots.map(s => Object.assign({}, s))
    };
}

function _restore(snap) {
    mapData.set(snap.grid);
    customTerrainOverlay = Object.assign({}, snap.overlay);
    settlements = snap.settlements.map(s => Object.assign({}, s));
    settlementSlots = (snap.slots || []).map(s => Object.assign({}, s));
    UI.updateSettlementCount();
}
```

- [ ] **Step 3: Export `settlement_slots` in `_buildJson()`**

Around line 2624, after `result.custom_terrain`:

```javascript
if (customTerrain.length > 0)
    result.custom_terrain = customTerrain;
if (settlementSlots.length > 0)
    result.settlement_slots = settlementSlots.map(s => ({
        minDist: s.minDist, maxDist: s.maxDist,
        count:   s.count,   type:    s.type
    }));
return JSON.stringify(result);
```

- [ ] **Step 4: Restore `settlementSlots` in `tryRestoreAutosave()`**

After the `settlements = ...` line (around line 2677):

```javascript
settlementSlots = (json.settlement_slots && Array.isArray(json.settlement_slots))
    ? json.settlement_slots.map(s => ({
        minDist: s.minDist ?? 10, maxDist: s.maxDist ?? 20,
        count:   s.count   ?? 1,  type:    s.type    ?? 'settlement'
      }))
    : [];
```

- [ ] **Step 5: Reset `settlementSlots` in `newMap()`**

In both the `silent` branch and the modal path (lines ~2693 and ~2730):

```javascript
settlements     = [{ col: getCityCol(), row: getCityRow(), type: 'city' }];
settlementSlots = [];
```

- [ ] **Step 6: Restore `settlementSlots` in `openMap()` (file-open path)**

Around line 2777, after `settlements = json.settlements.map(...)`:

```javascript
settlementSlots = (json.settlement_slots && Array.isArray(json.settlement_slots))
    ? json.settlement_slots.map(s => ({
        minDist: s.minDist ?? 10, maxDist: s.maxDist ?? 20,
        count:   s.count   ?? 1,  type:    s.type    ?? 'settlement'
      }))
    : [];
```

- [ ] **Step 7: Verify in browser**

Open `MapEditorPro.html`. Open dev console. Run:
```javascript
settlementSlots.push({minDist:10,maxDist:20,count:1,type:'settlement'});
IO.autoSave();
const saved = JSON.parse(localStorage.getItem('map_autosave'));
console.log(saved.settlement_slots);
// Expected: [{minDist:10,maxDist:20,count:1,type:'settlement'}]
```

- [ ] **Step 8: Commit**

```bash
cd "Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "feat: settlementSlots state — History, export, restore"
```

---

### Task 2: Editor — Right Panel UI

**Files:**
- Modify: `Post Apo Map Editor/MapEditorPro.html:239` (CSS for slot section)
- Modify: `Post Apo Map Editor/MapEditorPro.html:888` (right panel HTML)

- [ ] **Step 1: Add CSS for slot section and rows**

After the `#settlement-count` CSS block (around line 239):

```css
#slot-panel { padding: 8px; border-top: 1px solid var(--border); }
#slot-panel .section-title { font-size: 11px; color: var(--muted); margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
.slot-row { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
.slot-row input[type=number] { width: 52px; }
.slot-count { width: 36px; }
.slot-type-select { width: 100px; }
.slot-type-text   { width: 90px; display: none; }
.slot-type-text.visible { display: inline-block; }
.slot-remove { background: none; border: 1px solid var(--border); color: var(--muted); padding: 2px 6px; cursor: pointer; border-radius: 3px; }
.slot-remove:hover { border-color: var(--danger); color: var(--danger); }
#slot-add { margin-top: 4px; width: 100%; background: none; border: 1px dashed var(--border); color: var(--muted); padding: 4px; cursor: pointer; border-radius: 3px; font-size: 11px; }
#slot-add:hover { border-color: var(--accent); color: var(--accent); }
#slot-panel.collapsed .slot-rows, #slot-panel.collapsed #slot-add { display: none; }
```

- [ ] **Step 2: Add slot panel HTML to right panel**

Replace the closing `</div>` of `#settlement-count` (line 888) with:

```html
      <div id="settlement-count">Settlements: 0</div>
      <div id="slot-panel" class="collapsed">
        <div class="section-title" id="slot-panel-hdr">
          <span>🏘️ Settlement Slots</span>
          <span id="slot-chevron">▶</span>
        </div>
        <div class="slot-rows" id="slot-rows"></div>
        <button id="slot-add">+ Add Slot</button>
      </div>
```

- [ ] **Step 3: Add `_buildSlotRow(slot, idx)` helper function**

Add near the UI module (after `updateSettlementCount`):

```javascript
function _buildSlotRow(slot, idx) {
    const isCustom = !['settlement','outpost','trading_post'].includes(slot.type);
    const div = document.createElement('div');
    div.className = 'slot-row';
    div.dataset.slotIdx = idx;
    div.innerHTML = `
        <input type="number" class="hexdb-input slot-min" min="0" value="${slot.minDist}" title="Min distance">
        <span style="color:var(--muted)">→</span>
        <input type="number" class="hexdb-input slot-max" min="0" value="${slot.maxDist}" title="Max distance">
        <span style="color:var(--muted)">×</span>
        <input type="number" class="hexdb-input slot-count" min="1" max="99" value="${slot.count}" title="Count">
        <select class="hexdb-select slot-type-select">
            <option${slot.type==='settlement'?' selected':''}>settlement</option>
            <option${slot.type==='outpost'?' selected':''}>outpost</option>
            <option${slot.type==='trading_post'?' selected':''}>trading_post</option>
            <option${isCustom?' selected':''} value="__custom__">Custom…</option>
        </select>
        <input class="hexdb-input slot-type-text${isCustom?' visible':''}" value="${isCustom?slot.type:''}" placeholder="type name">
        <button class="slot-remove" data-slot-idx="${idx}">✕</button>`;
    return div;
}
```

- [ ] **Step 4: Add `rebuildSlotPanel()` function**

```javascript
function rebuildSlotPanel() {
    const container = document.getElementById('slot-rows');
    container.innerHTML = '';
    settlementSlots.forEach((slot, idx) => {
        container.appendChild(_buildSlotRow(slot, idx));
    });
    _wireSlotPanel();
}
```

- [ ] **Step 5: Add `_wireSlotPanel()` function**

```javascript
function _wireSlotPanel() {
    document.querySelectorAll('.slot-min').forEach(el => {
        el.addEventListener('change', () => {
            const idx = parseInt(el.closest('.slot-row').dataset.slotIdx);
            settlementSlots[idx].minDist = Math.max(0, parseInt(el.value) || 0);
            IO.scheduleAutoSave(); Canvas.render();
        });
    });
    document.querySelectorAll('.slot-max').forEach(el => {
        el.addEventListener('change', () => {
            const idx = parseInt(el.closest('.slot-row').dataset.slotIdx);
            settlementSlots[idx].maxDist = Math.max(0, parseInt(el.value) || 0);
            IO.scheduleAutoSave(); Canvas.render();
        });
    });
    document.querySelectorAll('.slot-count').forEach(el => {
        el.addEventListener('change', () => {
            const idx = parseInt(el.closest('.slot-row').dataset.slotIdx);
            settlementSlots[idx].count = Math.max(1, parseInt(el.value) || 1);
            IO.scheduleAutoSave();
        });
    });
    document.querySelectorAll('.slot-type-select').forEach(el => {
        el.addEventListener('change', () => {
            const idx = parseInt(el.closest('.slot-row').dataset.slotIdx);
            const textInput = el.nextElementSibling;
            if (el.value === '__custom__') {
                textInput.classList.add('visible');
                settlementSlots[idx].type = textInput.value || 'settlement';
            } else {
                textInput.classList.remove('visible');
                settlementSlots[idx].type = el.value;
            }
            IO.scheduleAutoSave(); Canvas.render();
        });
    });
    document.querySelectorAll('.slot-type-text').forEach(el => {
        el.addEventListener('input', () => {
            const idx = parseInt(el.closest('.slot-row').dataset.slotIdx);
            settlementSlots[idx].type = el.value || 'settlement';
            IO.scheduleAutoSave(); Canvas.render();
        });
    });
    document.querySelectorAll('.slot-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            History.push();
            const idx = parseInt(btn.dataset.slotIdx);
            settlementSlots.splice(idx, 1);
            rebuildSlotPanel(); IO.scheduleAutoSave(); Canvas.render();
        });
    });
    document.getElementById('slot-add').addEventListener('click', () => {
        History.push();
        settlementSlots.push({ minDist: 10, maxDist: 20, count: 1, type: 'settlement' });
        rebuildSlotPanel(); IO.scheduleAutoSave(); Canvas.render();
    });
    document.getElementById('slot-panel-hdr').addEventListener('click', () => {
        const panel = document.getElementById('slot-panel');
        const chevron = document.getElementById('slot-chevron');
        panel.classList.toggle('collapsed');
        chevron.textContent = panel.classList.contains('collapsed') ? '▶' : '▼';
    });
}
```

- [ ] **Step 6: Call `rebuildSlotPanel()` after map load/restore**

In `tryRestoreAutosave()` and `openMap()`, after `UI.updateSettlementCount()` (or wherever settlements are restored), add:

```javascript
UI.rebuildSlotPanel();
```

Also export `rebuildSlotPanel` from the UI module return object.

- [ ] **Step 7: Verify in browser**

Open editor. Right panel should show "🏘️ Settlement Slots" collapsed section. Click to expand. Click "+ Add Slot". A row appears with `10 → 20 ×1 settlement`. Change values — check `settlementSlots[0]` in console updates correctly.

- [ ] **Step 8: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat: settlement slots right-panel UI — add/edit/delete rows"
```

---

### Task 3: Editor — Canvas Ring Visualization

**Files:**
- Modify: `Post Apo Map Editor/MapEditorPro.html` — Canvas module, add `_drawSlotRings()`

- [ ] **Step 1: Add slot colour palette constant**

Near `ZONE_PALETTE` in the Canvas IIFE:

```javascript
const SLOT_PALETTE = [
    'rgba(79,195,247,',   // blue
    'rgba(255,183,77,',   // amber
    'rgba(174,213,129,',  // green
    'rgba(240,98,146,',   // pink
    'rgba(206,147,216,',  // purple
    'rgba(255,138,101,',  // orange
];
```

- [ ] **Step 2: Add `_selectedSlotIdx` state**

```javascript
let _selectedSlotIdx = -1;
```

Export `setSelectedSlot(idx)` from Canvas:

```javascript
function setSelectedSlot(idx) { _selectedSlotIdx = idx; render(); }
```

- [ ] **Step 3: Add `_drawSlotRings(scale, radius)` function**

Add after `_drawZoneOverlays`:

```javascript
function _drawSlotRings(scale, radius) {
    if (!settlementSlots || settlementSlots.length === 0) return;
    const padding = radius * 2;
    ctx.save();

    settlementSlots.forEach((slot, si) => {
        if (slot.minDist > slot.maxDist) return;
        const base   = SLOT_PALETTE[si % SLOT_PALETTE.length];
        const isSelected = si === _selectedSlotIdx;
        const alpha  = isSelected ? 0.40 : (_selectedSlotIdx >= 0 ? 0.12 : 0.28);

        for (let row = 0; row < MAP_HEIGHT; row++) {
            for (let col = 0; col < MAP_WIDTH; col++) {
                const s = hexScreenPos(col, row);
                if (s.x + padding < 0 || s.x - padding > canvas.width ||
                    s.y + padding < 0 || s.y - padding > canvas.height) continue;
                const appX = (MAP_HEIGHT - 1 - row) - Math.floor(MAP_HEIGHT / 2);
                const appY = col - Math.floor(MAP_WIDTH / 2);
                const d    = hexDist(appX, appY);
                if (d < slot.minDist || d > slot.maxDist) continue;
                // Boundary tiles (exact edge) get brighter
                const a = (d === slot.minDist || d === slot.maxDist)
                    ? Math.min(alpha + 0.15, 0.6) : alpha;
                ctx.globalAlpha = a;
                ctx.fillStyle = base + ')';
                hexClipPath(s.x, s.y, radius);
                ctx.fill();
            }
        }

        // Label at due-East tile of maxDist
        const labelRow = MAP_HEIGHT - 1 - (slot.maxDist + Math.floor(MAP_HEIGHT / 2));
        const labelCol = Math.floor(MAP_WIDTH / 2);
        if (labelRow >= 0 && labelRow < MAP_HEIGHT) {
            const ls = hexScreenPos(labelCol, labelRow);
            if (ls.x - radius < canvas.width && ls.y - radius < canvas.height) {
                ctx.globalAlpha = 1;
                const fontSize = Math.max(9, Math.round(radius * 0.55));
                ctx.font = `bold ${fontSize}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.beginPath();
                ctx.arc(ls.x, ls.y, radius * 0.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillText(`${slot.type}×${slot.count}`, ls.x, ls.y);
            }
        }
    });

    ctx.restore();
}
```

- [ ] **Step 4: Call `_drawSlotRings` in the render loop**

After `if (_showZones) _drawZoneOverlays(scale, radius);` add:

```javascript
if (settlementsVisible) _drawSlotRings(scale, radius);
```

This call must be BEFORE the settlement markers loop.

- [ ] **Step 5: Wire slot row selection in `_wireSlotPanel()`**

In `_buildSlotRow`, add to the div's click handler:

```javascript
div.addEventListener('click', () => {
    Canvas.setSelectedSlot(idx);
    document.querySelectorAll('.slot-row').forEach((r, i) => {
        r.style.outline = i === idx ? '1px solid var(--accent)' : '';
    });
});
```

- [ ] **Step 6: Verify in browser**

Add two slots with different ranges (e.g. 10–20 and 30–50). Toggle settlement visibility on. Two distinct coloured rings appear on the canvas. Click a slot row — its ring brightens, others dim.

- [ ] **Step 7: Commit**

```bash
git add MapEditorPro.html
git commit -m "feat: settlement slot rings visualised on canvas"
```

---

### Task 4: Unity — `GameSaveData` + `DebugController`

**Files:**
- Modify: `PostApocCityBuilder/Assets/_Project/Scripts/Save/GameSaveData.cs:89`
- Modify: `PostApocCityBuilder/Assets/_Project/Scripts/UI/DebugController.cs:307`

- [ ] **Step 1: Add four parallel slot lists to `MapSaveData`**

In `GameSaveData.cs`, after `CustomSettlementPositions` (line 89):

```csharp
        /// <summary>
        /// Settlement slot rules imported from map JSON.
        /// Parallel lists: minDist, maxDist, count, type.
        /// Resolved to CustomSettlementPositions by SettlementSlotResolver at import time.
        /// </summary>
        public List<int>    SlotMinDist = new List<int>();
        public List<int>    SlotMaxDist = new List<int>();
        public List<int>    SlotCount   = new List<int>();
        public List<string> SlotTypes   = new List<string>();
```

- [ ] **Step 2: Preserve slot lists through debug reset**

In `DebugController.cs` `ResetGame()`, after the `CustomTerrainIds` line (around line 311):

```csharp
                freshSave.Map.SlotMinDist = oldSave.Map.SlotMinDist;
                freshSave.Map.SlotMaxDist = oldSave.Map.SlotMaxDist;
                freshSave.Map.SlotCount   = oldSave.Map.SlotCount;
                freshSave.Map.SlotTypes   = oldSave.Map.SlotTypes;
```

Also update the log line to include slot count:

```csharp
                Debug.Log($"[Debug] Save reset — preserved {oldSave.Map.TerrainOverridePositions.Count} terrain overrides, " +
                          $"{oldSave.Map.CustomTerrainPositions?.Count ?? 0} custom terrain tiles, " +
                          $"{oldSave.Map.SlotMinDist?.Count ?? 0} settlement slots");
```

- [ ] **Step 3: Verify compile**

Open Unity. Check Console — no compile errors. Verify `MapSaveData` in the inspector shows the new lists (they'll be empty).

- [ ] **Step 4: Commit (Unity repo)**

```bash
cd PostApocCityBuilder
git add Assets/_Project/Scripts/Save/GameSaveData.cs Assets/_Project/Scripts/UI/DebugController.cs
git commit -m "feat: MapSaveData slot lists + preserve through DebugController reset"
```

---

### Task 5: Unity — `ParseSettlementSlots` in both importers

**Files:**
- Modify: `PostApocCityBuilder/Assets/_Project/Scripts/Map/RuntimeMapApplier.cs`
- Modify: `PostApocCityBuilder/Assets/_Project/Scripts/Map/RuntimeMapLoader.cs`

- [ ] **Step 1: Add `ParseSettlementSlots` to `RuntimeMapApplier`**

Add this private static method (after `ParseCustomTerrain`):

```csharp
private static void ParseSettlementSlots(string json, MapSaveData mapSaveData)
{
    try
    {
        int start = json.IndexOf("\"settlement_slots\"");
        if (start < 0) return;
        int arrayStart = json.IndexOf('[', start);
        if (arrayStart < 0) return;
        int arrayEnd = FindMatchingBracket(json, arrayStart);
        if (arrayEnd < 0) return;

        mapSaveData.Map.SlotMinDist.Clear();
        mapSaveData.Map.SlotMaxDist.Clear();
        mapSaveData.Map.SlotCount.Clear();
        mapSaveData.Map.SlotTypes.Clear();

        string content = json.Substring(arrayStart + 1, arrayEnd - arrayStart - 1);
        int pos = 0;
        while (pos < content.Length)
        {
            int objStart = content.IndexOf('{', pos);
            if (objStart < 0) break;
            int objEnd = FindMatchingBrace(content, objStart);
            if (objEnd < 0) break;
            string obj = content.Substring(objStart + 1, objEnd - objStart - 1);

            int minDist = ParseJsonIntFromObject(obj, "minDist");
            int maxDist = ParseJsonIntFromObject(obj, "maxDist");
            int count   = ParseJsonIntFromObject(obj, "count");
            if (count  < 0) count   = 1;
            string type = ParseJsonStringFromObject(obj, "type");
            if (string.IsNullOrEmpty(type)) type = "settlement";

            if (minDist >= 0 && maxDist >= minDist)
            {
                mapSaveData.Map.SlotMinDist.Add(minDist);
                mapSaveData.Map.SlotMaxDist.Add(maxDist);
                mapSaveData.Map.SlotCount.Add(count);
                mapSaveData.Map.SlotTypes.Add(type);
            }
            pos = objEnd + 1;
        }
        Debug.Log($"[RuntimeMapApplier] Parsed {mapSaveData.Map.SlotMinDist.Count} settlement slots.");
    }
    catch (Exception e)
    {
        Debug.LogWarning($"[RuntimeMapApplier] ParseSettlementSlots failed: {e.Message}");
    }
}
```

- [ ] **Step 2: Call `ParseSettlementSlots` in `ApplyMapJSON`**

In `ApplyMapJSON`, after `ParseCustomTerrain` (line ~68), add:

```csharp
                // Parse settlement slot rules (optional)
                ParseSettlementSlots(jsonContent, saveData);
```

Note: `saveData` is loaded earlier in the method at line ~71. Move the `ParseSettlementSlots` call to after `saveData` is loaded.

The correct position — after line `var saveData = SaveSystem.LoadFromDisk();`:

```csharp
                var saveData = SaveSystem.LoadFromDisk();
                if (saveData == null) { ... return false; }

                // Parse settlement slot rules now that saveData is available
                ParseSettlementSlots(jsonContent, saveData);
```

- [ ] **Step 3: Add `ParseSettlementSlots` to `RuntimeMapLoader`**

In `RuntimeMapLoader.cs`, add (after `ParseCustomTerrain`):

```csharp
private static void ParseSettlementSlots(string json, MapSaveData mapSaveData)
{
    try
    {
        int start = json.IndexOf("\"settlement_slots\"");
        if (start < 0) return;
        int arrayStart = json.IndexOf('[', start);
        if (arrayStart < 0) return;
        int arrayEnd = json.IndexOf(']', arrayStart);
        if (arrayEnd < 0) return;

        mapSaveData.SlotMinDist.Clear();
        mapSaveData.SlotMaxDist.Clear();
        mapSaveData.SlotCount.Clear();
        mapSaveData.SlotTypes.Clear();

        string content = json.Substring(arrayStart + 1, arrayEnd - arrayStart - 1);
        int pos = 0;
        while (pos < content.Length)
        {
            int objStart = content.IndexOf('{', pos);
            if (objStart < 0) break;
            int objEnd = content.IndexOf('}', objStart);
            if (objEnd < 0) break;
            string obj = content.Substring(objStart + 1, objEnd - objStart - 1);

            int minDist = ParseJsonInt(obj, "minDist");
            int maxDist = ParseJsonInt(obj, "maxDist");
            int count   = ParseJsonInt(obj, "count");
            if (count   <= 0) count = 1;
            string type = ParseJsonString(obj, "type");
            if (string.IsNullOrEmpty(type)) type = "settlement";

            if (maxDist >= minDist && minDist >= 0)
            {
                mapSaveData.SlotMinDist.Add(minDist);
                mapSaveData.SlotMaxDist.Add(maxDist);
                mapSaveData.SlotCount.Add(count);
                mapSaveData.SlotTypes.Add(type);
            }
            pos = objEnd + 1;
        }
        Debug.Log($"[RuntimeMapLoader] Parsed {mapSaveData.SlotMinDist.Count} settlement slots.");
    }
    catch (Exception e)
    {
        Debug.LogWarning($"[RuntimeMapLoader] ParseSettlementSlots failed: {e.Message}");
    }
}
```

- [ ] **Step 4: Call it in `TryApplyImport` after `ParseSettlements`**

In `RuntimeMapLoader.TryApplyImport`, after the custom terrain block:

```csharp
                // Parse settlement slot rules
                ParseSettlementSlots(json, mapSaveData);
```

- [ ] **Step 5: Verify compile — no errors in Unity Console**

- [ ] **Step 6: Commit**

```bash
git add Assets/_Project/Scripts/Map/RuntimeMapApplier.cs Assets/_Project/Scripts/Map/RuntimeMapLoader.cs
git commit -m "feat: ParseSettlementSlots in both importers"
```

---

### Task 6: Unity — `SettlementSlotResolver`

**Files:**
- Create: `PostApocCityBuilder/Assets/_Project/Scripts/Map/SettlementSlotResolver.cs`
- Modify: `PostApocCityBuilder/Assets/_Project/Scripts/Map/RuntimeMapApplier.cs` — call resolver

- [ ] **Step 1: Create `SettlementSlotResolver.cs`**

No grid dependency — only needs dimensions, occupied set, and seed.

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using PostApoc.Save;

namespace PostApoc.Map
{
    /// <summary>
    /// Resolves settlement slot rules (distance rings) into concrete map positions.
    /// Runs only at import time — resolved positions are persisted in CustomSettlementPositions.
    /// </summary>
    public static class SettlementSlotResolver
    {
        /// <summary>
        /// For each slot in mapData.SlotMinDist/MaxDist/Count/Types, pick random
        /// valid tiles within the distance ring and append to CustomSettlementPositions.
        /// Existing hard-placed settlements are never overwritten.
        /// </summary>
        public static void Resolve(MapSaveData mapData, int width, int height, int seed)
        {
            if (mapData.SlotMinDist == null || mapData.SlotMinDist.Count == 0)
                return;

            var rng      = new System.Random(seed);
            var occupied = new HashSet<int>(mapData.CustomSettlementPositions);

            for (int i = 0; i < mapData.SlotMinDist.Count; i++)
            {
                int    minDist = mapData.SlotMinDist[i];
                int    maxDist = mapData.SlotMaxDist[i];
                int    count   = mapData.SlotCount[i];
                string type    = mapData.SlotTypes[i];

                var candidates = new List<int>();
                for (int arrayX = 0; arrayX < width; arrayX++)
                {
                    for (int arrayY = 0; arrayY < height; arrayY++)
                    {
                        int worldX = arrayX - width  / 2;
                        int worldY = arrayY - height / 2;
                        if (worldX == 0 && worldY == 0) continue; // skip city
                        int d = HexUtils.Distance(worldX, worldY, 0, 0);
                        if (d < minDist || d > maxDist) continue;
                        int encoded = arrayX + arrayY * width;
                        if (occupied.Contains(encoded)) continue;
                        candidates.Add(encoded);
                    }
                }

                // Fisher-Yates shuffle
                for (int j = candidates.Count - 1; j > 0; j--)
                {
                    int k = rng.Next(j + 1);
                    (candidates[j], candidates[k]) = (candidates[k], candidates[j]);
                }

                int placed = 0;
                foreach (int enc in candidates)
                {
                    if (placed >= count) break;
                    mapData.CustomSettlementPositions.Add(enc);
                    occupied.Add(enc);
                    placed++;
                }

                Debug.Log($"[SettlementSlotResolver] Placed {placed}/{count} '{type}' in ring {minDist}–{maxDist}.");
            }
        }
    }
}
```

- [ ] **Step 2: Call `SettlementSlotResolver.Resolve` in `RuntimeMapApplier.ApplyMapJSON`**

After `ApplySettlements(...)` and before `SaveSystem.SaveToDisk(saveData)`:

```csharp
                // Resolve settlement slots into concrete positions
                SettlementSlotResolver.Resolve(
                    saveData.Map,
                    saveData.Map.Width,
                    saveData.Map.Height,
                    saveData.Map.Seed);
```

- [ ] **Step 3: Call resolver in `RuntimeMapLoader.TryApplyImport`**

After all parsing and before `File.Move(path, donePath)`:

```csharp
                // Resolve settlement slots
                SettlementSlotResolver.Resolve(
                    mapSaveData, width, height, mapSaveData.Seed);
```

- [ ] **Step 4: Verify compile — no errors**

- [ ] **Step 5: End-to-end test**

1. In the editor, create a map with slot `minDist:5, maxDist:10, count:2, type:settlement`
2. Export map JSON — confirm `settlement_slots` section is present
3. Copy JSON to `<persistentDataPath>/map_import.json`
4. Start Unity app — check logs for `[SettlementSlotResolver] Placed 2/2 'settlement' in ring 5–10`
5. Confirm two settlement markers appear in the 5–10 hex ring

- [ ] **Step 6: Commit**

```bash
git add Assets/_Project/Scripts/Map/SettlementSlotResolver.cs Assets/_Project/Scripts/Map/RuntimeMapApplier.cs Assets/_Project/Scripts/Map/RuntimeMapLoader.cs
git commit -m "feat: SettlementSlotResolver — resolve slot rings to map positions at import"
```

---

### Task 7: Version bump + publish

**Files:**
- Modify: `Post Apo Map Editor/MapEditorPro.html` — version string
- Modify: `Post Apo Map Editor/CHANGELOG.md`

- [ ] **Step 1: Bump editor version to v0.7.0**

Replace all occurrences of `v0.6.8` with `v0.7.0` in `MapEditorPro.html`.

- [ ] **Step 2: Add CHANGELOG entry**

```markdown
## v0.7.0 — 2026-05-21

### Features — Settlement Slots
- **Settlement Slots panel**: collapsible "🏘️ Settlement Slots" section in right panel. Add/edit/delete slots with min distance, max distance, count, and type (settlement / outpost / trading_post / custom text).
- **Canvas ring visualization**: each slot renders as a coloured distance ring overlay when settlements are visible. Selected slot ring brightens; others dim. Labels show `type×count` at the ring's due-East tile.
- **Full undo/redo + autosave**: slots are included in History snapshots and persisted via autosave/export.
- **JSON export**: `settlement_slots` section in map export, backwards compatible (missing = empty).
- **Unity resolver**: `SettlementSlotResolver` resolves slots into random `CustomSettlementPositions` at import time using the map seed (deterministic).
```

- [ ] **Step 3: Copy to publish folder**

```bash
cp "Post Apo Map Editor/MapEditorPro.html" "MapEditorPublish/MapEditorPro.html"
cp "Post Apo Map Editor/CHANGELOG.md"      "MapEditorPublish/CHANGELOG.md"
```

- [ ] **Step 4: Commit both repos**

```bash
# Editor
cd "Post Apo Map Editor"
git add MapEditorPro.html CHANGELOG.md
git commit -m "feat: settlement slots — v0.7.0"
git push origin feature/hex-grid

# Unity
cd PostApocCityBuilder
git push origin feature/map-list-panel-sync
```
